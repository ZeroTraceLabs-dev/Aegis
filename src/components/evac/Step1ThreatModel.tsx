import { ShieldAlert } from 'lucide-react';
import { acknowledgeThreatModel } from '@/lib/evac/configStore';

/**
 * Step 1 — Threat model explanation.
 *
 * Static, weighted copy. The friction here is the feature: a user who
 * doesn't read this can still proceed, but the content is sized so it
 * reads quickly and the language stays clinical. Cerberus's voice
 * register: calm, evidence-based, no theatrics.
 */
export function Step1ThreatModel() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 p-2 rounded border border-border bg-background">
          <ShieldAlert size={16} className="text-foreground" />
        </div>
        <div className="flex-1">
          <p className="text-[13px] font-semibold text-foreground mb-1">
            What evacuation does
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            If your wallet comes under active attack, evacuation moves your
            holdings out — fast — to a wallet you control elsewhere.
            Cerberus signs the moves; the destination wallet holds the
            assets after. The connected wallet is left behind.
          </p>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-2">
          The SOL-drain-first pattern
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Sophisticated attackers know defenders rely on SOL to pay transaction
          fees. The first thing many drainers do is sweep all SOL out of the
          target wallet. Once SOL is gone, the wallet can't sign anything —
          including the transactions that would move its remaining tokens
          and NFTs to safety. By the time you notice, your defense fund
          has already been removed.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-2">
          Why a separate gas reserve
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cerberus's defense is to keep the fee-paying funds in a different
          wallet from the at-risk one. A small gas sub-wallet — generated
          by Cerberus, funded by you — holds the SOL that pays for the
          evacuation transactions. When the main wallet's SOL is drained,
          the gas sub-wallet still has fuel. The evacuation completes from
          there.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-2">
          What you'll set up
        </p>
        <ul className="text-[11px] text-muted-foreground leading-relaxed space-y-1.5">
          <li className="flex gap-2">
            <span className="text-muted-foreground/60 shrink-0">1.</span>
            <span>The gas sub-wallet — Cerberus generates the keypair, you fund it with ~0.1 SOL.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-muted-foreground/60 shrink-0">2.</span>
            <span>The destination — a wallet you fully control. Hardware wallet is strongly preferred.</span>
          </li>
          <li className="flex gap-2">
            <span className="text-muted-foreground/60 shrink-0">3.</span>
            <span>Asset priorities — which categories evacuate first when seconds count.</span>
          </li>
        </ul>
      </div>

      <div className="border-t border-border pt-4">
        <button
          type="button"
          onClick={() => acknowledgeThreatModel()}
          className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
        >
          I understand, continue
        </button>
      </div>
    </div>
  );
}
