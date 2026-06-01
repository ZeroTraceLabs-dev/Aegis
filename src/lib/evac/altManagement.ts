/**
 * ALT Management — helpers for constructing and publishing the Solana
 * Address Lookup Table used by the evac execution path.
 *
 * The ALT holds every public key the evac transaction set will reference:
 *   - destination address
 *   - gas sub-wallet address
 *   - SPL token mint addresses (non-spam)
 *   - NFT collection mint addresses (non-spam)
 *   - system + token programs (well-known)
 *
 * A single Solana transaction can carry ~20-25 addresses in an
 * extendLookupTable instruction before hitting the 1232-byte tx size
 * limit, so we chunk. The wallet adapter signs each tx in sequence;
 * the user sees one wallet popup per chunk. For typical wallets
 * (<= ~20 mint addresses) this is one transaction.
 *
 * The CREATED ALT is not usable in v0 transactions until at least one
 * full slot has elapsed since the last extend — Solana's "warm-up"
 * requirement. The evac fire path (next brief) is responsible for
 * waiting; setup just publishes and confirms.
 */

import type { Connection, PublicKey, TransactionInstruction, TransactionSignature } from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';

/** Well-known programs that the evac transactions will invoke. */
const WELL_KNOWN_PROGRAMS = [
  '11111111111111111111111111111111',                    // System
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',         // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',         // Token-2022
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',        // Associated Token Account
];

/** Max addresses per extend tx. Conservative — leaves margin for the create-ix when bundled. */
const EXTEND_CHUNK_SIZE = 20;

export interface ALTPublishProgress {
  /** Total number of transactions that will need to be signed. */
  totalTxs: number;
  /** Index of the currently-signing transaction (1-based for display). */
  currentTx: number;
  /** Free-text status for the user. */
  status: string;
}

export interface ALTPublishInputs {
  destinationAddress: string;
  gasWalletAddress: string;
  /** SPL token mints the user holds (non-spam). */
  splMints: string[];
  /** NFT collection addresses the user holds (non-spam). Distinct from individual NFT mints. */
  nftCollections: string[];
}

/**
 * Build, sign, and confirm the transactions needed to publish a fresh
 * ALT for this wallet. Returns the ALT's public address.
 *
 * Caller supplies a progress callback so the UI can show "publishing
 * protection table (1/3)…" etc.
 */
export async function publishALT(
  connection: Connection,
  wallet: WalletContextState,
  inputs: ALTPublishInputs,
  onProgress: (p: ALTPublishProgress) => void,
): Promise<{ altAddress: string }> {
  if (!wallet.publicKey || !wallet.signTransaction) {
    throw new Error('Main wallet is not connected or does not support signing.');
  }

  const web3 = await import('@solana/web3.js');
  const { AddressLookupTableProgram, PublicKey } = web3;
  const payer = wallet.publicKey;

  // Dedupe + collect all addresses going into the ALT.
  const allAddrs = Array.from(new Set([
    inputs.destinationAddress,
    inputs.gasWalletAddress,
    ...WELL_KNOWN_PROGRAMS,
    ...inputs.splMints,
    ...inputs.nftCollections,
  ])).map((a) => new PublicKey(a));

  // Get a recent slot for ALT derivation.
  const recentSlot = await connection.getSlot('finalized');

  // Create the ALT (returns [instruction, derived ALT pubkey]).
  const [createIx, altPubkey] = AddressLookupTableProgram.createLookupTable({
    authority: payer,
    payer,
    recentSlot,
  });

  // Chunk the addresses into extend instructions.
  const extendIxs: TransactionInstruction[] = [];
  for (let i = 0; i < allAddrs.length; i += EXTEND_CHUNK_SIZE) {
    const chunk = allAddrs.slice(i, i + EXTEND_CHUNK_SIZE);
    extendIxs.push(AddressLookupTableProgram.extendLookupTable({
      lookupTable: altPubkey,
      authority: payer,
      payer,
      addresses: chunk,
    }));
  }

  // Pack into transactions: tx 0 = create + first extend; remaining extends each go in their own tx.
  const txGroups: TransactionInstruction[][] = [];
  if (extendIxs.length === 0) {
    txGroups.push([createIx]);
  } else {
    txGroups.push([createIx, extendIxs[0]]);
    for (let i = 1; i < extendIxs.length; i++) txGroups.push([extendIxs[i]]);
  }

  const totalTxs = txGroups.length;

  // Pattern: for each chunk, fetch a fresh blockhash, build, sign,
  // broadcast, confirm — then move on. Never reuse a blockhash across
  // iterations. Within an iteration we still guard against the user
  // taking 90+ seconds to click "Approve" by retrying once with a
  // fresh blockhash if the first broadcast comes back with a
  // blockhash-expired error.
  for (let i = 0; i < txGroups.length; i++) {
    onProgress({
      totalTxs,
      currentTx: i + 1,
      status: i === 0
        ? `Publishing protection table (${i + 1}/${totalTxs})…`
        : `Extending protection table (${i + 1}/${totalTxs})…`,
    });

    await signSendConfirmWithRetry(
      connection,
      wallet,
      payer,
      txGroups[i],
      (status) => onProgress({ totalTxs, currentTx: i + 1, status }),
    );
  }

  onProgress({ totalTxs, currentTx: totalTxs, status: 'Protection table armed.' });
  return { altAddress: altPubkey.toBase58() };
}

