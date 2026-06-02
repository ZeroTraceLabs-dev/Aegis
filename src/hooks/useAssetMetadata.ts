/**
 * useAssetMetadata — 4-tier metadata resolution (v7).
 * ZERO top-level imports from @solana/web3.js.
 *
 * Hook count: EXACTLY 6 unconditional hooks every render.
 * 1. useState(metadata)  2. useState(dasNfts)  3. useRef  4. useMemo
 * 5. useEffect(cleanup)  6. useEffect(allTiers)
 *
 * NEW: also returns `dasNfts` -- NFT-like assets discovered by DAS that may
 * not appear in the SPL token list (compressed NFTs, pNFTs, etc.)
 */
import { useEffect, useState, useRef, useMemo } from 'react';
import { RPC_ENDPOINT } from '@/lib/rpc';
import { injectDasPrices, extractNftCollections } from '@/lib/priceService';
import { getTokenListMap } from '@/lib/tokenService';
import type { TokenData } from '@/types/token';

export interface TokenMeta {
  symbol: string;
  name: string;
  image?: string;
  decimals?: number;
}

/**
 * NFT format discriminator copied from useWalletScan.NftFormat so this
 * module doesn't depend on the scan hook. Drives transfer-path routing
 * downstream in the fire engine.
 */
export type DasNftFormat = 'spl' | 'cnft' | 'core' | 'unknown';

/** Same shape as TokenProgramTag in useWalletScan; duplicated here to
 *  keep the hooks decoupled. Only meaningful when format='spl'. */
export type DasTokenProgramTag = 'spl' | 'token-2022';

/** An NFT discovered by DAS that may not be in the SPL token list */
export interface DasNft {
  mint: string;
  name: string;
  symbol: string;
  image: string;
  compressed: boolean;
  collection?: string;
  /** Definitive format classification. Initially seeded from DAS's
   *  `interface` field, then overridden by an on-chain owner-program
   *  check (TIER 1.2 below) when the two disagree. 'unknown' means we
   *  can't safely transfer the asset — fire path excludes it. */
  format: DasNftFormat;
  /** When format='spl', whether the mint is owned by SPL Token Program
   *  or Token-2022 Program. Irrelevant for cNFT and Core. */
  tokenProgram: DasTokenProgramTag;
}

// ── Canonical program IDs used by the owner-program check ────────
// Hardcoded as base58 strings so this module doesn't import @solana/web3.js
// or @metaplex-foundation/mpl-core at the top level (kept off the hot path).
const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
// Verified against node_modules/@metaplex-foundation/mpl-core's MPL_CORE_PROGRAM_ID.
const MPL_CORE_PROGRAM_ID = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';

interface OwnerClassification {
  format: DasNftFormat;
  tokenProgram: DasTokenProgramTag;
}

/**
 * Map an on-chain mint-account owner program to the format + token
 * program our fire path needs. This is ground truth — it overrides
 * whatever DAS reported in its `interface` field, because DAS has
 * been observed to mislabel MPL Core assets as V1_NFT.
 *
 * The compressed flag from DAS is consulted ONLY when the mint
 * account doesn't exist on-chain (Bubblegum doesn't create individual
 * mint accounts — the leaf hash lives in a Merkle tree). If DAS said
 * compressed=true and the mint is missing, it's a cNFT; otherwise we
 * can't classify it and surface 'unknown'.
 */
function classifyByOwner(
  owner: string | null,
  dasCompressed: boolean,
): OwnerClassification {
  if (owner === TOKEN_PROGRAM_ID) return { format: 'spl', tokenProgram: 'spl' };
  if (owner === TOKEN_2022_PROGRAM_ID) return { format: 'spl', tokenProgram: 'token-2022' };
  if (owner === MPL_CORE_PROGRAM_ID) return { format: 'core', tokenProgram: 'spl' };
  if (owner === null) {
    return { format: dasCompressed ? 'cnft' : 'unknown', tokenProgram: 'spl' };
  }
  return { format: 'unknown', tokenProgram: 'spl' };
}

