import { useState } from 'react';
import { Check, X, Clock, ExternalLink, Copy, AlertTriangle } from 'lucide-react';
import type { FireResult, TierResult, TxResult } from '@/lib/evac/fire';
import type { PriorityTier } from '@/lib/evac/configStore';

interface FireSuccessPanelProps {
  result: FireResult;
  /** When true (any failed tx OR signature rejection mid-fire), the
   *  header switches to "Evacuation incomplete" and the Retry button
   *  is prominent. */
  incomplete: boolean;
  onDone: () => void;
  onRetryFailed: () => void;
  onRearm: () => void;
}

const TIER_ORDER: PriorityTier[] = ['critical', 'priority', 'standard'];
const TIER_LABEL: Record<PriorityTier, string> = {
  critical: 'Critical',
  priority: 'Priority',
  standard: 'Standard',
};

/**
 * End-of-fire summary. Stays mounted (does NOT auto-disarm) until the
 * user clicks Done — the user must explicitly acknowledge the result
 * so they don't accidentally lose the tx signature list or re-fire.
 *
 * On Done, the parent calls disarmEvac() to clear all four pieces of
 * armed-state localStorage. On Re-arm, the parent calls the partial
 * clear (clearGasForRearm) and the setup flow resumes at Step 2 with
 * destination, priority, and ALT preserved.
 */
