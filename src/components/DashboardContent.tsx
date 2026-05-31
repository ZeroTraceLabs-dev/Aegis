import React, { useMemo, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletData } from '@/hooks/useWalletScan';
import { useTokenMetadata } from '@/hooks/useAssetMetadata';
import type { TokenAccount } from '@/hooks/useWalletScan';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { PriceProvider, usePrices } from '@/components/PriceContext';
import { NftHoldings } from '@/components/NftHoldings';
import { ActivityFeed } from '@/components/ActivityFeed';
import { WalletMonitor } from '@/components/WalletMonitor';
import { stopMonitoring, getMonitorEvents, subscribeMonitor } from '@/lib/walletMonitorService';
import { NuclearEvacuation } from '@/components/NuclearEvacuation';
import { initEvacuationStore, clearEvacuationStore, getSafeWallet, subscribeEvacuation } from '@/lib/evacuationStore';
import { initWhitelistForWallet, clearWhitelist, getWhitelistCount, subscribeWhitelist } from '@/lib/whitelistStore';
import { setWalletSnapshot, type WalletSnapshot } from '@/lib/cerberusService';
import { TrustedAddresses } from '@/components/TrustedAddresses';
import { TokenIcon } from '@/components/TokenIcon';
import {
  Wallet,
  Radio,
  AlertTriangle,
} from 'lucide-react';

// Canonical Solana mark for the native SOL row. SPL token list serves the
// same logo for wrapped SOL (mint So11111...112) and it's the authoritative
// public asset. Hard-coded here only for native SOL — fallback logic in
// TokenIcon still handles arbitrary SPL tokens that genuinely lack a logo.
const SOL_LOGO_URL = 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png';

export type DashboardTab = 'wallet' | 'watch' | 'emergency';

const TABS: { id: DashboardTab; label: string; icon: React.ReactNode; danger?: boolean }[] = [
  { id: 'wallet', label: 'Wallet', icon: <Wallet size={13} /> },
  { id: 'watch', label: 'Watch', icon: <Radio size={13} /> },
  { id: 'emergency', label: 'Evacuation', icon: <AlertTriangle size={13} />, danger: true },
];

export { TABS };

interface DashboardContentProps {
  activeTab?: DashboardTab;
}

export function DashboardContent({ activeTab = 'wallet' }: DashboardContentProps) {
  const { publicKey } = useWallet();
  const wallet = useWalletData();

  useEffect(() => {
    if (publicKey) {
      const addr = publicKey.toBase58();
      initEvacuationStore(addr);
      initWhitelistForWallet(addr);
    } else {
      clearEvacuationStore();
      clearWhitelist();
      stopMonitoring();
      setWalletSnapshot(null);
    }
  }, [publicKey]);

  // ── Cerberus wallet snapshot wiring ─────────────────────────────
  // Builds a live snapshot of the connected wallet and pushes it to
  // cerberusService so the chat edge function has real on-chain context.
  // Re-runs whenever the scanned wallet data changes; also subscribes to the
  // live monitor, whitelist, and evacuation stores so recentEvents /
  // whitelistedAddressCount / hasEvacuationAddress stay current.
  useEffect(() => {
    if (!publicKey) {
      setWalletSnapshot(null);
      return;
    }

    const addr = publicKey.toBase58();

    const push = () => {
      const fungibles = wallet.tokenAccounts.filter((t) => !t.isNft && t.uiAmount > 0);
      const nftCount = wallet.tokenAccounts.filter((t) => t.isNft).length;
      const recent = getMonitorEvents().slice(0, 10).map((e) => ({
        category: e.category,
        severity: e.severity,
        title: e.title,
      }));

      const snapshot: WalletSnapshot = {
        walletAddress: addr,
        solBalance: wallet.solBalance,
        tokenCount: fungibles.length,
        nftCount,
        delegateApprovals: wallet.delegateApprovals.map((d) => ({
          mint: d.mint,
          symbol: d.mintSymbol,
          delegate: d.delegate,
          usdValue: 0, // pricing not joined into snapshot; left at 0 until/unless we wire prices in
        })),
        failedTxCount: wallet.failedTxCount,
        emptyAccounts: wallet.emptyAccounts,
        recentEvents: recent,
        hasEvacuationAddress: !!getSafeWallet(),
        whitelistedAddressCount: getWhitelistCount(),
      };
      setWalletSnapshot(snapshot);
    };

    push();
    const unsubMonitor = subscribeMonitor(push);
    const unsubWhitelist = subscribeWhitelist(push);
    const unsubEvacuation = subscribeEvacuation(push);

    return () => {
      unsubMonitor();
      unsubWhitelist();
      unsubEvacuation();
    };
  }, [
    publicKey,
    wallet.solBalance,
    wallet.tokenAccounts,
    wallet.delegateApprovals,
    wallet.failedTxCount,
    wallet.emptyAccounts,
  ]);

  const mints = useMemo(() => wallet.tokenAccounts.map((t) => t.mint), [wallet.tokenAccounts]);
  const { metadata, dasNfts } = useTokenMetadata(mints, publicKey?.toBase58());

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
      <div className="space-y-4 mt-4">
        {activeTab === 'wallet' && (
          <>
            <TokenList wallet={mergedWallet} metadata={metadata} />
            <NftHoldings wallet={mergedWallet} metadata={metadata} />
          </>
        )}

        {activeTab === 'watch' && (
          <>
            <WalletMonitor />
            <TrustedAddresses />
            <ActivityFeed wallet={wallet} />
          </>
        )}

        {activeTab === 'emergency' && (
          <>
            <NuclearEvacuation wallet={mergedWallet} />
          </>
        )}
      </div>
    </PriceProvider>
  );
}

