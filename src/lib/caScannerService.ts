/**
 * Contract Address (CA) Scanner Service
 *
 * Analyzes a Solana address to determine if it's:
 *  1. A token mint -- checks mint/freeze authority, supply, known token status
 *  2. A program -- checks if executable, whether it's known/verified
 *  3. A wallet/account -- shows balance and basic info
 *
 * Returns structured risk flags similar to the transaction simulator.
 */

import { RPC_ENDPOINT } from '@/lib/rpc';
import type { SimulationFlag, SimulatedProgramCall } from '@/lib/txSimulatorService';

export interface CaScanResult {
  address: string;
  accountType: 'token-mint' | 'program' | 'wallet' | 'unknown';
  label: string;
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  score: number;
  flags: SimulationFlag[];
  programs: SimulatedProgramCall[];
  details: Record<string, string | number | boolean>;
}

// Known safe mints
const KNOWN_MINTS: Record<string, string> = {
  'So11111111111111111111111111111111111111112': 'Wrapped SOL',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT',
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': 'mSOL',
  'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1': 'bSOL',
  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN': 'JUP',
  'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3': 'PYTH',
  'jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL': 'JTO',
  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm': 'WIF',
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': 'BONK',
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'Wrapped ETH',
};

// Known programs
const KNOWN_PROGRAMS: Record<string, string> = {
  '11111111111111111111111111111111': 'System Program',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'SPL Token',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'Token-2022',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter v6',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Metadata',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade Finance',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'Stake Pool',
};

/**
 * Scan a Solana address (token mint, program, or wallet)
 */
