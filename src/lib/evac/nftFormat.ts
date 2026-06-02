/**
 * NFT format handling for the evac fire path.
 *
 * Three formats coexist in modern Solana wallets, each with its own
 * transfer instruction and its own SDK:
 *
 *   'spl'  — Standard SPL Token NFTs (incl. Metaplex V1 / V2 / pNFT).
 *            Transferred via createTransferCheckedInstruction. Handled
 *            inline in fire.ts; this module only classifies them.
 *   'cnft' — Bubblegum compressed NFTs. Stored as leaves in a Merkle
 *            tree, not as token accounts. Need a Merkle proof per
 *            transfer (one DAS getAssetProof call per cNFT). No ATA
 *            on the destination — the Bubblegum program updates the
 *            tree leaf directly.
 *   'core' — Metaplex Core assets. Distinct on-chain account per
 *            asset, owned by the MPL Core program. transferV1 ix.
 *            No ATA, no proof.
 *
 * Umi is Metaplex's framework for building these instructions; both
 * Bubblegum and MPL Core ship as Umi plugins. We build ixs as Umi
 * Instructions and convert to web3.js TransactionInstructions so the
 * existing fire-path packing/signing/broadcast pipeline consumes them
 * exactly like SPL transfer ixs.
 *
 * Signing model preserved: every transfer requires the main wallet's
 * signature (authority). The gas keypair pays fees (payer). Both
 * carried into Umi via createNoopSigner — Umi sets the right account
 * roles in the ix; actual signing happens later via the wallet
 * adapter's signAllTransactions + the gas keypair's local sign.
 */

import type { TransactionInstruction } from '@solana/web3.js';

// ── DAS RPC helpers ─────────────────────────────────────────────

interface DasAssetCompression {
  compressed: boolean;
  tree?: string;
  leaf_id?: number;
  data_hash?: string;
  creator_hash?: string;
  asset_hash?: string;
  seq?: number;
}

interface DasAssetGrouping {
  group_key: string;
  group_value: string;
}

interface DasAsset {
  id: string;
  interface?: string;
  compression?: DasAssetCompression;
  grouping?: DasAssetGrouping[];
}

interface DasAssetProof {
  root: string;
  proof: string[];
  node_index: number;
  leaf: string;
  tree_id: string;
}

interface RpcEnvelope<T> {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: { code: number; message: string };
}

async function rpcCall<T>(rpcUrl: string, method: string, params: unknown): Promise<T> {
  const resp = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'cerberus-evac', method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) throw new Error(`DAS ${method} HTTP ${resp.status}`);
  const json = (await resp.json()) as RpcEnvelope<T>;
  if (json.error) throw new Error(`DAS ${method}: ${json.error.message}`);
  if (json.result === undefined) throw new Error(`DAS ${method}: empty result`);
  return json.result;
}

export async function fetchDasAsset(rpcUrl: string, assetId: string): Promise<DasAsset> {
  return rpcCall<DasAsset>(rpcUrl, 'getAsset', { id: assetId });
}

export async function fetchDasAssetProof(
  rpcUrl: string,
  assetId: string,
): Promise<DasAssetProof> {
  return rpcCall<DasAssetProof>(rpcUrl, 'getAssetProof', { id: assetId });
}

// ── Hash decode helpers ─────────────────────────────────────────

/**
 * Decode a base58 string into a 32-byte Uint8Array. Used for the
 * root / dataHash / creatorHash fields that Bubblegum's transfer ix
 * expects as raw bytes (DAS returns them as base58 strings).
 *
 * Umi's base58 serializer is a typed wrapper: .serialize(b58String)
 * returns the decoded byte representation. Using it avoids a
 * standalone bs58 dep + its missing type declarations.
 */
async function base58ToBytes32(s: string): Promise<Uint8Array> {
  const { base58 } = await import('@metaplex-foundation/umi/serializers');
  const decoded = base58.serialize(s);
  if (decoded.length !== 32) {
    throw new Error(`Expected 32-byte hash, got ${decoded.length} bytes from "${s}"`);
  }
  return decoded;
}

// ── Umi setup (lazy) ────────────────────────────────────────────

// Cache the Umi instance per RPC URL so we don't re-register plugins on every transfer.
const umiCache = new Map<string, unknown>();

async function getUmi(rpcUrl: string) {
  const cached = umiCache.get(rpcUrl);
  if (cached) return cached;
  const { createUmi } = await import('@metaplex-foundation/umi-bundle-defaults');
  const { mplBubblegum } = await import('@metaplex-foundation/mpl-bubblegum');
  const { mplCore } = await import('@metaplex-foundation/mpl-core');
  const umi = createUmi(rpcUrl).use(mplBubblegum()).use(mplCore());
  umiCache.set(rpcUrl, umi);
  return umi;
}

// ── Transfer builders ───────────────────────────────────────────

