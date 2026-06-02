/**
 * Gas estimation for the fire path.
 *
 * Critical safety invariant: the user CANNOT enter armed state without
 * enough gas to cover the Critical + Priority tiers. Standard is
 * always best-effort by definition. If the precondition lies, the user
 * has a false sense of security; refuse to lie.
 *
 * Per-tx cost model (fixed, deterministic):
 *   base fee         5,000   lamports
 *   priority fee   100,000   lamports  (set via ComputeUnitPrice below)
 *   subtotal       105,000   lamports per tx
 *
 * Plus, for any SPL transfer that creates a new destination ATA, the
 * gas wallet covers the ATA rent-exempt minimum (~2.04M lamports per
 * ATA). cNFTs and MPL Core assets DO NOT use ATAs, so they're
 * significantly cheaper at scale — 100 cNFTs are ~200× cheaper than
 * 100 standard SPL NFTs.
 *
 * Precondition baseline:
 *   max(MIN_RESERVE, ceil((critical+priority) cost * 1.20))
 *
 * Packing strategy in fire.ts groups by program ID + NFT format so
 * txs never mix programs. The estimate mirrors that bucketing
 * exactly: a wallet with 11 SPL tokens, 11 Token-2022 tokens, 11 SPL
 * NFTs, 11 cNFTs, and 11 Core NFTs estimates 5 buckets × 2 txs = 10
 * txs even though the asset total only crosses one packing boundary
 * naively.
 */

import type { TokenAccount } from '@/hooks/useWalletScan';

/** Base + priority fee per evac transaction. */
export const PER_TX_LAMPORTS = 105_000;

/** Rent-exempt minimum for a new SPL token account (165 bytes). The
 *  gas wallet pays this when it creates a destination ATA via the
 *  idempotent ATA-create ix. cNFTs and Core assets don't use ATAs. */
export const ATA_RENT_LAMPORTS = 2_039_280;

/** Planning assumption: transfers per v0 transaction. Empirically the
 *  observed cap with ALT-compressed mints + uncompressed ATAs is ~12;
 *  we round down to 10 for a margin. */
export const TRANSFERS_PER_TX = 10;

/** Floor reserve: even an empty evac should keep the gas wallet alive
 *  enough to cover a sweep on disarm. */
export const FLOOR_RESERVE_LAMPORTS = 50_000;

/** 20% safety buffer on the computed minimum. */
const SAFETY_BUFFER_MULTIPLIER = 1.2;

/** ComputeUnitPrice (micro-lamports per CU) tuned with a 200,000 CU
 *  budget so total priority fee per tx is exactly 100,000 lamports. */
export const COMPUTE_UNIT_PRICE_MICRO_LAMPORTS = 500_000;
export const COMPUTE_UNIT_LIMIT = 200_000;

export interface GasEstimate {
  /** Lamports needed to guarantee Critical + Priority tier completion. */
  guaranteedLamports: number;
  /** Lamports needed to guarantee Critical + Priority + Standard. */
  fullLamports: number;
  /** Transaction count for the guaranteed (Critical + Priority) tiers. */
  guaranteedTxCount: number;
  /** Transaction count for the full evac including Standard. */
  fullTxCount: number;
  /** Asset breakdown by tier — used by the confirmation modal. */
  breakdown: {
    critical: TierBreakdown;
    priority: TierBreakdown;
    standard: TierBreakdown;
  };
}

export interface TierBreakdown {
  solCount: number;
  tokenCount: number;
  nftCount: number;
  totalTransfers: number;
  txCount: number;
  lamports: number;
  /** Format-aware NFT sub-counts. Sum equals nftCount. Surfaced for
   *  debugging/logging; the confirmation modal only reads nftCount. */
  nftBreakdown: {
    spl: number;
    cnft: number;
    core: number;
  };
}

import type { PriorityConfig, AssetCategory } from './configStore';

/**
 * Bucket categories used by the gas estimator. Mirrors the packing
 * groups in fire.ts so the estimated tx count matches what the engine
 * will actually emit.
 *
 *   'spl-token'  — fungibles under SPL Token Program
 *   'token-2022' — fungibles + NFTs under SPL Token-2022 (shared
 *                  bucket because fire.ts routes both via the same
 *                  programId)
 *   'spl-nft'    — NFTs under SPL Token Program (separate bucket from
 *                  spl-token for fate isolation)
 *   'cnft'       — Bubblegum compressed NFTs (no ATA rent)
 *   'core'       — MPL Core NFTs (no ATA rent)
 */
type GasBucket = 'spl-token' | 'token-2022' | 'spl-nft' | 'cnft' | 'core';

function classifyAssetBucket(t: TokenAccount): GasBucket {
  if (t.isNft) {
    if (t.nftFormat === 'cnft') return 'cnft';
    if (t.nftFormat === 'core') return 'core';
    // SPL NFT or unknown — both routed through the SPL transfer path
    // for build purposes; unknown will fail in build but still gets
    // budgeted so the precondition doesn't underestimate.
    return t.tokenProgram === 'token-2022' ? 'token-2022' : 'spl-nft';
  }
  return t.tokenProgram === 'token-2022' ? 'token-2022' : 'spl-token';
}

