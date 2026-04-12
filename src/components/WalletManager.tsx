import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Users,
  Plus,
  Trash2,
  RefreshCw,
  Shield,
  AlertTriangle,
  ExternalLink,
  Loader2,
  Edit3,
  Check,
  X,
  ChevronDown,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { RPC_ENDPOINT } from '@/lib/rpc';
import {
  getWatchedWallets,
  addWatchedWallet,
  removeWatchedWallet,
  updateWalletLabel,
  updateWalletScanResults,
  subscribeWalletList,
  getAggregateStats,
  type WatchedWallet,
} from '@/lib/multiWalletStore';

function abbr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function scoreColor(score: number | undefined): string {
  if (score === undefined) return 'text-muted-foreground';
  if (score >= 70) return 'text-safe';
  if (score >= 40) return 'text-yellow-400';
  return 'text-destructive';
}

function scoreBg(score: number | undefined): string {
  if (score === undefined) return 'bg-secondary border-border';
  if (score >= 70) return 'bg-safe/10 border-safe/20';
  if (score >= 40) return 'bg-yellow-400/10 border-yellow-400/20';
  return 'bg-destructive/10 border-destructive/20';
}

/**
 * Lightweight scan: fetches SOL balance, token count, and computes a basic health score
 * without the full pipeline (so it's fast and doesn't overload RPC).
 */
async function quickScanWallet(address: string): Promise<{
  healthScore: number;
  riskCount: number;
  solBalance: number;
  tokenCount: number;
}> {
  const web3 = await import('@solana/web3.js');
  const { Connection, PublicKey, TOKEN_PROGRAM_ID } = web3;
  const conn = new Connection(RPC_ENDPOINT, 'confirmed');
  const pubkey = new PublicKey(address);

  // SOL balance
  const lamports = await conn.getBalance(pubkey);
  const solBalance = lamports / 1e9;

  // Token accounts
  const tokenResp = await conn.getParsedTokenAccountsByOwner(pubkey, {
    programId: TOKEN_PROGRAM_ID,
  });

  const accounts = tokenResp.value;
  const tokenCount = accounts.filter(
    (a) => (a.account.data as { parsed: { info: { tokenAmount: { uiAmount: number } } } }).parsed.info.tokenAmount.uiAmount > 0,
  ).length;

  // Basic health scoring
  let score = 85;
  let riskCount = 0;

  // Check for open delegates
  for (const acct of accounts) {
    const parsed = (acct.account.data as { parsed: { info: { delegate?: string; delegatedAmount?: { uiAmount: number } } } }).parsed;
    if (parsed.info.delegate) {
      score -= 10;
      riskCount++;
    }
  }

  // Empty accounts penalty
  const emptyCount = accounts.filter(
    (a) => (a.account.data as { parsed: { info: { tokenAmount: { uiAmount: number } } } }).parsed.info.tokenAmount.uiAmount === 0,
  ).length;
  if (emptyCount > 5) {
    score -= 5;
    riskCount++;
  }

  // Low SOL warning
  if (solBalance < 0.01 && solBalance > 0) {
    score -= 5;
  }

  return {
    healthScore: Math.max(0, Math.min(100, score)),
    riskCount,
    solBalance,
    tokenCount,
  };
}

