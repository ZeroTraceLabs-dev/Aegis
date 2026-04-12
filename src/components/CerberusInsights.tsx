/**
 * CerberusInsights — Proactive AI security briefing widget
 *
 * Three-tier loading strategy for instant perceived performance:
 *   1. Instant local briefing from wallet snapshot data (<50ms)
 *   2. Cached AI briefing from localStorage (0ms on revisit)
 *   3. Fresh AI streaming briefing from cerberus-core edge function
 *
 * Edge function is pre-warmed on mount so cold start is absorbed before user clicks.
 */

import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, ChevronDown, ChevronUp, RefreshCw, AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import cerberusAvatar from '@/assets/cerberus-avatar.jpg';
import {
  fetchCerberusBriefing,
  setWalletSnapshot,
  type CerberusBriefing,
  type BriefingAction,
  type WalletSnapshot,
} from '@/lib/cerberusService';
import { usePrices } from './PriceContext';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { getSpamScore } from '@/hooks/useAssetMetadata';
import { isManuallyFlagged } from '@/lib/manualSpamStore';
import { getAllTokenRisks } from '@/lib/tokenRiskService';
import { getMonitorEvents } from '@/lib/walletMonitorService';
import { getSafeDelegateCount } from '@/lib/riskStore';
import { getSafeWallet } from '@/lib/evacuationStore';
import { getWhitelistCount } from '@/lib/whitelistStore';

interface CerberusInsightsProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
  healthScore: number;
}

const SEVERITY_CONFIG: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  CRITICAL: { icon: <XCircle size={14} />, color: 'text-destructive', bg: 'bg-destructive/10 border-destructive/30' },
  HIGH: { icon: <AlertTriangle size={14} />, color: 'text-accent', bg: 'bg-accent/10 border-accent/30' },
  MED: { icon: <AlertTriangle size={14} />, color: 'text-warning', bg: 'bg-warning/10 border-warning/30' },
  LOW: { icon: <Info size={14} />, color: 'text-primary', bg: 'bg-primary/10 border-primary/30' },
  INFO: { icon: <CheckCircle size={14} />, color: 'text-safe', bg: 'bg-safe/10 border-safe/30' },
};

