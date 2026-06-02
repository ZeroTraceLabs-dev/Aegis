/**
 * Gas Sub-Wallet Sweep — moves SOL from the encrypted gas sub-wallet
 * back to the user's main wallet as part of the disarm flow.
 *
 * Why this exists: disarm wipes the encrypted private-key blob from
 * localStorage. The blob is the ONLY copy of the gas wallet's secret
 * key — once it's gone, any SOL still in the sub-wallet's address is
 * permanently unrecoverable. So disarm has to sweep first, then clear.
 *
 * The gas sub-wallet is both fee payer and source for the sweep, so
 * no main-wallet signature is needed for the transfer itself (the
 * main wallet only signs the decryption message that produces the
 * AES key for the encrypted blob — that's handled by the caller via
 * decryptGasWalletSecret).
 */
import type { Connection, PublicKey } from '@solana/web3.js';

/** Tx fee margin held back from the sweep so the broadcast can't fail
 *  on fee deduction. 5,000 lamports is the standard Solana base fee
 *  for a single-signature tx. */
const FEE_BUFFER_LAMPORTS = 5_000;

export interface SweepPlan {
  /** Current gas wallet balance in lamports. */
  gasBalanceLamports: number;
  /** Rent-exempt minimum for a 0-data system account — left behind so
   *  the broadcast doesn't try to drain the account below rent and get
   *  rejected. */
  rentExemptLamports: number;
  /** Tx fee buffer also left behind. */
  feeBufferLamports: number;
  /** Lamports the sweep will actually transfer. Zero if the balance
   *  isn't above rent + fee. */
  sweepLamports: number;
  /** True if there's enough above rent + fee to bother sweeping. */
  shouldSweep: boolean;
}

/**
 * Compute the sweep plan. Pure read — no signing, no broadcast.
 * Caller uses the result to render a confirmation modal before
 * proceeding to executeSweep.
 */
export async function planSweep(
  connection: Connection,
  gasPubkey: PublicKey,
): Promise<SweepPlan> {
  const [balanceLamports, rentExemptLamports] = await Promise.all([
    connection.getBalance(gasPubkey, 'confirmed'),
    connection.getMinimumBalanceForRentExemption(0, 'confirmed'),
  ]);
  const threshold = rentExemptLamports + FEE_BUFFER_LAMPORTS;
  const shouldSweep = balanceLamports > threshold;
  return {
    gasBalanceLamports: balanceLamports,
    rentExemptLamports,
    feeBufferLamports: FEE_BUFFER_LAMPORTS,
    sweepLamports: shouldSweep ? balanceLamports - threshold : 0,
    shouldSweep,
  };
}

export interface SweepResult {
  signature: string;
  sweptLamports: number;
}

/**
 * Build → sign → broadcast → confirm a SOL transfer from the gas
 * sub-wallet to the destination (main wallet). The decrypted secret
 * is consumed in-memory to build a Keypair — caller still owns the
 * Uint8Array and is responsible for zeroing it after this returns.
 *
 * Retries once if the broadcast comes back with a stale-blockhash
 * error, mirroring signSendConfirmWithRetry from altManagement.
 *
 * Throws on any failure. The caller's contract is to preserve armed
 * state on throw, so this function never swallows errors.
 */
export async function executeSweep(
  connection: Connection,
  decryptedSecret: Uint8Array,
  destinationPubkey: PublicKey,
  sweepLamports: number,
  onStatus: (msg: string) => void,
): Promise<SweepResult> {
  const web3 = await import('@solana/web3.js');
  const { Keypair, Transaction, SystemProgram } = web3;

  const gasKeypair = Keypair.fromSecretKey(decryptedSecret);

  const attempt = async (signLabel: string): Promise<string> => {
    onStatus(signLabel);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: gasKeypair.publicKey,
        toPubkey: destinationPubkey,
        lamports: sweepLamports,
      }),
    );
    tx.recentBlockhash = blockhash;
    tx.feePayer = gasKeypair.publicKey;
    tx.sign(gasKeypair);

    onStatus('Broadcasting sweep…');
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    });

    onStatus('Confirming on-chain…');
    await connection.confirmTransaction(
      { signature: sig, blockhash, lastValidBlockHeight },
      'confirmed',
    );
    return sig;
  };

  try {
    const sig = await attempt('Signing sweep transaction…');
    return { signature: sig, sweptLamports: sweepLamports };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const stale = /blockhash not found|block height exceeded|expired/i.test(msg);
    if (!stale) throw e;
    const sig = await attempt('Blockhash expired — retrying sweep…');
    return { signature: sig, sweptLamports: sweepLamports };
  }
}
