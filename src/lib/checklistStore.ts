/**
 * Before You Sign -- Checklist Progress Store
 *
 * Persists per-wallet checklist completion state in localStorage.
 * Each step can be checked/unchecked and the overall progress is tracked.
 */

const STORAGE_PREFIX = 'ztl-checklist-';

export interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  detail: string;
  category: 'pre-sign' | 'wallet-hygiene' | 'advanced';
  /** Whether this step is completed */
  completed: boolean;
}

/** The master list of checklist items */
export function getDefaultChecklist(): ChecklistStep[] {
  return [
    // Pre-Sign checks
    {
      id: 'verify-url',
      title: 'Verify the URL',
      description: 'Always double-check the domain before connecting your wallet.',
      detail: 'Phishing sites use look-alike domains (e.g., "raydlum.io" instead of "raydium.io"). Bookmark trusted sites and type URLs manually. Never follow links from Discord DMs or X replies.',
      category: 'pre-sign',
      completed: false,
    },
    {
      id: 'check-simulation',
      title: 'Simulate the transaction',
      description: 'Use a transaction simulator before signing anything.',
      detail: 'Tools like Blowfish or your wallet\'s built-in simulator can preview exactly what a transaction will do -- balance changes, approvals granted, programs called. If the preview looks different from what you expect, do NOT sign.',
      category: 'pre-sign',
      completed: false,
    },
    {
      id: 'review-approvals',
      title: 'Review token approvals',
      description: 'Check what permissions the transaction is requesting.',
      detail: 'A malicious dApp may request a "delegate" approval that lets it drain your tokens later. Look for SetAuthority or Approve instructions. If a simple swap is asking for broad approvals, that\'s a red flag.',
      category: 'pre-sign',
      completed: false,
    },
    {
      id: 'verify-program',
      title: 'Verify the program ID',
      description: 'Confirm the transaction calls known, audited programs.',
      detail: 'Major protocols have well-known program IDs (Jupiter, Raydium, Marinade, etc.). If you see an unknown program ID, search it on Solscan first. Scammers deploy look-alike programs that steal funds.',
      category: 'pre-sign',
      completed: false,
    },
    {
      id: 'check-urgency',
      title: 'Ignore artificial urgency',
      description: 'Scammers create fake time pressure to rush you into signing.',
      detail: '"Limited-time airdrop!", "Mint closes in 5 minutes!", "Your wallet will be locked!" -- these are almost always scams. Legitimate projects don\'t pressure you. Take your time and verify.',
      category: 'pre-sign',
      completed: false,
    },
    // Wallet hygiene
    {
      id: 'revoke-delegates',
      title: 'Revoke stale token delegates',
      description: 'Remove old approvals that could be exploited.',
      detail: 'Use the Permission Scanner above to find active delegates. Any approval you don\'t actively need is an attack surface. Revoke them regularly -- especially after using new or unfamiliar dApps.',
      category: 'wallet-hygiene',
      completed: false,
    },
    {
      id: 'burn-spam',
      title: 'Clean up spam NFTs',
      description: 'Burn airdropped spam tokens that could link to phishing sites.',
      detail: 'Scammers airdrop NFTs with phishing URLs in the metadata. Don\'t visit those URLs. Use the NFT Holdings panel above to identify and burn spam NFTs safely.',
      category: 'wallet-hygiene',
      completed: false,
    },
    {
      id: 'separate-wallets',
      title: 'Use separate wallets',
      description: 'Keep a "hot" wallet for daily use and a "vault" for long-term holdings.',
      detail: 'Never connect your main holdings wallet to random dApps. Create a dedicated "burner" wallet for minting, testing, and interacting with new protocols. Transfer only what you need.',
      category: 'wallet-hygiene',
      completed: false,
    },
    // Advanced
    {
      id: 'check-token-risk',
      title: 'Check token risk grades',
      description: 'Review mint/freeze authority status on tokens you hold.',
      detail: 'The Token Rug-Pull Risk panel above shows which tokens still have active mint or freeze authority. Tokens graded D or F carry significant centralization risk -- the issuer can inflate supply or freeze your balance at any time.',
      category: 'advanced',
      completed: false,
    },
    {
      id: 'monitor-activity',
      title: 'Monitor wallet activity',
      description: 'Keep an eye on recent transactions for unauthorized actions.',
      detail: 'The Activity Feed shows your recent transactions. Watch for unexpected outgoing transfers, new delegates, or program interactions you didn\'t initiate. If you see something suspicious, revoke all approvals immediately.',
      category: 'advanced',
      completed: false,
    },
  ];
}

let currentWallet: string | null = null;
let checklist: ChecklistStep[] = [];
const listeners = new Set<() => void>();

function storageKey(): string | null {
  return currentWallet ? `${STORAGE_PREFIX}${currentWallet}` : null;
}

function persist() {
  const key = storageKey();
  if (!key) return;
  try {
    // Only persist completion states (not full definitions)
    const state = checklist.reduce<Record<string, boolean>>((acc, s) => {
      acc[s.id] = s.completed;
      return acc;
    }, {});
    localStorage.setItem(key, JSON.stringify(state));
  } catch { /* ignore */ }
}

function load() {
  checklist = getDefaultChecklist();
  const key = storageKey();
  if (!key) return;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const state = JSON.parse(raw) as Record<string, boolean>;
      for (const step of checklist) {
        if (state[step.id] !== undefined) {
          step.completed = state[step.id];
        }
      }
    }
  } catch { /* corrupted – use defaults */ }
}

function notify() {
  listeners.forEach((fn) => fn());
}

/** Initialize for a wallet address */
export function initChecklistForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load();
  notify();
}

/** Clear on disconnect */
export function clearChecklist() {
  currentWallet = null;
  checklist = [];
  notify();
}

/** Toggle a step's completion */
export function toggleStep(stepId: string) {
  const step = checklist.find((s) => s.id === stepId);
  if (!step) return;
  step.completed = !step.completed;
  persist();
  notify();
}

/** Get full checklist */
export function getChecklist(): ChecklistStep[] {
  return [...checklist];
}

/** Get progress stats */
export function getChecklistProgress(): { completed: number; total: number; percent: number } {
  const total = checklist.length;
  const completed = checklist.filter((s) => s.completed).length;
  return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 };
}

/** Subscribe to changes */
export function subscribeChecklist(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
