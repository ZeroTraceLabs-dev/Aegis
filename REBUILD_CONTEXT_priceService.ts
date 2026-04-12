/**
 * Centralized Price Service for ZeroTraceLabs
 *
 * Single source of truth for all USD prices:
 * 1. Helius DAS price_per_token (fungible tokens -- injected from useTokenMetadata)
 * 2. Jupiter Price API v2  (fungible tokens + SOL -- client-side, no CORS issues)
 * 3. Supabase edge function -> Magic Eden API (NFT floor prices -- server-side proxy, no CORS)
 *
 * All components subscribe via a simple revision counter.
 */

// ── Constants ──
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ── Supabase config ──
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// ── Global Price Cache ──
const priceCache = new Map<string, number>();
const nftFloorCache = new Map<string, { floor: number; source: string }>();
let solPrice = 0;

// Maps NFT mint -> collection address (populated from DAS grouping data)
const nftCollectionMap = new Map<string, string>();

// ── Subscription system ──
let revision = 0;
const subscribers = new Set<() => void>();

function notify() {
  revision++;
  subscribers.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => { subscribers.delete(fn); };
}

export function getRevision() {
  return revision;
}

// ── Public Getters ──

export function getPrice(mint: string): number | null {
  if (mint === 'native' || mint === SOL_MINT) return solPrice > 0 ? solPrice : null;
  return priceCache.get(mint) ?? null;
}

export function getSolPrice(): number {
  return solPrice;
}

export function getUsdValue(mint: string, amount: number): number | null {
  if (mint === 'native' || mint === SOL_MINT) {
    return solPrice > 0 ? amount * solPrice : null;
  }
  const p = priceCache.get(mint);
  if (p && p > 0) return amount * p;
  const nftFloor = nftFloorCache.get(mint);
  if (nftFloor && nftFloor.floor > 0) return amount * nftFloor.floor;
  return null;
}

export function getNftFloor(mint: string): { floor: number; source: string } | null {
  return nftFloorCache.get(mint) ?? null;
}

export function getAllPrices(): Map<string, number> {
  return new Map(priceCache);
}

export function formatUsd(value: number | null): string {
  if (value === null || value === undefined) return '--';
  if (value === 0) return '$0.00';
  if (value < 0.01) return '<$0.01';
  if (value < 1) return `$${value.toFixed(4)}`;
  if (value < 1000) return `$${value.toFixed(2)}`;
  if (value < 1_000_000) return `$${(value / 1000).toFixed(2)}K`;
  return `$${(value / 1_000_000).toFixed(2)}M`;
}

/**
 * Returns the NFT collection map so the edge function knows
 * which NFTs belong to which collection.
 */
export function getCollectionMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [mint, coll] of nftCollectionMap) {
    map[mint] = coll;
  }
  return map;
}

// ── Inject: Helius DAS prices (called from useTokenMetadata) ──

export function injectDasPrices(assets: Array<{
  id: string;
  token_info?: {
    price_info?: {
      price_per_token?: number;
    };
  };
}>) {
  let count = 0;
  for (const asset of assets) {
    const price = asset.token_info?.price_info?.price_per_token;
    if (price && price > 0 && asset.id) {
      priceCache.set(asset.id, price);
      count++;
      if (asset.id === SOL_MINT) {
        solPrice = price;
      }
    }
  }
  if (count > 0) {
    console.log(`[PriceService] DAS injected ${count} prices. SOL=$${solPrice.toFixed(2)}`);
    notify();
  }
}

/**
 * Extract collection grouping from DAS assets.
 * Stores mint->collection mapping for the edge function.
 */
export function extractNftCollections(assets: Array<{
  id: string;
  interface?: string;
  token_info?: { decimals?: number };
  grouping?: Array<{
    group_key: string;
    group_value: string;
  }>;
}>) {
  let count = 0;
  for (const asset of assets) {
    const isNft = asset.interface === 'V1_NFT' || asset.interface === 'ProgrammableNFT'
      || asset.interface === 'V2_NFT' || (asset.token_info?.decimals === 0);
    if (!isNft) continue;

    const collection = asset.grouping?.find((g) => g.group_key === 'collection');
    if (collection?.group_value) {
      nftCollectionMap.set(asset.id, collection.group_value);
      count++;
    }
  }
  if (count > 0) {
    console.log(`[PriceService] Mapped ${count} NFTs to ${new Set(nftCollectionMap.values()).size} collections`);
  }
}

// ── Fetch: SOL Price (independent, guaranteed) ──

let solPriceFetching = false;

export async function ensureSolPrice(): Promise<number> {
  if (solPrice > 0) return solPrice;
  if (solPriceFetching) return solPrice;
  solPriceFetching = true;

  try {
    console.log('[PriceService] Fetching SOL price from Jupiter...');
    const resp = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      const json = await resp.json();
      const priceVal = json?.data?.[SOL_MINT]?.price;
      if (priceVal) {
        const num = typeof priceVal === 'string' ? parseFloat(priceVal) : Number(priceVal);
        if (!isNaN(num) && num > 0) {
          solPrice = num;
          priceCache.set(SOL_MINT, num);
          console.log(`[PriceService] SOL price: $${solPrice.toFixed(2)}`);
          notify();
        }
      }
    }
  } catch (err) {
    console.warn('[PriceService] SOL price fetch failed:', err);
  } finally {
    solPriceFetching = false;
  }

  return solPrice;
}

