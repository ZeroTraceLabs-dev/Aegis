/**
 * Cerberus Client Service
 *
 * Client-side interface to the Cerberus AI agent.
 * Handles streaming chat from the dashboard and non-streaming
 * calls for alert enrichment.
 */

import { supabase } from '@/lib/supabaseClient';

const CERBERUS_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cerberus-core`;

export interface CerberusMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// ── Streaming chat (dashboard) ────────────────────────────────

export async function streamCerberusChat({
  messages,
  context,
  onDelta,
  onDone,
  onError,
}: {
  messages: CerberusMessage[];
  context?: Record<string, unknown>;
  onDelta: (delta: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

    const resp = await fetch(CERBERUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        context,
        walletSnapshot: _walletSnapshot || undefined,
        channel: 'dashboard',
        mode: 'chat',
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
      onError(err.error || `Cerberus error: ${resp.status}`);
      return;
    }

    const reader = resp.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch { /* skip malformed chunks */ }
      }
    }
    onDone();
  } catch {
    onError('Connection failed. Please try again.');
  }
}

// ── Wallet snapshot (shared context for chat + briefing) ───────

export interface WalletSnapshot {
  walletAddress: string;
  solBalance: number;
  tokenCount: number;
  nftCount: number;
  delegateApprovals: { mint: string; symbol: string; delegate: string; usdValue: number }[];
  failedTxCount: number;
  emptyAccounts: number;
  recentEvents: { category: string; severity: string; title: string }[];
  /** Whether the user has configured a Nuclear Evacuation safe wallet */
  hasEvacuationAddress: boolean;
  /** Number of trusted/whitelisted addresses configured */
  whitelistedAddressCount: number;
}

/** Shared ref so CerberusChat can include snapshot in every request */
let _walletSnapshot: WalletSnapshot | null = null;
export function setWalletSnapshot(snap: WalletSnapshot | null) { _walletSnapshot = snap; }
export function getWalletSnapshot(): WalletSnapshot | null { return _walletSnapshot; }

// ── Briefing mode (proactive intelligence) ────────────────────

export interface BriefingAction {
  priority: number;
  action: string;
  reason: string;
  severity: 'INFO' | 'LOW' | 'MED' | 'HIGH' | 'CRITICAL';
}

export interface CerberusBriefing {
  summary: string;
  severity: string;
  actions: BriefingAction[];
  rawText: string;
}

/**
 * Streams the briefing from the edge function and calls onDelta with
 * each partial text chunk so the UI can render progressively.
 * Returns the final parsed CerberusBriefing when complete.
 */
export async function fetchCerberusBriefing(
  snapshot: WalletSnapshot,
  onDelta?: (partialText: string) => void,
): Promise<CerberusBriefing | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;

    const resp = await fetch(CERBERUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        mode: 'briefing',
        channel: 'briefing',
        walletSnapshot: snapshot,
      }),
    });

    if (!resp.ok) return null;

    // Stream SSE chunks progressively
    const reader = resp.body?.getReader();
    if (!reader) return null;

    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullText += content;
            onDelta?.(fullText);
          }
        } catch { /* skip malformed chunks */ }
      }
    }

    if (!fullText) return null;
    return parseBriefingResponse(fullText, snapshot);
  } catch {
    return null;
  }
}

/** Parse Cerberus's text response into a structured briefing object */
function parseBriefingResponse(text: string, snapshot: WalletSnapshot): CerberusBriefing {
  // Extract severity
  const sevMatch = text.match(/\*\*Severity\*\*:\s*(INFO|LOW|MED|HIGH|CRITICAL)/i);
  const severity = sevMatch ? sevMatch[1].toUpperCase() : 'INFO';

  // Extract summary (first line or Risk Summary)
  const sumMatch = text.match(/\*\*Risk Summary\*\*:\s*(.+)/i);
  const summary = sumMatch ? sumMatch[1].trim() : text.split('\n')[0].replace(/\*\*/g, '').trim();

  // Extract action items from Next Steps
  const actions: BriefingAction[] = [];
  const nextMatch = text.match(/\*\*Next Step[^*]*\*\*:([\s\S]*?)(?=\*\*|$)/i);
  if (nextMatch) {
    const lines = nextMatch[1].split('\n').filter(l => l.trim().match(/^[\d\-\*•]/));
    lines.forEach((line, i) => {
      const clean = line.replace(/^[\d\-\*•.]+\s*/, '').trim();
      if (clean.length > 5) {
        actions.push({
          priority: i + 1,
          action: clean,
          reason: '',
          severity: severity as BriefingAction['severity'],
        });
      }
    });
  }

  // If no actions found from structured format, extract any numbered/bulleted lines
  if (actions.length === 0) {
    const lines = text.split('\n').filter(l => l.trim().match(/^[\d\-\*•]/));
    lines.slice(0, 5).forEach((line, i) => {
      const clean = line.replace(/^[\d\-\*•.]+\s*/, '').trim();
      if (clean.length > 5) {
        actions.push({
          priority: i + 1,
          action: clean,
          reason: '',
          severity: severity as BriefingAction['severity'],
        });
      }
    });
  }

  return { summary, severity, actions, rawText: text };
}

// ── Quick helpers ─────────────────────────────────────────────

let idCounter = 0;
export function createMessage(role: 'user' | 'assistant', content: string): CerberusMessage {
  return {
    id: `cerberus-${Date.now()}-${++idCounter}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

// ── Suggested quick actions ───────────────────────────────────

export const CERBERUS_QUICK_ACTIONS = [
  { label: 'Scan my wallet', prompt: 'What do you see on my wallet right now? Anything worth my attention?' },
  { label: 'Explain my delegates', prompt: 'Walk me through my active delegate approvals. Which are likely from staking and which should I verify?' },
  { label: 'Phishing guide', prompt: 'How do I spot a phishing site in the Solana ecosystem?' },
  { label: 'Delegate safety', prompt: 'What is a token delegate and when should I revoke one?' },
  { label: 'Rug-pull signs', prompt: 'What are the general red flags people look for when evaluating a Solana token?' },
];