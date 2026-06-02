import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { GasEstimate } from '@/lib/evac/gasEstimation';

interface FireConfirmationModalProps {
  open: boolean;
  destinationAddress: string;
  estimate: GasEstimate;
  /** Sufficient-guaranteed → standard tier reads "best-effort". */
  standardBestEffort: boolean;
  estimatedDurationSec: number;
  estimatedSignaturePrompts: number;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Glass-mode confirmation modal. The single safety gate before fire.
 *
 * Keyboard:
 *   - Enter   → confirm (matches default-focused confirm button)
 *   - Escape  → cancel
 *
 * Focus management: when open, the confirm button is auto-focused so
 * Enter triggers it without an additional Tab.
 */
export function FireConfirmationModal({
  open,
  destinationAddress,
  estimate,
  standardBestEffort,
  estimatedDurationSec,
  estimatedSignaturePrompts,
  onCancel,
  onConfirm,
}: FireConfirmationModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const tot = (
    estimate.breakdown.critical.lamports +
    estimate.breakdown.priority.lamports +
    estimate.breakdown.standard.lamports
  ) / 1e9;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="fire-modal-title">
      <div className="w-full max-w-md bg-card border border-destructive/60 rounded-lg shadow-2xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <AlertTriangle size={16} className="text-destructive" />
          <h2 id="fire-modal-title" className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Evacuate Wallet
          </h2>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-[11px] text-muted-foreground mb-1 uppercase tracking-wider">
              Destination
            </p>
            <p className="font-mono text-[11px] text-foreground break-all">
              {destinationAddress}
            </p>
          </div>

          <div>
            <p className="text-[11px] text-muted-foreground mb-2 uppercase tracking-wider">
              Assets to evacuate
            </p>
            <div className="space-y-1.5 text-[11px]">
              <TierLine
                label="Critical"
                breakdown={estimate.breakdown.critical}
                note="guaranteed"
              />
              <TierLine
                label="Priority"
                breakdown={estimate.breakdown.priority}
                note="guaranteed"
              />
              <TierLine
                label="Standard"
                breakdown={estimate.breakdown.standard}
                note={standardBestEffort ? 'best-effort, depends on gas' : 'guaranteed'}
              />
            </div>
          </div>

          <div className="border-t border-border pt-3 space-y-1.5 text-[11px]">
            <Row label="Estimated gas" value={`${tot.toFixed(4)} SOL`} />
            <Row label="Estimated duration" value={`~${estimatedDurationSec}s`} />
            <Row
              label="Signature prompts"
              value={`${estimatedSignaturePrompts}`}
            />
          </div>

          <div className="p-3 border border-destructive/40 bg-destructive/10 rounded-md">
            <p className="text-[11px] text-destructive font-semibold">
              This action is irreversible.
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Once broadcast, transfers cannot be recalled. The destination
              wallet permanently receives every asset listed above.
            </p>
          </div>
        </div>

        {/* Buttons */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="flex-1 px-5 py-3 rounded-md bg-destructive text-destructive-foreground text-[12px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-destructive focus:ring-offset-2 focus:ring-offset-card"
          >
            Evacuate Now
          </button>
        </div>
      </div>
    </div>
  );
}

function TierLine({ label, breakdown, note }: {
  label: string;
  breakdown: { solCount: number; tokenCount: number; nftCount: number; totalTransfers: number };
  note: string;
}) {
  const parts: string[] = [];
  if (breakdown.solCount > 0) parts.push('SOL');
  if (breakdown.tokenCount > 0) parts.push(`${breakdown.tokenCount} token${breakdown.tokenCount === 1 ? '' : 's'}`);
  if (breakdown.nftCount > 0) parts.push(`${breakdown.nftCount} NFT${breakdown.nftCount === 1 ? '' : 's'}`);
  const value = parts.length > 0 ? parts.join(' · ') : '—';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider w-20 shrink-0">
        {label}
      </span>
      <span className="text-foreground flex-1">{value}</span>
      <span className="text-[9px] text-muted-foreground italic">{note}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
