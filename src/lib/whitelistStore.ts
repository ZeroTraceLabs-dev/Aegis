/**
 * Whitelist Store — manages trusted addresses per wallet.
 *
 * Addresses can be added manually by the user or via Cerberus chat
 * ("don't alert me about this address"). Whitelisted addresses
 * suppress live monitor alerts and background notification dispatch.
 *
 * Persisted per-wallet in localStorage.
 */

const STORAGE_PREFIX = 'ztl-whitelist-';
let currentWallet: string | null = null;

export interface WhitelistedAddress {
  address: string;
  label: string;
  /** ISO timestamp of when it was added */
  addedAt: string;
  /** How it was added: 'manual' | 'cerberus' */
  source: 'manual' | 'cerberus';
}

let whitelist: WhitelistedAddress[] = [];
const listeners = new Set<() => void>();

function storageKey(): string | null {
  return currentWallet ? `${STORAGE_PREFIX}${currentWallet}` : null;
}

function persist() {
  const key = storageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(whitelist));
  } catch { /* quota exceeded — silent */ }
}

function load() {
  whitelist = [];
  const key = storageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) whitelist = arr;
    }
  } catch { /* corrupted data — start fresh */ }
}

function notify() {
  listeners.forEach((fn) => fn());
}

/** Call once when wallet connects. Loads persisted whitelist. */
export function initWhitelistForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load();
  notify();
}

/** Call when wallet disconnects. */
export function clearWhitelist() {
  currentWallet = null;
  whitelist = [];
  notify();
}

/** Subscribe to whitelist changes. */
export function subscribeWhitelist(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Get all whitelisted addresses. */
export function getWhitelist(): WhitelistedAddress[] {
  return [...whitelist];
}

/** Get just the address strings (for fast lookup). */
export function getWhitelistedAddresses(): Set<string> {
  return new Set(whitelist.map((w) => w.address));
}

/** Check if an address is whitelisted. */
export function isWhitelisted(address: string): boolean {
  return whitelist.some((w) => w.address === address);
}

/** Add an address to the whitelist. No-op if already present. Returns true if added. */
export function addToWhitelist(
  address: string,
  label: string,
  source: 'manual' | 'cerberus' = 'manual',
): boolean {
  if (isWhitelisted(address)) return false;
  whitelist.push({
    address,
    label: label || address.slice(0, 8),
    addedAt: new Date().toISOString(),
    source,
  });
  persist();
  notify();
  return true;
}

/** Update label for an existing whitelisted address. */
export function updateWhitelistLabel(address: string, label: string) {
  const entry = whitelist.find((w) => w.address === address);
  if (entry) {
    entry.label = label;
    persist();
    notify();
  }
}

/** Remove an address from the whitelist. */
export function removeFromWhitelist(address: string) {
  const before = whitelist.length;
  whitelist = whitelist.filter((w) => w.address !== address);
  if (whitelist.length !== before) {
    persist();
    notify();
  }
}

/** Get whitelist count. */
export function getWhitelistCount(): number {
  return whitelist.length;
}