/** Renders markdown-ish text to basic HTML */
function renderBriefingMarkdown(text: string): string {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground">$1</strong>');
  html = html.replace(/`([^`]+)`/g, '<code class="text-primary bg-background/60 px-1 rounded text-[10px]">$1</code>');
  html = html.replace(/\n/g, '<br />');
  return html;
}

// ── localStorage briefing cache ─────────────────────────────
const CACHE_KEY = 'cerberus_briefing_cache';
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCachedBriefing(wallet: string): CerberusBriefing | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed.wallet !== wallet) return null;
    if (Date.now() - parsed.ts > CACHE_TTL) return null;
    return parsed.briefing as CerberusBriefing;
  } catch { return null; }
}

function setCachedBriefing(wallet: string, briefing: CerberusBriefing) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ wallet, briefing, ts: Date.now() }));
  } catch { /* quota */ }
}

// ── Instant local briefing from snapshot data ───────────────
function generateInstantBriefing(snap: WalletSnapshot): CerberusBriefing {
  const findings: string[] = [];
  const actions: BriefingAction[] = [];
  let severity: 'INFO' | 'LOW' | 'MED' | 'HIGH' | 'CRITICAL' = 'INFO';

  // Health score assessment
  if (snap.healthScore < 40) {
    severity = 'HIGH';
    findings.push(`Health score is **${snap.healthScore}/100** — in the danger zone`);
  } else if (snap.healthScore < 70) {
    severity = 'MED';
    findings.push(`Health score is **${snap.healthScore}/100** — needs attention`);
  } else {
    findings.push(`Health score is **${snap.healthScore}/100** — looking solid`);
  }

  // SOL balance
  findings.push(`SOL balance: **${snap.solBalance.toFixed(4)} SOL**`);

  // Delegates
  const unsafeDelegates = snap.delegateApprovals.length - (snap.safeDelegateCount || 0);
  const highValueDelegates = snap.delegateApprovals.filter(d => d.usdValue > 10);
  if (highValueDelegates.length > 0) {
    if (severity === 'INFO' || severity === 'LOW') severity = 'MED';
    findings.push(`**${highValueDelegates.length}** delegate approval(s) with real USD value at risk`);
    actions.push({ priority: 1, action: 'Review delegate approvals with USD value — revoke any you don\'t recognize', reason: '', severity: 'MED' });
  } else if (unsafeDelegates > 0) {
    findings.push(`${unsafeDelegates} unreviewed delegate approval(s) — likely NFT staking`);
  }
  if ((snap.safeDelegateCount || 0) > 0) {
    findings.push(`${snap.safeDelegateCount} delegate(s) verified safe`);
  }

  // Risky tokens
  const criticalTokens = snap.riskyTokens.filter(t => t.grade === 'F' || t.grade === 'D');
  if (criticalTokens.length > 0) {
    if (severity === 'INFO') severity = 'LOW';
    if (criticalTokens.some(t => t.grade === 'F')) severity = 'MED';
    findings.push(`**${criticalTokens.length}** risky token(s): ${criticalTokens.map(t => `${t.symbol} (${t.grade})`).join(', ')}`);
    actions.push({ priority: actions.length + 1, action: 'Investigate risky tokens — consider removing grade F holdings', reason: '', severity: 'MED' });
  }

  // Spam NFTs
  if (snap.spamNftCount > 0) {
    findings.push(`${snap.spamNftCount} spam NFT(s) detected — consider burning them`);
  }

  // Failed txns
  if (snap.failedTxCount > 3) {
    findings.push(`${snap.failedTxCount} failed transactions — could indicate bot activity or phishing attempts`);
  }

  // Recent monitor events
  const criticalEvents = snap.recentEvents.filter(e => e.severity === 'danger' || e.severity === 'critical');
  if (criticalEvents.length > 0) {
    severity = 'HIGH';
    findings.push(`**${criticalEvents.length}** critical security event(s) detected recently`);
    actions.push({ priority: 1, action: 'Review alert history immediately — critical events detected', reason: '', severity: 'HIGH' });
  }

  // Empty accounts
  if (snap.emptyAccounts > 5) {
    findings.push(`${snap.emptyAccounts} empty token accounts — close them to reclaim SOL`);
  }

  // Evacuation address check
  if (!snap.hasEvacuationAddress) {
    findings.push('**No emergency evacuation wallet configured** — set one up in the Emergency tab');
    actions.push({ priority: actions.length + 1, action: 'Configure a Nuclear Evacuation safe wallet so you can quickly move assets if compromised', reason: '', severity: 'MED' });
  }

  // Whitelist count
  if (snap.whitelistedAddressCount > 0) {
    findings.push(`${snap.whitelistedAddressCount} trusted address(es) configured — alerts suppressed for these`);
  }

  if (actions.length === 0) {
    actions.push({ priority: 1, action: 'No urgent actions needed — keep monitoring', reason: '', severity: 'INFO' });
  }

  const summary = findings[0] || 'Wallet scan complete';
  const rawText = `**Risk Summary**: ${summary}\n**Severity**: ${severity}\n**Key Findings**:\n${findings.map(f => `- ${f}`).join('\n')}\n**Next Step(s)**:\n${actions.map((a, i) => `${i + 1}. ${a.action}`).join('\n')}`;

  return { summary, severity, actions, rawText };
}

// ── Pre-warm edge function ──────────────────────────────────
let _preWarmed = false;
function preWarmEdgeFunction() {
  if (_preWarmed) return;
  _preWarmed = true;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/cerberus-core`;
  fetch(url, { method: 'OPTIONS' }).catch(() => {});
}

