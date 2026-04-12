/**
 * Shared risk acknowledgment store.
 * Persists acknowledged risks per wallet in localStorage.
 * Components can mark risks as acknowledged, and HealthScore reads them.
 */

const STORAGE_PREFIX = 'ztl-ack-';
const SAFE_DELEGATE_PREFIX = 'ztl-safe-del-';
let currentWallet: string | null = null;
const acknowledged = new Set<string>();
const safeDelegates = new Set<string>();
const listeners = new Set<() => void>();

function storageKey(): string | null {
  return currentWallet ? `${STORAGE_PREFIX}${currentWallet}` : null;
}

function safeDelegateStorageKey(): string | null {
  return currentWallet ? `${SAFE_DELEGATE_PREFIX}${currentWallet}` : null;
}

function persist() {
  const key = storageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...acknowledged]));
  } catch { /* quota exceeded – silent */ }
}

function persistSafeDelegates() {
  const key = safeDelegateStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...safeDelegates]));
  } catch { /* quota exceeded – silent */ }
}

function load() {
  acknowledged.clear();
  const key = storageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr: string[] = JSON.parse(raw);
      arr.forEach((id) => acknowledged.add(id));
    }
  } catch { /* corrupted data – start fresh */ }
}

function loadSafeDelegates() {
  safeDelegates.clear();
  const key = safeDelegateStorageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr: string[] = JSON.parse(raw);
      arr.forEach((id) => safeDelegates.add(id));
    }
  } catch { /* corrupted data – start fresh */ }
}

/** Call once when wallet connects. Loads persisted acknowledgments. */
export function initRiskStoreForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load();
  loadSafeDelegates();
  listeners.forEach((fn) => fn());
}

/** Call when wallet disconnects. */
export function clearRiskStore() {
  currentWallet = null;
  acknowledged.clear();
  safeDelegates.clear();
  listeners.forEach((fn) => fn());
}

export function acknowledgeRisk(id: string) {
  acknowledged.add(id);
  persist();
  listeners.forEach((fn) => fn());
}

export function unacknowledgeRisk(id: string) {
  acknowledged.delete(id);
  persist();
  listeners.forEach((fn) => fn());
}

export function isAcknowledged(id: string): boolean {
  return acknowledged.has(id);
}

export function getAcknowledgedCount(): number {
  return acknowledged.size;
}

export function getAcknowledgedSet(): Set<string> {
  return new Set(acknowledged);
}

export function subscribeRisk(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// ── Safe Delegate Whitelist ─────────────────────────────────

/** Unique key for a delegate approval (mint + delegate address) */
export function delegateKey(mint: string, delegate: string): string {
  return `${mint}::${delegate}`;
}

export function markDelegateSafe(mint: string, delegate: string) {
  safeDelegates.add(delegateKey(mint, delegate));
  persistSafeDelegates();
  listeners.forEach((fn) => fn());
}

export function unmarkDelegateSafe(mint: string, delegate: string) {
  safeDelegates.delete(delegateKey(mint, delegate));
  persistSafeDelegates();
  listeners.forEach((fn) => fn());
}

export function isDelegateSafe(mint: string, delegate: string): boolean {
  return safeDelegates.has(delegateKey(mint, delegate));
}

export function getSafeDelegateCount(): number {
  return safeDelegates.size;
}

export function getSafeDelegateSet(): Set<string> {
  return new Set(safeDelegates);
}