// ── Fetch: Jupiter Price API v2 (fungible tokens) ──

const fetchedMints = new Set<string>();
let activeFetch: Promise<void> | null = null;

export async function fetchJupiterPrices(mints: string[]): Promise<void> {
  if (activeFetch) {
    await activeFetch;
  }

  const uniqueMints = [...new Set(mints.filter((m) => m && m !== 'native'))];
  if (!uniqueMints.includes(SOL_MINT)) uniqueMints.push(SOL_MINT);

  const toFetch = uniqueMints.filter((m) => !fetchedMints.has(m) || m === SOL_MINT);
  if (toFetch.length === 0) {
    notify();
    return;
  }

  const doFetch = async () => {
    try {
      const batchSize = 100;
      for (let i = 0; i < toFetch.length; i += batchSize) {
        const batch = toFetch.slice(i, i + batchSize);
        const ids = batch.join(',');

        console.log(`[PriceService] Jupiter batch ${Math.floor(i / batchSize) + 1}: ${batch.length} mints`);

        const resp = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`, {
          signal: AbortSignal.timeout(15000),
        });

        if (!resp.ok) {
          console.warn(`[PriceService] Jupiter HTTP ${resp.status}`);
          continue;
        }

        const json = await resp.json();
        const data = json?.data;

        if (data && typeof data === 'object') {
          let newPrices = 0;
          for (const [mint, info] of Object.entries(data)) {
            const priceVal = (info as any)?.price;
            if (priceVal !== undefined && priceVal !== null) {
              const num = typeof priceVal === 'string' ? parseFloat(priceVal) : Number(priceVal);
              if (!isNaN(num) && num > 0) {
                priceCache.set(mint, num);
                newPrices++;
                if (mint === SOL_MINT) solPrice = num;
              }
            }
            fetchedMints.add(mint);
          }
          for (const m of batch) {
            fetchedMints.add(m);
          }
          console.log(`[PriceService] Jupiter batch got ${newPrices} prices`);
        }

        if (i + batchSize < toFetch.length) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      console.log(`[PriceService] Jupiter complete. SOL=$${solPrice.toFixed(2)}, total cached: ${priceCache.size}`);
      notify();
    } catch (err) {
      console.warn('[PriceService] Jupiter error:', err);
    } finally {
      activeFetch = null;
    }
  };

  activeFetch = doFetch();
  return activeFetch;
}

// ── Fetch: NFT Floor Prices via Supabase Edge Function ──
// This calls our server-side proxy which hits Magic Eden API (no CORS).

let nftFloorFetching = false;

export async function fetchNftFloorPrices(nftMints: string[]): Promise<void> {
  if (nftMints.length === 0 || nftFloorFetching) return;

  const uncached = nftMints.filter((m) => !nftFloorCache.has(m));
  if (uncached.length === 0) {
    console.log('[PriceService] All NFTs already have floor prices');
    return;
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn('[PriceService] Supabase not configured -- cannot fetch NFT floors');
    return;
  }

  nftFloorFetching = true;
  console.log(`[PriceService] Calling edge function for ${uncached.length} NFT floor prices...`);

  try {
    const collectionMap = getCollectionMap();

    const resp = await fetch(`${SUPABASE_URL}/functions/v1/nft-prices`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        nftMints: uncached,
        collectionMap,
      }),
      signal: AbortSignal.timeout(60000), // 60s -- ME lookups can be slow
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.warn(`[PriceService] Edge function HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return;
    }

    const data = await resp.json();

    // Update SOL price if edge function returned one (backup)
    if (data.solPrice && data.solPrice > 0 && solPrice <= 0) {
      solPrice = data.solPrice;
      priceCache.set(SOL_MINT, solPrice);
      console.log(`[PriceService] SOL price from edge function: $${solPrice.toFixed(2)}`);
    }

    // Inject NFT floor prices
    const floors = data.floors || {};
    let pricedCount = 0;

    for (const [mint, floorData] of Object.entries(floors)) {
      const fd = floorData as { floorSol: number; floorUsd: number; source: string };
      if (fd.floorUsd > 0) {
        nftFloorCache.set(mint, { floor: fd.floorUsd, source: fd.source });
        priceCache.set(mint, fd.floorUsd);
        pricedCount++;
      } else if (fd.floorSol > 0 && solPrice > 0) {
        const usd = fd.floorSol * solPrice;
        nftFloorCache.set(mint, { floor: usd, source: fd.source });
        priceCache.set(mint, usd);
        pricedCount++;
      }
    }

    console.log(`[PriceService] Edge function returned ${pricedCount}/${uncached.length} NFT floor prices`);
    if (pricedCount > 0) notify();
  } catch (err) {
    console.warn('[PriceService] Edge function error:', err);
  } finally {
    nftFloorFetching = false;
  }
}