export function CerberusInsights({ wallet, metadata, healthScore }: CerberusInsightsProps) {
  const { publicKey, connected } = useWallet();
  const { getUsdValue, getNftFloor, prices } = usePrices();
  const [instantBriefing, setInstantBriefing] = useState<CerberusBriefing | null>(null);
  const [briefing, setBriefing] = useState<CerberusBriefing | null>(null);
  const [streamingText, setStreamingText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAiEnhanced, setIsAiEnhanced] = useState(false);
  const fetchedForRef = useRef<string | null>(null);
  const hasFetchedOnce = useRef(false);

  // Pre-warm edge function on mount so cold start is absorbed early
  useEffect(() => { preWarmEdgeFunction(); }, []);

  // Build the wallet snapshot for Cerberus context
  const snapshot: WalletSnapshot | null = useMemo(() => {
    if (!publicKey || wallet.loading) return null;

    const addr = publicKey.toBase58();
    const fungible = wallet.tokenAccounts.filter(t => !t.isNft);
    const nfts = wallet.tokenAccounts.filter(t => t.isNft);
    const spamNfts = nfts.filter(t => {
      if (isManuallyFlagged(t.mint)) return true;
      return getSpamScore(t.mint)?.isSpam;
    });

    const safeDelegateCount = getSafeDelegateCount();
    const delegates = wallet.delegateApprovals.map(d => {
      const usd = getUsdValue(d.mint, d.amount) || getNftFloor(d.mint)?.floor || 0;
      return {
        mint: d.mint,
        symbol: d.mintSymbol || d.mint.slice(0, 8),
        delegate: d.delegate,
        usdValue: usd,
      };
    });

    const tokenRisks = getAllTokenRisks();
    const riskyTokens: WalletSnapshot['riskyTokens'] = [];
    for (const [mint, risk] of tokenRisks) {
      if (risk.grade === 'C' || risk.grade === 'D' || risk.grade === 'F') {
        const meta = metadata.get(mint);
        riskyTokens.push({
          mint,
          symbol: meta?.symbol || mint.slice(0, 8),
          grade: risk.grade,
          score: risk.score,
        });
      }
    }

    const recentEvents = getMonitorEvents().slice(0, 10).map(e => ({
      category: e.category,
      severity: e.severity,
      title: e.title,
    }));

    return {
      walletAddress: addr,
      solBalance: wallet.solBalance,
      healthScore,
      tokenCount: fungible.length,
      nftCount: nfts.length,
      spamNftCount: spamNfts.length,
      delegateApprovals: delegates,
      safeDelegateCount,
      riskyTokens,
      failedTxCount: wallet.failedTxCount,
      emptyAccounts: wallet.emptyAccounts,
      recentEvents,
      hasEvacuationAddress: !!getSafeWallet(),
      whitelistedAddressCount: getWhitelistCount(),
    };
  }, [publicKey, wallet, metadata, healthScore, getUsdValue, getNftFloor, prices]);

  // Set snapshot globally so CerberusChat uses it too
  useEffect(() => {
    setWalletSnapshot(snapshot);
    return () => setWalletSnapshot(null);
  }, [snapshot]);

  // Generate instant local briefing whenever snapshot changes
  useEffect(() => {
    if (!snapshot) { setInstantBriefing(null); return; }
    setInstantBriefing(generateInstantBriefing(snapshot));
  }, [snapshot]);

  // Reset on wallet change + restore cached AI briefing
  useEffect(() => {
    if (!connected || !snapshot) return;
    if (fetchedForRef.current !== snapshot.walletAddress) {
      fetchedForRef.current = snapshot.walletAddress;
      hasFetchedOnce.current = false;
      setStreamingText('');
      setError(null);
      setExpanded(false);
      setIsAiEnhanced(false);
      // Restore cached AI briefing instantly
      const cached = getCachedBriefing(snapshot.walletAddress);
      if (cached) {
        setBriefing(cached);
        setIsAiEnhanced(true);
      } else {
        setBriefing(null);
      }
    }
  }, [snapshot, connected]);

  // Lazy-fetch AI briefing when user expands the widget
  useEffect(() => {
    if (!expanded || !snapshot || !connected) return;
    if (hasFetchedOnce.current) return;
    if (loading) return;

    hasFetchedOnce.current = true;
    let cancelled = false;

    async function loadBriefing() {
      setLoading(true);
      setError(null);
      setStreamingText('');
      try {
        const result = await fetchCerberusBriefing(snapshot!, (partialText) => {
          if (!cancelled) setStreamingText(partialText);
        });
        if (!cancelled) {
          if (result) {
            setBriefing(result);
            setIsAiEnhanced(true);
            setStreamingText('');
            setCachedBriefing(snapshot!.walletAddress, result);
          } else if (!briefing && !instantBriefing) {
            setError('Could not generate briefing');
          }
        }
      } catch {
        if (!cancelled && !briefing && !instantBriefing) {
          setError('Failed to contact Cerberus');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBriefing();
    return () => { cancelled = true; };
  }, [expanded, snapshot, connected, loading, briefing, instantBriefing]);

  // Refresh handler — forces fresh AI briefing
  const handleRefresh = useCallback(async () => {
    if (!snapshot || loading) return;
    hasFetchedOnce.current = true;
    setLoading(true);
    setError(null);
    setStreamingText('');
    try {
      const result = await fetchCerberusBriefing(snapshot, (partialText) => {
        setStreamingText(partialText);
      });
      if (result) {
        setBriefing(result);
        setIsAiEnhanced(true);
        setStreamingText('');
        setCachedBriefing(snapshot.walletAddress, result);
      } else {
        setError('Could not generate briefing');
      }
    } catch {
      setError('Failed to contact Cerberus');
    } finally {
      setLoading(false);
    }
  }, [snapshot, loading]);

  if (!connected || !publicKey) return null;

  // Use AI briefing if available, fall back to instant local briefing
  const activeBriefing = briefing || instantBriefing;
  const sevConfig = SEVERITY_CONFIG[activeBriefing?.severity || 'INFO'] || SEVERITY_CONFIG.INFO;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`rounded-xl border overflow-hidden transition-colors ${
        activeBriefing ? sevConfig.bg : 'bg-card border-border'
      }`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0 ring-2 ring-primary/25 shadow-lg shadow-primary/10">
            <img src={cerberusAvatar} alt="Cerberus" className="w-full h-full object-cover" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-foreground">Cerberus Security Briefing</span>
              {loading && <Loader2 size={10} className="animate-spin text-muted-foreground" />}
              {!loading && isAiEnhanced && (
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">AI</span>
              )}
            </div>
            {activeBriefing && !expanded ? (
              <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-1">
                {activeBriefing.summary}
              </p>
            ) : !expanded && !activeBriefing && (
              <p className="text-[9px] text-muted-foreground mt-0.5">
                Click to generate security briefing
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeBriefing && (
            <span className={`text-[9px] font-bold ${sevConfig.color}`}>
              {activeBriefing.severity}
            </span>
          )}
          {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
        </div>
      </button>

      {/* Body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              {/* Instant local briefing shown immediately while AI loads */}
              {!briefing && instantBriefing && !streamingText && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-muted-foreground/15 text-muted-foreground font-medium">
                      Quick Scan
                    </span>
                    {loading && (
                      <span className="text-[8px] text-muted-foreground flex items-center gap-1">
                        <Loader2 size={8} className="animate-spin" /> AI analysis loading...
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-foreground/90 leading-relaxed">
                    <div
                      className="cerberus-markdown"
                      dangerouslySetInnerHTML={{ __html: renderBriefingMarkdown(instantBriefing.rawText) }}
                    />
                  </div>
                </div>
              )}

              {/* AI streaming text (replaces instant briefing progressively) */}
              {loading && streamingText && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                      AI Analysis
                    </span>
                    <Loader2 size={8} className="animate-spin text-primary" />
                  </div>
                  <div className="text-[11px] text-foreground/90 leading-relaxed">
                    <div
                      className="cerberus-markdown"
                      dangerouslySetInnerHTML={{ __html: renderBriefingMarkdown(streamingText) }}
                    />
                    <span className="inline-block w-1.5 h-3 bg-primary/60 animate-pulse ml-0.5 rounded-sm" />
                  </div>
                </div>
              )}

              {/* Skeleton only if nothing at all to show */}
              {loading && !briefing && !instantBriefing && !streamingText && (
                <div className="flex items-center gap-3 py-6 justify-center">
                  <div className="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 opacity-60">
                    <img src={cerberusAvatar} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="h-2 w-48 bg-muted-foreground/20 rounded animate-pulse" />
                    <div className="h-2 w-36 bg-muted-foreground/15 rounded animate-pulse" />
                    <div className="h-2 w-40 bg-muted-foreground/10 rounded animate-pulse" />
                  </div>
                </div>
              )}

              {/* Error state */}
              {error && !loading && (
                <div className="flex items-center gap-2 py-3 text-[10px] text-muted-foreground">
                  <AlertTriangle size={12} className="text-warning" />
                  <span>{error}</span>
                  <button
                    onClick={handleRefresh}
                    className="ml-auto text-primary hover:text-primary/80 transition-colors"
                  >
                    <RefreshCw size={12} />
                  </button>
                </div>
              )}

              {/* Full AI briefing content */}
              {briefing && !loading && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                      {isAiEnhanced ? 'AI Analysis' : 'Quick Scan'}
                    </span>
                  </div>
                  <div className="text-[11px] text-foreground leading-relaxed">
                    <div
                      className="cerberus-markdown"
                      dangerouslySetInnerHTML={{ __html: renderBriefingMarkdown(briefing.rawText) }}
                    />
                  </div>

                  {briefing.actions.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Priority Actions</p>
                      {briefing.actions.map((action, i) => (
                        <div
                          key={i}
                          className="flex items-start gap-2 px-2.5 py-2 rounded-lg bg-background/40 border border-border/50"
                        >
                          <span className={`text-[9px] font-bold mt-0.5 ${sevConfig.color}`}>
                            {action.priority}.
                          </span>
                          <span className="text-[10px] text-foreground/90 leading-relaxed">
                            {action.action}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Footer — always visible when expanded */}
              {(activeBriefing || error) && (
                <div className="flex items-center justify-between pt-1 border-t border-border/30">
                  <span className="text-[8px] text-muted-foreground">
                    {isAiEnhanced ? 'Cerberus AI analysis' : 'Data-driven scan'}
                    {loading && ' — updating...'}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRefresh(); }}
                    disabled={loading}
                    className="flex items-center gap-1 text-[9px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
                  >
                    <RefreshCw size={9} className={loading ? 'animate-spin' : ''} />
                    {isAiEnhanced ? 'Refresh' : 'Get AI analysis'}
                  </button>
                </div>
              )}

              {/* Waiting for data */}
              {!loading && !activeBriefing && !error && wallet.loading && (
                <p className="text-[10px] text-muted-foreground py-3 text-center">
                  Waiting for wallet data to load...
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}