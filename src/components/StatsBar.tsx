import React from 'react';
import { Coins, Image, Activity, Wallet } from 'lucide-react';
import type { WalletData } from '@/hooks/useWalletScan';

interface StatsBarProps {
  wallet: WalletData;
}

export function StatsBar({ wallet }: StatsBarProps) {
  const nftCount = wallet.tokenAccounts.filter((t) => t.isNft).length;
  const tokenCount = wallet.tokenAccounts.filter((t) => !t.isNft).length;

  const stats = [
    { label: 'SOL', value: wallet.solBalance.toFixed(4), icon: Wallet },
    { label: 'TOKENS', value: String(tokenCount), icon: Coins },
    { label: 'NFTS', value: String(nftCount), icon: Image },
    { label: 'RECENT TX', value: String(wallet.signatures.length), icon: Activity },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {stats.map((s) => (
        <div
          key={s.label}
          className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 card-glow"
        >
          <s.icon size={18} className="text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className="text-sm font-bold text-foreground truncate">{s.value}</p>
          </div>
        </div>
      ))}
    </div>
  );
}