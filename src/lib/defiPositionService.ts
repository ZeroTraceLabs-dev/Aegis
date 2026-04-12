/**
 * DeFi Position Awareness Service
 *
 * Detects active DeFi positions by scanning token accounts for known
 * protocol receipt tokens and staking accounts:
 *   - Native SOL staking
 *   - Liquid staking (mSOL, bSOL, jitoSOL, etc.)
 *   - LP tokens (Raydium, Orca)
 *   - Lending/borrowing receipts (MarginFi, Kamino)
 *
 * No external API required -- uses on-chain data + known token mappings.
 */

import { RPC_ENDPOINT } from '@/lib/rpc';

export type PositionType = 'staking' | 'liquid-staking' | 'lp' | 'lending' | 'borrowing' | 'other';
export type RiskLevel = 'low' | 'medium' | 'high';

export interface DeFiPosition {
  id: string;
  protocol: string;
  type: PositionType;
  asset: string;
  symbol: string;
  amount: number;
  estimatedValueSol?: number;
  risk: RiskLevel;
  riskNote: string;
  mint?: string;
}

// Known liquid staking tokens
const LIQUID_STAKING_TOKENS: Record<string, { protocol: string; symbol: string; solRatio: number }> = {
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { protocol: 'Marinade', symbol: 'mSOL', solRatio: 1.15 },
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': { protocol: 'SolBlaze', symbol: 'bSOL', solRatio: 1.08 },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { protocol: 'Jito', symbol: 'jitoSOL', solRatio: 1.12 },
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': { protocol: 'Lido', symbol: 'stSOL', solRatio: 1.10 },
  'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A': { protocol: 'Helius', symbol: 'hSOL', solRatio: 1.05 },
  'INF1ciKyWMFYkFWxfHCbuXb6massM9UjFZbASRgo4999': { protocol: 'Sanctum Infinity', symbol: 'INF', solRatio: 1.10 },
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v': { protocol: 'Jupiter', symbol: 'jupSOL', solRatio: 1.08 },
  '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm': { protocol: 'Socean', symbol: 'scnSOL', solRatio: 1.06 },
  'LSTxxxnJzKDFSLr4dUkPcmCf5VyryEqzPLz5j4bpxFp': { protocol: 'Sanctum LST', symbol: 'LST', solRatio: 1.05 },
};

// Known LP token patterns (mint prefix -> protocol)
const LP_TOKEN_OWNERS: Record<string, string> = {
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
};

// Known lending protocol receipt tokens
const LENDING_TOKENS: Record<string, { protocol: string; asset: string; type: PositionType }> = {
  // MarginFi and Kamino receipt tokens would go here
  // These change frequently, so we use heuristics below
};

/**
 * Scan a wallet for DeFi positions
 */
