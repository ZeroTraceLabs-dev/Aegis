import { useState, useMemo, useCallback, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import type { WalletData } from '@/hooks/useWalletScan';
import {
  getGasWallet,
  getDestination,
  setAlt,
} from '@/lib/evac/configStore';
import { publishALT, type ALTPublishProgress } from '@/lib/evac/altManagement';
import {
  subscribeSpamFilter,
  isTokenSpam,
  isNftCollectionSpam,
} from '@/lib/spamFilterStore';
import { getCollectionMap } from '@/lib/priceService';

interface Step5Props {
  wallet: WalletData;
}

/**
 * Step 5 — Publish the Address Lookup Table.
 *
 * Constructs an ALT containing:
 *   - destination wallet address
 *   - gas sub-wallet address
 *   - well-known program addresses (System, SPL Token, Token-2022, ATA)
 *   - all non-spam SPL token mints
 *   - all non-spam NFT collection addresses
 *
 * For typical wallets this fits in a single transaction. Wallets with
 * many collections may need 2-3 sigs as the ALT extends are chunked
 * into ~20-address transactions. Progress is surfaced so the user knows
 * which signature popup belongs to which step.
 *
 * On success: the ALT's address is persisted under evac_alt_{wallet}
 * and the flow advances to the ArmedStatePanel summary.
 */
export function Step5ALTPublish({ wallet }: Step5Props) {
  const { connection } = useConnection();
  const adapter = useWallet();

  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ALTPublishProgress | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  // Refresh asset counts when spam list mutates.
  useEffect(() => {
    const unsub = subscribeSpamFilter(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  const gasWallet = getGasWallet();
  const destination = getDestination();

  // ── Address set going into the ALT ──────────────────────────────

  const altInputs = useMemo(() => {
    const collectionMap = getCollectionMap();
    const splMints = wallet.tokenAccounts
      .filter((t) => !t.isNft && !isTokenSpam(t.mint))
      .map((t) => t.mint);

    const nftCollectionSet = new Set<string>();
    for (const t of wallet.tokenAccounts) {
      if (!t.isNft) continue;
      const cid = collectionMap[t.mint] || '__uncategorized__';
      if (cid === '__uncategorized__') continue; // not a real address
      if (isNftCollectionSpam(cid)) continue;
      nftCollectionSet.add(cid);
    }
    const nftCollections = Array.from(nftCollectionSet);

    return {
      destinationAddress: destination ?? '',
      gasWalletAddress: gasWallet?.pubkey ?? '',
      splMints,
      nftCollections,
    };
  }, [wallet.tokenAccounts, destination, gasWallet]);

  const totalAddrs = useMemo(
    () => 2 + 4 /* well-known programs */ + altInputs.splMints.length + altInputs.nftCollections.length,
    [altInputs],
  );

  // ~20 per extend tx, plus the first one bundled with create.
  const estimatedSigs = useMemo(() => {
    const extendCount = Math.ceil((totalAddrs) / 20);
    return Math.max(1, extendCount);
  }, [totalAddrs]);

  const handlePublish = useCallback(async () => {
    if (!gasWallet || !destination) {
      setErr('Setup state missing. Restart the flow.');
      return;
    }
    setBusy(true);
    setErr(null);
    setProgress(null);
    try {
      const { altAddress } = await publishALT(
        connection,
        adapter,
        altInputs,
        (p) => setProgress(p),
      );
      setAlt(altAddress);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Publishing failed.');
    } finally {
      setBusy(false);
    }
  }, [connection, adapter, altInputs, gasWallet, destination]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground mb-1">
          Publish protection table
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Cerberus is about to publish an on-chain lookup table that the
          evacuation transactions reference. Your main wallet signs and
          pays the fee (~0.002 SOL). The table contains addresses only —
          no balances, no keys, no permissions.
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-[11px] font-semibold text-foreground uppercase tracking-wider mb-2">
          What's in the table
        </p>
        <div className="space-y-1.5 text-[11px]">
          <Row label="Destination" value={destination ? abbrAddr(destination) : '—'} />
          <Row label="Gas sub-wallet" value={gasWallet ? abbrAddr(gasWallet.pubkey) : '—'} />
          <Row label="SPL token mints" value={`${altInputs.splMints.length}`} />
          <Row label="NFT collections" value={`${altInputs.nftCollections.length}`} />
          <Row label="Well-known programs" value="4" />
          <div className="pt-1.5 border-t border-border flex items-center justify-between">
            <span className="text-foreground font-semibold">Total addresses</span>
            <span className="font-mono text-foreground">{totalAddrs}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estimated signatures</span>
            <span className="font-mono text-muted-foreground">{estimatedSigs}</span>
          </div>
        </div>
      </div>

      {progress && (
        <div className="border border-primary/40 bg-primary/5 rounded-md p-3 flex items-center gap-2">
          <Loader2 size={14} className="text-primary animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-foreground">{progress.status}</p>
            <p className="text-[10px] text-muted-foreground">
              Transaction {progress.currentTx} of {progress.totalTxs}
            </p>
          </div>
        </div>
      )}

      {err && (
        <div className="flex items-start gap-2 p-3 border border-destructive/40 bg-destructive/10 rounded-md">
          <AlertTriangle size={14} className="text-destructive shrink-0 mt-0.5" />
          <p className="text-[11px] text-destructive">{err}</p>
        </div>
      )}

      <button
        type="button"
        onClick={handlePublish}
        disabled={busy || !gasWallet || !destination}
        className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {busy ? (
          <>
            <Loader2 size={12} className="animate-spin" /> Publishing…
          </>
        ) : (
          <>
            <ShieldCheck size={12} /> Publish &amp; arm
          </>
        )}
      </button>
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

function abbrAddr(a: string): string {
  if (a.length <= 12) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
