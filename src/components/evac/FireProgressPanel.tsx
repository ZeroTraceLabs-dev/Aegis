import { Loader2, Check, X, AlertTriangle, Clock } from 'lucide-react';
import type { PriorityTier } from '@/lib/evac/configStore';
import type { FireProgressEvent } from '@/lib/evac/fire';

export type TierPhase =
  | 'pending'
  | 'planning'
  | 'signing'
  | 'broadcasting'
  | 'confirming'
  | 'complete';

export interface TierProgressState {
  phase: TierPhase;
  planned: number;
  succeeded: number;
  failed: number;
  skipped: number;
  /** Most recent status line for this tier. */
  status: string;
}

export interface FireProgressState {
  critical: TierProgressState;
  priority: TierProgressState;
  standard: TierProgressState;
  currentTier: PriorityTier | null;
  /** Bottom-of-panel narration. */
  globalStatus: string;
  /** Critical safety banner shown if gas drops mid-fire. */
  gasLowWarning: string | null;
}

export const INITIAL_FIRE_PROGRESS: FireProgressState = {
  critical: emptyTier(),
  priority: emptyTier(),
  standard: emptyTier(),
  currentTier: null,
  globalStatus: 'Preparing evacuation…',
  gasLowWarning: null,
};

function emptyTier(): TierProgressState {
  return {
    phase: 'pending',
    planned: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    status: '',
  };
}

/**
 * Reducer over FireProgressEvent. Pure — easy to test, easy for the
 * parent component to wire up via useReducer. ArmedStatePanel folds
 * progress events into this state and renders the panel.
 */
export function applyFireProgress(
  state: FireProgressState,
  ev: FireProgressEvent,
): FireProgressState {
  switch (ev.type) {
    case 'tier-start': {
      const next = { ...state, currentTier: ev.tier };
      next[ev.tier] = {
        ...state[ev.tier],
        phase: 'planning',
        planned: ev.plannedTransfers,
        status: `${labelTier(ev.tier)}: ${ev.plannedTransfers} transfer${ev.plannedTransfers === 1 ? '' : 's'} planned across ${ev.plannedTxs} tx${ev.plannedTxs === 1 ? '' : 's'}.`,
      };
      next.globalStatus = `Starting ${labelTier(ev.tier)} tier…`;
      return next;
    }
    case 'tier-signing': {
      const next = { ...state };
      next[ev.tier] = {
        ...state[ev.tier],
        phase: 'signing',
        status: `Awaiting signature: ${labelTier(ev.tier)} tier (${ev.txCount} transaction${ev.txCount === 1 ? '' : 's'})`,
      };
      next.globalStatus = next[ev.tier].status;
      return next;
    }
    case 'tier-broadcasting': {
      const next = { ...state };
      next[ev.tier] = {
        ...state[ev.tier],
        phase: 'broadcasting',
        status: `Broadcasting ${labelTier(ev.tier)} tier…`,
      };
      next.globalStatus = next[ev.tier].status;
      return next;
    }
    case 'tier-confirming': {
      const next = { ...state };
      next[ev.tier] = {
        ...state[ev.tier],
        phase: 'confirming',
        status: `Confirming ${labelTier(ev.tier)} on-chain (${ev.txCount} transaction${ev.txCount === 1 ? '' : 's'})…`,
      };
      next.globalStatus = next[ev.tier].status;
      return next;
    }
    case 'tx-confirmed': {
      const next = { ...state };
      next[ev.tier] = {
        ...state[ev.tier],
        succeeded: state[ev.tier].succeeded + 1,
      };
      return next;
    }
    case 'tx-failed': {
      const next = { ...state };
      next[ev.tier] = {
        ...state[ev.tier],
        failed: state[ev.tier].failed + 1,
      };
      return next;
    }
    case 'tx-skipped': {
      const next = { ...state };
      next[ev.tier] = {
        ...state[ev.tier],
        skipped: state[ev.tier].skipped + 1,
      };
      return next;
    }
    case 'tier-complete': {
      const next = { ...state };
      const parts: string[] = [];
      if (ev.succeeded > 0) parts.push(`${ev.succeeded} confirmed`);
      if (ev.failed > 0) parts.push(`${ev.failed} failed`);
      if (ev.skipped > 0) parts.push(`${ev.skipped} skipped`);
      next[ev.tier] = {
        ...state[ev.tier],
        phase: 'complete',
        status: `${labelTier(ev.tier)} complete · ${parts.join(' · ') || 'no work'}`,
      };
      next.globalStatus = next[ev.tier].status;
      return next;
    }
    case 'gas-low': {
      return {
        ...state,
        gasLowWarning: `Gas reserve low (${(ev.remainingLamports / 1e9).toFixed(4)} SOL). Remaining txs may be skipped.`,
      };
    }
  }
}

function labelTier(t: PriorityTier): string {
  return t === 'critical' ? 'Critical' : t === 'priority' ? 'Priority' : 'Standard';
}

// ── Rendering ───────────────────────────────────────────────────

interface FireProgressPanelProps {
  state: FireProgressState;
}

export function FireProgressPanel({ state }: FireProgressPanelProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Loader2 size={16} className="animate-spin text-destructive" />
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Evacuating…
        </h3>
      </div>

      {state.gasLowWarning && (
        <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/10 rounded-md">
          <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive">{state.gasLowWarning}</p>
        </div>
      )}

      <TierSection label="Critical" tier="critical" state={state.critical} />
      <TierSection label="Priority" tier="priority" state={state.priority} />
      <TierSection label="Standard" tier="standard" state={state.standard} />

      <div className="border-t border-border pt-3">
        <p className="text-[11px] text-muted-foreground italic">
          {state.globalStatus}
        </p>
      </div>
    </div>
  );
}

function TierSection({
  label,
  tier,
  state,
}: {
  label: string;
  tier: PriorityTier;
  state: TierProgressState;
}) {
  const completed = state.succeeded + state.failed + state.skipped;
  return (
    <div className="border border-border rounded-md p-3 bg-background">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <PhaseIcon phase={state.phase} />
          <span className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
            {label}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {state.planned === 0 ? '—' : `${completed}/${state.planned} transfers`}
        </span>
      </div>
      {state.planned > 0 && (
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Check size={10} className="text-safe" /> {state.succeeded}
          </span>
          {state.failed > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <X size={10} /> {state.failed}
            </span>
          )}
          {state.skipped > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock size={10} /> {state.skipped}
            </span>
          )}
        </div>
      )}
      {state.status && (
        <p className="text-[10px] text-muted-foreground mt-2 italic">
          {state.status}
        </p>
      )}
      {/* Suppress unused-var warning */}
      <span data-tier={tier} className="hidden" aria-hidden="true" />
    </div>
  );
}

function PhaseIcon({ phase }: { phase: TierPhase }) {
  if (phase === 'pending') return <Clock size={12} className="text-muted-foreground/60" />;
  if (phase === 'complete') return <Check size={12} className="text-safe" />;
  return <Loader2 size={12} className="animate-spin text-destructive" />;
}