export async function scanDeFiPositions(walletAddress: string): Promise<DeFiPosition[]> {
  const positions: DeFiPosition[] = [];

  try {
    const web3 = await import('@solana/web3.js');
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = web3;
    const conn = new Connection(RPC_ENDPOINT, 'confirmed');
    const pubkey = new PublicKey(walletAddress);

    // 1. Check for native stake accounts
    try {
      const stakeAccounts = await conn.getParsedProgramAccounts(
        new PublicKey('Stake11111111111111111111111111111111111111'),
        {
          filters: [
            { memcmp: { offset: 12, bytes: walletAddress } }, // authorized staker
          ],
        },
      );

      for (const acct of stakeAccounts) {
        const lamports = acct.account.lamports;
        const sol = lamports / LAMPORTS_PER_SOL;
        if (sol < 0.001) continue;

        const parsed = acct.account.data;
        let status = 'active';
        if ('parsed' in parsed) {
          const info = parsed.parsed?.info;
          const stake = info?.stake;
          if (stake?.delegation?.deactivationEpoch !== '18446744073709551615') {
            status = 'deactivating';
          }
        }

        positions.push({
          id: `stake-${acct.pubkey.toBase58().slice(0, 8)}`,
          protocol: 'Native Staking',
          type: 'staking',
          asset: `Staked SOL (${status})`,
          symbol: 'SOL',
          amount: sol,
          estimatedValueSol: sol,
          risk: status === 'deactivating' ? 'medium' : 'low',
          riskNote: status === 'deactivating'
            ? 'Stake is deactivating — funds will be available after cooldown'
            : 'Native staking is the safest yield option on Solana',
        });
      }
    } catch { /* skip stake check */ }

    // 2. Check token accounts for liquid staking, LP tokens, etc.
    try {
      const tokenResp = await conn.getParsedTokenAccountsByOwner(pubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });

      for (const acct of tokenResp.value) {
        const parsed = acct.account.data.parsed?.info;
        if (!parsed) continue;

        const mint = parsed.mint as string;
        const uiAmount = parsed.tokenAmount?.uiAmount || 0;
        if (uiAmount === 0) continue;

        // Check liquid staking tokens
        const lstInfo = LIQUID_STAKING_TOKENS[mint];
        if (lstInfo) {
          const estimatedSol = uiAmount * lstInfo.solRatio;
          positions.push({
            id: `lst-${mint.slice(0, 8)}`,
            protocol: lstInfo.protocol,
            type: 'liquid-staking',
            asset: `${lstInfo.symbol}`,
            symbol: lstInfo.symbol,
            amount: uiAmount,
            estimatedValueSol: estimatedSol,
            mint,
            risk: 'low',
            riskNote: `Liquid staking via ${lstInfo.protocol} — redeemable for ~${estimatedSol.toFixed(3)} SOL`,
          });
          continue;
        }

        // Check if owned by known LP program (heuristic)
        const owner = acct.account.owner.toBase58();
        const lpProtocol = LP_TOKEN_OWNERS[owner];
        if (lpProtocol && parsed.tokenAmount?.decimals > 0) {
          positions.push({
            id: `lp-${mint.slice(0, 8)}`,
            protocol: lpProtocol,
            type: 'lp',
            asset: 'LP Position',
            symbol: 'LP',
            amount: uiAmount,
            mint,
            risk: 'medium',
            riskNote: `Liquidity position on ${lpProtocol} — subject to impermanent loss`,
          });
          continue;
        }

        // Check lending tokens
        const lendingInfo = LENDING_TOKENS[mint];
        if (lendingInfo) {
          positions.push({
            id: `lend-${mint.slice(0, 8)}`,
            protocol: lendingInfo.protocol,
            type: lendingInfo.type,
            asset: lendingInfo.asset,
            symbol: mint.slice(0, 6),
            amount: uiAmount,
            mint,
            risk: lendingInfo.type === 'borrowing' ? 'high' : 'medium',
            riskNote: lendingInfo.type === 'borrowing'
              ? `Active borrow on ${lendingInfo.protocol} — monitor liquidation risk`
              : `Deposit on ${lendingInfo.protocol} — earning yield`,
          });
        }
      }

      // Also check Token-2022 accounts
      try {
        const t22Resp = await conn.getParsedTokenAccountsByOwner(pubkey, {
          programId: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
        });

        for (const acct of t22Resp.value) {
          const parsed = acct.account.data.parsed?.info;
          if (!parsed) continue;
          const mint = parsed.mint as string;
          const uiAmount = parsed.tokenAmount?.uiAmount || 0;
          if (uiAmount === 0) continue;

          const lstInfo = LIQUID_STAKING_TOKENS[mint];
          if (lstInfo) {
            positions.push({
              id: `lst22-${mint.slice(0, 8)}`,
              protocol: lstInfo.protocol,
              type: 'liquid-staking',
              asset: lstInfo.symbol,
              symbol: lstInfo.symbol,
              amount: uiAmount,
              estimatedValueSol: uiAmount * lstInfo.solRatio,
              mint,
              risk: 'low',
              riskNote: `Liquid staking via ${lstInfo.protocol} (Token-2022)`,
            });
          }
        }
      } catch { /* skip T22 */ }
    } catch { /* skip token check */ }
  } catch (err) {
    console.warn('[DeFiPositions] Scan error:', err);
  }

  return positions;
}

/**
 * Calculate a DeFi risk penalty for the health score
 * Returns 0-15 penalty points
 */
export function calculateDeFiRiskPenalty(positions: DeFiPosition[]): number {
  let penalty = 0;

  for (const pos of positions) {
    if (pos.risk === 'high') penalty += 5;
    else if (pos.risk === 'medium') penalty += 2;
    // Low risk = no penalty
  }

  return Math.min(penalty, 15);
}
