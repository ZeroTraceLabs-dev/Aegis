import React, { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { ShieldAlert, ShieldCheck, Lock, Unlock, ChevronDown, ExternalLink, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { TokenIcon } from './TokenIcon';
import {
  analyzeTokenRisks,
  getTokenRisk,
  subscribeTokenRisk,
  type TokenRiskResult,
  type RiskGrade,
} from '@/lib/tokenRiskService';

interface TokenRiskScoringProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

function gradeColor(grade: RiskGrade): string {
  switch (grade) {
    case 'A': return 'text-safe';
    case 'B': return 'text-cyan-400';
    case 'C': return 'text-yellow-400';
    case 'D': return 'text-orange-400';
    case 'F': return 'text-destructive';
  }
}

function gradeBg(grade: RiskGrade): string {
  switch (grade) {
    case 'A': return 'bg-safe/10 border-safe/30';
    case 'B': return 'bg-cyan-400/10 border-cyan-400/30';
    case 'C': return 'bg-yellow-400/10 border-yellow-400/30';
    case 'D': return 'bg-orange-400/10 border-orange-400/30';
    case 'F': return 'bg-destructive/10 border-destructive/30';
  }
}

function gradeLabel(grade: RiskGrade): string {
  switch (grade) {
    case 'A': return 'Safe';
    case 'B': return 'Low Risk';
    case 'C': return 'Medium';
    case 'D': return 'High Risk';
    case 'F': return 'Critical';
  }
}

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function TokenRiskRow({ mint, meta, result }: { mint: string; meta?: TokenMeta; result?: TokenRiskResult }) {
  const [expanded, setExpanded] = useState(false);

  if (!result) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-md bg-secondary/30">
        <TokenIcon src={meta?.image} symbol={meta?.symbol || abbr(mint)} size={28} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-foreground">{meta?.symbol || abbr(mint)}</span>
        </div>
        <div className="w-4 h-4 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { grade, flags, hasMintAuthority, hasFreezeAuthority } = result;

  return (
    <div className="rounded-md border border-border overflow-hidden transition-colors hover:border-border/80">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <TokenIcon src={meta?.image} symbol={meta?.symbol || abbr(mint)} size={28} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">{meta?.symbol || abbr(mint)}</span>
            {meta?.name && <span className="text-[10px] text-muted-foreground truncate">{meta.name}</span>}
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">{abbr(mint)}</span>
        </div>

        {/* Authority icons */}
        <div className="flex items-center gap-1.5">
          <div className={`flex items-center gap-0.5 text-[9px] font-semibold ${hasMintAuthority ? 'text-destructive' : 'text-safe'}`} title={hasMintAuthority ? 'Mint authority active' : 'Mint authority revoked'}>
            {hasMintAuthority ? <Unlock size={10} /> : <Lock size={10} />}
            <span className="hidden sm:inline">Mint</span>
          </div>
          <div className={`flex items-center gap-0.5 text-[9px] font-semibold ${hasFreezeAuthority ? 'text-destructive' : 'text-safe'}`} title={hasFreezeAuthority ? 'Freeze authority active' : 'Freeze authority revoked'}>
            {hasFreezeAuthority ? <Unlock size={10} /> : <Lock size={10} />}
            <span className="hidden sm:inline">Freeze</span>
          </div>
        </div>

        {/* Grade badge */}
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold border ${gradeBg(grade)} ${gradeColor(grade)}`}>
          {grade}
        </div>

        <ChevronDown
          size={14}
          className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
              {/* Grade detail */}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${gradeColor(grade)}`}>
                  Grade {grade} — {gradeLabel(grade)}
                </span>
                <span className="text-[10px] text-muted-foreground">(Score: {result.score}/100)</span>
              </div>

              {/* Authority details */}
              <div className="grid grid-cols-2 gap-2">
                <div className={`p-2 rounded text-[10px] ${hasMintAuthority ? 'bg-destructive/10 text-destructive' : 'bg-safe/10 text-safe'}`}>
                  <div className="flex items-center gap-1 font-bold mb-0.5">
                    {hasMintAuthority ? <Unlock size={10} /> : <Lock size={10} />}
                    Mint Authority
                  </div>
                  {hasMintAuthority ? 'ACTIVE — supply can be inflated' : 'Revoked — supply is fixed'}
                </div>
                <div className={`p-2 rounded text-[10px] ${hasFreezeAuthority ? 'bg-destructive/10 text-destructive' : 'bg-safe/10 text-safe'}`}>
                  <div className="flex items-center gap-1 font-bold mb-0.5">
                    {hasFreezeAuthority ? <Unlock size={10} /> : <Lock size={10} />}
                    Freeze Authority
                  </div>
                  {hasFreezeAuthority ? 'ACTIVE — tokens can be frozen' : 'Revoked — tokens cannot be frozen'}
                </div>
              </div>

              {/* Flags */}
              {flags.length > 0 && (
                <div className="space-y-1">
                  {flags.map((f, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
                      <AlertTriangle size={10} className="text-yellow-400 mt-0.5 shrink-0" />
                      {f}
                    </div>
                  ))}
                </div>
              )}

              {/* Link */}
              <a
                href={`https://solscan.io/token/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
              >
                View on Solscan <ExternalLink size={9} />
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function TokenRiskScoring({ wallet, metadata }: TokenRiskScoringProps) {
  const { connected } = useWallet();
  const [, setTick] = useState(0);

  // Subscribe to risk cache updates
  useEffect(() => {
    const unsub = subscribeTokenRisk(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  // Get fungible token mints
  const fungibleMints = useMemo(
    () => wallet.tokenAccounts
      .filter((t) => !t.isNft && t.uiAmount > 0)
      .map((t) => t.mint),
    [wallet.tokenAccounts],
  );

  // Trigger analysis when mints change
  useEffect(() => {
    if (fungibleMints.length > 0) {
      analyzeTokenRisks(fungibleMints);
    }
  }, [fungibleMints]);

  // Collect results
  const results = useMemo(
    () => fungibleMints.map((m) => ({ mint: m, result: getTokenRisk(m) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fungibleMints, /* re-run when tick changes */],
  );

  // Summary stats
  const analyzed = results.filter((r) => r.result);
  const gradeDistribution = useMemo(() => {
    const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    for (const r of analyzed) {
      if (r.result) dist[r.result.grade]++;
    }
    return dist;
  }, [analyzed]);

  const riskyCount = gradeDistribution.D + gradeDistribution.F;
  const safeCount = gradeDistribution.A + gradeDistribution.B;

  if (!connected || wallet.loading) return null;
  if (fungibleMints.length === 0) return null;

  // Sort: worst grades first
  const gradeOrder: Record<RiskGrade, number> = { F: 0, D: 1, C: 2, B: 3, A: 4 };
  const sorted = [...results].sort((a, b) => {
    const ga = a.result?.grade ?? 'C';
    const gb = b.result?.grade ?? 'C';
    return gradeOrder[ga] - gradeOrder[gb];
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Token Rug-Pull Risk
          </h3>
          <span className="text-[10px] text-muted-foreground">
            ({analyzed.length}/{fungibleMints.length} analyzed)
          </span>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {safeCount > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-safe/10 border border-safe/20">
            <ShieldCheck size={12} className="text-safe" />
            <span className="text-[10px] font-bold text-safe">{safeCount} Safe</span>
          </div>
        )}
        {gradeDistribution.C > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-yellow-400/10 border border-yellow-400/20">
            <AlertTriangle size={12} className="text-yellow-400" />
            <span className="text-[10px] font-bold text-yellow-400">{gradeDistribution.C} Medium</span>
          </div>
        )}
        {riskyCount > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-destructive/10 border border-destructive/20">
            <ShieldAlert size={12} className="text-destructive" />
            <span className="text-[10px] font-bold text-destructive">{riskyCount} High Risk</span>
          </div>
        )}

        {/* Grade distribution mini bar */}
        {analyzed.length > 0 && (
          <div className="flex-1 flex h-2 rounded-full overflow-hidden bg-secondary ml-auto min-w-[80px]">
            {gradeDistribution.A > 0 && (
              <div className="h-full bg-safe" style={{ width: `${(gradeDistribution.A / analyzed.length) * 100}%` }} />
            )}
            {gradeDistribution.B > 0 && (
              <div className="h-full bg-cyan-400" style={{ width: `${(gradeDistribution.B / analyzed.length) * 100}%` }} />
            )}
            {gradeDistribution.C > 0 && (
              <div className="h-full bg-yellow-400" style={{ width: `${(gradeDistribution.C / analyzed.length) * 100}%` }} />
            )}
            {gradeDistribution.D > 0 && (
              <div className="h-full bg-orange-400" style={{ width: `${(gradeDistribution.D / analyzed.length) * 100}%` }} />
            )}
            {gradeDistribution.F > 0 && (
              <div className="h-full bg-destructive" style={{ width: `${(gradeDistribution.F / analyzed.length) * 100}%` }} />
            )}
          </div>
        )}
      </div>

      {/* Token list */}
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {sorted.map(({ mint, result }) => (
          <TokenRiskRow
            key={mint}
            mint={mint}
            meta={metadata.get(mint)}
            result={result}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 mt-3 pt-3 border-t border-border">
        {(['A', 'B', 'C', 'D', 'F'] as RiskGrade[]).map((g) => (
          <div key={g} className="flex items-center gap-1 text-[9px] text-muted-foreground">
            <span className={`w-3 text-center font-bold ${gradeColor(g)}`}>{g}</span>
            <span>{gradeLabel(g)}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