function WalletRow({
  wallet,
  scanning,
  onScan,
  onRemove,
  onRename,
}: {
  wallet: WatchedWallet;
  scanning: boolean;
  onScan: () => void;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(wallet.label);

  const saveLabel = () => {
    if (labelDraft.trim()) {
      onRename(labelDraft.trim());
    }
    setEditing(false);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className={`p-3 rounded-md border ${scoreBg(wallet.healthScore)}`}
    >
      <div className="flex items-center gap-3">
        {/* Score badge */}
        <div className={`text-base font-bold w-10 text-center ${scoreColor(wallet.healthScore)}`}>
          {wallet.healthScore !== undefined ? wallet.healthScore : '—'}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {editing ? (
              <div className="flex items-center gap-1">
                <input
                  value={labelDraft}
                  onChange={(e) => setLabelDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveLabel()}
                  className="bg-secondary/60 border border-border rounded px-2 py-0.5 text-[11px] text-foreground w-32 focus:outline-none focus:border-primary/40"
                  autoFocus
                />
                <button onClick={saveLabel} className="text-safe hover:text-safe/80"><Check size={10} /></button>
                <button onClick={() => setEditing(false)} className="text-muted-foreground hover:text-foreground"><X size={10} /></button>
              </div>
            ) : (
              <span className="text-[11px] font-semibold text-foreground flex items-center gap-1">
                {wallet.label}
                <button onClick={() => { setLabelDraft(wallet.label); setEditing(true); }} className="text-muted-foreground hover:text-foreground">
                  <Edit3 size={8} />
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[9px] font-mono text-muted-foreground">{abbr(wallet.address)}</span>
            <a
              href={`https://solscan.io/account/${wallet.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary"
            >
              <ExternalLink size={8} />
            </a>
            {wallet.solBalance !== undefined && (
              <span className="text-[9px] text-muted-foreground">{wallet.solBalance.toFixed(3)} SOL</span>
            )}
            {wallet.tokenCount !== undefined && (
              <span className="text-[9px] text-muted-foreground">{wallet.tokenCount} tokens</span>
            )}
            {wallet.riskCount !== undefined && wallet.riskCount > 0 && (
              <span className="flex items-center gap-0.5 text-[9px] text-yellow-400">
                <AlertTriangle size={8} /> {wallet.riskCount} risk{wallet.riskCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={onScan}
            disabled={scanning}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            title="Scan wallet"
          >
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button
            onClick={onRemove}
            className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove wallet"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

export function WalletManager() {
  const { connected } = useWallet();
  const [wallets, setWallets] = useState<WatchedWallet[]>(getWatchedWallets());
  const [showInput, setShowInput] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState('');
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const unsub = subscribeWalletList(() => setWallets(getWatchedWallets()));
    return unsub;
  }, []);

  const handleAdd = useCallback(() => {
    const addr = newAddress.trim();
    if (!addr) {
      setAddError('Enter a wallet address');
      return;
    }
    const ok = addWatchedWallet(addr, newLabel.trim() || undefined);
    if (!ok) {
      if (wallets.some((w) => w.address === addr)) {
        setAddError('Wallet already added');
      } else if (wallets.length >= 10) {
        setAddError('Maximum 10 wallets');
      } else {
        setAddError('Invalid Solana address');
      }
      return;
    }
    setNewAddress('');
    setNewLabel('');
    setAddError('');
    setShowInput(false);
  }, [newAddress, newLabel, wallets]);

  const handleScan = useCallback(async (address: string) => {
    setScanningId(address);
    try {
      const results = await quickScanWallet(address);
      updateWalletScanResults(address, results);
    } catch (err) {
      console.warn('[MultiWallet] Scan failed:', err);
    } finally {
      setScanningId(null);
    }
  }, []);

  const handleScanAll = useCallback(async () => {
    for (const w of wallets) {
      setScanningId(w.address);
      try {
        const results = await quickScanWallet(w.address);
        updateWalletScanResults(w.address, results);
      } catch { /* skip */ }
    }
    setScanningId(null);
  }, [wallets]);

  if (!connected) return null;

  const aggregate = getAggregateStats();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2"
        >
          <Users size={16} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Multi-Wallet Monitor
          </h3>
          <span className="text-[10px] text-muted-foreground">({wallets.length}/10)</span>
          <ChevronDown size={12} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        <div className="flex items-center gap-2">
          {wallets.length > 0 && (
            <button
              onClick={handleScanAll}
              disabled={scanningId !== null}
              className="flex items-center gap-1 text-[9px] font-semibold text-primary hover:text-primary/80 disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={10} className={scanningId ? 'animate-spin' : ''} />
              Scan All
            </button>
          )}
          <button
            onClick={() => setShowInput(!showInput)}
            className="flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-[9px] font-semibold hover:bg-primary/20 transition-colors"
          >
            <Plus size={10} />
            Add Wallet
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {/* Aggregate stats */}
            {aggregate && (
              <div className="flex items-center gap-4 mb-3 text-[10px]">
                <div>
                  <span className="text-muted-foreground">Avg Health: </span>
                  <span className={`font-bold ${scoreColor(aggregate.avgHealth)}`}>{aggregate.avgHealth}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total Risks: </span>
                  <span className="font-bold text-yellow-400">{aggregate.totalRisks}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total SOL: </span>
                  <span className="font-bold text-foreground">{aggregate.totalSol.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Add wallet input */}
            <AnimatePresence>
              {showInput && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden mb-3"
                >
                  <div className="p-3 rounded-md bg-secondary/40 border border-border space-y-2">
                    <input
                      value={newAddress}
                      onChange={(e) => { setNewAddress(e.target.value); setAddError(''); }}
                      placeholder="Solana wallet address..."
                      className="w-full bg-secondary/60 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Label (optional)"
                        className="flex-1 bg-secondary/60 border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
                        onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                      />
                      <button
                        onClick={handleAdd}
                        className="px-3 py-2 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                      >
                        Add
                      </button>
                    </div>
                    {addError && (
                      <p className="text-[10px] text-destructive">{addError}</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Wallet list */}
            {wallets.length > 0 ? (
              <div className="space-y-1.5">
                <AnimatePresence mode="popLayout">
                  {wallets.map((w) => (
                    <WalletRow
                      key={w.address}
                      wallet={w}
                      scanning={scanningId === w.address}
                      onScan={() => handleScan(w.address)}
                      onRemove={() => removeWatchedWallet(w.address)}
                      onRename={(label) => updateWalletLabel(w.address, label)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <div className="text-center py-6">
                <Users size={20} className="mx-auto text-muted-foreground mb-2 opacity-40" />
                <p className="text-[11px] text-muted-foreground">
                  No wallets being monitored yet
                </p>
                <p className="text-[9px] text-muted-foreground mt-1">
                  Add wallet addresses to monitor their security across accounts
                </p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
