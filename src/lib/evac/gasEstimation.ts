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
 * With a +20% safety buffer the required reserve is:
 *   max(MIN_RESERVE, ceil(critical_priority_txs * 105,000 * 1.20))
 *
 * Transfers per tx is the crux. With an ALT compressing well-known
 * programs and mint addresses, but with source/destination ATAs as
 * uncompressed accounts, real-world packing lands closer to 8-12
 * transfers per tx. We use 10 as the planning assumption — slightly
 * pessimistic, so the precondition rarely under-provisions.
 */

import type { TokenAccount } from '@/hooks/useWalletScan';

/** Base + priority fee per evac transaction. */
export const PER_TX_LAMPORTS = 105_000;

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
}

import type { PriorityConfig, AssetCategory } from './configStore';

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
  // Categorize assets. SOL is "1 transfer" if balance > 0; tokens and
  // nfts are counted individually after spam filtering.
  const fungibleTokens = tokenAccounts.filter(
    (t) => !t.isNft && t.uiAmount > 0 && !isTokenSpam(t.mint),
  );
  const nfts = tokenAccounts.filter((t) => {
    if (!t.isNft) return false;
    const collId = nftCollectionOf(t.mint);
    // NFTs without a known collection still evacuate but pass the spam
    // check on the mint itself.
    if (collId && isCollectionSpam(collId)) return false;
    if (isTokenSpam(t.mint)) return false;
    return true;
  });

  const counts = {
    sol: walletSolBalance > 0 ? 1 : 0,
    tokens: fungibleTokens.length,
    nfts: nfts.length,
  };

  const breakdown = {
    critical: tierBreakdown(priority.tiers.critical, counts),
    priority: tierBreakdown(priority.tiers.priority, counts),
    standard: tierBreakdown(priority.tiers.standard, counts),
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
  counts: { sol: number; tokens: number; nfts: number },
): TierBreakdown {
  const solCount = categories.includes('sol') ? counts.sol : 0;
  const tokenCount = categories.includes('tokens') ? counts.tokens : 0;
  const nftCount = categories.includes('nfts') ? counts.nfts : 0;
  const totalTransfers = solCount + tokenCount + nftCount;
  const txCount = totalTransfers === 0 ? 0 : Math.ceil(totalTransfers / TRANSFERS_PER_TX);
  return {
    solCount,
    tokenCount,
    nftCount,
    totalTransfers,
    txCount,
    lamports: txCount * PER_TX_LAMPORTS,
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
