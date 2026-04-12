/**
 * Health Score History Store
 * Persists timestamped health score snapshots per wallet in localStorage.
 * Used by HealthHistory chart to show score trend over time.
 */

const STORAGE_PREFIX = 'ztl-health-history-';
const MAX_ENTRIES = 90; // keep up to 90 data points (~3 months if daily)
const MIN_INTERVAL_MS = 4 * 60 * 60 * 1000; // minimum 4h between snapshots

export interface ScoreSnapshot {
  /** ISO timestamp */
  ts: string;
  /** Health score 0-100 */
  score: number;
  /** Risk count at the time */
  risks: number;
  /** Acknowledged count at the time */
  acked: number;
}

let currentWallet: string | null = null;
let history: ScoreSnapshot[] = [];
const listeners = new Set<() => void>();

function storageKey(): string | null {
  return currentWallet ? `${STORAGE_PREFIX}${currentWallet}` : null;
}

function persist() {
  const key = storageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch { /* quota exceeded – trim oldest */
    history = history.slice(-30);
    try { localStorage.setItem(key, JSON.stringify(history)); } catch { /* give up */ }
  }
}

function load() {
  history = [];
  const key = storageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      history = JSON.parse(raw) as ScoreSnapshot[];
    }
  } catch { /* corrupted – start fresh */ }
}

function notify() {
  listeners.forEach((fn) => fn());
}

/** Call when wallet connects. Loads persisted history. */
export function initHealthHistoryForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load();
  notify();
}

/** Call when wallet disconnects. */
export function clearHealthHistory() {
  currentWallet = null;
  history = [];
  notify();
}

/**
 * Record a new score snapshot.
 * Skips if too recent (< MIN_INTERVAL_MS since last entry) to avoid flooding.
 */
export function recordSnapshot(score: number, risks: number, acked: number) {
  if (!currentWallet) return;

  const now = new Date();
  const last = history[history.length - 1];

  // Skip if last snapshot was too recent
  if (last) {
    const lastTime = new Date(last.ts).getTime();
    if (now.getTime() - lastTime < MIN_INTERVAL_MS) {
      // Update the latest entry in-place if score changed (keeps chart current)
      if (last.score !== score || last.risks !== risks || last.acked !== acked) {
        last.score = score;
        last.risks = risks;
        last.acked = acked;
        last.ts = now.toISOString();
        persist();
        notify();
      }
      return;
    }
  }

  history.push({
    ts: now.toISOString(),
    score,
    risks,
    acked,
  });

  // Trim to max entries
  if (history.length > MAX_ENTRIES) {
    history = history.slice(-MAX_ENTRIES);
  }

  persist();
  notify();
}

/** Get the full history array (read-only copy). */
export function getHistory(): ScoreSnapshot[] {
  return [...history];
}

/** Get the count of snapshots. */
export function getHistoryCount(): number {
  return history.length;
}

/** Subscribe to history changes. Returns unsubscribe function. */
export function subscribeHealthHistory(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
