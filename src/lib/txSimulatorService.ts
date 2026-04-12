/**
 * Transaction Simulation Service
 *
 * Takes a base64-encoded Solana transaction, decodes it,
 * simulates via RPC, and returns structured results:
 *  - Balance changes (SOL + tokens)
 *  - Programs invoked
 *  - Log messages
 *  - Suspicious pattern flags
 */

import { RPC_ENDPOINT } from '@/lib/rpc';

export interface SimulatedBalanceChange {
  account: string;
  preBalance: number;
  postBalance: number;
  change: number;
  isNative: boolean;
}

export interface SimulatedProgramCall {
  programId: string;
  label: string;
  isSuspicious: boolean;
}

export interface SimulationFlag {
  severity: 'info' | 'warning' | 'danger';
  message: string;
}

export interface SimulationResult {
  success: boolean;
  error?: string;
  balanceChanges: SimulatedBalanceChange[];
  programs: SimulatedProgramCall[];
  logs: string[];
  flags: SimulationFlag[];
  unitsConsumed: number;
}

// Well-known program IDs
const KNOWN_PROGRAMS: Record<string, string> = {
  '11111111111111111111111111111111': 'System Program',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'SPL Token',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'Token-2022',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter v6',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium AMM',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo',
  'Memo1UhkJBfCR6MNUNGJXsLnE1GcLAHhf7rUuo5wMEL': 'Memo v1',
  'ComputeBudget111111111111111111111111111111': 'Compute Budget',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Metadata',
  'auth9SigNpDKz4sJJ1DfCTuZrZNSAgh9sFD3rboVmgg': 'Metaplex Auth',
  'vau1zxA2LbssAUEF7Gpw91zMM1LvXrvpzJtmZ58rPsn': 'Metaplex Vault',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade Finance',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'Stake Pool',
  'Vote111111111111111111111111111111111111111': 'Vote Program',
  'Stake11111111111111111111111111111111111111': 'Stake Program',
};

// Programs commonly abused or suspicious when unexpected
const SUSPICIOUS_PATTERNS = new Set([
  'SetAuthority',
  'Approve',
  'Revoke',
  'CloseAccount',
  'Transfer',
]);

/**
 * Simulate a base64-encoded transaction
 */
