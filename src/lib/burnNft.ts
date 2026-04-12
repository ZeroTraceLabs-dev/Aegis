/**
 * NFT Burn utilities.
 *
 * For standard SPL / Token-2022 NFTs:
 *   1. Burn the token (amount = 1, decimals = 0)
 *   2. Close the token account (reclaim ~0.00203 SOL rent)
 *
 * Compressed NFTs require a different program (Bubblegum) and are NOT
 * supported for burn here — they are skipped gracefully.
 */

import type { Connection } from '@solana/web3.js';

export interface BurnResult {
  mint: string;
  success: boolean;
  signature?: string;
  error?: string;
  rentReclaimed: number;
}

/**
 * Build burn + close instructions for a single SPL NFT.
 * Returns null if the token account can't be found (e.g. compressed NFT).
 */
export async function buildBurnIx(
  mint: string,
  ownerBase58: string,
  connection: Connection,
) {
  const { PublicKey, } = await import('@solana/web3.js');
  const {
    createBurnInstruction,
    createCloseAccountInstruction,
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
  } = await import('@solana/spl-token');

  const owner = new PublicKey(ownerBase58);
  const mintPk = new PublicKey(mint);

  // Try standard SPL first, then Token-2022
  let tokenAccountPk: InstanceType<typeof PublicKey> | null = null;
  let programId = TOKEN_PROGRAM_ID;

  const splAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    mint: mintPk,
    programId: TOKEN_PROGRAM_ID,
  });

  if (splAccounts.value.length > 0) {
    tokenAccountPk = splAccounts.value[0].pubkey;
    programId = TOKEN_PROGRAM_ID;
  } else {
    const t22Accounts = await connection.getParsedTokenAccountsByOwner(owner, {
      mint: mintPk,
      programId: TOKEN_2022_PROGRAM_ID,
    });
    if (t22Accounts.value.length > 0) {
      tokenAccountPk = t22Accounts.value[0].pubkey;
      programId = TOKEN_2022_PROGRAM_ID;
    }
  }

  if (!tokenAccountPk) return null; // compressed or already closed

  const burnIx = createBurnInstruction(
    tokenAccountPk,
    mintPk,
    owner,
    1, // NFT amount = 1
    [],
    programId,
  );

  const closeIx = createCloseAccountInstruction(
    tokenAccountPk,
    owner, // destination for rent
    owner, // authority
    [],
    programId,
  );

  return { burnIx, closeIx, tokenAccountPk };
}

/**
 * Burn a single NFT. Returns the result.
 */
export async function burnSingleNft(
  mint: string,
  ownerBase58: string,
  connection: Connection,
  sendTransaction: (tx: import('@solana/web3.js').Transaction, conn: Connection) => Promise<string>,
): Promise<BurnResult> {
  try {
    const ixData = await buildBurnIx(mint, ownerBase58, connection);
    if (!ixData) {
      return { mint, success: false, error: 'Compressed NFT — burn not supported', rentReclaimed: 0 };
    }

    const { Transaction } = await import('@solana/web3.js');
    const tx = new Transaction().add(ixData.burnIx, ixData.closeIx);
    const sig = await sendTransaction(tx, connection);
    await connection.confirmTransaction(sig, 'confirmed');

    return { mint, success: true, signature: sig, rentReclaimed: 0.00203 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { mint, success: false, error: msg, rentReclaimed: 0 };
  }
}

/**
 * Burn multiple NFTs in batches.
 * Each batch contains up to `batchSize` burn+close instruction pairs.
 * Calls `onProgress` after each batch completes.
 */
export async function burnBatchNfts(
  mints: string[],
  ownerBase58: string,
  connection: Connection,
  sendTransaction: (tx: import('@solana/web3.js').Transaction, conn: Connection) => Promise<string>,
  onProgress?: (completed: number, total: number, results: BurnResult[]) => void,
  batchSize = 5,
): Promise<BurnResult[]> {
  const results: BurnResult[] = [];
  const { Transaction } = await import('@solana/web3.js');

  for (let i = 0; i < mints.length; i += batchSize) {
    const batch = mints.slice(i, i + batchSize);

    // Build instructions for this batch
    const ixPairs = await Promise.all(
      batch.map(async (mint) => {
        const data = await buildBurnIx(mint, ownerBase58, connection);
        return { mint, data };
      }),
    );

    // Separate burnable vs non-burnable
    const burnable = ixPairs.filter((p) => p.data !== null);
    const skipped = ixPairs.filter((p) => p.data === null);

    // Record skipped
    for (const s of skipped) {
      results.push({ mint: s.mint, success: false, error: 'Compressed NFT — burn not supported', rentReclaimed: 0 });
    }

    if (burnable.length === 0) {
      onProgress?.(results.length, mints.length, results);
      continue;
    }

    try {
      const tx = new Transaction();
      for (const b of burnable) {
        tx.add(b.data!.burnIx, b.data!.closeIx);
      }

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      for (const b of burnable) {
        results.push({ mint: b.mint, success: true, signature: sig, rentReclaimed: 0.00203 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const b of burnable) {
        results.push({ mint: b.mint, success: false, error: msg, rentReclaimed: 0 });
      }
    }

    onProgress?.(results.length, mints.length, results);
  }

  return results;
}