/**
 * Batch-fetch the on-chain owner program for each mint via
 * getMultipleAccounts (up to 100 per RPC call). Returns a Map keyed
 * by mint address; the value is the owner program ID, or null if the
 * account doesn't exist on-chain (expected for cNFTs), or absent
 * from the Map entirely if the batch errored (caller treats that as
 * "fall back to DAS classification").
 */
async function fetchMintOwners(
  rpcUrl: string,
  mints: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const BATCH = 100;
  for (let i = 0; i < mints.length; i += BATCH) {
    const batch = mints.slice(i, i + BATCH);
    try {
      const r = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'owner-check',
          method: 'getMultipleAccounts',
          params: [batch, { commitment: 'confirmed', encoding: 'base64' }],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        console.warn(`[Meta] owner-check HTTP ${r.status} on batch ${i}`);
        continue;
      }
      const json = await r.json();
      const values: Array<{ owner: string } | null> = json?.result?.value || [];
      for (let j = 0; j < batch.length; j++) {
        const value = values[j];
        out.set(batch[j], value ? value.owner : null);
      }
    } catch (e) {
      console.warn(`[Meta] owner-check batch ${i} failed:`, e);
      // Don't set entries — caller treats absence as "keep DAS classification"
    }
  }
  return out;
}

/**
 * Classify a DAS asset's NFT transfer format. Centralised so any
 * future DAS-interface additions land in one place.
 *
 * Rules:
 *   MplCoreAsset                        → 'core'
 *   any compressed asset (Bubblegum)    → 'cnft'
 *   V1_NFT / V2_NFT / ProgrammableNFT   → 'spl'  (Metaplex/SPL Token-based)
 *   anything else NFT-like              → 'unknown'
 *
 * pNFT (ProgrammableNFT) is treated as 'spl' per the brief — most
 * transfer fine via createTransferCheckedInstruction; rule-set
 * failures surface in the per-tx error report.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectNftFormatFromDas(item: any): DasNftFormat {
  const iface = item.interface || '';
  if (iface === 'MplCoreAsset') return 'core';
  if (item.compression?.compressed === true) return 'cnft';
  if (iface === 'V1_NFT' || iface === 'V2_NFT' || iface === 'ProgrammableNFT') return 'spl';
  return 'unknown';
}

const _cache = new Map<string, TokenMeta>();
const _dasNftCache: DasNft[] = [];
let _dasRan: Promise<void> | null = null;
let _jupListRan = false;
const _jupDone = new Set<string>();
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Resolve image from a json_uri. Used when DAS doesn't have a direct image link.
 */
async function resolveJsonUri(jsonUri: string): Promise<string> {
  if (!jsonUri || !jsonUri.startsWith('http')) return '';
  try {
    // Convert IPFS URIs to gateway
    const url = jsonUri.startsWith('ipfs://')
      ? `https://ipfs.io/ipfs/${jsonUri.slice(7)}`
      : jsonUri;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return '';
    const json = await r.json();
    const img = json.image || json.properties?.files?.[0]?.uri || '';
    // Also resolve ipfs:// in the image field
    if (img && img.startsWith('ipfs://')) {
      return `https://ipfs.io/ipfs/${img.slice(7)}`;
    }
    return img || '';
  } catch {
    return '';
  }
}

