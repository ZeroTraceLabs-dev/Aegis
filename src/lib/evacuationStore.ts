/**
 * Evacuation Store — manages the "safe wallet" escape address.
 * Persisted per-wallet in localStorage.
 */

const STORAGE_PREFIX = 'ztl-evac-';
let currentWallet: string | null = null;
let safeWallet: string | null = null;
const listeners = new Set<() => void>();

function storageKey(): string | null {
  return currentWallet ? `${STORAGE_PREFIX}${currentWallet}` : null;
}

function persist() {
  const key = storageKey();
  if (!key) return;
  try {
    if (safeWallet) {
      localStorage.setItem(key, safeWallet);
    } else {
      localStorage.removeItem(key);
    }
  } catch { /* silent */ }
}

function load() {
  safeWallet = null;
  const key = storageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw && raw.length >= 32) safeWallet = raw;
  } catch { /* silent */ }
}

export function initEvacuationStore(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load();
  listeners.forEach((fn) => fn());
}

export function clearEvacuationStore() {
  currentWallet = null;
  safeWallet = null;
  listeners.forEach((fn) => fn());
}

export function setSafeWallet(address: string | null) {
  safeWallet = address;
  persist();
  listeners.forEach((fn) => fn());
}

export function getSafeWallet(): string | null {
  return safeWallet;
}

export function subscribeEvacuation(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