export async function scanContractAddress(address: string): Promise<CaScanResult> {
  const flags: SimulationFlag[] = [];
  const programs: SimulatedProgramCall[] = [];
  const details: Record<string, string | number | boolean> = {};
  let score = 80;

  try {
    const web3 = await import('@solana/web3.js');
    const { Connection, PublicKey } = web3;
    const conn = new Connection(RPC_ENDPOINT, 'confirmed');

    // Validate address format
    let pubkey: InstanceType<typeof PublicKey>;
    try {
      pubkey = new PublicKey(address);
    } catch {
      return {
        address,
        accountType: 'unknown',
        label: 'Invalid Address',
        riskLevel: 'critical',
        score: 0,
        flags: [{ severity: 'danger', message: 'Invalid Solana address format' }],
        programs: [],
        details: {},
      };
    }

    // Check if it's a known token
    if (KNOWN_MINTS[address]) {
      return {
        address,
        accountType: 'token-mint',
        label: KNOWN_MINTS[address],
        riskLevel: 'safe',
        score: 95,
        flags: [{ severity: 'info', message: `Verified token: ${KNOWN_MINTS[address]} -- widely recognized and trusted` }],
        programs: [],
        details: { knownToken: true, name: KNOWN_MINTS[address] },
      };
    }

    // Check if it's a known program
    if (KNOWN_PROGRAMS[address]) {
      return {
        address,
        accountType: 'program',
        label: KNOWN_PROGRAMS[address],
        riskLevel: 'safe',
        score: 95,
        flags: [{ severity: 'info', message: `Verified program: ${KNOWN_PROGRAMS[address]}` }],
        programs: [{ programId: address, label: KNOWN_PROGRAMS[address], isSuspicious: false }],
        details: { knownProgram: true, name: KNOWN_PROGRAMS[address] },
      };
    }

    // Fetch account info
    const accountInfo = await conn.getParsedAccountInfo(pubkey);

    if (!accountInfo.value) {
      return {
        address,
        accountType: 'unknown',
        label: 'Account Not Found',
        riskLevel: 'high',
        score: 15,
        flags: [{ severity: 'danger', message: 'Account does not exist on-chain -- possibly never funded or already closed' }],
        programs: [],
        details: {},
      };
    }

    const { data, executable, lamports, owner } = accountInfo.value;
    details.balance = lamports / 1e9;
    details.executable = executable;
    details.owner = owner.toBase58();

    // ---- EXECUTABLE PROGRAM ----
    if (executable) {
      details.accountType = 'program';

      programs.push({
        programId: address,
        label: 'Unknown Program',
        isSuspicious: false,
      });

      // Check if owned by BPF Loader (upgradeable vs immutable)
      const ownerStr = owner.toBase58();
      const isUpgradeable = ownerStr === 'BPFLoaderUpgradeab1e11111111111111111111111';

      if (isUpgradeable) {
        score -= 10;
        details.upgradeable = true;
        flags.push({
          severity: 'warning',
          message: 'Program is upgradeable -- the owner can modify its code at any time',
        });

        // Try to get upgrade authority
        try {
          const programAcct = await conn.getAccountInfo(pubkey);
          if (programAcct && programAcct.data.length >= 45) {
            // For upgradeable programs, data contains a pointer to programdata
            flags.push({
              severity: 'info',
              message: 'Upgradeable programs can be frozen by revoking upgrade authority',
            });
          }
        } catch { /* skip */ }
      } else {
        details.upgradeable = false;
        flags.push({
          severity: 'info',
          message: 'Program is immutable (not upgradeable) -- code cannot be changed',
        });
        score += 5;
      }

      // Not a known program -- flag it
      flags.push({
        severity: 'warning',
        message: 'This program is not in our verified program database -- exercise caution',
      });

      const riskLevel: CaScanResult['riskLevel'] =
        score >= 75 ? 'low' : score >= 50 ? 'medium' : score >= 25 ? 'high' : 'critical';

      return {
        address,
        accountType: 'program',
        label: 'Unknown Program',
        riskLevel,
        score: Math.max(0, Math.min(100, score)),
        flags,
        programs,
        details,
      };
    }

    // ---- TOKEN MINT ----
    if (data && 'parsed' in data && data.parsed?.type === 'mint') {
      const mintInfo = data.parsed.info;
      const hasMintAuth = !!mintInfo.mintAuthority;
      const hasFreezeAuth = !!mintInfo.freezeAuthority;
      const supplyRaw = parseFloat(mintInfo.supply || '0');
      const decimals = mintInfo.decimals ?? 0;
      const supply = supplyRaw / Math.pow(10, decimals);

      details.accountType = 'token-mint';
      details.mintAuthority = hasMintAuth ? mintInfo.mintAuthority : 'revoked';
      details.freezeAuthority = hasFreezeAuth ? mintInfo.freezeAuthority : 'revoked';
      details.decimals = decimals;
      details.supply = supply;
      details.hasMintAuthority = hasMintAuth;
      details.hasFreezeAuthority = hasFreezeAuth;

      if (hasMintAuth) {
        score -= 25;
        flags.push({
          severity: 'danger',
          message: 'Mint authority is ACTIVE -- token issuer can inflate supply at any time (rug-pull risk)',
        });
      } else {
        flags.push({
          severity: 'info',
          message: 'Mint authority revoked -- supply is fixed and cannot be inflated',
        });
      }

      if (hasFreezeAuth) {
        score -= 20;
        flags.push({
          severity: 'danger',
          message: 'Freeze authority is ACTIVE -- issuer can freeze your token balance',
        });
      } else {
        flags.push({
          severity: 'info',
          message: 'Freeze authority revoked -- your tokens cannot be frozen',
        });
      }

      if (hasMintAuth && hasFreezeAuth) {
        score -= 10;
        flags.push({
          severity: 'danger',
          message: 'Both mint AND freeze authority active -- extremely high centralization risk',
        });
      }

      if (decimals <= 2 && decimals >= 1) {
        score -= 5;
        flags.push({
          severity: 'warning',
          message: `Unusual decimals (${decimals}) -- legitimate tokens typically use 6-9 decimals`,
        });
      }

      if (supply > 1e15) {
        score -= 5;
        flags.push({
          severity: 'warning',
          message: 'Extremely large token supply (>1 quadrillion) -- may indicate meme/spam token',
        });
      }

      if (supply === 0) {
        score -= 10;
        flags.push({
          severity: 'warning',
          message: 'Zero supply -- token may not have been minted yet or was fully burned',
        });
      }

      // Try to get metadata via DAS
      try {
        const metaRes = await fetch(RPC_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0', id: 1,
            method: 'getAsset',
            params: { id: address },
          }),
        });
        const metaData = await metaRes.json();
        if (metaData?.result?.content?.metadata) {
          const meta = metaData.result.content.metadata;
          if (meta.name) details.name = meta.name;
          if (meta.symbol) details.symbol = meta.symbol;
        }
      } catch { /* skip metadata fetch */ }

      score = Math.max(0, Math.min(100, score));

      const riskLevel: CaScanResult['riskLevel'] =
        score >= 75 ? 'low' : score >= 50 ? 'medium' : score >= 25 ? 'high' : 'critical';

      return {
        address,
        accountType: 'token-mint',
        label: (details.symbol as string) || (details.name as string) || 'Unknown Token',
        riskLevel,
        score,
        flags,
        programs: [],
        details,
      };
    }

    // ---- REGULAR ACCOUNT / WALLET ----
    details.accountType = 'wallet';

    flags.push({
      severity: 'info',
      message: `Account holds ${(lamports / 1e9).toFixed(4)} SOL`,
    });

    if (lamports === 0) {
      flags.push({
        severity: 'warning',
        message: 'Account has zero balance -- may be inactive or a newly created address',
      });
    }

    return {
      address,
      accountType: 'wallet',
      label: 'Wallet / Account',
      riskLevel: 'low',
      score: 70,
      flags,
      programs: [],
      details,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      address,
      accountType: 'unknown',
      label: 'Scan Failed',
      riskLevel: 'high',
      score: 10,
      flags: [{ severity: 'danger', message: `Failed to scan address: ${msg}` }],
      programs: [],
      details: {},
    };
  }
}