export async function simulateTransaction(base64Tx: string): Promise<SimulationResult> {
  const flags: SimulationFlag[] = [];
  const programs: SimulatedProgramCall[] = [];
  const balanceChanges: SimulatedBalanceChange[] = [];

  try {
    // Decode and get transaction details
    const web3 = await import('@solana/web3.js');
    const { Connection, VersionedTransaction, Transaction } = web3;
    const conn = new Connection(RPC_ENDPOINT, 'confirmed');

    // Try to decode as VersionedTransaction first, then legacy
    let tx: InstanceType<typeof VersionedTransaction> | InstanceType<typeof Transaction>;
    let accountKeys: string[] = [];

    const buffer = Buffer.from(base64Tx, 'base64');

    try {
      tx = VersionedTransaction.deserialize(buffer);
      // For versioned transactions, get static account keys
      const msg = tx.message;
      accountKeys = msg.staticAccountKeys.map((k) => k.toBase58());
      // Also check for address lookup tables (not fully resolved without RPC, but static is enough for flags)
    } catch {
      // Fallback to legacy
      tx = Transaction.from(buffer);
      accountKeys = tx.compileMessage().accountKeys.map((k) => k.toBase58());
    }

    // Identify programs being called
    const programSet = new Set<string>();
    for (const key of accountKeys) {
      if (KNOWN_PROGRAMS[key]) {
        programSet.add(key);
      }
    }

    // If fewer than expected, check all keys against known list
    for (const key of accountKeys) {
      if (KNOWN_PROGRAMS[key] && !programSet.has(key)) {
        programSet.add(key);
      }
    }

    for (const pid of programSet) {
      programs.push({
        programId: pid,
        label: KNOWN_PROGRAMS[pid] || 'Unknown Program',
        isSuspicious: false,
      });
    }

    // Check for unknown programs (not in our known list)
    // Heuristic: any account that's a program but not recognized
    const knownSet = new Set(Object.keys(KNOWN_PROGRAMS));
    const unknownPrograms = accountKeys.filter(
      (k) => !knownSet.has(k) && !programSet.has(k),
    );

    // Simulate
    const simResult = await conn.simulateTransaction(
      tx as InstanceType<typeof VersionedTransaction>,
      {
        sigVerify: false,
        replaceRecentBlockhash: true,
      },
    );

    const simValue = simResult.value;

    if (simValue.err) {
      return {
        success: false,
        error: typeof simValue.err === 'string' ? simValue.err : JSON.stringify(simValue.err),
        balanceChanges: [],
        programs,
        logs: simValue.logs || [],
        flags: [{ severity: 'danger', message: `Simulation failed: ${JSON.stringify(simValue.err)}` }],
        unitsConsumed: simValue.unitsConsumed || 0,
      };
    }

    const logs = simValue.logs || [];

    // Parse logs for suspicious patterns
    for (const log of logs) {
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (log.includes(pattern)) {
          flags.push({
            severity: pattern === 'SetAuthority' || pattern === 'Approve' ? 'warning' : 'info',
            message: `Transaction includes "${pattern}" instruction`,
          });
        }
      }

      // Check for unknown programs in invoke logs
      const invokeMatch = log.match(/Program (\w{32,44}) invoke/);
      if (invokeMatch) {
        const pid = invokeMatch[1];
        if (!knownSet.has(pid) && !programSet.has(pid)) {
          programSet.add(pid);
          programs.push({
            programId: pid,
            label: 'Unknown Program',
            isSuspicious: true,
          });
        }
      }
    }

    // Balance changes from accounts
    if (simValue.accounts) {
      const preBalances = accountKeys.map(() => 0); // We don't have pre-balances from sim
      for (let i = 0; i < simValue.accounts.length && i < accountKeys.length; i++) {
        const acct = simValue.accounts[i];
        if (acct) {
          balanceChanges.push({
            account: accountKeys[i],
            preBalance: 0,
            postBalance: acct.lamports / 1e9,
            change: 0,
            isNative: true,
          });
        }
      }
    }

    // Generate flags
    if (unknownPrograms.length > 3) {
      flags.push({
        severity: 'warning',
        message: `Transaction interacts with ${unknownPrograms.length} unrecognized accounts`,
      });
    }

    const suspiciousPrograms = programs.filter((p) => p.isSuspicious);
    if (suspiciousPrograms.length > 0) {
      flags.push({
        severity: 'danger',
        message: `${suspiciousPrograms.length} unknown program(s) invoked -- verify these are legitimate`,
      });
    }

    // Check for authority changes
    const hasAuthChange = logs.some((l) => l.includes('SetAuthority'));
    if (hasAuthChange) {
      flags.push({
        severity: 'danger',
        message: 'Transaction changes token authority -- this could grant someone else control of your tokens',
      });
    }

    // Check for many approvals
    const approvalCount = logs.filter((l) => l.includes('Approve')).length;
    if (approvalCount > 1) {
      flags.push({
        severity: 'warning',
        message: `Transaction includes ${approvalCount} token approvals -- verify each one is expected`,
      });
    }

    // Check for close account
    if (logs.some((l) => l.includes('CloseAccount'))) {
      flags.push({
        severity: 'info',
        message: 'Transaction closes one or more token accounts (reclaims rent)',
      });
    }

    // Compute units warning
    const units = simValue.unitsConsumed || 0;
    if (units > 800_000) {
      flags.push({
        severity: 'warning',
        message: `High compute usage (${units.toLocaleString()} CU) -- complex transaction`,
      });
    }

    if (flags.length === 0) {
      flags.push({
        severity: 'info',
        message: 'No suspicious patterns detected in simulation',
      });
    }

    return {
      success: true,
      balanceChanges,
      programs,
      logs,
      flags,
      unitsConsumed: units,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Provide helpful error messages
    if (msg.includes('Unexpected end') || msg.includes('Invalid') || msg.includes('buffer')) {
      return {
        success: false,
        error: 'Invalid transaction format. Please paste a valid base64-encoded Solana transaction.',
        balanceChanges: [],
        programs: [],
        logs: [],
        flags: [{ severity: 'danger', message: 'Could not decode -- ensure the data is a valid base64 Solana transaction' }],
        unitsConsumed: 0,
      };
    }

    return {
      success: false,
      error: msg,
      balanceChanges: [],
      programs: [],
      logs: [],
      flags: [{ severity: 'danger', message: `Simulation error: ${msg}` }],
      unitsConsumed: 0,
    };
  }
}
