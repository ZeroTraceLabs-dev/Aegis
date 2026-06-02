/**
 * Evac Fire Path — the execution engine.
 *
 * Given a fully-configured armed state (gas keypair, destination, ALT,
 * priority order) and the current wallet contents, executeEvac walks
 * the three priority tiers in order:
 *
 *   Critical  — simulate-while-signing (optimistic). The user clicks
 *               Approve once; sims run in parallel; broadcast filters
 *               out failed-sim txs after the wallet returns.
 *   Priority  — simulate-then-sign. Safer/slower: txs that would fail
 *               are filtered out BEFORE the user is prompted, so the
 *               signature popup only carries valid work.
 *   Standard  — same as Priority. Best-effort. If gas runs out
 *               mid-tier, remaining txs are marked skipped, not failed.
 *
 * Per-tier failures don't halt subsequent tiers. Per-tx failures don't
 * halt the rest of the tier. The user always gets a granular result.
 *
 * Safety invariants enforced here:
 *   - The gas Keypair is created once from the decrypted secret and
 *     not exfiltrated. The CALLER is responsible for zeroing the
 *     decrypted secret bytes when this returns. We never log keys.
 *   - Every tx uses commitment: 'confirmed' explicitly.
 *   - Every tx carries the fixed 100,000-lamport priority fee via
 *     ComputeBudgetProgram. No dynamic pricing.
 *   - Gas-low check fires BEFORE broadcasting a fresh batch — txs
 *     that would fail for insufficient lamports are marked skipped.
 */

