import { useState, useCallback } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import { AlertTriangle, Check, Loader2 } from 'lucide-react';
import { setDestination } from '@/lib/evac/configStore';
import { validateWalletAddress, checkAddressIsWallet } from '@/lib/evac/altManagement';

/**
 * Step 3 — Configure the destination wallet.
 *
 * User pastes an address. We validate it as a real wallet (base58 format,
 * length, on-curve check — rejects PDAs), and best-effort check that it's
 * not an executable program. A confirm checkbox is required before the
 * step advances — friction is intentional, because a wrong destination
 * during evac is catastrophic.
 */
export function Step3Destination() {
  const { connection } = useConnection();
  const [input, setInput] = useState('');
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleValidate = useCallback(async () => {
    setErr(null);
    setValidated(null);
    setConfirmed(false);
    if (!input.trim()) {
      setErr('Paste an address to continue.');
      return;
    }
    setValidating(true);
    try {
      const parsed = await validateWalletAddress(input);
      const walletCheck = await checkAddressIsWallet(connection, parsed);
      if (!walletCheck.ok) {
        setErr(walletCheck.reason || 'Address is not a wallet.');
        return;
      }
      setValidated(parsed.toBase58());
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Invalid address.');
    } finally {
      setValidating(false);
    }
  }, [input, connection]);

  const handleSave = useCallback(() => {
    if (!validated || !confirmed) return;
    setDestination(validated);
  }, [validated, confirmed]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground mb-1">
          Where should evacuated assets land?
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Enter the Solana address of a wallet you fully control. A hardware
          wallet (Ledger, Trezor) is strongly preferred — if you're
          evacuating from a wallet under attack, the destination should be
          somewhere the attacker can't reach.
        </p>
      </div>

      <div className="border-t border-border pt-4 space-y-2">
        <label className="block text-[10px] uppercase tracking-wider text-muted-foreground">
          Destination wallet address
        </label>
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setValidated(null);
            setErr(null);
            setConfirmed(false);
          }}
          placeholder="Paste base58 wallet address…"
          rows={2}
          className="w-full px-3 py-2 text-[11px] font-mono bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/60 resize-none"
        />
        <button
          type="button"
          onClick={handleValidate}
          disabled={validating || !input.trim()}
          className="w-full px-3 py-2 rounded-md border border-border text-[11px] font-medium text-foreground hover:bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {validating ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Validating…
            </>
          ) : (
            'Validate address'
          )}
        </button>
      </div>

      {err && (
        <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/10 rounded-md">
          <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive">{err}</p>
        </div>
      )}

      {validated && (
        <div className="border border-primary/40 bg-primary/5 rounded-md p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Check size={14} className="text-primary shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Address validated
              </p>
              <p className="font-mono text-[10px] text-foreground break-all leading-relaxed">
                {validated}
              </p>
            </div>
          </div>

          <label className="flex items-start gap-2 cursor-pointer pt-2 border-t border-border">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 accent-primary"
            />
            <span className="text-[11px] text-foreground leading-relaxed">
              I confirm this is the wallet I want to receive evacuated
              assets. I control the keys for this address.
            </span>
          </label>

          <button
            type="button"
            onClick={handleSave}
            disabled={!confirmed}
            className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save destination
          </button>
        </div>
      )}

      <div className="border-t border-border pt-4">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">Wrong destination = catastrophic.</span>{' '}
          Cerberus stores only this public address — never the destination's
          keys. If you set the wrong one, evacuation moves your assets to
          the wrong place.
        </p>
      </div>
    </div>
  );
}
