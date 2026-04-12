import React from 'react';
import { PieChart, ExternalLink } from 'lucide-react';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { TokenIcon } from './TokenIcon';
import { usePrices } from './PriceContext';

interface PortfolioBreakdownProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

const ALLOC_COLORS = [
  'hsl(192 100% 55%)', 'hsl(330 100% 60%)', 'hsl(210 100% 60%)',
  'hsl(45 100% 50%)', 'hsl(270 80% 60%)', 'hsl(350 80% 55%)',
  'hsl(30 100% 55%)', 'hsl(160 60% 50%)',
];

export function PortfolioBreakdown({ wallet, metadata }: PortfolioBreakdownProps) {
  const { getUsdValue, formatUsd, getNftFloor, prices } = usePrices();

  void prices;

  // Build asset list including SOL
  const fungible = wallet.tokenAccounts.filter((t) => !t.isNft);
  const nfts = wallet.tokenAccounts.filter((t) => t.isNft);

  const allAssets = [
    {
      mint: 'native',
      symbol: 'SOL',
      name: 'Solana',
      uiAmount: wallet.solBalance,
      decimals: 9,
      isNft: false,
      image: '',
    },
    ...fungible.map((t) => {
      const meta = metadata.get(t.mint);
      return {
        mint: t.mint,
        symbol: (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : t.symbol,
        name: (meta?.name && !meta.name.includes('..')) ? meta.name : t.name,
        uiAmount: t.uiAmount,
        decimals: t.decimals,
        isNft: false,
        image: meta?.image || '',
      };
    }),
  ];

  const assetsWithUsd = allAssets.map((a) => ({
    ...a,
    usd: getUsdValue(a.mint, a.uiAmount),
  })).sort((a, b) => (b.usd || 0) - (a.usd || 0));

  const nftTotalUsd = nfts.reduce((sum, t) => {
    const floor = getNftFloor(t.mint);
    return sum + (floor?.floor || 0);
  }, 0);

  const totalUsd = assetsWithUsd.reduce((s, a) => s + (a.usd || 0), 0) + nftTotalUsd;

  // Allocation segments
  const segments = assetsWithUsd
    .filter((a) => a.usd && a.usd > 0 && totalUsd > 0)
    .map((a, i) => ({
      symbol: a.symbol,
      pct: ((a.usd || 0) / totalUsd) * 100,
      color: ALLOC_COLORS[i % ALLOC_COLORS.length],
    }));

  if (nftTotalUsd > 0 && totalUsd > 0) {
    segments.push({
      symbol: 'NFTs',
      pct: (nftTotalUsd / totalUsd) * 100,
      color: 'hsl(330 100% 60%)',
    });
  }

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <PieChart size={18} className="text-primary" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">PORTFOLIO</h3>
        </div>
        <span className="text-sm font-bold text-primary">{formatUsd(totalUsd)}</span>
      </div>

      {/* Allocation bar */}
      {segments.length > 0 && (
        <div className="mb-4">
          <div className="flex h-3 rounded-full overflow-hidden bg-secondary">
            {segments.map((s, i) => (
              <div
                key={i}
                className="h-full transition-all duration-500"
                style={{ width: `${s.pct}%`, background: s.color }}
                title={`${s.symbol}: ${s.pct.toFixed(1)}%`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-2">
            {segments.slice(0, 6).map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                {s.symbol} {s.pct.toFixed(1)}%
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Token list */}
      <div className="space-y-1 max-h-[350px] overflow-y-auto">
        {assetsWithUsd.map((a) => (
          <div key={a.mint} className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary/50 transition-colors">
            <TokenIcon src={a.image} symbol={a.symbol} size={30} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-bold text-xs text-foreground">{a.symbol}</span>
                {a.name && <span className="text-[10px] text-muted-foreground truncate">{a.name}</span>}
              </div>
              {a.mint !== 'native' && (
                <span className="text-[10px] font-mono text-muted-foreground">{abbr(a.mint)}</span>
              )}
            </div>
            <div className="text-right">
              <p className="text-xs font-semibold text-foreground">{a.usd !== null ? formatUsd(a.usd) : '--'}</p>
              <p className="text-[10px] text-muted-foreground">{a.uiAmount.toFixed(a.decimals > 2 ? 4 : a.decimals)}</p>
            </div>
            {a.mint !== 'native' && (
              <a href={`https://solscan.io/token/${a.mint}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink size={10} className="text-muted-foreground hover:text-primary" />
              </a>
            )}
          </div>
        ))}
      </div>

      {/* NFT section summary */}
      {nfts.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{nfts.length} NFTs</span>
            {nftTotalUsd > 0 && <span className="text-accent font-semibold">{formatUsd(nftTotalUsd)}</span>}
          </div>
        </div>
      )}
    </div>
  );
}