export function FireSuccessPanel({ result, incomplete, onDone, onRetryFailed, onRearm }: FireSuccessPanelProps) {
  const totalSucceeded = sumTiers(result.tiers, (t) => t.succeeded.length);
  const totalFailed = sumTiers(result.tiers, (t) => t.failed.length);
  const totalSkipped = sumTiers(result.tiers, (t) => t.skipped.length);

  const allFailedOrSkipped: { tier: PriorityTier; tx: TxResult }[] = [];
  for (const tier of TIER_ORDER) {
    for (const tx of result.tiers[tier].failed) allFailedOrSkipped.push({ tier, tx });
    for (const tx of result.tiers[tier].skipped) allFailedOrSkipped.push({ tier, tx });
  }

  const sigs: { tier: PriorityTier; tx: TxResult }[] = [];
  for (const tier of TIER_ORDER) {
    for (const tx of result.tiers[tier].succeeded) sigs.push({ tier, tx });
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        {incomplete ? (
          <AlertTriangle size={16} className="text-destructive" />
        ) : (
          <Check size={16} className="text-safe" />
        )}
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          {incomplete ? 'Evacuation incomplete' : 'Evacuation complete'}
        </h3>
      </div>

      {/* Per-tier counts */}
      <div className="border border-border rounded-md p-3 bg-background space-y-2">
        {TIER_ORDER.map((t) => {
          const tier = result.tiers[t];
          const total =
            tier.succeeded.length + tier.failed.length + tier.skipped.length;
          if (total === 0) return null;
          const allOk = tier.failed.length === 0 && tier.skipped.length === 0;
          return (
            <div key={t} className="flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-2">
                {allOk ? (
                  <Check size={12} className="text-safe" />
                ) : tier.failed.length > 0 ? (
                  <X size={12} className="text-destructive" />
                ) : (
                  <Clock size={12} className="text-muted-foreground" />
                )}
                <span className="text-muted-foreground uppercase tracking-wider text-[10px] w-20">
                  {TIER_LABEL[t]}
                </span>
              </span>
              <span className="font-mono text-foreground">
                {tier.succeeded.length}/{total} transfers
                {tier.skipped.length > 0 && (
                  <span className="text-muted-foreground"> · {tier.skipped.length} skipped</span>
                )}
                {tier.failed.length > 0 && (
                  <span className="text-destructive"> · {tier.failed.length} failed</span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {/* Totals */}
      <div className="border border-border rounded-md p-3 bg-background space-y-1 text-[11px]">
        <SummaryRow
          label="Total evacuated"
          value={`${result.totalAssetsEvacuated.sol.toFixed(4)} SOL · ${result.totalAssetsEvacuated.tokens} tokens · ${result.totalAssetsEvacuated.nfts} NFTs`}
        />
        <SummaryRow
          label="Gas spent"
          value={`${(result.totalGasSpent / 1e9).toFixed(4)} SOL`}
        />
        <SummaryRow
          label="Duration"
          value={`${(result.durationMs / 1000).toFixed(1)}s`}
        />
        <SummaryRow
          label="Transfers"
          value={`${totalSucceeded} ok · ${totalFailed} failed · ${totalSkipped} skipped`}
        />
      </div>

      {/* Failed / skipped detail */}
      {allFailedOrSkipped.length > 0 && (
        <CollapsibleSection title={`Failed / skipped transfers (${allFailedOrSkipped.length})`} defaultOpen={incomplete}>
          <div className="space-y-1.5">
            {allFailedOrSkipped.map((entry, i) => (
              <div key={i} className="border border-border rounded-md p-2 text-[10px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-muted-foreground uppercase tracking-wider text-[9px]">
                    {TIER_LABEL[entry.tier]}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.tx.assets.map((a) => a.name).join(' · ')}
                  </span>
                </div>
                {entry.tx.error && (
                  <p className="text-destructive leading-relaxed mt-1 break-words">
                    {entry.tx.error}
                  </p>
                )}
                {entry.tx.signature && (
                  <SignatureLine sig={entry.tx.signature} />
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Signatures */}
      {sigs.length > 0 && (
        <CollapsibleSection title={`Transaction signatures (${sigs.length})`} defaultOpen={false}>
          <div className="space-y-1.5">
            {sigs.map((entry, i) => (
              <div key={i} className="border border-border rounded-md p-2 text-[10px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-muted-foreground uppercase tracking-wider text-[9px]">
                    {TIER_LABEL[entry.tier]}
                  </span>
                  <span className="text-muted-foreground">
                    {entry.tx.assets.map((a) => a.name).join(' · ')}
                  </span>
                </div>
                {entry.tx.signature && <SignatureLine sig={entry.tx.signature} />}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Actions */}
      <div className="border-t border-border pt-4 flex items-center gap-2">
        {incomplete && (
          <button
            type="button"
            onClick={onRetryFailed}
            className="flex-1 px-4 py-2.5 rounded-md bg-destructive text-destructive-foreground text-[11px] font-bold uppercase tracking-wider hover:opacity-90 transition-opacity"
          >
            Retry failed
          </button>
        )}
        <button
          type="button"
          onClick={onRearm}
          className="flex-1 px-4 py-2.5 rounded-md border border-border text-[11px] text-foreground hover:bg-secondary transition-colors"
        >
          Re-arm
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex-1 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function sumTiers(
  tiers: FireResult['tiers'],
  fn: (t: TierResult) => number,
): number {
  return fn(tiers.critical) + fn(tiers.priority) + fn(tiers.standard);
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}

function SignatureLine({ sig }: { sig: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(sig).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return (
    <div className="flex items-center gap-2">
      <a
        href={`https://solscan.io/tx/${sig}`}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[10px] text-foreground hover:text-primary truncate flex-1"
      >
        {sig}
      </a>
      <a
        href={`https://solscan.io/tx/${sig}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground shrink-0"
        title="Open on Solscan"
      >
        <ExternalLink size={11} />
      </a>
      <button
        type="button"
        onClick={copy}
        className="text-muted-foreground hover:text-foreground shrink-0"
        title="Copy signature"
      >
        {copied ? <Check size={11} className="text-safe" /> : <Copy size={11} />}
      </button>
    </div>
  );
}

function CollapsibleSection({
  title,
  defaultOpen,
  children,
}: {
  title: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border rounded-md">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full px-3 py-2 flex items-center justify-between text-[11px] text-foreground hover:bg-secondary/50 transition-colors"
      >
        <span className="uppercase tracking-wider text-[10px]">{title}</span>
        <span className="text-muted-foreground text-[10px]">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}