/**
 * Extract image from a DAS asset item, trying all known locations.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImage(item: any): string {
  return (
    item.content?.links?.image ||
    item.content?.files?.[0]?.cdn_uri ||
    item.content?.files?.[0]?.uri ||
    ''
  );
}

/**
 * Determine if a DAS asset is an NFT-like item.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isDasNft(item: any): boolean {
  const iface = item.interface || '';
  if (['V1_NFT', 'V2_NFT', 'ProgrammableNFT', 'MplCoreAsset'].includes(iface)) return true;
  if (item.compression?.compressed) return true;
  if (item.token_info?.decimals === 0 && item.content?.metadata?.name) return true;
  return false;
}

export function useTokenMetadata(
  mints: string[],
  ownerAddress?: string,
): { metadata: Map<string, TokenMeta>; dasNfts: DasNft[] } {
  // ── Hook 1: metadata state ──
  const [metadata, setMetadata] = useState<Map<string, TokenMeta>>(new Map());
  // ── Hook 2: discovered DAS NFTs ──
  const [dasNfts, setDasNfts] = useState<DasNft[]>([]);
  // ── Hook 3: alive ref ──
  const alive = useRef(true);
  // ── Hook 4: mintsKey memo ──
  const mintsKey = useMemo(() => mints.join(','), [mints]);

  const hasMints = mints.length > 0;

  // ── Hook 5: cleanup ──
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // ── Hook 6: ALL tiers in one effect ──
  useEffect(() => {
    if (!hasMints && !ownerAddress) return;

    let cancelled = false;

    (async () => {
      // ════════════════════════════���══════════════════════════════
      // TIER 1: Helius DAS getAssetsByOwner
      // ═══════════════════════════════════════════════════════════
      if (ownerAddress && !_dasRan) {
        _dasRan = (async () => {
          try {
            console.log('[Meta] T1: DAS getAssetsByOwner');
            const r = await fetch(RPC_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 'das',
                method: 'getAssetsByOwner',
                params: {
                  ownerAddress, page: 1, limit: 1000,
                  displayOptions: {
                    showFungible: true,
                    showNativeBalance: false,
                    showCollectionMetadata: true,
                    showUnverifiedCollections: true,
                  },
                },
              }),
              signal: AbortSignal.timeout(30000),
            });

            if (!r.ok) { console.warn('[Meta] DAS HTTP', r.status); return; }

            const json = await r.json();
            const items = json?.result?.items || [];
            console.log(`[Meta] DAS returned ${items.length} assets`);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const dasItems: any[] = [];
            // Track json_uris that need follow-up for images
            const needJsonUri: { mint: string; uri: string }[] = [];

            for (const item of items) {
              const id = item.id;
              if (!id) continue;

              const image = extractImage(item);
              const m: TokenMeta = {
                symbol: item.content?.metadata?.symbol || item.token_info?.symbol || '',
                name: item.content?.metadata?.name || '',
                image,
                decimals: item.token_info?.decimals,
              };

              if (m.symbol || m.name || m.image) _cache.set(id, m);
              dasItems.push(item);

              // Track NFT-like assets for the dasNfts list
              if (isDasNft(item)) {
                const collGroup = item.grouping?.find(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (g: any) => g.group_key === 'collection',
                );

                const format = detectNftFormatFromDas(item);
                if (format === 'unknown') {
                  console.warn(`[Meta] Unknown NFT format for ${id} (interface=${item.interface}). Excluded from evac.`);
                }
                _dasNftCache.push({
                  mint: id,
                  name: m.name || `NFT ${id.slice(0, 4)}...${id.slice(-4)}`,
                  symbol: m.symbol,
                  image: image,
                  compressed: !!item.compression?.compressed,
                  collection: collGroup?.group_value || undefined,
                  format,
                  // Seeded from DAS; potentially overridden by TIER 1.2
                  // owner-program check below.
                  tokenProgram: 'spl',
                });
              }

              // Queue json_uri follow-up for imageless assets
              if (!image && item.content?.json_uri) {
                needJsonUri.push({ mint: id, uri: item.content.json_uri });
              }
            }

            injectDasPrices(dasItems);
            extractNftCollections(dasItems);
            console.log(`[Meta] DAS resolved ${_cache.size} metadata, ${_dasNftCache.length} NFTs discovered`);

            // Follow up on json_uris in parallel (batched)
            if (needJsonUri.length > 0) {
              console.log(`[Meta] Following ${needJsonUri.length} json_uris for images...`);
              const PARALLEL = 10;
              for (let i = 0; i < needJsonUri.length; i += PARALLEL) {
                const batch = needJsonUri.slice(i, i + PARALLEL);
                const results = await Promise.allSettled(
                  batch.map(async ({ mint, uri }) => {
                    const img = await resolveJsonUri(uri);
                    if (img) {
                      const prev = _cache.get(mint);
                      if (prev) _cache.set(mint, { ...prev, image: img });
                      // Also update the dasNft entry
                      const nftEntry = _dasNftCache.find((n) => n.mint === mint);
                      if (nftEntry) nftEntry.image = img;
                    }
                    return { mint, img };
                  }),
                );
                const resolved = results.filter(
                  (r) => r.status === 'fulfilled' && r.value.img,
                ).length;
                if (resolved > 0) {
                  console.log(`[Meta] json_uri batch resolved ${resolved} images`);
                }
              }
            }

            // ═══════════════════════════════════════════════════════════
            // TIER 1.2: On-chain owner-program verification (ground truth)
            // ═══════════════════════════════════════════════════════════
            // DAS has been observed to mislabel MPL Core assets as V1_NFT
            // (e.g. Misfit collection on the bait wallet). Trusting DAS
            // alone routes those through the SPL transfer path, where
            // ATA-create rejects the mint with IncorrectProgramId because
            // the mint isn't owned by SPL Token Program.
            //
            // Fix: batch-fetch the mint accounts and classify each by its
            // actual on-chain owner program. Override the DAS-derived
            // format whenever the two disagree. DAS's compressed flag is
            // still consulted for cNFTs (mints absent from chain).
            if (_dasNftCache.length > 0) {
              const nftMints = _dasNftCache.map((n) => n.mint);
              console.log(`[Meta] T1.2: Owner-program check for ${nftMints.length} NFTs`);
              const owners = await fetchMintOwners(RPC_ENDPOINT, nftMints);
              let overrides = 0;
              for (const entry of _dasNftCache) {
                if (!owners.has(entry.mint)) continue; // batch errored — keep DAS classification
                const owner = owners.get(entry.mint) ?? null;
                const cls = classifyByOwner(owner, entry.compressed);
                if (cls.format !== entry.format) {
                  console.log(
                    `[Meta] Owner-program override for ${entry.mint}: ` +
                      `DAS said '${entry.format}', on-chain owner ${owner ?? 'null'} → '${cls.format}'`,
                  );
                  entry.format = cls.format;
                  overrides++;
                }
                entry.tokenProgram = cls.tokenProgram;
              }
              if (overrides > 0) {
                console.log(`[Meta] T1.2 applied ${overrides} format override(s)`);
              }
            }
          } catch (e) {
            console.warn('[Meta] DAS error:', e);
          }
        })();
      }

      // Wait for DAS if it's running
      if (_dasRan) await _dasRan;
      if (cancelled) return;

      // Push DAS results to state
      setMetadata(new Map(_cache));
      if (_dasNftCache.length > 0) setDasNfts([..._dasNftCache]);

      // ═════════════════���═════════════════════════════════════════
      // TIER 1.5: Jupiter strict token list
      // ═══════════════════════════════════════════════════════════
      if (!_jupListRan && mints.length > 0) {
        _jupListRan = true;
        try {
          const tokenMap: Map<string, TokenData> = await getTokenListMap();
          if (tokenMap.size > 0) {
            let enriched = 0;
            for (const mint of mints) {
              if (mint === 'native') continue;
              const existing = _cache.get(mint);
              if (existing?.symbol && !existing.symbol.includes('..') && existing.image) continue;
              const td = tokenMap.get(mint);
              if (td) {
                _cache.set(mint, {
                  symbol: (existing?.symbol && !existing.symbol.includes('..')) ? existing.symbol : td.symbol,
                  name: (existing?.name && !existing.name.includes('..')) ? existing.name : td.name,
                  image: existing?.image || td.logoURI || '',
                  decimals: existing?.decimals ?? td.decimals,
                });
                enriched++;
              }
            }
            if (enriched > 0 && !cancelled) {
              console.log(`[Meta] T1.5: Jupiter list enriched ${enriched}`);
              setMetadata(new Map(_cache));
            }
          }
        } catch (e) {
          console.warn('[Meta] Jupiter list error:', e);
        }
      }

      if (cancelled) return;

      // ═══════════════════════════════════════════════════════════
      // TIER 2: Jupiter per-token API (tokens without metadata)
      // ═══════════════════════════════════════════════════════════
      const jupNeed = mints.filter((m) => {
        if (m === 'native' || _jupDone.has(m)) return false;
        const c = _cache.get(m);
        return !(c?.symbol && !c.symbol.includes('..'));
      });

      if (jupNeed.length > 0) {
        console.log(`[Meta] T2: Jupiter per-token ${jupNeed.length}`);
        let count = 0;
        for (const mint of jupNeed) {
          if (cancelled || _jupDone.has(mint)) continue;
          try {
            const r = await fetch(`https://api.jup.ag/tokens/v1/${mint}`, {
              signal: AbortSignal.timeout(8000),
            });
            if (r.ok) {
              const d = await r.json();
              if (d?.symbol || d?.name) {
                _cache.set(mint, {
                  symbol: d.symbol || '', name: d.name || '',
                  image: d.logoURI || '', decimals: d.decimals,
                });
                count++;
                if (!cancelled && count % 5 === 0) setMetadata(new Map(_cache));
              }
            } else if (r.status === 429) {
              await wait(2000);
            }
          } catch { /* silent */ }
          _jupDone.add(mint);
          await wait(400);
        }
        if (count > 0 && !cancelled) {
          console.log(`[Meta] Jupiter per-token resolved ${count}`);
          setMetadata(new Map(_cache));
        }
      }

      if (cancelled) return;

      // ════════════════════════════════════════════════════════���══
      // TIER 2.5: DAS getAssetBatch for imageless assets
      // ═══════════════════════════════════════════════════════════
      // Collect ALL known mints (from props + discovered DAS NFTs)
      const allKnown = new Set(mints);
      for (const n of _dasNftCache) allKnown.add(n.mint);

      const needImage = [...allKnown].filter((m) => {
        if (m === 'native') return false;
        return !_cache.get(m)?.image;
      });

      if (needImage.length > 0) {
        console.log(`[Meta] T2.5: DAS getAssetBatch for ${needImage.length} imageless`);
        const BATCH = 100;

        for (let i = 0; i < needImage.length; i += BATCH) {
          if (cancelled) break;
          const batch = needImage.slice(i, i + BATCH).filter((m) => !_cache.get(m)?.image);
          if (batch.length === 0) continue;

          try {
            const r = await fetch(RPC_ENDPOINT, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                jsonrpc: '2.0', id: 'das-batch',
                method: 'getAssetBatch',
                params: { ids: batch },
              }),
              signal: AbortSignal.timeout(20000),
            });

            if (!r.ok) continue;
            const json = await r.json();
            const results = json?.result || [];
            let resolved = 0;

            // Collect json_uris that need follow-up
            const followUp: { mint: string; uri: string }[] = [];

            for (const item of results) {
              if (!item?.id) continue;
              const mint = item.id;
              const prev = _cache.get(mint);
              if (prev?.image) continue;

              let image = extractImage(item);
              const symbol = item.content?.metadata?.symbol || item.token_info?.symbol || prev?.symbol || '';
              const name = item.content?.metadata?.name || prev?.name || '';

              if (!image && item.content?.json_uri) {
                followUp.push({ mint, uri: item.content.json_uri });
              }

              if (image || symbol || name) {
                _cache.set(mint, {
                  symbol: (prev?.symbol && !prev.symbol.includes('..')) ? prev.symbol : symbol,
                  name: (prev?.name && !prev.name.includes('..')) ? prev.name : name,
                  image: image || prev?.image || '',
                  decimals: prev?.decimals ?? item.token_info?.decimals ?? 0,
                });
                if (image) resolved++;
              }
            }

            // Follow up json_uris in parallel
            if (followUp.length > 0) {
              await Promise.allSettled(
                followUp.map(async ({ mint, uri }) => {
                  const img = await resolveJsonUri(uri);
                  if (img) {
                    const prev = _cache.get(mint);
                    if (prev) _cache.set(mint, { ...prev, image: img });
                    const nftEntry = _dasNftCache.find((n) => n.mint === mint);
                    if (nftEntry) nftEntry.image = img;
                    resolved++;
                  }
                }),
              );
            }

            if (resolved > 0 && !cancelled) {
              console.log(`[Meta] DAS getAssetBatch resolved ${resolved} images`);
              setMetadata(new Map(_cache));
              setDasNfts([..._dasNftCache]);
            }
          } catch (e) {
            console.warn('[Meta] DAS getAssetBatch error:', e);
          }
          await wait(300);
        }
      }

      if (cancelled) return;

      // ════════════��══════════════════════════════════════════════
      // TIER 3: Metaplex on-chain (last resort for NFTs without images)
      // ═══════════════════════════════════════════════════════════
      const nftMints = [...allKnown].filter((m) => {
        if (m === 'native') return false;
        const c = _cache.get(m);
        if (c?.image) return false;
        if (c?.decimals !== undefined && c.decimals > 0) return false;
        return true;
      });

      if (nftMints.length === 0) return;

      let PK: typeof import('@solana/web3.js').PublicKey;
      let metaplexId: InstanceType<typeof PK>;
      try {
        const web3 = await import('@solana/web3.js');
        PK = web3.PublicKey;
        metaplexId = new PK('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
      } catch (e) {
        console.warn('[Meta] Metaplex init failed:', e);
        return;
      }

      console.log(`[Meta] T3: Metaplex ${nftMints.length} NFTs`);
      const MPLEX_BATCH = 20;

      for (let i = 0; i < nftMints.length; i += MPLEX_BATCH) {
        if (cancelled) break;
        const batch = nftMints.slice(i, i + MPLEX_BATCH);

        try {
          const pdas = batch.map((mint) => {
            const mk = new PK(mint);
            const [pda] = PK.findProgramAddressSync(
              [new TextEncoder().encode('metadata'), metaplexId.toBytes(), mk.toBytes()],
              metaplexId,
            );
            return pda;
          });

          const r = await fetch(RPC_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              jsonrpc: '2.0', id: 'mplex',
              method: 'getMultipleAccounts',
              params: [pdas.map((p) => p.toBase58()), { encoding: 'base64' }],
            }),
            signal: AbortSignal.timeout(15000),
          });

          if (!r.ok) continue;
          const rJson = await r.json();
          const accs = rJson?.result?.value || [];

          for (let j = 0; j < accs.length; j++) {
            const acc = accs[j];
            if (!acc?.data?.[0]) continue;
            const mint = batch[j];
            const prev = _cache.get(mint);
            if (prev?.image) continue;

            try {
              const raw = Uint8Array.from(atob(acc.data[0]), (ch) => ch.charCodeAt(0));
              let off = 1 + 32 + 32;

              const nLen = raw[off] | (raw[off+1] << 8) | (raw[off+2] << 16) | (raw[off+3] << 24);
              off += 4;
              const name = new TextDecoder().decode(raw.slice(off, off + Math.min(nLen, 64))).replace(/\0/g, '').trim();
              off += nLen;

              const sLen = raw[off] | (raw[off+1] << 8) | (raw[off+2] << 16) | (raw[off+3] << 24);
              off += 4;
              const symbol = new TextDecoder().decode(raw.slice(off, off + Math.min(sLen, 32))).replace(/\0/g, '').trim();
              off += sLen;

              const uLen = raw[off] | (raw[off+1] << 8) | (raw[off+2] << 16) | (raw[off+3] << 24);
              off += 4;
              const uri = new TextDecoder().decode(raw.slice(off, off + Math.min(uLen, 256))).replace(/\0/g, '').trim();

              if (name || symbol) {
                _cache.set(mint, {
                  symbol: symbol || prev?.symbol || '',
                  name: name || prev?.name || '',
                  image: prev?.image || '',
                  decimals: prev?.decimals ?? 0,
                });
              }

              if (uri && uri.startsWith('http')) {
                const img = await resolveJsonUri(uri);
                if (img) {
                  const cur = _cache.get(mint);
                  if (cur) _cache.set(mint, { ...cur, image: img });
                  const nftEntry = _dasNftCache.find((n) => n.mint === mint);
                  if (nftEntry) nftEntry.image = img;
                }
              }
            } catch { /* decode error */ }
          }

          if (!cancelled) {
            setMetadata(new Map(_cache));
            setDasNfts([..._dasNftCache]);
          }
        } catch (e) {
          console.warn('[Meta] Metaplex batch error:', e);
        }
        await wait(600);
      }

      if (!cancelled) {
        console.log(`[Meta] All tiers complete`);
        setMetadata(new Map(_cache));
        setDasNfts([..._dasNftCache]);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintsKey, ownerAddress]);

  return { metadata, dasNfts };
}