import React, { useMemo, useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletData } from '@/hooks/useWalletScan';
import { useTokenMetadata } from '@/hooks/useAssetMetadata';
import type { TokenAccount } from '@/hooks/useWalletScan';
import { PriceProvider } from '@/components/PriceContext';
import { HealthScore } from '@/components/HealthScore';
import { StatsBar } from '@/components/StatsBar';
import { PermissionScanner } from '@/components/PermissionScanner';
import { RiskEvaluation } from '@/components/RiskEvaluation';
import { PortfolioBreakdown } from '@/components/PortfolioBreakdown';
import { NftHoldings } from '@/components/NftHoldings';
import { WalletActions } from '@/components/WalletActions';
import { ActivityFeed } from '@/components/ActivityFeed';
import { initRiskStoreForWallet, clearRiskStore } from '@/lib/riskStore';
import { initSpamStoreForWallet, clearSpamStore } from '@/lib/manualSpamStore';
import { initHealthHistoryForWallet, clearHealthHistory } from '@/lib/healthHistoryStore';
import { HealthHistory } from '@/components/HealthHistory';
import { TokenRiskScoring } from '@/components/TokenRiskScoring';
import { clearTokenRiskCache } from '@/lib/tokenRiskService';
import { initChecklistForWallet, clearChecklist } from '@/lib/checklistStore';
import { BeforeYouSign } from '@/components/BeforeYouSign';
import { TransactionSimulator } from '@/components/TransactionSimulator';
import { WalletMonitor } from '@/components/WalletMonitor';
import { stopMonitoring } from '@/lib/walletMonitorService';
import { WalletManager } from '@/components/WalletManager';
import { CerberusInsights } from '@/components/CerberusInsights';
import { NuclearEvacuation } from '@/components/NuclearEvacuation';
import { TransactionVerifyAlert } from '@/components/TransactionVerifyAlert';
import { AlertHistory } from '@/components/AlertHistory';
import { useHealthScore } from '@/hooks/useHealthScore';
import { initEvacuationStore, clearEvacuationStore } from '@/lib/evacuationStore';
import { initWhitelistForWallet, clearWhitelist } from '@/lib/whitelistStore';
import { ScamChecker } from '@/components/ScamChecker';
import { TrustedAddresses } from '@/components/TrustedAddresses';
import { DeFiPositions } from '@/components/DeFiPositions';
import {
  LayoutDashboard,
  ShieldCheck,
  Wallet,
  Radio,
  AlertTriangle,
} from 'lucide-react';

export type DashboardTab = 'overview' | 'security' | 'assets' | 'monitoring' | 'emergency';

const TABS: { id: DashboardTab; label: string; icon: React.ReactNode; danger?: boolean }[] = [
  { id: 'overview', label: 'Overview', icon: <LayoutDashboard size={13} /> },
  { id: 'security', label: 'Security', icon: <ShieldCheck size={13} /> },
  { id: 'assets', label: 'Assets', icon: <Wallet size={13} /> },
  { id: 'monitoring', label: 'Monitoring', icon: <Radio size={13} /> },
  { id: 'emergency', label: 'Emergency', icon: <AlertTriangle size={13} />, danger: true },
];

export { TABS };

interface DashboardContentProps {
  activeTab?: DashboardTab;
}

export function DashboardContent({ activeTab = 'overview' }: DashboardContentProps) {
  const { publicKey } = useWallet();
  const wallet = useWalletData();

  // Hydrate persisted risk acknowledgments & manual spam flags for this wallet
  useEffect(() => {
    if (publicKey) {
      const addr = publicKey.toBase58();
      initRiskStoreForWallet(addr);
      initSpamStoreForWallet(addr);
      initHealthHistoryForWallet(addr);
      initChecklistForWallet(addr);
      initEvacuationStore(addr);
      initWhitelistForWallet(addr);
    } else {
      clearRiskStore();
      clearSpamStore();
      clearHealthHistory();
      clearTokenRiskCache();
      clearChecklist();
      clearEvacuationStore();
      clearWhitelist();
      stopMonitoring();
    }
  }, [publicKey]);

  const healthScore = useHealthScore(wallet);

  const mints = useMemo(() => wallet.tokenAccounts.map((t) => t.mint), [wallet.tokenAccounts]);
  const { metadata, dasNfts } = useTokenMetadata(mints, publicKey?.toBase58());

  // Merge DAS-discovered NFTs (compressed, pNFTs, etc.) into the token list
  const mergedTokenAccounts = useMemo(() => {
    const splMints = new Set(wallet.tokenAccounts.map((t) => t.mint));
    const extraNfts: TokenAccount[] = [];

    for (const nft of dasNfts) {
      if (splMints.has(nft.mint)) continue;
      extraNfts.push({
        mint: nft.mint,
        symbol: nft.symbol || `${nft.mint.slice(0, 4)}..${nft.mint.slice(-4)}`,
        name: nft.name,
        amount: 1,
        uiAmount: 1,
        decimals: 0,
        isNft: true,
      });
    }

    if (extraNfts.length === 0) return wallet.tokenAccounts;
    return [...wallet.tokenAccounts, ...extraNfts];
  }, [wallet.tokenAccounts, dasNfts]);

  const mergedWallet = useMemo(() => ({
    ...wallet,
    tokenAccounts: mergedTokenAccounts,
  }), [wallet, mergedTokenAccounts]);

  const allMints = useMemo(
    () => ['native', ...mergedTokenAccounts.map((t) => t.mint)],
    [mergedTokenAccounts],
  );
  const nftMints = useMemo(
    () => mergedTokenAccounts.filter((t) => t.isNft).map((t) => t.mint),
    [mergedTokenAccounts],
  );

  return (
    <PriceProvider allMints={allMints} nftMints={nftMints}>
      {/* Global alert -- always visible */}
      <TransactionVerifyAlert />

      <div className="space-y-4 mt-4">
        {activeTab === 'overview' && (
          <>
            <HealthScore wallet={mergedWallet} />
            <CerberusInsights wallet={mergedWallet} metadata={metadata} healthScore={healthScore} />
            <HealthHistory />
            <StatsBar wallet={mergedWallet} />
            <PortfolioBreakdown wallet={mergedWallet} metadata={metadata} />
          </>
        )}

        {activeTab === 'security' && (
          <>
            <RiskEvaluation wallet={mergedWallet} metadata={metadata} />
            <PermissionScanner wallet={wallet} metadata={metadata} />
            <WalletActions wallet={wallet} />
            <TransactionSimulator />
            <BeforeYouSign />
            <TokenRiskScoring wallet={mergedWallet} metadata={metadata} />
          </>
        )}

        {activeTab === 'assets' && (
          <>
            <PortfolioBreakdown wallet={mergedWallet} metadata={metadata} />
            <NftHoldings wallet={mergedWallet} metadata={metadata} />
            <DeFiPositions />
          </>
        )}

        {activeTab === 'monitoring' && (
          <>
            <WalletMonitor />
            <TrustedAddresses />
            <AlertHistory />
            <ScamChecker wallet={mergedWallet} />
            <ActivityFeed wallet={wallet} />
          </>
        )}

        {activeTab === 'emergency' && (
          <>
            <NuclearEvacuation wallet={mergedWallet} />
            <WalletManager />
          </>
        )}
      </div>
    </PriceProvider>
  );
}