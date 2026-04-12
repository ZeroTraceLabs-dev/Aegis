import React, { useMemo, useEffect, useState, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useWalletData } from '@/hooks/useWalletScan';
import { usePrices } from './PriceContext';
import { getAcknowledgedCount, subscribeRisk, isAcknowledged, isDelegateSafe, getSafeDelegateCount } from '@/lib/riskStore';
import { getSpamScore } from '@/hooks/useAssetMetadata';
import { isManuallyFlagged, subscribeManualSpam } from '@/lib/manualSpamStore';
import { recordSnapshot } from '@/lib/healthHistoryStore';
import { notifyHealthDrop } from '@/lib/notificationService';
import { getAllTokenRisks, subscribeTokenRisk } from '@/lib/tokenRiskService';

const LOGO_URL = 'https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg';

interface HealthScoreProps {
  wallet: ReturnType<typeof useWalletData>;
}

export function HealthScore({ wallet }: HealthScoreProps) {
  const { connected } = useWallet();
  const { getUsdValue, getNftFloor, formatUsd, prices } = usePrices();
  const [ackCount, setAckCount] = useState(getAcknowledgedCount());
  const [safeDelegateCount, setSafeDelegateCount] = useState(getSafeDelegateCount());
  const [tokenRiskPenalty, setTokenRiskPenalty] = useState(0);

  useEffect(() => {
    const unsub1 = subscribeRisk(() => {
      setAckCount(getAcknowledgedCount());
      setSafeDelegateCount(getSafeDelegateCount());
    });
    const unsub2 = subscribeManualSpam(() => setAckCount(getAcknowledgedCount()));
    const unsub3 = subscribeTokenRisk(() => {
      const risks = getAllTokenRisks();
      let penalty = 0;
      for (const [, r] of risks) {
        if (r.grade === 'F') penalty += 5;
        else if (r.grade === 'D') penalty += 3;
        else if (r.grade === 'C') penalty += 1;
      }
      setTokenRiskPenalty(Math.min(penalty, 20));
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const totalPortfolioUsd = useMemo(() => {
    let total = getUsdValue('native', wallet.solBalance) || 0;
    for (const t of wallet.tokenAccounts) {
      const v = getUsdValue(t.mint, t.uiAmount);
      if (v) total += v;
      else if (t.isNft) {
        const floor = getNftFloor(t.mint);
        if (floor) total += floor.floor;
      }
    }
    return total;
  }, [wallet.solBalance, wallet.tokenAccounts, getUsdValue, getNftFloor, prices]);

  const totalAtRisk = useMemo(() => {
    let risk = 0;
    for (const a of wallet.delegateApprovals) {
      if (isDelegateSafe(a.mint, a.delegate)) continue;
      const v = getUsdValue(a.mint, a.amount);
      if (v) risk += v;
      else {
        const floor = getNftFloor(a.mint);
        if (floor) risk += floor.floor;
      }
    }
    return risk;
  }, [wallet.delegateApprovals, getUsdValue, getNftFloor, prices, safeDelegateCount]);

  // Count total risks across all categories
  const totalRisks = useMemo(() => {
    let count = 0;
    // Delegate risks (only unsafe ones)
    count += wallet.delegateApprovals.filter((d) => !isDelegateSafe(d.mint, d.delegate)).length;
    // Dust tokens
    count += wallet.tokenAccounts.filter((t) => !t.isNft && t.uiAmount > 0 && t.uiAmount < 0.001).length;
    // Failed transactions
    count += wallet.failedTxCount;
    // Zero-decimal oddities
    count += wallet.tokenAccounts.filter((t) => t.decimals === 0 && !t.isNft).length;
    // Spam NFTs (excluding acknowledged, plus manually flagged)
    count += wallet.tokenAccounts.filter((t) => {
      if (!t.isNft) return false;
      if (isAcknowledged(`spam-${t.mint}`)) return false;
      if (isManuallyFlagged(t.mint)) return true;
      return getSpamScore(t.mint)?.isSpam;
    }).length;
    return count;
  }, [wallet]);

  const score = useMemo(() => {
    if (!connected) return 0;
    let s = 70;
    const tokenCount = wallet.tokenAccounts.filter((t) => !t.isNft).length;
    s += Math.min(tokenCount * 2, 10);
    // Only penalize delegates NOT marked safe
    const unsafeDelegates = wallet.delegateApprovals.filter(
      (d) => !isDelegateSafe(d.mint, d.delegate)
    ).length;
    const unackedDelegates = Math.max(0, unsafeDelegates - ackCount);
    s -= unackedDelegates * 8;
    // Bonus for safe-marked delegates
    s += Math.min(safeDelegateCount * 2, 10);
    // Acknowledged risks boost score
    s += Math.min(ackCount * 3, 15);
    // Failed tx penalty
    s -= wallet.failedTxCount * 3;
    // Has SOL bonus
    if (wallet.solBalance > 0.01) s += 5;
    // Empty accounts penalty
    if (wallet.emptyAccounts > 5) s -= 5;
    // Spam NFT penalty (excluding acknowledged, plus manually flagged)
    const spamNftCount = wallet.tokenAccounts.filter((t) => {
      if (!t.isNft) return false;
      if (isAcknowledged(`spam-${t.mint}`)) return false;
      if (isManuallyFlagged(t.mint)) return true;
      return getSpamScore(t.mint)?.isSpam;
    }).length;
    s -= Math.min(spamNftCount * 2, 15);
    // Token rug-pull risk penalty
    s -= tokenRiskPenalty;
    return Math.max(0, Math.min(100, s));
  }, [connected, wallet, ackCount, safeDelegateCount, tokenRiskPenalty]);

  // Track previous score for drop notifications
  const prevScoreRef = useRef<number | null>(null);

  // Record snapshot whenever score stabilises + fire health drop alerts
  useEffect(() => {
    if (connected && !wallet.loading && score > 0) {
      recordSnapshot(score, totalRisks, ackCount);
      if (prevScoreRef.current !== null && prevScoreRef.current > score) {
        notifyHealthDrop(prevScoreRef.current, score);
      }
      prevScoreRef.current = score;
    }
  }, [connected, wallet.loading, score, totalRisks, ackCount]);

  const scoreColor = score >= 70 ? 'text-safe' : score >= 40 ? 'text-yellow-400' : 'text-destructive';
  const ringColor = score >= 70 ? 'stroke-safe' : score >= 40 ? 'stroke-yellow-400' : 'stroke-destructive';

  if (!connected) {
    return (
      <div className="bg-card border border-border rounded-lg p-8 card-glow text-center">
        <img src={LOGO_URL} alt="Aegis" className="mx-auto mb-4 w-16 h-16 rounded-full object-cover" />
        <Shield className="mx-auto mb-3 text-muted-foreground" size={40} />
        <p className="text-muted-foreground text-sm">Connect your wallet to begin security scan</p>
      </div>
    );
  }

  if (wallet.loading) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 card-glow">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-primary text-sm">{wallet.loadingPhase || 'Scanning...'}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-6 card-glow"
    >
      {/* Risk banner */}
      {wallet.delegateApprovals.length > 0 ? (() => {
        const unsafeD = wallet.delegateApprovals.filter(d => !isDelegateSafe(d.mint, d.delegate));
        const safeD = wallet.delegateApprovals.length - unsafeD.length;
        const allMarkedSafe = unsafeD.length === 0;
        return allMarkedSafe ? (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-safe/10 border border-safe/30">
            <CheckCircle size={16} className="text-safe" />
            <span className="text-safe text-xs font-medium">
              {safeD} DELEGATE{safeD > 1 ? 'S' : ''} VERIFIED SAFE
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30">
            <AlertTriangle size={16} className="text-destructive" />
            <span className="text-destructive text-xs font-medium">
              {unsafeD.length} UNREVIEWED DELEGATE{unsafeD.length > 1 ? 'S' : ''}
              {safeD > 0 && <span className="text-safe ml-1">({safeD} safe)</span>}
              {totalAtRisk > 0 && ` -- ${formatUsd(totalAtRisk)} AT RISK`}
            </span>
          </div>
        );
      })() : wallet.scanTimestamp ? (
        <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-md bg-safe/10 border border-safe/30">
          <CheckCircle size={16} className="text-safe" />
          <span className="text-safe text-xs font-medium">NO OPEN DELEGATES -- WALLET CLEAN</span>
        </div>
      ) : null}

      <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-6">
        {/* Circular gauge */}
        <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" strokeWidth="6" className="stroke-secondary" />
            <circle
              cx="50" cy="50" r="42" fill="none" strokeWidth="6"
              strokeDasharray={`${score * 2.64} ${264 - score * 2.64}`}
              strokeLinecap="round"
              className={`${ringColor} transition-all duration-1000`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-2xl font-bold ${scoreColor}`}>{score}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">HEALTH</span>
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 w-full grid grid-cols-2 gap-2 sm:gap-3">
          <div className="bg-secondary/50 rounded-md p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">PORTFOLIO</p>
            <p className="text-sm font-semibold text-foreground">{formatUsd(totalPortfolioUsd)}</p>
          </div>
          <div className="bg-secondary/50 rounded-md p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">AT RISK</p>
            <p className={`text-sm font-semibold ${totalAtRisk > 0 ? 'text-destructive' : 'text-safe'}`}>
              {formatUsd(totalAtRisk)}
            </p>
          </div>
          <div className="bg-secondary/50 rounded-md p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">ASSETS</p>
            <p className="text-sm font-semibold text-foreground">{wallet.tokenAccounts.length}</p>
          </div>
          <div className="bg-secondary/50 rounded-md p-3">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">RISKS ACKNOWLEDGED</p>
            <p className={`text-sm font-semibold ${ackCount > 0 ? 'text-safe' : 'text-muted-foreground'}`}>
              {ackCount}/{totalRisks}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}