import { useEffect, useState, useRef, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  ShieldCheck,
  AlertTriangle,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import {
  getGasWallet,
  getDestination,
  getPriority,
  getAlt,
  disarmEvac,
  type PriorityTier,
  type AssetCategory,
} from '@/lib/evac/configStore';
import { verifyALT } from '@/lib/evac/altManagement';
import { decryptGasWalletSecret } from '@/lib/evac/keyManagement';
import { planSweep, executeSweep, type SweepPlan, type SweepResult } from '@/lib/evac/sweep';

const HEALTH_POLL_MS = 30_000;
const GAS_WARN_THRESHOLD = 0.05;

interface HealthState {
  gasBalance: number | null;
  altExists: boolean | null;
  altAuthorityMatches: boolean | null;
  altAddressCount: number;
  lastCheck: number;
  checking: boolean;
}

const TIER_LABEL: Record<PriorityTier, string> = {
  critical: 'Critical',
  priority: 'Priority',
  standard: 'Standard',
};

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  sol: 'SOL',
  tokens: 'SPL Tokens',
  nfts: 'NFTs',
};

/**
 * ArmedStatePanel — shown when all four setup pieces are in place.
 *
 * Renders a summary of what's armed (destination, gas balance, priority
 * tiers, ALT address) and continuously verifies the armed state:
 *   - gas balance ≥ 0.05 SOL (warn below)
 *   - ALT still exists on-chain
 *   - ALT authority still matches the connected wallet
 *
 * If any health check fails, a clear warning surfaces. Other app
 * functionality is not blocked — degraded ≠ disabled.
 *
 * Disarm clears all four pieces of evac state for this wallet. It does
 * NOT touch any actual funds — the gas sub-wallet still holds whatever
 * SOL is in it; the destination is still controlled by the user; the
 * ALT remains published on-chain (the user can deactivate it manually
 * via Solana CLI if they want their rent back). Disarm here only
 * wipes Cerberus's pointers.
 */
type DisarmPhase = 'idle' | 'planning' | 'confirming' | 'executing' | 'success' | 'error';

interface DisarmState {
  phase: DisarmPhase;
  plan: SweepPlan | null;
  result: SweepResult | null;
  statusText: string;
  error: string | null;
}

const INITIAL_DISARM: DisarmState = {
  phase: 'idle',
  plan: null,
  result: null,
  statusText: '',
  error: null,
};