export interface CnftTransferInputs {
  rpcUrl: string;
  assetId: string;
  /** Current owner (main wallet). Authority on the transfer ix. */
  currentOwner: string;
  /** New owner (destination wallet). */
  newOwner: string;
}

/**
 * Build the instructions to transfer one compressed NFT.
 *
 * Network calls: DAS getAsset + getAssetProof (parallel, ~1 RTT each).
 * Output: usually a single Bubblegum transfer ix, returned as a
 * web3.js TransactionInstruction array so the caller can flatMap it
 * into a pack alongside ComputeBudget + other cNFTs of the same tier.
 *
 * Throws if:
 *   - DAS returns compressed=false (asset isn't actually a cNFT)
 *   - DAS is missing data_hash / creator_hash (rare; broken indexer)
 *   - getAssetProof times out or returns an error (stale proof; retry)
 *
 * Caller fate-isolates the failure to this asset's own tx so the rest
 * of the cNFT batch is unaffected.
 */
export async function buildCnftTransferIxs(
  inputs: CnftTransferInputs,
): Promise<TransactionInstruction[]> {
  const [asset, proof] = await Promise.all([
    fetchDasAsset(inputs.rpcUrl, inputs.assetId),
    fetchDasAssetProof(inputs.rpcUrl, inputs.assetId),
  ]);

  if (!asset.compression?.compressed) {
    throw new Error(
      `Asset ${inputs.assetId} not classified as compressed by DAS at fire time. ` +
        `Refresh wallet scan and retry.`,
    );
  }
  if (!asset.compression.data_hash || !asset.compression.creator_hash) {
    throw new Error(
      `cNFT ${inputs.assetId} missing data_hash/creator_hash in DAS response. ` +
        `Indexer state may be stale; retry after a few seconds.`,
    );
  }

  const [root, dataHash, creatorHash] = await Promise.all([
    base58ToBytes32(proof.root),
    base58ToBytes32(asset.compression.data_hash),
    base58ToBytes32(asset.compression.creator_hash),
  ]);

  const umi = await getUmi(inputs.rpcUrl);
  const { transfer } = await import('@metaplex-foundation/mpl-bubblegum');
  const { publicKey, createNoopSigner } = await import('@metaplex-foundation/umi');
  const { toWeb3JsInstruction } = await import('@metaplex-foundation/umi-web3js-adapters');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = transfer(umi as any, {
    leafOwner: createNoopSigner(publicKey(inputs.currentOwner)),
    newLeafOwner: publicKey(inputs.newOwner),
    merkleTree: publicKey(proof.tree_id),
    root,
    dataHash,
    creatorHash,
    nonce: BigInt(asset.compression.leaf_id ?? 0),
    index: proof.node_index,
    proof: proof.proof.map((p) => publicKey(p)),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umiIxs = builder.getInstructions() as any[];
  return umiIxs.map((ix) => toWeb3JsInstruction(ix));
}

export interface CoreTransferInputs {
  rpcUrl: string;
  /** Asset address (same as DAS id for Core assets). */
  assetId: string;
  /** Current owner. */
  currentOwner: string;
  /** Destination wallet. */
  newOwner: string;
  /** Fee payer (gas wallet pubkey). */
  payer: string;
}

/**
 * Build the instructions to transfer one MPL Core asset.
 *
 * Network calls: DAS getAsset (one RTT) to discover the collection
 * group, if any. Core assets that aren't part of a collection don't
 * need the collection account.
 *
 * Output: a single transferV1 ix as web3.js TransactionInstruction[].
 */
export async function buildCoreTransferIxs(
  inputs: CoreTransferInputs,
): Promise<TransactionInstruction[]> {
  const asset = await fetchDasAsset(inputs.rpcUrl, inputs.assetId);

  // Collection lookup: MPL Core assets that belong to a collection
  // must pass that collection's pubkey to transferV1 so the program
  // can apply collection-level plugins (royalties, freeze, etc.).
  const collectionGroup = asset.grouping?.find((g) => g.group_key === 'collection');
  const collectionAddr = collectionGroup?.group_value;

  const umi = await getUmi(inputs.rpcUrl);
  const { transferV1 } = await import('@metaplex-foundation/mpl-core');
  const { publicKey, createNoopSigner } = await import('@metaplex-foundation/umi');
  const { toWeb3JsInstruction } = await import('@metaplex-foundation/umi-web3js-adapters');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder = transferV1(umi as any, {
    asset: publicKey(inputs.assetId),
    collection: collectionAddr ? publicKey(collectionAddr) : undefined,
    newOwner: publicKey(inputs.newOwner),
    authority: createNoopSigner(publicKey(inputs.currentOwner)),
    payer: createNoopSigner(publicKey(inputs.payer)),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const umiIxs = builder.getInstructions() as any[];
  return umiIxs.map((ix) => toWeb3JsInstruction(ix));
}