/**
 * Build → sign → broadcast → confirm one chunk's worth of instructions.
 * Fetches a fresh blockhash immediately before construction. If the
 * broadcast comes back with a blockhash-expired error (which happens
 * when the user takes ~90+ seconds to approve in their wallet), we
 * refetch and prompt the user to sign again — one retry only, to
 * avoid loops.
 */
async function signSendConfirmWithRetry(
  connection: Connection,
  wallet: WalletContextState,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  onStatus: (status: string) => void,
): Promise<void> {
  const web3 = await import('@solana/web3.js');
  const { Transaction } = web3;

  const attempt = async (label: string): Promise<TransactionSignature> => {
    onStatus(label);
    // Fresh blockhash, applied right before the wallet popup. If the
    // user dawdles on the approve click, the blockhash ages while we
    // wait — that's what triggers the retry path below.
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction().add(...ixs);
    tx.recentBlockhash = blockhash;
    tx.feePayer = payer;

    if (!wallet.signTransaction) {
      throw new Error('Main wallet does not support signTransaction.');
    }
    const signed = await wallet.signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    return sig;
  };

  try {
    await attempt('Sign to publish…');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stale = /blockhash not found|block height exceeded|expired/i.test(msg);
    if (!stale) throw e;
    // Stale blockhash — refetch and ask the user to sign once more.
    await attempt('Blockhash expired — sign again to retry…');
  }
}

/**
 * Verify an ALT still exists on-chain and is owned by the expected authority.
 * Used by the armed-state monitor.
 */
export async function verifyALT(
  connection: Connection,
  altAddress: string,
  expectedAuthority: string,
): Promise<{ exists: boolean; addressCount: number; authorityMatches: boolean }> {
  const web3 = await import('@solana/web3.js');
  const { PublicKey } = web3;
  try {
    const altPubkey = new PublicKey(altAddress);
    const res = await connection.getAddressLookupTable(altPubkey);
    if (!res.value) return { exists: false, addressCount: 0, authorityMatches: false };
    const authority = res.value.state.authority?.toBase58() ?? null;
    return {
      exists: true,
      addressCount: res.value.state.addresses.length,
      authorityMatches: authority === expectedAuthority,
    };
  } catch {
    return { exists: false, addressCount: 0, authorityMatches: false };
  }
}

/**
 * Address-format validation. Returns the parsed PublicKey if valid; throws
 * a friendly Error otherwise. Used by Step 3 (destination) and anywhere
 * else the user pastes an address.
 *
 * Rejects:
 *   - non-base58 / wrong-length strings
 *   - PDAs (off-curve) — destinations must be wallets, not program-derived
 */
export async function validateWalletAddress(addr: string): Promise<PublicKey> {
  const web3 = await import('@solana/web3.js');
  const { PublicKey } = web3;
  let parsed: PublicKey;
  try {
    parsed = new PublicKey(addr.trim());
  } catch {
    throw new Error('Not a valid Solana address.');
  }
  if (!PublicKey.isOnCurve(parsed.toBytes())) {
    throw new Error('This is a program-derived address (PDA), not a wallet. Use a wallet you control.');
  }
  return parsed;
}

/**
 * Best-effort check: is this address an executable program? If yes, reject —
 * destinations must be wallets, not contracts. Network failures here are
 * non-fatal; we proceed with format validation only.
 */
export async function checkAddressIsWallet(
  connection: Connection,
  addr: PublicKey,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const info = await connection.getAccountInfo(addr);
    if (info?.executable) {
      return { ok: false, reason: 'This address is an executable program, not a wallet.' };
    }
    return { ok: true };
  } catch {
    // RPC failure — fall through, format validation already passed.
    return { ok: true };
  }
}
