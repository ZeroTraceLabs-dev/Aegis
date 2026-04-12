import React from 'react';
import { Activity, CheckCircle, XCircle, ExternalLink } from 'lucide-react';
import type { WalletData } from '@/hooks/useWalletScan';

interface ActivityFeedProps {
  wallet: WalletData;
}

export function ActivityFeed({ wallet }: ActivityFeedProps) {
  if (wallet.signatures.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <div className="flex items-center gap-2 mb-4">
        <Activity size={18} className="text-primary" />
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">RECENT ACTIVITY</h3>
        <span className="text-xs text-muted-foreground">({wallet.signatures.length})</span>
      </div>

      <div className="space-y-1.5">
        {wallet.signatures.map((sig) => (
          <div
            key={sig.signature}
            className={`flex items-center gap-3 p-2 rounded-md ${
              sig.err ? 'bg-destructive/5 border border-destructive/20' : 'hover:bg-secondary/50'
            } transition-colors`}
          >
            {sig.err ? (
              <XCircle size={14} className="text-destructive shrink-0" />
            ) : (
              <CheckCircle size={14} className="text-safe shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[10px] text-foreground truncate">{sig.signature}</p>
              {sig.blockTime && (
                <p className="text-[10px] text-muted-foreground">
                  {new Date(sig.blockTime * 1000).toLocaleString()}
                </p>
              )}
              {sig.memo && <p className="text-[10px] text-muted-foreground truncate">Memo: {sig.memo}</p>}
            </div>
            <a
              href={`https://solscan.io/tx/${sig.signature}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <ExternalLink size={12} className="text-muted-foreground hover:text-primary transition-colors" />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}