interface TokenListProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

function TokenList({ wallet, metadata }: TokenListProps) {
  const { getUsdValue, formatUsd, getSolPrice } = usePrices();

  const fungibles = useMemo(
    () => wallet.tokenAccounts.filter((t) => !t.isNft && t.uiAmount > 0),
    [wallet.tokenAccounts],
  );

  const enriched = useMemo(() => {
    const rows = fungibles.map((t) => {
      const meta = metadata.get(t.mint);
      const symbol = (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : (t.symbol || `${t.mint.slice(0, 4)}..${t.mint.slice(-4)}`);
      const name = meta?.name || t.name || symbol;
      const image = meta?.image || '';
      const usd = getUsdValue(t.mint, t.uiAmount) ?? 0;
      return { mint: t.mint, symbol, name, image, uiAmount: t.uiAmount, usd };
    });
    rows.sort((a, b) => b.usd - a.usd);
    return rows;
  }, [fungibles, metadata, getUsdValue]);

  const solUsd = wallet.solBalance * getSolPrice();
  const totalUsd = enriched.reduce((s, r) => s + r.usd, 0) + solUsd;

  if (wallet.solBalance === 0 && enriched.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-header text-sm font-semibold text-foreground uppercase tracking-wider">Tokens</h3>
        {totalUsd > 0 && (
          <span className="text-xs font-bold text-foreground">{formatUsd(totalUsd)}</span>
        )}
      </div>

      <div className="space-y-1.5">
        {wallet.solBalance > 0 && (
          <div className="flex items-center gap-3 p-2.5 rounded-md hover:bg-secondary/50 transition-colors">
            <TokenIcon src={SOL_LOGO_URL} symbol="SOL" size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground">SOL</p>
              <p className="text-[10px] text-muted-foreground">Solana</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-foreground">{wallet.solBalance.toFixed(4)}</p>
              {solUsd > 0 && <p className="text-[10px] text-muted-foreground">{formatUsd(solUsd)}</p>}
            </div>
          </div>
        )}

        {enriched.map((row) => (
          <a
            key={row.mint}
            href={`https://solscan.io/token/${row.mint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 p-2.5 rounded-md hover:bg-secondary/50 transition-colors"
          >
            <TokenIcon src={row.image} symbol={row.symbol} size={32} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground truncate">{row.symbol}</p>
              <p className="text-[10px] text-muted-foreground truncate">{row.name}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-foreground">
                {row.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })}
              </p>
              {row.usd > 0 && <p className="text-[10px] text-muted-foreground">{formatUsd(row.usd)}</p>}
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
