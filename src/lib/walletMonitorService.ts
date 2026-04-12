/**
 * Wallet Monitor Service
 *
 * Uses Solana onLogs WebSocket subscription to watch the connected wallet
 * for real-time transaction activity. Parses log messages to classify events:
 *   - Inflows / Outflows
 *   - Delegate changes (approvals, revokes)
 *   - Authority changes
 *   - NFT transfers
 *   - Account closes
 *
 * Falls back to polling recent signatures if WebSocket is unavailable.
 * Auto-pauses when the browser tab is hidden to save resources.
 */

import { RPC_ENDPOINT } from '@/lib/rpc';
import { isWhitelisted } from '@/lib/whitelistStore';

export type EventSeverity = 'info' | 'warning' | 'danger';
export type EventCategory =
  | 'inflow'
  | 'outflow'
  | 'approval'
  | 'authority'
  | 'nft-transfer'
  | 'close'
  | 'program'
  | 'other';

export interface WalletEvent {
  id: string;
  timestamp: number;
  signature: string;
  category: EventCategory;
  severity: EventSeverity;
  title: string;
  description: string;
  programs: string[];
}

// Known programs for labeling
const KNOWN_PROGRAMS: Record<string, string> = {
  '11111111111111111111111111111111': 'System',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'SPL Token',
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'Token-2022',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'ATA',
  'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
  '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CLMM',
  'ComputeBudget111111111111111111111111111111': 'Compute Budget',
  'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex',
  'MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD': 'Marinade',
  'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy': 'Stake Pool',
};

const MAX_EVENTS = 80;
let events: WalletEvent[] = [];
let subscriptionId: number | null = null;
let connectionRef: unknown = null;
let currentWallet: string | null = null;
let autoPaused = false;
const listeners = new Set<() => void>();
const alertListeners = new Set<(event: WalletEvent) => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function notifyAlert(event: WalletEvent) {
  alertListeners.forEach((fn) => fn(event));
}

