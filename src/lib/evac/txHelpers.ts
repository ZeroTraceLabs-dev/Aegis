/**
 * Shared transaction helpers for the evac fire path.
 *
 * Every Solana RPC call in this module passes commitment: 'confirmed'
 * explicitly even though the ConnectionProvider default is now
 * 'confirmed'. Money-moving paths spell their commitment out.
 *
 * Two distinct flows are supported:
 *
 *   1. Legacy `signSendConfirmWithRetry` — the pattern lifted out of
 *      altManagement.ts. Used for non-fire flows that build a single
 *      Transaction, ask the connected wallet to sign, and confirm.
 *      altManagement.ts keeps its own private copy for backward
 *      compatibility with brief 1; future call sites should import
 *      from here.
 *
 *   2. Versioned-tx broadcast/confirm/simulate primitives — used by
 *      fire.ts to drive many pre-signed v0 transactions through the
 *      cluster in parallel.
 */

import type {
  Connection,
  PublicKey,
  SimulatedTransactionResponse,
  TransactionInstruction,
  TransactionSignature,
  VersionedTransaction,
} from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';

// ── 1. Legacy single-tx flow ────────────────────────────────────

export interface SignSendConfirmInputs {
  connection: Connection;
  wallet: WalletContextState;
  payer: PublicKey;
  ixs: TransactionInstruction[];
  onStatus: (status: string) => void;
}

/**
 * Build → sign → broadcast → confirm a single legacy Transaction
 * with one stale-blockhash retry. Mirrors the pattern in
 * altManagement.ts so other non-fire flows can share it.
 */
export async function signSendConfirmWithRetry(
  inputs: SignSendConfirmInputs,
): Promise<TransactionSignature> {
  const { connection, wallet, payer, ixs, onStatus } = inputs;
  const web3 = await import('@solana/web3.js');
  const { Transaction } = web3;

  const attempt = async (label: string): Promise<TransactionSignature> => {
    onStatus(label);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;

    if (!wallet.signTransaction) {
      throw new Error('Wallet does not support signTransaction.');
    }
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    return sig;
  };

  try {
    return await attempt('Sign to send…');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stale = /blockhash not found|block height exceeded|expired/i.test(msg);
    if (!stale) throw e;
    return attempt('Blockhash expired — sign again to retry…');
  }
}

// ── 2. v0 (versioned) transaction primitives ────────────────────

export interface BroadcastResult {
  signature: TransactionSignature;
  /** Echoed back so the confirmer can use the matching blockhash. */
  blockhash: string;
  lastValidBlockHeight: number;
}

/**
 * Broadcast a pre-signed VersionedTransaction. Caller already holds a
 * fresh blockhash + lastValidBlockHeight from connection.getLatestBlockhash
 * and embedded that blockhash in the tx's message. Returns immediately
 * after the cluster accepts the tx — confirmation is a separate step.
 *
 * Throws on RPC failure or preflight rejection. Caller decides whether
 * to mark this tx failed or retry.
 */
export async function broadcastV0(
  connection: Connection,
  tx: VersionedTransaction,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<BroadcastResult> {
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  });
  return { signature, blockhash, lastValidBlockHeight };
}

/**
 * Confirm a broadcast tx at 'confirmed' commitment. Throws on
 * confirmation failure (blockhash expired before confirmation, RPC
 * error, etc.) — the caller treats throw as "tx failed".
 */
export async function confirmV0(
  connection: Connection,
  broadcast: BroadcastResult,
): Promise<void> {
  await connection.confirmTransaction(
    {
      signature: broadcast.signature,
      blockhash: broadcast.blockhash,
      lastValidBlockHeight: broadcast.lastValidBlockHeight,
    },
    'confirmed',
  );
}

export interface SimulationOutcome {
  ok: boolean;
  /** Stringified error if ok=false. */
  error: string | null;
  /** Whatever the cluster reported, for surfacing logs. */
  raw: SimulatedTransactionResponse | null;
}

/**
 * Simulate a v0 tx without signature verification (sigVerify=false)
 * so unsigned/partial-signed txs can be checked. Returns a structured
 * outcome — never throws on simulation error, only on RPC failure.
 *
 * For the critical-tier "simulate while signing" pattern: caller kicks
 * this off in parallel with the wallet-adapter signature prompt.
 */
export async function simulateV0(
  connection: Connection,
  tx: VersionedTransaction,
): Promise<SimulationOutcome> {
  try {
    const res = await connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'confirmed',
    });
    if (res.value.err) {
      return {
        ok: false,
        error: typeof res.value.err === 'string' ? res.value.err : JSON.stringify(res.value.err),
        raw: res.value,
      };
    }
    return { ok: true, error: null, raw: res.value };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      raw: null,
    };
  }
}

/** Classifier used by fire.ts to decide whether a sweep is worth retrying. */
export function isStaleBlockhashError(msg: string): boolean {
  return /blockhash not found|block height exceeded|expired/i.test(msg);
}
