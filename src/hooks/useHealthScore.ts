/**
 * useHealthScore — shared hook to compute the wallet health score.
 * Used by HealthScore component and CerberusInsights for context injection.
 */

import { useMemo, useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletData } from '@/hooks/useWalletScan';
import { getAcknowledgedCount, subscribeRisk, isAcknowledged, isDelegateSafe, getSafeDelegateCount } from '@/lib/riskStore';
import { getSpamScore } from '@/hooks/useAssetMetadata';
import { isManuallyFlagged, subscribeManualSpam } from '@/lib/manualSpamStore';
import { getAllTokenRisks, subscribeTokenRisk } from '@/lib/tokenRiskService';

export function useHealthScore(wallet: WalletData): number {
  const { connected } = useWallet();
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

  return useMemo(() => {
    if (!connected) return 0;
    let s = 70;
    const tokenCount = wallet.tokenAccounts.filter((t) => !t.isNft).length;
    s += Math.min(tokenCount * 2, 10);
    // Only penalize delegates that are NOT marked safe
    const unsafeDelegates = wallet.delegateApprovals.filter(
      (d) => !isDelegateSafe(d.mint, d.delegate)
    ).length;
    const unackedDelegates = Math.max(0, unsafeDelegates - ackCount);
    s -= unackedDelegates * 8;
    // Bonus for marking delegates safe (shows intentionality)
    s += Math.min(safeDelegateCount * 2, 10);
    s += Math.min(ackCount * 3, 15);
    s -= wallet.failedTxCount * 3;
    if (wallet.solBalance > 0.01) s += 5;
    if (wallet.emptyAccounts > 5) s -= 5;
    const spamNftCount = wallet.tokenAccounts.filter((t) => {
      if (!t.isNft) return false;
      if (isAcknowledged(`spam-${t.mint}`)) return false;
      if (isManuallyFlagged(t.mint)) return true;
      return getSpamScore(t.mint)?.isSpam;
    }).length;
    s -= Math.min(spamNftCount * 2, 15);
    s -= tokenRiskPenalty;
    return Math.max(0, Math.min(100, s));
  }, [connected, wallet, ackCount, safeDelegateCount, tokenRiskPenalty]);
}