/** Subscribe to event list updates */
export function subscribeMonitor(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Subscribe to individual alert events (for notifications) */
export function subscribeAlerts(fn: (event: WalletEvent) => void) {
  alertListeners.add(fn);
  return () => { alertListeners.delete(fn); };
}

/** Get current events */
export function getMonitorEvents(): WalletEvent[] {
  return [...events];
}

/** Clear events */
export function clearMonitorEvents() {
  events = [];
  notify();
}

/**
 * Classify log messages into a categorized event
 */
function classifyLogs(signature: string, logs: string[]): WalletEvent {
  const programs: string[] = [];
  let category: EventCategory = 'other';
  let severity: EventSeverity = 'info';
  let title = 'Transaction Detected';
  let description = '';

  // Extract invoked programs
  for (const log of logs) {
    const match = log.match(/Program (\w{32,44}) invoke/);
    if (match) {
      const pid = match[1];
      const label = KNOWN_PROGRAMS[pid] || pid.slice(0, 8) + '...';
      if (!programs.includes(label)) programs.push(label);
    }
  }

  const logText = logs.join(' ');
  const hasMetaplex = programs.includes('Metaplex');

  // Priority classification
  if (logText.includes('SetAuthority')) {
    category = 'authority';
    severity = 'danger';
    title = 'Authority Change Detected';
    description = 'A token authority was modified — verify this was intentional.';
  } else if (logText.includes('Approve') && !logText.includes('Revoke')) {
    category = 'approval';
    severity = 'warning';
    title = 'New Delegate Approved';
    description = 'A delegate was approved to spend tokens on your behalf.';
  } else if (logText.includes('Revoke')) {
    category = 'approval';
    severity = 'info';
    title = 'Approval Revoked';
    description = 'A previously granted token approval was revoked.';
  } else if (logText.includes('CloseAccount')) {
    category = 'close';
    severity = 'info';
    title = 'Account Closed';
    description = 'A token account was closed and rent reclaimed.';
  } else if (hasMetaplex && logText.includes('Transfer')) {
    category = 'nft-transfer';
    severity = 'warning';
    title = 'NFT Transfer Detected';
    description = 'An NFT was transferred — check if this was expected.';
  } else if (logText.includes('Transfer')) {
    // Try to determine inflow vs outflow from log context
    const transferCount = (logText.match(/Transfer/g) || []).length;
    const hasSystem = programs.includes('System');

    if (transferCount > 2) {
      category = 'outflow';
      severity = 'warning';
      title = 'Multiple Transfers';
      description = `${transferCount} transfer operations in a single transaction.`;
    } else if (hasSystem) {
      // System program transfers are SOL — could be either direction
      category = 'outflow';
      severity = 'info';
      title = 'SOL Transfer';
      description = programs.length > 1
        ? `SOL transfer via ${programs.filter(p => p !== 'System').slice(0, 2).join(', ')}`
        : 'A SOL transfer was executed.';
    } else {
      category = 'inflow';
      severity = 'info';
      title = 'Token Transfer';
      description = programs.length > 0
        ? `Transfer via ${programs.slice(0, 2).join(', ')}`
        : 'A token transfer was executed.';
    }
  } else {
    category = 'program';
    description = programs.length > 0
      ? `Interaction with ${programs.slice(0, 3).join(', ')}`
      : 'Transaction executed on your wallet.';
  }

  // Check for errors
  if (logText.includes('failed') || logText.includes('Error')) {
    severity = 'warning';
    title = 'Failed Transaction';
    description = 'A transaction involving your wallet failed.';
  }

  // Escalate multi-approval events
  const approveCount = (logText.match(/Approve/g) || []).length;
  if (approveCount > 1) {
    severity = 'danger';
    title = `${approveCount} Approvals in One Transaction`;
    description = 'Multiple token approvals granted simultaneously — this is unusual.';
    category = 'approval';
  }

  return {
    id: `${Date.now()}-${signature.slice(0, 8)}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: Date.now(),
    signature,
    category,
    severity,
    title,
    description,
    programs,
  };
}

/**
 * Start monitoring a wallet via WebSocket
 */
export async function startMonitoring(walletAddress: string) {
  if (currentWallet === walletAddress && connectionRef) return;

  stopMonitoring();
  currentWallet = walletAddress;
  events = [];
  autoPaused = false;
  notify();

  // Set up visibility change listener for auto-pause
  document.addEventListener('visibilitychange', handleVisibilityChange);

  try {
    const web3 = await import('@solana/web3.js');
    const { Connection, PublicKey } = web3;
    const conn = new Connection(RPC_ENDPOINT, {
      commitment: 'confirmed',
      wsEndpoint: RPC_ENDPOINT.replace('https://', 'wss://'),
    });

    const pubkey = new PublicKey(walletAddress);

    subscriptionId = conn.onLogs(
      pubkey,
      (logInfo) => {
        if (!logInfo.logs || logInfo.logs.length === 0) return;

        const event = classifyLogs(logInfo.signature, logInfo.logs);

        // Deduplicate
        if (events.some((e) => e.signature === logInfo.signature)) return;

        // Check if any program in this event is whitelisted — suppress alert if so
        const involvesWhitelisted = event.programs.some((p) => isWhitelisted(p));

        events = [event, ...events].slice(0, MAX_EVENTS);
        notify();

        // Fire alert for danger/warning events, but skip whitelisted addresses
        if ((event.severity === 'danger' || event.severity === 'warning') && !involvesWhitelisted) {
          notifyAlert(event);
        }
      },
      'confirmed',
    );

    connectionRef = conn;
  } catch (err) {
    console.warn('[WalletMonitor] WebSocket failed, falling back to polling:', err);
    startPolling(walletAddress);
  }
}

// --- Visibility auto-pause ---
function handleVisibilityChange() {
  if (!currentWallet) return;

  if (document.hidden) {
    // Auto-pause: stop WebSocket/polling but remember wallet
    autoPaused = true;
    teardownConnection();
    stopPolling();
    notify();
  } else if (autoPaused) {
    // Resume when tab becomes visible again
    autoPaused = false;
    const wallet = currentWallet;
    connectionRef = null;
    subscriptionId = null;
    // Re-start without clearing events
    restartMonitoring(wallet);
  }
}

async function restartMonitoring(walletAddress: string) {
  try {
    const web3 = await import('@solana/web3.js');
    const { Connection, PublicKey } = web3;
    const conn = new Connection(RPC_ENDPOINT, {
      commitment: 'confirmed',
      wsEndpoint: RPC_ENDPOINT.replace('https://', 'wss://'),
    });

    const pubkey = new PublicKey(walletAddress);

    subscriptionId = conn.onLogs(
      pubkey,
      (logInfo) => {
        if (!logInfo.logs || logInfo.logs.length === 0) return;
        const event = classifyLogs(logInfo.signature, logInfo.logs);
        if (events.some((e) => e.signature === logInfo.signature)) return;
        const involvesWhitelisted = event.programs.some((p) => isWhitelisted(p));
        events = [event, ...events].slice(0, MAX_EVENTS);
        notify();
        if ((event.severity === 'danger' || event.severity === 'warning') && !involvesWhitelisted) {
          notifyAlert(event);
        }
      },
      'confirmed',
    );

    connectionRef = conn;
    notify();
  } catch {
    startPolling(walletAddress);
  }
}

// --- Polling fallback ---
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastSeenSig: string | null = null;

function startPolling(walletAddress: string) {
  stopPolling();

  const poll = async () => {
    try {
      const web3 = await import('@solana/web3.js');
      const { Connection, PublicKey } = web3;
      const conn = new Connection(RPC_ENDPOINT, 'confirmed');
      const pubkey = new PublicKey(walletAddress);

      const sigs = await conn.getSignaturesForAddress(pubkey, { limit: 5 });

      for (const sig of sigs) {
        if (lastSeenSig && sig.signature === lastSeenSig) break;
        if (events.some((e) => e.signature === sig.signature)) continue;

        try {
          const tx = await conn.getTransaction(sig.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });
          if (tx?.meta?.logMessages) {
            const event = classifyLogs(sig.signature, tx.meta.logMessages);
            event.timestamp = (sig.blockTime || Math.floor(Date.now() / 1000)) * 1000;
            events = [event, ...events].slice(0, MAX_EVENTS);

            if (event.severity === 'danger' || event.severity === 'warning') {
              notifyAlert(event);
            }
          }
        } catch { /* skip */ }
      }

      if (sigs.length > 0) lastSeenSig = sigs[0].signature;
      notify();
    } catch (err) {
      console.warn('[WalletMonitor] Polling error:', err);
    }
  };

  poll();
  pollInterval = setInterval(poll, 15_000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  lastSeenSig = null;
}

function teardownConnection() {
  if (subscriptionId !== null && connectionRef) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (connectionRef as any).removeOnLogsListener(subscriptionId).catch(() => {});
    } catch { /* ignore */ }
    subscriptionId = null;
  }
  connectionRef = null;
}

/** Stop monitoring entirely */
export function stopMonitoring() {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  teardownConnection();
  stopPolling();
  currentWallet = null;
  autoPaused = false;
  events = [];
  notify();
}

/** Check if currently monitoring */
export function isMonitoring(): boolean {
  return currentWallet !== null && !autoPaused;
}

/** Check if auto-paused */
export function isAutoPaused(): boolean {
  return autoPaused;
}

/** Get current wallet being monitored */
export function getMonitoredWallet(): string | null {
  return currentWallet;
}