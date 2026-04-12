/**
 * Manual spam flag store.
 * Persists flags per wallet in localStorage.
 * Users can manually flag/unflag any NFT as spam.
 */

const STORAGE_PREFIX = 'ztl-spam-';
let currentWallet: string | null = null;
const manualSpam = new Set<string>();
const listeners = new Set<() => void>();

function storageKey(): string | null {
  return currentWallet ? `${STORAGE_PREFIX}${currentWallet}` : null;
}

function persist() {
  const key = storageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...manualSpam]));
  } catch { /* quota exceeded – silent */ }
}

function load() {
  manualSpam.clear();
  const key = storageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr: string[] = JSON.parse(raw);
      arr.forEach((mint) => manualSpam.add(mint));
    }
  } catch { /* corrupted data – start fresh */ }
}

/** Call once when wallet connects. Loads persisted manual flags. */
export function initSpamStoreForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load();
  listeners.forEach((fn) => fn());
}

/** Call when wallet disconnects. */
export function clearSpamStore() {
  currentWallet = null;
  manualSpam.clear();
  listeners.forEach((fn) => fn());
}

export function flagAsSpam(mint: string) {
  manualSpam.add(mint);
  persist();
  listeners.forEach((fn) => fn());
}

export function unflagSpam(mint: string) {
  manualSpam.delete(mint);
  persist();
  listeners.forEach((fn) => fn());
}

export function isManuallyFlagged(mint: string): boolean {
  return manualSpam.has(mint);
}

export function getManualSpamSet(): Set<string> {
  return new Set(manualSpam);
}

export function getManualSpamCount(): number {
  return manualSpam.size;
}

export function subscribeManualSpam(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