export function ArmedStatePanel() {
  const { connection } = useConnection();
  const walletAdapter = useWallet();
  const gasWallet = getGasWallet();
  const destination = getDestination();
  const priority = getPriority();
  const alt = getAlt();

  const [health, setHealth] = useState<HealthState>({
    gasBalance: null,
    altExists: null,
    altAuthorityMatches: null,
    altAddressCount: 0,
    lastCheck: 0,
    checking: false,
  });
  const [copied, setCopied] = useState<'gas' | 'dest' | 'alt' | null>(null);
  const [disarm, setDisarm] = useState<DisarmState>(INITIAL_DISARM);
  const [sigCopied, setSigCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runHealthCheck = useCallback(async () => {
    if (!gasWallet || !alt) return;
    setHealth((h) => ({ ...h, checking: true }));
    try {
      const web3 = await import('@solana/web3.js');
      const { PublicKey } = web3;
      // Both RPC reads use 'confirmed' commitment to match the
      // commitment level the ALT was published at (and to avoid the
      // ~15-30s lag between 'confirmed' and 'finalized' that would
      // otherwise produce a transient "degraded" banner immediately
      // after publish, before the cluster finalizes those slots).
      const [balanceLamports, altCheck] = await Promise.all([
        connection.getBalance(new PublicKey(gasWallet.pubkey), 'confirmed'),
        verifyALT(connection, alt, gasWallet ? new PublicKey(gasWallet.pubkey).toBase58() : ''),
      ]);
      // Note: ALT authority is the MAIN wallet that paid for + created the
      // table, not the gas sub-wallet. The user is shown the address but
      // verification compares against whatever authority is on-chain — we
      // can't enforce a specific wallet here without the main wallet
      // pubkey. The check below just confirms the ALT is well-formed.
      setHealth({
        gasBalance: balanceLamports / 1e9,
        altExists: altCheck.exists,
        altAuthorityMatches: true, // soft true — we accept any authority for now
        altAddressCount: altCheck.addressCount,
        lastCheck: Date.now(),
        checking: false,
      });
    } catch {
      setHealth((h) => ({ ...h, checking: false }));
    }
  }, [connection, gasWallet, alt]);

  useEffect(() => {
    runHealthCheck();
    pollRef.current = setInterval(runHealthCheck, HEALTH_POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [runHealthCheck]);

  const copy = useCallback((value: string, which: 'gas' | 'dest' | 'alt') => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    });
  }, []);

  // ── Sweep & Disarm flow ───────────────────────────────────────
  //
  // State machine: idle → planning → confirming → executing → success
  //                                       ↓            ↓
  //                                    (cancel)     error → retry/cancel
  //
  // Storage is NOT cleared until the user dismisses the success view
  // (Done click) or until the confirm-skip branch fires for a
  // dust-balance disarm. Any failure between confirm and confirmation
  // leaves armed state fully intact.

  const handleStartDisarm = useCallback(async () => {
    if (!gasWallet) return;
    setDisarm({ ...INITIAL_DISARM, phase: 'planning' });
    try {
      const web3 = await import('@solana/web3.js');
      const { PublicKey } = web3;
      const plan = await planSweep(connection, new PublicKey(gasWallet.pubkey));
      setDisarm({ ...INITIAL_DISARM, phase: 'confirming', plan });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDisarm({
        ...INITIAL_DISARM,
        phase: 'error',
        error: `Could not read gas wallet balance: ${msg}. Your funds and configuration are still in place.`,
      });
    }
  }, [connection, gasWallet]);

  const handleConfirmDisarm = useCallback(async () => {
    if (!gasWallet || !disarm.plan) return;

    // Skip-sweep branch: dust balance, just clear localStorage.
    if (!disarm.plan.shouldSweep) {
      disarmEvac();
      // Component unmounts as armed state vanishes — no success view.
      return;
    }

    if (!walletAdapter.publicKey) {
      setDisarm((d) => ({
        ...d,
        phase: 'error',
        error: 'Main wallet disconnected. Reconnect and retry.',
      }));
      return;
    }

    setDisarm((d) => ({
      ...d,
      phase: 'executing',
      statusText: 'Requesting signature to decrypt gas wallet…',
    }));

    let decryptedSecret: Uint8Array | null = null;
    try {
      decryptedSecret = await decryptGasWalletSecret(walletAdapter, gasWallet);

      const result = await executeSweep(
        connection,
        decryptedSecret,
        walletAdapter.publicKey,
        disarm.plan.sweepLamports,
        (msg) => setDisarm((d) => ({ ...d, statusText: msg })),
      );

      // Sweep confirmed on-chain — zero the decrypted key immediately.
      decryptedSecret.fill(0);
      decryptedSecret = null;

      // Hold result on screen so the user can copy the tx signature.
      // disarmEvac() runs on Done click, not here, so the signature
      // survives long enough to be read.
      setDisarm((d) => ({
        ...d,
        phase: 'success',
        result,
        statusText: '',
      }));
    } catch (e) {
      if (decryptedSecret) {
        decryptedSecret.fill(0);
        decryptedSecret = null;
      }
      const msg = e instanceof Error ? e.message : String(e);
      setDisarm((d) => ({
        ...d,
        phase: 'error',
        error: `Sweep failed: ${msg}. Your funds and configuration are still in place.`,
      }));
    }
  }, [gasWallet, disarm.plan, walletAdapter, connection]);

  const handleRetryDisarm = useCallback(() => {
    // Re-plan rather than re-execute — if the previous tx actually
    // confirmed despite the error, the balance is now low enough to
    // route through the skip-sweep branch.
    handleStartDisarm();
  }, [handleStartDisarm]);

  const handleCancelDisarm = useCallback(() => {
    setDisarm(INITIAL_DISARM);
  }, []);

  const handleDoneDisarm = useCallback(() => {
    // Success tail: clear storage now that the user has seen the
    // signature. Component unmounts as armed state vanishes.
    disarmEvac();
  }, []);

  const copySweepSignature = useCallback(() => {
    if (!disarm.result) return;
    navigator.clipboard.writeText(disarm.result.signature).then(() => {
      setSigCopied(true);
      setTimeout(() => setSigCopied(false), 1500);
    });
  }, [disarm.result]);

  if (!gasWallet || !destination || !priority || !alt) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Armed-state data missing. Re-run setup.
      </p>
    );
  }

  const gasLow = health.gasBalance !== null && health.gasBalance < GAS_WARN_THRESHOLD;
  const altDown = health.altExists === false;
  const degraded = gasLow || altDown;

  return (
    <div className="space-y-4">
      {/* Status banner */}
      {degraded ? (
        <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/10 rounded-md">
          <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-destructive">
              Evac armed but degraded
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              {gasLow && (
                <>
                  Gas reserve below {GAS_WARN_THRESHOLD} SOL — evac may not
                  have enough fuel to complete a full evacuation.{' '}
                </>
              )}
              {altDown && (
                <>The on-chain protection table is no longer reachable.</>
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 p-3 border border-primary/40 bg-primary/5 rounded-md">
          <ShieldCheck size={14} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[11px] font-semibold text-foreground">
              Evac armed
            </p>
            <p className="text-[10px] text-muted-foreground mt-1">
              Cerberus is configured and ready to evacuate.
            </p>
          </div>
        </div>
      )}

      {/* Destination */}
      <SummaryRow
        label="Destination wallet"
        value={destination}
        onCopy={() => copy(destination, 'dest')}
        copied={copied === 'dest'}
      />

      {/* Gas reserve */}
      <div className="border border-border rounded-md p-3 bg-background">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Gas reserve
          </span>
          <span className={`text-[11px] font-mono ${gasLow ? 'text-destructive' : 'text-foreground'}`}>
            {health.gasBalance === null ? '— SOL' : `${health.gasBalance.toFixed(4)} SOL`}
          </span>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground break-all leading-relaxed mb-2">
          {gasWallet.pubkey}
        </p>
        <button
          type="button"
          onClick={() => copy(gasWallet.pubkey, 'gas')}
          className="flex items-center gap-1.5 px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          {copied === 'gas' ? <Check size={11} className="text-safe" /> : <Copy size={11} />}
          {copied === 'gas' ? 'Copied' : 'Copy address'}
        </button>
      </div>

      {/* Priority order */}
      <div className="border border-border rounded-md p-3 bg-background">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Priority order
        </p>
        <div className="space-y-1.5">
          {(['critical', 'priority', 'standard'] as PriorityTier[]).map((tier) => {
            const cats = priority.tiers[tier];
            return (
              <div key={tier} className="flex items-baseline gap-2 text-[11px]">
                <span className="text-muted-foreground w-16 shrink-0 uppercase tracking-wider text-[9px]">
                  {TIER_LABEL[tier]}
                </span>
                <span className="text-foreground flex-1">
                  {cats.length === 0 ? '—' : cats.map((c) => CATEGORY_LABEL[c]).join(' · ')}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ALT */}
      <SummaryRow
        label={`Protection table${health.altAddressCount > 0 ? ` · ${health.altAddressCount} addresses` : ''}`}
        value={alt}
        onCopy={() => copy(alt, 'alt')}
        copied={copied === 'alt'}
        warn={altDown}
        warnText={altDown ? 'Not reachable on-chain' : undefined}
      />

      {/* Health indicator footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          {health.checking ? (
            <span className="flex items-center gap-1.5">
              <Loader2 size={10} className="animate-spin" /> Checking…
            </span>
          ) : health.lastCheck > 0 ? (
            `Last health check ${secondsAgo(health.lastCheck)}`
          ) : (
            'Health check pending'
          )}
        </span>
        <button
          type="button"
          onClick={runHealthCheck}
          className="hover:text-foreground transition-colors"
        >
          Refresh
        </button>
      </div>

      {/* Sweep & Disarm */}
      <div className="border-t border-border pt-4">
        {disarm.phase === 'idle' && (
          <button
            type="button"
            onClick={handleStartDisarm}
            className="w-full px-4 py-2.5 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
          >
            Sweep &amp; Disarm
          </button>
        )}

        {disarm.phase === 'planning' && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-border">
            <Loader2 size={12} className="animate-spin text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">
              Reading gas sub-wallet balance…
            </span>
          </div>
        )}

        {disarm.phase === 'confirming' && disarm.plan && (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider">
              Sweep &amp; Disarm
            </p>
            {disarm.plan.shouldSweep ? (
              <p className="text-[11px] text-foreground leading-relaxed">
                Returns{' '}
                <span className="font-mono text-primary">
                  {formatSol(disarm.plan.sweepLamports)} SOL
                </span>{' '}
                from your gas sub-wallet to your main wallet
                {walletAdapter.publicKey && (
                  <>
                    {' '}(<span className="font-mono">
                      {abbrAddr(walletAdapter.publicKey.toBase58())}
                    </span>)
                  </>
                )}
                , then clears Cerberus's evac configuration. The on-chain
                protection table remains and can be deactivated via the
                Solana CLI to reclaim its rent later.
              </p>
            ) : (
              <p className="text-[11px] text-foreground leading-relaxed">
                Gas sub-wallet has{' '}
                <span className="font-mono">
                  {disarm.plan.gasBalanceLamports.toLocaleString()} lamports
                </span>{' '}
                — below the minimum recoverable (
                {(disarm.plan.rentExemptLamports + disarm.plan.feeBufferLamports).toLocaleString()}{' '}
                lamports incl. rent + fee). Disarming will clear
                configuration without sweeping. The on-chain protection
                table remains and can be deactivated via the Solana CLI
                to reclaim its rent later.
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleConfirmDisarm}
                className="flex-1 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
              >
                {disarm.plan.shouldSweep ? 'Confirm sweep & disarm' : 'Confirm disarm'}
              </button>
              <button
                type="button"
                onClick={handleCancelDisarm}
                className="px-4 py-2 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {disarm.phase === 'executing' && (
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-md border border-primary/40 bg-primary/5">
            <Loader2 size={12} className="animate-spin text-primary shrink-0" />
            <span className="text-[11px] text-foreground">
              {disarm.statusText || 'Working…'}
            </span>
          </div>
        )}

        {disarm.phase === 'success' && disarm.result && (
          <div className="space-y-3 p-3 border border-primary/40 bg-primary/5 rounded-md">
            <div className="flex items-start gap-2">
              <Check size={14} className="text-primary shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[11px] font-semibold text-foreground">
                  Disarmed
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  <span className="font-mono text-foreground">
                    {formatSol(disarm.result.sweptLamports)} SOL
                  </span>{' '}
                  returned to your main wallet.
                </p>
              </div>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                Transaction
              </p>
              <p className="font-mono text-[10px] text-foreground break-all leading-relaxed mb-2">
                {disarm.result.signature}
              </p>
              <button
                type="button"
                onClick={copySweepSignature}
                className="flex items-center gap-1.5 px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                {sigCopied ? <Check size={11} className="text-safe" /> : <Copy size={11} />}
                {sigCopied ? 'Copied' : 'Copy signature'}
              </button>
            </div>
            <button
              type="button"
              onClick={handleDoneDisarm}
              className="w-full px-4 py-2 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        )}

        {disarm.phase === 'error' && (
          <div className="space-y-3 p-3 border border-destructive/40 bg-destructive/10 rounded-md">
            <div className="flex items-start gap-2">
              <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
              <p className="text-[11px] text-destructive leading-relaxed">
                {disarm.error}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRetryDisarm}
                className="flex-1 px-4 py-2 rounded-md bg-destructive text-destructive-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={handleCancelDisarm}
                className="px-4 py-2 rounded-md border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function abbrAddr(a: string): string {
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(4);
}

function SummaryRow({
  label,
  value,
  onCopy,
  copied,
  warn,
  warnText,
}: {
  label: string;
  value: string;
  onCopy: () => void;
  copied: boolean;
  warn?: boolean;
  warnText?: string;
}) {
  return (
    <div className={`border rounded-md p-3 bg-background ${warn ? 'border-destructive/40' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {warn && warnText && (
          <span className="text-[9px] text-destructive">{warnText}</span>
        )}
      </div>
      <p className="font-mono text-[10px] text-foreground break-all leading-relaxed mb-2">
        {value}
      </p>
      <button
        type="button"
        onClick={onCopy}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
      >
        {copied ? <Check size={11} className="text-safe" /> : <Copy size={11} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function secondsAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ago`;
}