/** Does this bucket create destination ATAs (and therefore pay rent)? */
function bucketUsesAta(b: GasBucket): boolean {
  return b === 'spl-token' || b === 'spl-nft' || b === 'token-2022';
}

/**
 * Compute the gas estimate given the user's wallet contents and
 * priority configuration. Spam-filtered assets are excluded — the
 * caller passes in the de-spam'd token set.
 */
export function estimateGas(
  walletSolBalance: number,
  tokenAccounts: TokenAccount[],
  priority: PriorityConfig,
  isTokenSpam: (mint: string) => boolean,
  nftCollectionOf: (mint: string) => string | null,
  isCollectionSpam: (collectionId: string) => boolean,
): GasEstimate {
  const fungibleTokens = tokenAccounts.filter(
    (t) => !t.isNft && t.uiAmount > 0 && !isTokenSpam(t.mint),
  );
  const nfts = tokenAccounts.filter((t) => {
    if (!t.isNft) return false;
    const collId = nftCollectionOf(t.mint);
    if (collId && isCollectionSpam(collId)) return false;
    if (isTokenSpam(t.mint)) return false;
    return true;
  });

  const breakdown = {
    critical: tierBreakdown(priority.tiers.critical, walletSolBalance, fungibleTokens, nfts),
    priority: tierBreakdown(priority.tiers.priority, walletSolBalance, fungibleTokens, nfts),
    standard: tierBreakdown(priority.tiers.standard, walletSolBalance, fungibleTokens, nfts),
  };

  const guaranteedRaw =
    breakdown.critical.lamports + breakdown.priority.lamports;
  const fullRaw = guaranteedRaw + breakdown.standard.lamports;

  const guaranteedLamports = Math.max(
    FLOOR_RESERVE_LAMPORTS,
    Math.ceil(guaranteedRaw * SAFETY_BUFFER_MULTIPLIER),
  );
  const fullLamports = Math.max(
    FLOOR_RESERVE_LAMPORTS,
    Math.ceil(fullRaw * SAFETY_BUFFER_MULTIPLIER),
  );

  return {
    guaranteedLamports,
    fullLamports,
    guaranteedTxCount: breakdown.critical.txCount + breakdown.priority.txCount,
    fullTxCount:
      breakdown.critical.txCount +
      breakdown.priority.txCount +
      breakdown.standard.txCount,
    breakdown,
  };
}

function tierBreakdown(
  categories: AssetCategory[],
  solBalance: number,
  fungibles: TokenAccount[],
  nfts: TokenAccount[],
): TierBreakdown {
  const includeSol = categories.includes('sol');
  const includeTokens = categories.includes('tokens');
  const includeNfts = categories.includes('nfts');

  const tierFungibles = includeTokens ? fungibles : [];
  const tierNfts = includeNfts ? nfts : [];

  // Bucket by group. The 'token-2022' bucket carries both fungibles
  // and NFTs because fire.ts routes them through the same programId.
  const buckets: Record<GasBucket, number> = {
    'spl-token': 0,
    'token-2022': 0,
    'spl-nft': 0,
    cnft: 0,
    core: 0,
  };
  for (const t of tierFungibles) buckets[classifyAssetBucket(t)]++;
  for (const n of tierNfts) buckets[classifyAssetBucket(n)]++;

  // Per-bucket tx count + ATA rent. SOL is its own single-ix bucket.
  let txCount = includeSol && solBalance > 0 ? 1 : 0;
  let ataRent = 0;
  for (const bucket of Object.keys(buckets) as GasBucket[]) {
    const count = buckets[bucket];
    if (count === 0) continue;
    txCount += Math.ceil(count / TRANSFERS_PER_TX);
    if (bucketUsesAta(bucket)) ataRent += count * ATA_RENT_LAMPORTS;
  }

  const solCount = includeSol && solBalance > 0 ? 1 : 0;
  const tokenCount = tierFungibles.length;
  const nftCount = tierNfts.length;

  return {
    solCount,
    tokenCount,
    nftCount,
    totalTransfers: solCount + tokenCount + nftCount,
    txCount,
    lamports: txCount * PER_TX_LAMPORTS + ataRent,
    nftBreakdown: {
      spl: tierNfts.filter((n) => classifyAssetBucket(n) === 'spl-nft' || classifyAssetBucket(n) === 'token-2022').length,
      cnft: tierNfts.filter((n) => classifyAssetBucket(n) === 'cnft').length,
      core: tierNfts.filter((n) => classifyAssetBucket(n) === 'core').length,
    },
  };
}

/**
 * Live gas-sufficiency status. Computed from estimate + current gas
 * reserve. Used by the armed-state display and the precondition gate.
 */
export type GasStatus =
  | { kind: 'sufficient-full' }       // covers full evac including Standard
  | { kind: 'sufficient-guaranteed' } // covers Critical + Priority only
  | { kind: 'insufficient'; shortfallLamports: number };

export function assessGas(
  gasReserveLamports: number,
  estimate: GasEstimate,
): GasStatus {
  if (gasReserveLamports >= estimate.fullLamports) {
    return { kind: 'sufficient-full' };
  }
  if (gasReserveLamports >= estimate.guaranteedLamports) {
    return { kind: 'sufficient-guaranteed' };
  }
  return {
    kind: 'insufficient',
    shortfallLamports: estimate.guaranteedLamports - gasReserveLamports,
  };
}
