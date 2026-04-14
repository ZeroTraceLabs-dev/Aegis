import React, { useState, useEffect } from 'react';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronUp, ExternalLink, Lock, LockOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { WalletData, DelegateApproval } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { TokenIcon } from './TokenIcon';
import { usePrices } from './PriceContext';
import { notifyDelegateChange } from '@/lib/notificationService';
import {
  isDelegateSafe,
  markDelegateSafe,
  unmarkDelegateSafe,
  subscribeRisk,
} from '@/lib/riskStore';
import { toast } from '@/hooks/use-toast';

interface PermissionScannerProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

function getDisplay(mint: string, fallbackSymbol: string, metadata: Map<string, TokenMeta>) {
  const meta = metadata.get(mint);
  const symbol = (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : fallbackSymbol;
  const name = (meta?.name && !meta.name.includes('..')) ? meta.name : '';
  const image = meta?.image || '';
  return { symbol, name, image };
}

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

export function PermissionScanner({ wallet, metadata }: PermissionScannerProps) {
  const { getUsdValue, formatUsd, getNftFloor, prices } = usePrices();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [revokeErrors, setRevokeErrors] = useState<Map<string, string>>(new Map());

  // Re-render when risk store changes (safe delegate toggling)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = subscribeRisk(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  void prices;

  // Filter out already-revoked from display
  const activeApprovals = wallet.delegateApprovals.filter(
    (a) => !revoked.has(`${a.mint}-${a.delegate}`)
  );

  // Counts
  const safeCount = activeApprovals.filter((a) => isDelegateSafe(a.mint, a.delegate)).length;
  const unsafeCount = activeApprovals.length - safeCount;

  const totalAtRisk = activeApprovals
    .filter((a) => !isDelegateSafe(a.mint, a.delegate))
    .reduce((sum, a) => {
      const v = getUsdValue(a.mint, a.amount);
      if (v) return sum + v;
      const floor = getNftFloor(a.mint);
      if (floor) return sum + floor.floor;
      return sum;
    }, 0);

  async function handleRevoke(approval: DelegateApproval) {
    console.log('[Revoke] handleRevoke called', approval);
    if (!publicKey) return;
    if (!publicKey) return;
    const key = `${approval.mint}-${approval.delegate}`;
    setRevoking(key);
    try {
      const { PublicKey, Transaction } = await import('@solana/web3.js');
      const { createRevokeInstruction } = await import('@solana/spl-token');

     const tokenAccountPk = new PublicKey(approval.tokenAccount);
      const ix = createRevokeInstruction(tokenAccountPk, publicKey);
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setRevoked((prev) => new Set(prev).add(key));
      setRevokeErrors((prev) => { const n = new Map(prev); n.delete(key); return n; });
      const display = getDisplay(approval.mint, approval.tokenSymbol || 'Unknown', metadata);
      notifyDelegateChange('revoked', display.symbol);
      toast({ title: 'Delegate revoked', description: `Revoked approval for ${display.symbol}` });
    } catch (err) {
      console.error('Revoke failed:', err);
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setRevokeErrors((prev) => new Map(prev).set(key, errMsg));
      toast({ title: 'Revoke failed', description: errMsg, variant: 'destructive' });
    } finally {
      setRevoking(null);
    }
  }

  function handleToggleSafe(approval: DelegateApproval) {
    if (isDelegateSafe(approval.mint, approval.delegate)) {
      unmarkDelegateSafe(approval.mint, approval.delegate);
    } else {
      markDelegateSafe(approval.mint, approval.delegate);
    }
  }

  // Dynamic header state
  const allClean = activeApprovals.length === 0 && wallet.scanTimestamp;
  const allSafe = activeApprovals.length > 0 && unsafeCount === 0;
  const mixed = activeApprovals.length > 0 && safeCount > 0 && unsafeCount > 0;

  if (allClean) {
    return (
      <div className="bg-card border border-border rounded-lg p-5 card-glow-safe">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck size={18} className="text-safe" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">PERMISSION SCANNER</h3>
        </div>
        <p className="text-xs text-safe">No open delegate approvals found. Wallet is clean.</p>
      </div>
    );
  }

  // Determine header icon/color
  const headerIcon = allSafe
    ? <ShieldCheck size={18} className="text-safe" />
    : mixed
      ? <ShieldAlert size={18} className="text-yellow-400" />
      : <ShieldAlert size={18} className="text-destructive" />;

  const headerGlow = allSafe ? 'card-glow-safe' : unsafeCount > 0 ? 'card-glow' : 'card-glow-safe';

  return (
    <div className={`bg-card border border-border rounded-lg p-5 ${headerGlow}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          {headerIcon}
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">PERMISSION SCANNER</h3>
        </div>
        {activeApprovals.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
            <span className="text-muted-foreground">
              {safeCount > 0 && (
                <span className="text-safe font-bold">{safeCount} SAFE</span>
              )}
              {safeCount > 0 && unsafeCount > 0 && <span className="mx-1">·</span>}
              {unsafeCount > 0 && (
                <span className="text-destructive font-bold">{unsafeCount} UNREVIEWED</span>
              )}
            </span>
            {totalAtRisk > 0 && (
              <span className="text-destructive font-bold">AT RISK: {formatUsd(totalAtRisk)}</span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {activeApprovals.map((a) => {
          const key = `${a.mint}-${a.delegate}`;
          const isExpanded = expanded === key;
          const isRevoking = revoking === key;
          const isSafe = isDelegateSafe(a.mint, a.delegate);
          const display = getDisplay(a.mint, a.mintSymbol, metadata);
          const usdVal = getUsdValue(a.mint, a.amount) || getNftFloor(a.mint)?.floor || null;

          const borderColor = isSafe
            ? 'border-safe/30 bg-safe/5'
            : 'border-destructive/30 bg-destructive/5';

          return (
            <motion.div
              key={key}
              layout
              className={`border rounded-md overflow-hidden ${borderColor}`}
            >
              <button
                className="w-full flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 p-3 text-left"
                onClick={() => setExpanded(isExpanded ? null : key)}
              >
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <TokenIcon src={display.image} symbol={display.symbol} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm text-foreground">{display.symbol}</span>
                      {display.name && <span className="text-[10px] sm:text-xs text-muted-foreground truncate max-w-[100px] sm:max-w-none">{display.name}</span>}
                      {a.isNft && <span className="text-[8px] sm:text-[9px] px-1 py-0.5 bg-accent/20 text-accent rounded">NFT</span>}
                      {a.isNft && (
                        <span className="text-[8px] sm:text-[9px] px-1 py-0.5 bg-primary/15 text-primary rounded border border-primary/20">
                          STAKING
                        </span>
                      )}
                      {isSafe && (
                        <span className="text-[8px] sm:text-[9px] px-1 py-0.5 bg-safe/15 text-safe rounded border border-safe/20 font-bold">
                          SAFE
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground font-mono">{abbr(a.mint)}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] sm:text-xs text-foreground">Delegated: {a.amount.toFixed(a.decimals > 0 ? 4 : 0)}</span>
                      {usdVal !== null && !isSafe && <span className="text-[10px] sm:text-xs font-bold text-destructive">{formatUsd(usdVal)}</span>}
                      {usdVal !== null && isSafe && <span className="text-[10px] sm:text-xs font-bold text-safe">{formatUsd(usdVal)}</span>}
                    </div>
                    {revokeErrors.has(key) && (
                      <p className="text-[9px] text-destructive mt-0.5">Revoke failed: {revokeErrors.get(key)}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-auto">
                  {/* Mark Safe / Unsafe toggle */}
                  <button
                    className={`px-2 py-1 text-[10px] font-bold rounded transition-colors ${
                      isSafe
                        ? 'bg-safe/20 text-safe border border-safe/30 hover:bg-safe/30'
                        : 'bg-secondary/60 text-muted-foreground border border-border hover:bg-secondary hover:text-foreground'
                    }`}
                    onClick={(e) => { e.stopPropagation(); handleToggleSafe(a); }}
                    title={isSafe ? 'Remove from safe list' : 'Mark as safe (e.g. staking)'}
                  >
                    {isSafe ? <><Lock size={10} className="inline mr-1" />SAFE</> : <><LockOpen size={10} className="inline mr-1" />MARK SAFE</>}
                  </button>

                  {/* Revoke button -- only show for unsafe delegates */}
                  {!isSafe && (
                    <button
                      className="px-2 py-1 text-[10px] font-bold bg-destructive/20 text-destructive border border-destructive/30 rounded hover:bg-destructive/30 transition-colors disabled:opacity-50"
                      onClick={(e) => { e.stopPropagation(); handleRevoke(a); }}
                      disabled={isRevoking}
                    >
                      {isRevoking ? 'REVOKING...' : 'REVOKE'}
                    </button>
                  )}

                  {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                </div>
              </button>

              <AnimatePresence>
                {isExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="border-t border-border"
                  >
                    <div className="p-3 space-y-2 text-xs">
                      {/* Context info for NFT delegates */}
                      {a.isNft && (
                        <div className="px-3 py-2 rounded bg-primary/5 border border-primary/20">
                          <span className="text-primary text-[10px]">
                            NFT delegates are typically from staking protocols. If you recognize the delegate address below, this is safe.
                          </span>
                        </div>
                      )}
                      {usdVal !== null && usdVal > 0 && !isSafe && (
                        <div className="px-3 py-2 rounded bg-destructive/10 border border-destructive/30">
                          <span className="text-destructive font-bold">AT RISK: {formatUsd(usdVal)}</span>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">DELEGATE: </span>
                        <span className="font-mono text-foreground">{a.delegate}</span>
                        <a
                          href={`https://solscan.io/account/${a.delegate}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex ml-1"
                        >
                          <ExternalLink size={10} className="text-primary" />
                        </a>
                      </div>
                      <div>
                        <span className="text-muted-foreground">MINT: </span>
                        <span className="font-mono text-foreground">{a.mint}</span>
                        <a
                          href={`https://solscan.io/token/${a.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex ml-1"
                        >
                          <ExternalLink size={10} className="text-primary" />
                        </a>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}