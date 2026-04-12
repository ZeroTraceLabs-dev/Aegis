/**
 * Multi-Wallet Store
 *
 * Manages a list of watched wallet addresses stored in localStorage.
 * Each wallet can be scanned independently through the existing risk pipeline.
 */

const STORAGE_KEY = 'ztl-watched-wallets';
const MAX_WALLETS = 10;

export interface WatchedWallet {
  address: string;
  label: string;
  addedAt: number;
  lastScan?: number;
  healthScore?: number;
  riskCount?: number;
  solBalance?: number;
  tokenCount?: number;
}

let wallets: WatchedWallet[] = [];
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wallets));
  } catch { /* quota */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) wallets = JSON.parse(raw) as WatchedWallet[];
  } catch {
    wallets = [];
  }
}

function notify() {
  listeners.forEach((fn) => fn());
}

// Initialize on module load
load();

/** Subscribe to wallet list changes */
export function subscribeWalletList(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Get all watched wallets */
export function getWatchedWallets(): WatchedWallet[] {
  return [...wallets];
}

/** Add a wallet to watch list */
export function addWatchedWallet(address: string, label?: string): boolean {
  if (wallets.length >= MAX_WALLETS) return false;
  if (wallets.some((w) => w.address === address)) return false;

  // Validate address format
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;

  wallets.push({
    address,
    label: label || `Wallet ${wallets.length + 1}`,
    addedAt: Date.now(),
  });

  persist();
  notify();
  return true;
}

/** Remove a wallet from watch list */
export function removeWatchedWallet(address: string) {
  wallets = wallets.filter((w) => w.address !== address);
  persist();
  notify();
}

/** Update wallet label */
export function updateWalletLabel(address: string, label: string) {
  const w = wallets.find((w) => w.address === address);
  if (w) {
    w.label = label;
    persist();
    notify();
  }
}

/** Update wallet scan results */
export function updateWalletScanResults(
  address: string,
  results: {
    healthScore?: number;
    riskCount?: number;
    solBalance?: number;
    tokenCount?: number;
  },
) {
  const w = wallets.find((w) => w.address === address);
  if (w) {
    Object.assign(w, results, { lastScan: Date.now() });
    persist();
    notify();
  }
}

/** Get aggregate stats across all wallets */
export function getAggregateStats() {
  const scanned = wallets.filter((w) => w.healthScore !== undefined);
  if (scanned.length === 0) return null;

  const totalRisks = scanned.reduce((sum, w) => sum + (w.riskCount || 0), 0);
  const avgHealth = Math.round(scanned.reduce((sum, w) => sum + (w.healthScore || 0), 0) / scanned.length);
  const totalSol = scanned.reduce((sum, w) => sum + (w.solBalance || 0), 0);
  const totalTokens = scanned.reduce((sum, w) => sum + (w.tokenCount || 0), 0);

  return {
    walletCount: scanned.length,
    avgHealth,
    totalRisks,
    totalSol,
    totalTokens,
  };
}
