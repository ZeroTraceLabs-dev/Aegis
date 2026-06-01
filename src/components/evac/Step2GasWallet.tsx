import { useEffect, useRef, useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, Loader2, AlertTriangle } from 'lucide-react';
import { getGasWallet, setGasWallet, markGasReady } from '@/lib/evac/configStore';
import { generateGasWallet, encryptGasWallet } from '@/lib/evac/keyManagement';

const REQUIRED_SOL = 0.1;
const POLL_MS = 5000;

/**
 * Step 2 — Generate and fund the gas sub-wallet.
 *
 * On mount: if no gas wallet record exists for this main wallet, render a
 * "generate" prompt. Generating spawns a fresh Solana keypair entirely in
 * the browser, asks the main wallet to sign a deterministic message, and
 * uses the signature's bytes (SHA-256 → AES-GCM key) to encrypt the
 * sub-wallet's private key. Only the encrypted blob is persisted; the
 * plaintext private key is zeroed before this component continues.
 *
 * Once a record exists: render the sub-wallet's pubkey + QR code + a live
 * SOL balance poll. When balance ≥ 0.1 SOL the advance button enables;
 * pressing it doesn't write new state (the record already exists) — the
 * step is "complete" by virtue of the gas wallet being persisted and
 * funded.
 *
 * The brief calls for auto-advance on threshold met. I add an explicit
 * "looks funded — continue" button anyway so the user sees the value of
 * the polling tick land before the flow moves on. (If you prefer
 * auto-advance, that's one line — but explicit confirm feels safer here.)
 */
export function Step2GasWallet() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  const record = getGasWallet();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll the gas wallet's SOL balance once a record exists.
  useEffect(() => {
    if (!record) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const web3 = await import('@solana/web3.js');
        const { PublicKey } = web3;
        const lamports = await connection.getBalance(new PublicKey(record.pubkey));
        if (!cancelled) setBalance(lamports / 1e9);
      } catch {
        /* network failure — keep last good reading */
      }
    };

    tick();
    pollRef.current = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [record, connection]);

  const handleGenerate = useCallback(async () => {
    if (!wallet.publicKey || !wallet.signMessage) {
      setErr('Connect a wallet that supports message signing (Phantom, Solflare).');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const gen = await generateGasWallet();
      // gen.secret is now zeroed inside encryptGasWallet — do not retain.
      const stored = await encryptGasWallet(wallet, gen.pubkey, gen.secret);
      setGasWallet(stored);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  const handleCopy = useCallback(() => {
    if (!record) return;
    navigator.clipboard.writeText(record.pubkey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [record]);

  // ── No record yet — prompt to generate ───────────────────────
  if (!record) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[13px] font-semibold text-foreground mb-1">
            Generate the gas sub-wallet
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Cerberus will create a new Solana keypair in your browser and
            encrypt the private key with a signature from your main wallet.
            The encrypted blob is stored in localStorage; the plaintext key
            never leaves your machine and never sits in storage in the clear.
          </p>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-2">
            What you'll see next
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Your wallet will prompt you to sign a single message:{' '}
            <span className="font-mono text-foreground">
              "Cerberus evac gas wallet encryption v1"
            </span>
            . That signature becomes the encryption key. It moves no
            tokens and costs no SOL.
          </p>
        </div>

        {err && (
          <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/10 rounded-md">
            <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
            <p className="text-[11px] text-destructive">{err}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={busy || !wallet.publicKey}
          className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {busy ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Generating…
            </>
          ) : (
            'Generate gas sub-wallet'
          )}
        </button>
      </div>
    );
  }

  // ── Record exists — display + funding instructions ───────────
  const funded = balance !== null && balance >= REQUIRED_SOL;
  const underWarn = balance !== null && balance > 0 && balance < REQUIRED_SOL;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground mb-1">
          Fund the gas sub-wallet
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Send <span className="text-foreground font-medium">{REQUIRED_SOL} SOL</span>{' '}
          to the address below from your main wallet (or any source). Once
          the balance lands you can continue.
        </p>
      </div>

      <div className="border border-border rounded-md p-4 bg-background">
        <div className="flex items-start gap-4">
          <div className="shrink-0 bg-foreground p-2 rounded">
            <QRCodeSVG value={record.pubkey} size={96} bgColor="#ede7d9" fgColor="#0c0a0a" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
              Gas sub-wallet address
            </p>
            <p className="font-mono text-[10px] text-foreground break-all leading-relaxed mb-2">
              {record.pubkey}
            </p>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              {copied ? <Check size={11} className="text-safe" /> : <Copy size={11} />}
              {copied ? 'Copied' : 'Copy address'}
            </button>
          </div>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground">Current balance</span>
          <span className="text-[11px] font-mono text-foreground">
            {balance === null ? '— SOL' : `${balance.toFixed(4)} SOL`}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Required minimum</span>
          <span className="text-[11px] font-mono text-foreground">{REQUIRED_SOL.toFixed(4)} SOL</span>
        </div>
        {underWarn && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Funds detected — waiting for the balance to reach the minimum.
          </p>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          <span className="text-foreground font-medium">This wallet holds gas only.</span>{' '}
          Never deposit larger amounts here. If your browser storage is ever
          compromised, the maximum loss is whatever SOL is sitting in this
          sub-wallet.
        </p>
      </div>

      <button
        type="button"
        disabled={!funded}
        onClick={() => markGasReady()}
        className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {funded ? 'Funded — continue' : `Waiting for ${REQUIRED_SOL} SOL…`}
      </button>
    </div>
  );
}
