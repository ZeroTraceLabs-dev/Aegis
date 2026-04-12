import React, { useEffect, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Layers,
  RefreshCw,
  Loader2,
  Shield,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  Landmark,
  Droplets,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  scanDeFiPositions,
  type DeFiPosition,
  type PositionType,
} from '@/lib/defiPositionService';

function typeIcon(type: PositionType) {
  switch (type) {
    case 'staking': return <Landmark size={12} />;
    case 'liquid-staking': return <Droplets size={12} />;
    case 'lp': return <Layers size={12} />;
    case 'lending': return <TrendingUp size={12} />;
    case 'borrowing': return <AlertTriangle size={12} />;
    default: return <Wallet size={12} />;
  }
}

function typeLabel(type: PositionType): string {
  switch (type) {
    case 'staking': return 'Staking';
    case 'liquid-staking': return 'Liquid Staking';
    case 'lp': return 'Liquidity';
    case 'lending': return 'Lending';
    case 'borrowing': return 'Borrowing';
    default: return 'Other';
  }
}

function riskColor(risk: string): string {
  switch (risk) {
    case 'low': return 'text-safe';
    case 'medium': return 'text-yellow-400';
    case 'high': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}

function riskBg(risk: string): string {
  switch (risk) {
    case 'low': return 'bg-safe/10 border-safe/20';
    case 'medium': return 'bg-yellow-400/10 border-yellow-400/20';
    case 'high': return 'bg-destructive/10 border-destructive/20';
    default: return 'bg-secondary border-border';
  }
}

function PositionRow({ position }: { position: DeFiPosition }) {
  return (
    <div className={`flex items-start gap-3 p-3 rounded-md border ${riskBg(position.risk)}`}>
      <div className={`mt-0.5 shrink-0 ${riskColor(position.risk)}`}>
        {typeIcon(position.type)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className="text-[11px] font-bold text-foreground">{position.protocol}</span>
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
            {typeLabel(position.type)}
          </span>
          <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${
            position.risk === 'low' ? 'bg-safe/10 border-safe/20 text-safe' :
            position.risk === 'medium' ? 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400' :
            'bg-destructive/10 border-destructive/20 text-destructive'
          }`}>
            {position.risk} risk
          </span>
        </div>

        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-foreground font-semibold">
            {position.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {position.symbol}
          </span>
          {position.estimatedValueSol !== undefined && (
            <span className="text-muted-foreground">
              ~{position.estimatedValueSol.toFixed(3)} SOL
            </span>
          )}
        </div>

        <p className="text-[9px] text-muted-foreground mt-0.5 leading-relaxed">
          {position.riskNote}
        </p>
      </div>

      {position.mint && (
        <a
          href={`https://solscan.io/account/${position.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-primary shrink-0 mt-0.5"
        >
          <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}

export function DeFiPositions() {
  const { publicKey, connected } = useWallet();
  const [positions, setPositions] = useState<DeFiPosition[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const scan = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const result = await scanDeFiPositions(publicKey.toBase58());
      setPositions(result);
      setScanned(true);
    } catch (err) {
      console.warn('[DeFiPositions] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  // Auto-scan on connect
  useEffect(() => {
    if (connected && publicKey) {
      scan();
    } else {
      setPositions([]);
      setScanned(false);
    }
  }, [connected, publicKey, scan]);

  if (!connected) return null;

  const totalEstSol = positions.reduce((sum, p) => sum + (p.estimatedValueSol || 0), 0);
  const highRiskCount = positions.filter((p) => p.risk === 'high').length;

  // Group by type
  const grouped = positions.reduce((acc, p) => {
    const key = p.type;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {} as Record<string, DeFiPosition[]>);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <Layers size={16} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            DeFi Positions
          </h3>
          {loading && <Loader2 size={12} className="animate-spin text-primary" />}
          {scanned && !loading && (
            <span className="text-[10px] text-muted-foreground">
              {positions.length} position{positions.length !== 1 ? 's' : ''}
            </span>
          )}
          {highRiskCount > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/20">
              <AlertTriangle size={9} />
              {highRiskCount} high risk
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {scanned && totalEstSol > 0 && (
            <span className="text-[10px] font-semibold text-foreground">
              ~{totalEstSol.toFixed(2)} SOL
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); scan(); }}
            disabled={loading}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </button>
          <ChevronDown size={12} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4">
              {positions.length > 0 ? (
                <div className="space-y-3">
                  {Object.entries(grouped).map(([type, posns]) => (
                    <div key={type}>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5 block px-1">
                        {typeLabel(type as PositionType)} ({posns.length})
                      </span>
                      <div className="space-y-1.5">
                        {posns.map((p) => (
                          <PositionRow key={p.id} position={p} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : scanned ? (
                <div className="text-center py-6">
                  <Layers size={20} className="mx-auto text-muted-foreground mb-2 opacity-40" />
                  <p className="text-[11px] text-muted-foreground">No DeFi positions detected</p>
                  <p className="text-[9px] text-muted-foreground mt-1">
                    Staking, LP, and lending positions will appear here when found
                  </p>
                </div>
              ) : (
                <div className="text-center py-6">
                  <Loader2 size={16} className="mx-auto text-primary animate-spin mb-2" />
                  <p className="text-[10px] text-muted-foreground">Scanning for DeFi positions...</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