import type {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { WalletData, TokenAccount } from '@/hooks/useWalletScan';
import type { PriorityConfig, PriorityTier, AssetCategory } from './configStore';
import {
  broadcastV0,
  confirmV0,
  simulateV0,
  type BroadcastResult,
} from './txHelpers';
import {
  COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
  COMPUTE_UNIT_LIMIT,
  PER_TX_LAMPORTS,
  TRANSFERS_PER_TX,
} from './gasEstimation';

// ── Types ───────────────────────────────────────────────────────

export interface AssetDescriptor {
  type: 'sol' | 'token' | 'nft';
  name: string;
  mint?: string;
  /** Display amount (lamports for SOL, UI amount for tokens, 1 for NFTs). */
  amount: number;
}

export interface TxResult {
  signature?: string;
  assets: AssetDescriptor[];
  error?: string;
}

export interface TierResult {
  succeeded: TxResult[];
  failed: TxResult[];
  skipped: TxResult[];
}

export interface FireTotals {
  sol: number;
  tokens: number;
  nfts: number;
}

export interface FireResult {
  tiers: {
    critical: TierResult;
    priority: TierResult;
    standard: TierResult;
  };
  totalAssetsEvacuated: FireTotals;
  totalGasSpent: number;
  durationMs: number;
}

export type FireProgressEvent =
  | { type: 'tier-start'; tier: PriorityTier; plannedTransfers: number; plannedTxs: number }
  | { type: 'tier-signing'; tier: PriorityTier; txCount: number }
  | { type: 'tier-broadcasting'; tier: PriorityTier; txCount: number }
  | { type: 'tier-confirming'; tier: PriorityTier; txCount: number }
  | { type: 'tx-confirmed'; tier: PriorityTier; signature: string; assets: AssetDescriptor[] }
  | { type: 'tx-failed'; tier: PriorityTier; assets: AssetDescriptor[]; error: string; signature?: string }
  | { type: 'tx-skipped'; tier: PriorityTier; assets: AssetDescriptor[]; reason: string }
  | { type: 'tier-complete'; tier: PriorityTier; succeeded: number; failed: number; skipped: number }
  | { type: 'gas-low'; remainingLamports: number };

export interface FireInputs {
  connection: Connection;
  walletAdapter: WalletContextState; // for signAllTransactions
  gasKeypair: Keypair;
  destinationAddress: string;
  walletData: WalletData;
  collectionMap: Record<string, string>;
  spamTokenMints: Set<string>;
  spamCollectionIds: Set<string>;
  priority: PriorityConfig;
  altAddress: string;
  /** Asset display names by mint. Optional — falls back to mint short. */
  metadataByMint?: Map<string, { symbol?: string; name?: string }>;
  /** Helius DAS RPC endpoint. Required when any cNFT or MPL Core
   *  asset is being evacuated — those formats need getAsset /
   *  getAssetProof calls that aren't available on the standard
   *  Solana RPC. Pass the same VITE_HELIUS_RPC_URL value used by
   *  the rest of the app. */
  dasRpcUrl: string;
  onProgress: (event: FireProgressEvent) => void;
}

// ── Public API ──────────────────────────────────────────────────

export async function executeEvac(inputs: FireInputs): Promise<FireResult> {
  const startTime = performance.now();
  const web3 = await import('@solana/web3.js');
  const { PublicKey } = web3;

  const altAccount = await loadAlt(inputs.connection, inputs.altAddress);
  if (!altAccount) {
    throw new Error('Protection table not reachable on-chain. Re-arm before firing.');
  }

  const destinationPubkey = new PublicKey(inputs.destinationAddress);
  const mainPubkey = inputs.walletAdapter.publicKey;
  if (!mainPubkey) {
    throw new Error('Main wallet disconnected. Reconnect before firing.');
  }
  if (!inputs.walletAdapter.signAllTransactions) {
    throw new Error('Wallet does not support batch signing. Use Phantom, Solflare, or Backpack.');
  }

  const initialGasBalance = await inputs.connection.getBalance(
    inputs.gasKeypair.publicKey,
    'confirmed',
  );

  // Build the asset universe once. Subsequent tiers consume from this.
  const universe = buildAssetUniverse(inputs);

  const tiers: FireResult['tiers'] = {
    critical: { succeeded: [], failed: [], skipped: [] },
    priority: { succeeded: [], failed: [], skipped: [] },
    standard: { succeeded: [], failed: [], skipped: [] },
  };

  const tierOrder: PriorityTier[] = ['critical', 'priority', 'standard'];
  for (const tier of tierOrder) {
    const categories = inputs.priority.tiers[tier];
    if (categories.length === 0) continue;
    const assets = collectAssetsForTier(universe, categories);
    if (assets.length === 0) continue;

    const mode: TierMode = tier === 'critical' ? 'optimistic-sign' : 'simulate-first';

    const tierResult = await processTier({
      tier,
      mode,
      assets,
      altAccount,
      destinationPubkey,
      mainPubkey,
      ...inputs,
    });

    tiers[tier] = tierResult;
  }

  const finalGasBalance = await inputs.connection
    .getBalance(inputs.gasKeypair.publicKey, 'confirmed')
    .catch(() => initialGasBalance);

  const totals = computeTotals(tiers);

  return {
    tiers,
    totalAssetsEvacuated: totals,
    totalGasSpent: Math.max(0, initialGasBalance - finalGasBalance),
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ── Asset enumeration ───────────────────────────────────────────

interface AssetUniverse {
  sol: AssetDescriptor[]; // 0 or 1 entry
  tokens: TokenAssetPlan[];
  nfts: TokenAssetPlan[];
}

interface TokenAssetPlan {
  descriptor: AssetDescriptor;
  account: TokenAccount;
}

function buildAssetUniverse(inputs: FireInputs): AssetUniverse {
  const { walletData, spamTokenMints, spamCollectionIds, collectionMap, metadataByMint } = inputs;

  const sol: AssetDescriptor[] = [];
  if (walletData.solBalance > 0) {
    sol.push({ type: 'sol', name: 'SOL', amount: walletData.solBalance });
  }

  const tokens: TokenAssetPlan[] = [];
  const nfts: TokenAssetPlan[] = [];
  for (const acc of walletData.tokenAccounts) {
    if (spamTokenMints.has(acc.mint)) continue;
    if (acc.isNft) {
      const collId = collectionMap[acc.mint];
      if (collId && spamCollectionIds.has(collId)) continue;
      const meta = metadataByMint?.get(acc.mint);
      nfts.push({
        descriptor: {
          type: 'nft',
          name: meta?.name || acc.name || meta?.symbol || acc.symbol,
          mint: acc.mint,
          amount: 1,
        },
        account: acc,
      });
    } else {
      if (acc.uiAmount <= 0) continue;
      const meta = metadataByMint?.get(acc.mint);
      tokens.push({
        descriptor: {
          type: 'token',
          name: meta?.symbol || acc.symbol,
          mint: acc.mint,
          amount: acc.uiAmount,
        },
        account: acc,
      });
    }
  }

  return { sol, tokens, nfts };
}

function collectAssetsForTier(universe: AssetUniverse, categories: AssetCategory[]): TierAsset[] {
  const collected: TierAsset[] = [];
  if (categories.includes('sol')) {
    for (const s of universe.sol) collected.push({ kind: 'sol', descriptor: s });
  }
  if (categories.includes('tokens')) {
    for (const t of universe.tokens) collected.push({ kind: 'token', descriptor: t.descriptor, account: t.account });
  }
  if (categories.includes('nfts')) {
    for (const n of universe.nfts) collected.push({ kind: 'nft', descriptor: n.descriptor, account: n.account });
  }
  return collected;
}

type TierAsset =
  | { kind: 'sol'; descriptor: AssetDescriptor }
  | { kind: 'token' | 'nft'; descriptor: AssetDescriptor; account: TokenAccount };

// ── Tier processing ─────────────────────────────────────────────

type TierMode = 'optimistic-sign' | 'simulate-first';

interface TierContext {
  tier: PriorityTier;
  mode: TierMode;
  assets: TierAsset[];
  altAccount: AddressLookupTableAccount;
  destinationPubkey: PublicKey;
  mainPubkey: PublicKey;
  connection: Connection;
  walletAdapter: WalletContextState;
  gasKeypair: Keypair;
  dasRpcUrl: string;
  onProgress: (event: FireProgressEvent) => void;
  /** Populated by buildTierTransfers when an asset's ixs can't be
   *  constructed (DAS fetch failure for a cNFT, missing fields, etc.).
   *  processTier surfaces these as tx-failed events alongside per-tx
   *  simulation/broadcast failures so the user sees a single unified
   *  failure list. */
  buildFailures?: { asset: AssetDescriptor; error: string }[];
}

async function processTier(ctx: TierContext): Promise<TierResult> {
  const result: TierResult = { succeeded: [], failed: [], skipped: [] };
  const web3 = await import('@solana/web3.js');
  const { TransactionMessage, VersionedTransaction } = web3;

  // 1. Build raw transfer instructions, one entry per asset (each entry
  //    may produce multiple ixs — token transfers carry an idempotent
  //    ATA-create alongside the transfer).
  const planned = await buildTierTransfers(ctx);

  // 1a. Surface any assets that couldn't even be built (DAS fetch
  //     failures for cNFT proofs, unknown NFT formats, etc.). These
  //     skip the simulate/broadcast pipeline entirely and land in
  //     result.failed[] before the tx work begins.
  for (const bf of ctx.buildFailures ?? []) {
    result.failed.push({ assets: [bf.asset], error: bf.error });
    ctx.onProgress({ type: 'tx-failed', tier: ctx.tier, assets: [bf.asset], error: bf.error });
  }

  // 2. Pack into v0 txs with compute-budget ixs prepended. Each pack
  //    carries the assets it covers so failures can be attributed back
  //    to the user-visible items.
  const packs = await packTransfersIntoTxs(planned);

  ctx.onProgress({
    type: 'tier-start',
    tier: ctx.tier,
    plannedTransfers: planned.length,
    plannedTxs: packs.length,
  });

  if (packs.length === 0) return result;

  // 3. Gas-low check before any signing.
  const requiredLamports = packs.length * PER_TX_LAMPORTS;
  const gasAtStart = await ctx.connection.getBalance(ctx.gasKeypair.publicKey, 'confirmed');
  if (gasAtStart < PER_TX_LAMPORTS) {
    // Not even one tx can fly. Skip the whole tier.
    for (const p of packs) {
      const tx: TxResult = { assets: p.assets, error: 'Gas exhausted — insufficient lamports for any further transfers.' };
      result.skipped.push(tx);
      ctx.onProgress({ type: 'tx-skipped', tier: ctx.tier, assets: p.assets, reason: 'gas-exhausted' });
    }
    ctx.onProgress({ type: 'gas-low', remainingLamports: gasAtStart });
    ctx.onProgress({
      type: 'tier-complete',
      tier: ctx.tier,
      succeeded: result.succeeded.length,
      failed: result.failed.length,
      skipped: result.skipped.length,
    });
    return result;
  }

  let executablePacks = packs;
  if (gasAtStart < requiredLamports) {
    // Partial gas — execute what we can, skip the rest.
    const affordable = Math.floor(gasAtStart / PER_TX_LAMPORTS);
    executablePacks = packs.slice(0, affordable);
    for (let i = affordable; i < packs.length; i++) {
      const p = packs[i];
      result.skipped.push({ assets: p.assets, error: 'Gas would be exhausted before this tx.' });
      ctx.onProgress({ type: 'tx-skipped', tier: ctx.tier, assets: p.assets, reason: 'gas-exhausted' });
    }
    ctx.onProgress({ type: 'gas-low', remainingLamports: gasAtStart });
  }

  // 4. Fresh blockhash for the whole batch.
  const { blockhash, lastValidBlockHeight } =
    await ctx.connection.getLatestBlockhash('confirmed');

  // 5. Build VersionedTransactions. Gas-sign each immediately (synchronous
  //    cost — no wallet popup). Wallet sig comes via signAllTransactions.
  const builtTxs: VersionedTransaction[] = executablePacks.map((pack) => {
    const message = new TransactionMessage({
      payerKey: ctx.gasKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions: pack.ixs,
    }).compileToV0Message([ctx.altAccount]);
    const tx = new VersionedTransaction(message);
    tx.sign([ctx.gasKeypair]);
    return tx;
  });

  // 6. Sign + simulate per mode.
  let sims: Array<{ ok: boolean; error: string | null }>;
  let signedTxs: VersionedTransaction[];

  if (ctx.mode === 'optimistic-sign') {
    // Kick off simulations IN PARALLEL with the wallet's signAll prompt.
    ctx.onProgress({ type: 'tier-signing', tier: ctx.tier, txCount: builtTxs.length });
    const simPromise = Promise.all(builtTxs.map((tx) => simulateV0(ctx.connection, tx)));
    const signPromise = ctx.walletAdapter.signAllTransactions!(builtTxs);
    try {
      const [simResults, signedResult] = await Promise.all([simPromise, signPromise]);
      sims = simResults;
      signedTxs = signedResult;
    } catch (e) {
      // Wallet rejected. Mark everything failed and bail (later tiers
      // still attempted by the caller — this tier just halts).
      const msg = e instanceof Error ? e.message : String(e);
      for (const pack of executablePacks) {
        result.failed.push({ assets: pack.assets, error: `Signature rejected: ${msg}` });
        ctx.onProgress({
          type: 'tx-failed',
          tier: ctx.tier,
          assets: pack.assets,
          error: `Signature rejected: ${msg}`,
        });
      }
      ctx.onProgress({
        type: 'tier-complete',
        tier: ctx.tier,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
      });
      throw new FireSignatureRejectedError(ctx.tier, msg);
    }
  } else {
    // Simulate first. Filter failed sims before showing the popup.
    sims = await Promise.all(builtTxs.map((tx) => simulateV0(ctx.connection, tx)));
    const validIndices: number[] = [];
    for (let i = 0; i < sims.length; i++) {
      if (sims[i].ok) {
        validIndices.push(i);
      } else {
        const pack = executablePacks[i];
        result.failed.push({ assets: pack.assets, error: `Simulation failed: ${sims[i].error}` });
        ctx.onProgress({
          type: 'tx-failed',
          tier: ctx.tier,
          assets: pack.assets,
          error: `Simulation failed: ${sims[i].error}`,
        });
      }
    }
    if (validIndices.length === 0) {
      ctx.onProgress({
        type: 'tier-complete',
        tier: ctx.tier,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
      });
      return result;
    }
    ctx.onProgress({ type: 'tier-signing', tier: ctx.tier, txCount: validIndices.length });
    try {
      const subset = validIndices.map((i) => builtTxs[i]);
      const signed = await ctx.walletAdapter.signAllTransactions!(subset);
      signedTxs = builtTxs.slice();
      for (let k = 0; k < validIndices.length; k++) {
        signedTxs[validIndices[k]] = signed[k];
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      for (const i of validIndices) {
        const pack = executablePacks[i];
        result.failed.push({ assets: pack.assets, error: `Signature rejected: ${msg}` });
        ctx.onProgress({
          type: 'tx-failed',
          tier: ctx.tier,
          assets: pack.assets,
          error: `Signature rejected: ${msg}`,
        });
      }
      ctx.onProgress({
        type: 'tier-complete',
        tier: ctx.tier,
        succeeded: result.succeeded.length,
        failed: result.failed.length,
        skipped: result.skipped.length,
      });
      throw new FireSignatureRejectedError(ctx.tier, msg);
    }
  }

  // 7. Broadcast surviving txs in parallel.
  ctx.onProgress({
    type: 'tier-broadcasting',
    tier: ctx.tier,
    txCount: executablePacks.length,
  });
  const broadcasts: Array<BroadcastResult | { failed: true; error: string; index: number }> = await Promise.all(
    signedTxs.map(async (tx, i) => {
      if (!sims[i].ok && ctx.mode === 'optimistic-sign') {
        return { failed: true, error: `Simulation failed: ${sims[i].error}`, index: i };
      }
      if (!sims[i].ok && ctx.mode === 'simulate-first') {
        // Already marked failed before signing; placeholder.
        return { failed: true, error: 'Pre-broadcast simulation failure', index: i };
      }
      try {
        return await broadcastV0(ctx.connection, tx, blockhash, lastValidBlockHeight);
      } catch (e) {
        return {
          failed: true,
          error: e instanceof Error ? e.message : String(e),
          index: i,
        };
      }
    }),
  );

  // 8. Confirm in parallel.
  ctx.onProgress({
    type: 'tier-confirming',
    tier: ctx.tier,
    txCount: broadcasts.filter((b): b is BroadcastResult => !('failed' in b)).length,
  });
  await Promise.all(
    broadcasts.map(async (b, i) => {
      const pack = executablePacks[i];

      // Cases where we already counted this as failed in optimistic-sign
      // (failed sim) or where broadcast itself threw.
      if ('failed' in b) {
        // For optimistic-sign, failed-sim wasn't yet pushed to failed[].
        if (ctx.mode === 'optimistic-sign' && !sims[i].ok) {
          result.failed.push({ assets: pack.assets, error: b.error });
          ctx.onProgress({ type: 'tx-failed', tier: ctx.tier, assets: pack.assets, error: b.error });
        } else if (!sims[i].ok && ctx.mode === 'simulate-first') {
          // already pushed
        } else {
          result.failed.push({ assets: pack.assets, error: b.error });
          ctx.onProgress({ type: 'tx-failed', tier: ctx.tier, assets: pack.assets, error: b.error });
        }
        return;
      }

      try {
        await confirmV0(ctx.connection, b);
        result.succeeded.push({ signature: b.signature, assets: pack.assets });
        ctx.onProgress({
          type: 'tx-confirmed',
          tier: ctx.tier,
          signature: b.signature,
          assets: pack.assets,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.failed.push({ signature: b.signature, assets: pack.assets, error: msg });
        ctx.onProgress({
          type: 'tx-failed',
          tier: ctx.tier,
          assets: pack.assets,
          error: msg,
          signature: b.signature,
        });
      }
    }),
  );

  ctx.onProgress({
    type: 'tier-complete',
    tier: ctx.tier,
    succeeded: result.succeeded.length,
    failed: result.failed.length,
    skipped: result.skipped.length,
  });
  return result;
}

// ── Instruction building ────────────────────────────────────────

/** Which on-chain program a planned transfer's ixs invoke. Drives
 *  fate-isolation in packing: txs never mix groups, so a failure in
 *  one group's ix can't atomic-rollback transfers in another.
 *
 *  Six groups in practice:
 *    'system'     — SOL transfer (SystemProgram)
 *    'spl-token'  — fungible SPL Token Program tokens
 *    'token-2022' — fungible SPL Token-2022 tokens
 *    'spl-nft'    — standard SPL Token Program NFTs (kept distinct
 *                   from spl-token so a hostile token doesn't poison
 *                   a clean NFT batch and vice versa)
 *    'cnft'       — Bubblegum compressed NFTs
 *    'core'       — MPL Core NFTs
 */
type TransferGroup =
  | 'system'
  | 'spl-token'
  | 'token-2022'
  | 'spl-nft'
  | 'cnft'
  | 'core';

interface PlannedTransfer {
  /** Instructions for this single asset (SystemProgram.transfer for
   *  SOL; createIdempotent + transferChecked for SPL/NFTs; Bubblegum
   *  transfer for cNFTs; MPL Core transferV1 for Core). */
  ixs: TransactionInstruction[];
  asset: AssetDescriptor;
  group: TransferGroup;
}

async function buildTierTransfers(ctx: TierContext): Promise<PlannedTransfer[]> {
  const web3 = await import('@solana/web3.js');
  const { SystemProgram, PublicKey } = web3;
  const splToken = await import('@solana/spl-token');
  const {
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createTransferCheckedInstruction,
    createAssociatedTokenAccountIdempotentInstruction,
    getAssociatedTokenAddressSync,
  } = splToken;

  const out: PlannedTransfer[] = [];
  const failedToBuild: { asset: AssetDescriptor; error: string }[] = [];

  for (const asset of ctx.assets) {
    if (asset.kind === 'sol') {
      // SystemProgram.transfer doesn't need ATAs or token program.
      // Drain main wallet to 0 — gas pays fee. Anything credited back
      // to main later (rent returns etc.) stays stranded, accepted.
      const lamports = Math.floor(asset.descriptor.amount * 1e9);
      if (lamports <= 0) continue;
      const ix = SystemProgram.transfer({
        fromPubkey: ctx.mainPubkey,
        toPubkey: ctx.destinationPubkey,
        lamports,
      });
      out.push({ ixs: [ix], asset: asset.descriptor, group: 'system' });
      continue;
    }

    // ── NFT-format routing ────────────────────────────────────
    // For isNft assets the wallet scan stamps nftFormat:
    //   'spl'     → standard SPL Token / Token-2022 NFT
    //   'cnft'    → Bubblegum compressed NFT
    //   'core'    → MPL Core asset
    //   'unknown' → DAS couldn't classify; we surface and skip
    // Fungible (non-NFT) tokens fall through to the standard SPL
    // transferChecked path below.
    const nftFormat = asset.kind === 'nft' || asset.kind === 'token'
      ? asset.account.nftFormat
      : undefined;

    if (asset.kind === 'nft' && nftFormat === 'unknown') {
      failedToBuild.push({
        asset: asset.descriptor,
        error: 'Unknown NFT format. Asset surfaced by DAS but its `interface` could not be classified as SPL, cNFT, or Core.',
      });
      continue;
    }

    if (asset.kind === 'nft' && nftFormat === 'cnft') {
      try {
        const { buildCnftTransferIxs } = await import('./nftFormat');
        const ixs = await buildCnftTransferIxs({
          rpcUrl: ctx.dasRpcUrl,
          assetId: asset.account.mint,
          currentOwner: ctx.mainPubkey.toBase58(),
          newOwner: ctx.destinationPubkey.toBase58(),
        });
        out.push({ ixs, asset: asset.descriptor, group: 'cnft' });
      } catch (e) {
        failedToBuild.push({
          asset: asset.descriptor,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }

    if (asset.kind === 'nft' && nftFormat === 'core') {
      try {
        const { buildCoreTransferIxs } = await import('./nftFormat');
        const ixs = await buildCoreTransferIxs({
          rpcUrl: ctx.dasRpcUrl,
          assetId: asset.account.mint,
          currentOwner: ctx.mainPubkey.toBase58(),
          newOwner: ctx.destinationPubkey.toBase58(),
          payer: ctx.gasKeypair.publicKey.toBase58(),
        });
        out.push({ ixs, asset: asset.descriptor, group: 'core' });
      } catch (e) {
        failedToBuild.push({
          asset: asset.descriptor,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      continue;
    }

    // ── SPL transfer (standard SPL/Token-2022 fungible OR SPL NFT) ──
    // Pick the program ID from the tag the wallet scan attached at
    // parse time. Mistagging here means the ATA-create's mint-owner
    // check inside the ATA program rejects with IncorrectProgramId —
    // silently roping every other ix in the same tx into the
    // rollback. Packing isolates groups to keep that failure scoped
    // to its own tx; here we just pick correctly.
    const mint = new PublicKey(asset.account.mint);
    const programId = asset.account.tokenProgram === 'token-2022'
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;
    const sourceAta = getAssociatedTokenAddressSync(mint, ctx.mainPubkey, false, programId);
    const destAta = getAssociatedTokenAddressSync(mint, ctx.destinationPubkey, false, programId);
    const ataIx = createAssociatedTokenAccountIdempotentInstruction(
      ctx.gasKeypair.publicKey, // payer for ATA rent: gas, not main
      destAta,
      ctx.destinationPubkey,
      mint,
      programId,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const amountRaw = BigInt(asset.account.amount);
    const transferIx = createTransferCheckedInstruction(
      sourceAta,
      mint,
      destAta,
      ctx.mainPubkey, // authority
      amountRaw,
      asset.account.decimals,
      [],
      programId,
    );
    // Bucket SPL NFTs separately from SPL fungibles so a hostile
    // fungible can't poison an NFT batch (and vice versa). Both
    // still use TOKEN_PROGRAM_ID under the hood; the split is for
    // fate isolation, not protocol correctness.
    const isSplNft = asset.kind === 'nft';
    const group: TransferGroup = asset.account.tokenProgram === 'token-2022'
      ? 'token-2022'
      : isSplNft
        ? 'spl-nft'
        : 'spl-token';
    out.push({
      ixs: [ataIx, transferIx],
      asset: asset.descriptor,
      group,
    });
  }

  // Stash build-time failures on the context so processTier can surface
  // them through the existing tx-failed pipeline alongside simulation
  // failures.
  ctx.buildFailures = failedToBuild;

  return out;
}

// ── Packing ─────────────────────────────────────────────────────

interface PackedTx {
  ixs: TransactionInstruction[];
  assets: AssetDescriptor[];
}

/**
 * Pack planned transfers into v0 transactions and prepend the
 * compute-budget ixs (price + limit) so the priority fee is exactly
 * the fixed value defined in gasEstimation.ts.
 *
 * Packing is grouped by program ID first, then chunked at
 * TRANSFERS_PER_TX (10) within each group. Solana transactions are
 * atomic — one ix failure rolls back every ix in the same tx — so
 * mixing program IDs in one tx means a hostile Token-2022 mint can
 * kill an otherwise-clean Token Program transfer. By emitting
 * separate txs per group, a failed mint takes only its same-group
 * batch down with it; the other groups continue to evacuate.
 *
 * Cost: in a mixed-program wallet, we pay one extra tx per program
 * group present (max two extra: Token-2022 + System). The 20% gas
 * buffer absorbs this; the precondition's worst-case is ~3 txs of
 * overhead vs the naive sum. Static chunk at 10 transfers/tx also
 * stays safely inside the 1232-byte tx size limit when ATAs ride
 * uncompressed alongside ALT-referenced mints.
 */
async function packTransfersIntoTxs(
  planned: PlannedTransfer[],
): Promise<PackedTx[]> {
  if (planned.length === 0) return [];
  const web3 = await import('@solana/web3.js');
  const { ComputeBudgetProgram } = web3;
  const cbIxs: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: COMPUTE_UNIT_PRICE_MICRO_LAMPORTS,
    }),
  ];

  // 1. Bucket by program-group. Order matters for predictable progress
  //    rendering: system first (single SOL ix), then fungibles by
  //    program, then NFTs by format.
  const buckets: Record<TransferGroup, PlannedTransfer[]> = {
    system: [],
    'spl-token': [],
    'token-2022': [],
    'spl-nft': [],
    cnft: [],
    core: [],
  };
  for (const p of planned) buckets[p.group].push(p);

  // 2. Chunk each bucket independently. Same-group transfers share txs
  //    up to TRANSFERS_PER_TX; cross-group transfers never share.
  const packs: PackedTx[] = [];
  const groupOrder: TransferGroup[] = [
    'system',
    'spl-token',
    'token-2022',
    'spl-nft',
    'cnft',
    'core',
  ];
  for (const group of groupOrder) {
    const bucket = buckets[group];
    for (let i = 0; i < bucket.length; i += TRANSFERS_PER_TX) {
      const slice = bucket.slice(i, i + TRANSFERS_PER_TX);
      packs.push({
        ixs: [...cbIxs, ...slice.flatMap((p) => p.ixs)],
        assets: slice.map((p) => p.asset),
      });
    }
  }
  return packs;
}

// ── ALT loading ─────────────────────────────────────────────────

async function loadAlt(
  connection: Connection,
  altAddress: string,
): Promise<AddressLookupTableAccount | null> {
  const web3 = await import('@solana/web3.js');
  const { PublicKey } = web3;
  const res = await connection.getAddressLookupTable(new PublicKey(altAddress), {
    commitment: 'confirmed',
  });
  return res.value ?? null;
}

// ── Totals ──────────────────────────────────────────────────────

function computeTotals(tiers: FireResult['tiers']): FireTotals {
  let sol = 0;
  let tokens = 0;
  let nfts = 0;
  for (const tier of Object.values(tiers) as TierResult[]) {
    for (const tx of tier.succeeded) {
      for (const asset of tx.assets) {
        if (asset.type === 'sol') sol += asset.amount;
        else if (asset.type === 'token') tokens += 1;
        else if (asset.type === 'nft') nfts += 1;
      }
    }
  }
  return { sol, tokens, nfts };
}

// ── Errors ──────────────────────────────────────────────────────

/** Thrown when the user rejects the wallet's signature prompt mid-fire.
 *  Caller propagates to the UI so it can surface "evacuation halted at
 *  {tier}, retry from this tier" rather than a generic failure. */
export class FireSignatureRejectedError extends Error {
  constructor(public readonly tier: PriorityTier, msg: string) {
    super(`Signature rejected during ${tier} tier: ${msg}`);
    this.name = 'FireSignatureRejectedError';
  }
}
