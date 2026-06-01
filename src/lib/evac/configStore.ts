/**
 * Evac Config Store — per-wallet localStorage-backed persistence for the
 * five evac setup steps and the resulting armed state. No backend; no
 * Supabase writes. Pattern mirrors spamFilterStore / evacuationStore.
 *
 * Storage keys (all scoped by main wallet pubkey):
 *   evac_gas_wallet_{mainAddr}  → { pubkey, encryptedPrivkey: { iv, ciphertext } }
 *   evac_destination_{mainAddr} → string (base58 destination address)
 *   evac_priority_{mainAddr}    → PriorityConfig
 *   evac_alt_{mainAddr}         → string (base58 ALT address)
 *
 * Each step writes its piece on completion. The aggregate "armed" status
 * is derived — a wallet is armed when all four pieces exist.
 */

const KEY_GAS = (addr: string) => `evac_gas_wallet_${addr}`;
const KEY_GAS_READY = (addr: string) => `evac_gas_ready_${addr}`;
const KEY_DEST = (addr: string) => `evac_destination_${addr}`;
const KEY_PRIORITY = (addr: string) => `evac_priority_${addr}`;
const KEY_ALT = (addr: string) => `evac_alt_${addr}`;

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

export interface GasWalletRecord {
  pubkey: string;
  encryptedPrivkey: EncryptedBlob;
}

export type PriorityTier = 'critical' | 'priority' | 'standard';
export type AssetCategory = 'nfts' | 'tokens' | 'sol';

/**
 * Snapshot of how the user has ordered the three asset categories into
 * the three priority tiers. Each tier holds zero or more categories.
 * Multiple categories can share a tier — the default sub-ordering within
 * a category is by USD value descending, optionally overridden by
 * `overrides` (mint -> rank within its category).
 */
export interface PriorityConfig {
  tiers: Record<PriorityTier, AssetCategory[]>;
  overrides?: Record<string, number>;
}

interface EvacState {
  gasWallet: GasWalletRecord | null;
  /** True once the user has confirmed the gas wallet is funded and clicked "continue".
      Distinct from gasWallet presence: the record exists from generation, but the
      user advances to step 3 only after funding lands. */
  gasReady: boolean;
  destination: string | null;
  priority: PriorityConfig | null;
  alt: string | null;
}

let currentWallet: string | null = null;
let state: EvacState = {
  gasWallet: null,
  gasReady: false,
  destination: null,
  priority: null,
  alt: null,
};
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function loadAll(addr: string) {
  state = {
    gasWallet: safeParse<GasWalletRecord>(localStorage.getItem(KEY_GAS(addr))),
    gasReady: localStorage.getItem(KEY_GAS_READY(addr)) === '1',
    destination: localStorage.getItem(KEY_DEST(addr)),
    priority: safeParse<PriorityConfig>(localStorage.getItem(KEY_PRIORITY(addr))),
    alt: localStorage.getItem(KEY_ALT(addr)),
  };
}

export function initEvacConfigForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  loadAll(walletAddress);
  notify();
}

export function clearEvacConfig() {
  currentWallet = null;
  state = { gasWallet: null, gasReady: false, destination: null, priority: null, alt: null };
  notify();
}

export function subscribeEvacConfig(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── Reads ──────────────────────────────────────────────────────

export function getGasWallet(): GasWalletRecord | null { return state.gasWallet; }
export function getGasReady(): boolean { return state.gasReady; }
export function getDestination(): string | null { return state.destination; }
export function getPriority(): PriorityConfig | null { return state.priority; }
export function getAlt(): string | null { return state.alt; }

/**
 * Which step the user is on. 1-5 for steps in progress; 'armed' once all
 * pieces are in place. Determines what EvacSetupFlow renders.
 *
 * Step 2 ("gas wallet generate + fund") is gated on TWO things — the
 * encrypted record existing AND a separate "gasReady" flag flipped when
 * the user clicks "Funded — continue" — because the gas balance is
 * runtime state and the step shouldn't advance the moment the record is
 * persisted but before the user has actually funded it.
 */
export function getEvacStep(): 1 | 2 | 3 | 4 | 5 | 'armed' {
  if (state.alt && state.priority && state.destination && state.gasReady) return 'armed';
  if (state.priority && state.destination && state.gasReady) return 5;
  if (state.destination && state.gasReady) return 4;
  if (state.gasReady) return 3;
  return hasAcknowledgedThreatModel() ? 2 : 1;
}

const THREAT_ACK_KEY = (addr: string) => `evac_threat_ack_${addr}`;

export function hasAcknowledgedThreatModel(): boolean {
  if (!currentWallet) return false;
  return localStorage.getItem(THREAT_ACK_KEY(currentWallet)) === '1';
}

export function acknowledgeThreatModel() {
  if (!currentWallet) return;
  localStorage.setItem(THREAT_ACK_KEY(currentWallet), '1');
  notify();
}

// ── Writes ─────────────────────────────────────────────────────

export function setGasWallet(record: GasWalletRecord) {
  if (!currentWallet) throw new Error('No wallet connected');
  localStorage.setItem(KEY_GAS(currentWallet), JSON.stringify(record));
  state.gasWallet = record;
  notify();
}

export function markGasReady() {
  if (!currentWallet) throw new Error('No wallet connected');
  localStorage.setItem(KEY_GAS_READY(currentWallet), '1');
  state.gasReady = true;
  notify();
}

export function setDestination(address: string) {
  if (!currentWallet) throw new Error('No wallet connected');
  localStorage.setItem(KEY_DEST(currentWallet), address);
  state.destination = address;
  notify();
}

export function setPriority(config: PriorityConfig) {
  if (!currentWallet) throw new Error('No wallet connected');
  localStorage.setItem(KEY_PRIORITY(currentWallet), JSON.stringify(config));
  state.priority = config;
  notify();
}

export function setAlt(altAddress: string) {
  if (!currentWallet) throw new Error('No wallet connected');
  localStorage.setItem(KEY_ALT(currentWallet), altAddress);
  state.alt = altAddress;
  notify();
}

// ── Disarm — wipe all evac storage for the connected wallet ────

export function disarmEvac() {
  if (!currentWallet) return;
  localStorage.removeItem(KEY_GAS(currentWallet));
  localStorage.removeItem(KEY_GAS_READY(currentWallet));
  localStorage.removeItem(KEY_DEST(currentWallet));
  localStorage.removeItem(KEY_PRIORITY(currentWallet));
  localStorage.removeItem(KEY_ALT(currentWallet));
  localStorage.removeItem(THREAT_ACK_KEY(currentWallet));
  state = { gasWallet: null, gasReady: false, destination: null, priority: null, alt: null };
  notify();
}

// ── Default priority ───────────────────────────────────────────

/** Sensible default ordering — SOL critical (drains first), tokens next, NFTs last. */
export function defaultPriority(): PriorityConfig {
  return {
    tiers: {
      critical: ['sol'],
      priority: ['tokens'],
      standard: ['nfts'],
    },
  };
}
