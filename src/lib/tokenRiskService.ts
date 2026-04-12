/**
 * Token Rug-Pull Risk Scoring Service
 *
 * Checks on-chain mint data for each fungible SPL token:
 *  - Mint authority still active (can mint infinite supply)
 *  - Freeze authority enabled (can freeze your tokens)
 *  - Supply concentration / small decimals
 *
 * Produces a risk grade: A (safe) / B (low risk) / C (medium) / D (high) / F (critical)
 *
 * Uses dynamic imports for @solana/web3.js to avoid module-scope crashes.
 */

import { RPC_ENDPOINT } from '@/lib/rpc';

export type RiskGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface TokenRiskResult {
  mint: string;
  grade: RiskGrade;
  score: number; // 0 (worst) – 100 (safest)
  hasMintAuthority: boolean;
  hasFreezeAuthority: boolean;
  supply: number;
  decimals: number;
  flags: string[];
}

// Known safe mints (stables, wrapped SOL, major tokens) – skip heavy checks
const KNOWN_SAFE = new Set([
  'So11111111111111111111111111111111111111112',  // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1', // bSOL
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL', // JTO
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm', // WIF
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH
]);

const cache = new Map<string, TokenRiskResult>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

/** Subscribe to risk result updates */
export function subscribeTokenRisk(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Get cached result for a mint */
export function getTokenRisk(mint: string): TokenRiskResult | undefined {
  return cache.get(mint);
}

/** Get all cached results */
export function getAllTokenRisks(): Map<string, TokenRiskResult> {
  return new Map(cache);
}

/** Clear cache (e.g., on wallet disconnect) */
export function clearTokenRiskCache() {
  cache.clear();
  notify();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Race a promise against a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

let analyzing = false;

/**
 * Analyze a batch of fungible token mints.
 * Fetches mint info from RPC with concurrency limit (3) and 5s timeout per token.
 */
export async function analyzeTokenRisks(mints: string[]): Promise<Map<string, TokenRiskResult>> {
  const toAnalyze = mints.filter((m) => !cache.has(m));
  if (toAnalyze.length === 0) return cache;
  if (analyzing) return cache; // prevent overlapping runs
  analyzing = true;

  let Connection: typeof import('@solana/web3.js').Connection;
  let PublicKeyClass: typeof import('@solana/web3.js').PublicKey;

  try {
    const web3 = await import('@solana/web3.js');
    Connection = web3.Connection;
    PublicKeyClass = web3.PublicKey;
  } catch {
    console.warn('[TokenRisk] Failed to load web3');
    analyzing = false;
    return cache;
  }

  const conn = new Connection(RPC_ENDPOINT, 'confirmed');
  const CONCURRENCY = 3;
  const TIMEOUT_MS = 5000;

  // Process known safe tokens first (instant)
  for (const mint of toAnalyze) {
    if (KNOWN_SAFE.has(mint)) {
      cache.set(mint, {
        mint, grade: 'A', score: 95,
        hasMintAuthority: false, hasFreezeAuthority: false,
        supply: 0, decimals: 0, flags: [],
      });
      notify();
    }
  }

  const remaining = toAnalyze.filter((m) => !cache.has(m));

  // Analyze single mint with timeout
  async function analyzeSingle(mint: string) {
    try {
      const mintPk = new PublicKeyClass(mint);
      const accountInfo = await withTimeout(conn.getParsedAccountInfo(mintPk), TIMEOUT_MS);

      if (!accountInfo.value || !('parsed' in accountInfo.value.data)) {
        cache.set(mint, {
          mint, grade: 'D', score: 25,
          hasMintAuthority: false, hasFreezeAuthority: false,
          supply: 0, decimals: 0,
          flags: ['Could not fetch mint data'],
        });
        notify();
        return;
      }

      const parsed = accountInfo.value.data.parsed.info;
      const hasMintAuth = !!parsed.mintAuthority;
      const hasFreezeAuth = !!parsed.freezeAuthority;
      const supplyRaw = parseFloat(parsed.supply || '0');
      const decimals = parsed.decimals ?? 0;
      const supply = supplyRaw / Math.pow(10, decimals);

      let score = 80;
      const flags: string[] = [];

      if (hasMintAuth) { score -= 30; flags.push('Mint authority active — token supply can be inflated'); }
      if (hasFreezeAuth) { score -= 20; flags.push('Freeze authority active — your tokens can be frozen'); }
      if (hasMintAuth && hasFreezeAuth) { score -= 10; flags.push('Both mint + freeze authorities active — high centralization risk'); }
      if (decimals <= 2 && decimals >= 1) { score -= 5; flags.push(`Unusual low decimals (${decimals}) — may indicate honeypot`); }
      if (supply > 1e15) { score -= 5; flags.push('Extremely large supply (>1 quadrillion)'); }

      score = Math.max(0, Math.min(100, score));
      const grade: RiskGrade = score >= 75 ? 'A' : score >= 55 ? 'B' : score >= 35 ? 'C' : score >= 15 ? 'D' : 'F';

      cache.set(mint, { mint, grade, score, hasMintAuthority: hasMintAuth, hasFreezeAuthority: hasFreezeAuth, supply, decimals, flags });
      notify();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg === 'Timeout';
      cache.set(mint, {
        mint, grade: 'C', score: 40,
        hasMintAuthority: false, hasFreezeAuthority: false,
        supply: 0, decimals: 0,
        flags: [isTimeout ? 'Analysis timed out — unable to assess' : 'Analysis failed — treat with caution'],
      });
      notify();
    }
  }

  // Process in batches of CONCURRENCY
  for (let i = 0; i < remaining.length; i += CONCURRENCY) {
    const batch = remaining.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(analyzeSingle));
    if (i + CONCURRENCY < remaining.length) await sleep(200);
  }

  analyzing = false;
  return cache;
}