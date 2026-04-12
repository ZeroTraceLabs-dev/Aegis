import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  DatabaseZap,
  ShieldAlert,
  ShieldCheck,
  Flag,
  Loader2,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  Search,
  Send,
  Check,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWalletData } from '@/hooks/useWalletScan';
import {
  checkAddresses,
  reportScamAddress,
  type ScamRecord,
} from '@/lib/scamDatabaseService';

function severityBadge(severity: ScamRecord['severity']) {
  const colors: Record<string, string> = {
    critical: 'bg-destructive/10 border-destructive/20 text-destructive',
    high: 'bg-orange-400/10 border-orange-400/20 text-orange-400',
    medium: 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400',
    low: 'bg-primary/10 border-primary/20 text-primary',
  };
  return (
    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded border ${colors[severity] || colors.medium}`}>
      {severity}
    </span>
  );
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    drainer: 'Drainer',
    phishing: 'Phishing',
    rugpull: 'Rug Pull',
    spam: 'Spam',
    other: 'Reported',
  };
  return labels[cat] || cat;
}

interface ScamCheckerProps {
  wallet: ReturnType<typeof useWalletData>;
}

export function ScamChecker({ wallet }: ScamCheckerProps) {
  const { publicKey, connected } = useWallet();
  const [matches, setMatches] = useState<Map<string, ScamRecord>>(new Map());
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Report state
  const [showReport, setShowReport] = useState(false);
  const [reportAddr, setReportAddr] = useState('');
  const [reportLabel, setReportLabel] = useState('');
  const [reportCategory, setReportCategory] = useState<ScamRecord['category']>('other');
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);

  // Auto-scan when wallet data loads
  useEffect(() => {
    if (!connected || wallet.loading || wallet.tokenAccounts.length === 0) return;

    const scan = async () => {
      setScanning(true);
      try {
        // Collect all addresses to check: delegates, recent tx signers, token mints
        const addressesToCheck = new Set<string>();

        // Delegate addresses
        for (const d of wallet.delegateApprovals) {
          addressesToCheck.add(d.delegate);
        }

        // Could also check interacted addresses from signatures
        // For now, delegates are the most critical attack vector

        if (addressesToCheck.size > 0) {
          const results = await checkAddresses([...addressesToCheck]);
          setMatches(results);
        }
      } catch (err) {
        console.warn('[ScamChecker] Scan error:', err);
      } finally {
        setScanning(false);
        setScanned(true);
      }
    };

    scan();
  }, [connected, wallet.loading, wallet.delegateApprovals, wallet.tokenAccounts.length]);

  const handleReport = useCallback(async () => {
    if (!reportAddr.trim() || !publicKey) return;
    setReporting(true);
    try {
      await reportScamAddress(
        reportAddr.trim(),
        publicKey.toBase58(),
        reportLabel.trim() || undefined,
        reportCategory,
      );
      setReported(true);
      setTimeout(() => {
        setReported(false);
        setReportAddr('');
        setReportLabel('');
        setShowReport(false);
      }, 2000);
    } catch {
      // Silent fail
    } finally {
      setReporting(false);
    }
  }, [reportAddr, reportLabel, reportCategory, publicKey]);

  if (!connected) return null;

  const matchCount = matches.size;
  const hasMatches = matchCount > 0;

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
          <DatabaseZap size={16} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Scam Address Database
          </h3>
          {scanning && <Loader2 size={12} className="animate-spin text-primary" />}
          {scanned && !scanning && hasMatches && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/20">
              <ShieldAlert size={9} />
              {matchCount} match{matchCount > 1 ? 'es' : ''}
            </span>
          )}
          {scanned && !scanning && !hasMatches && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-safe bg-safe/10 px-1.5 py-0.5 rounded border border-safe/20">
              <ShieldCheck size={9} />
              Clear
            </span>
          )}
        </div>
        <ChevronDown size={12} className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-3">
              {/* Matches */}
              {hasMatches && (
                <div className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">
                    Known Scam Addresses Detected
                  </span>
                  {[...matches.entries()].map(([addr, record]) => (
                    <div
                      key={addr}
                      className="flex items-start gap-3 p-3 rounded-md bg-destructive/10 border border-destructive/20"
                    >
                      <ShieldAlert size={14} className="text-destructive shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[11px] font-bold text-destructive">{record.label}</span>
                          {severityBadge(record.severity)}
                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground">
                            {categoryLabel(record.category)}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono text-muted-foreground block">
                          {addr}
                        </span>
                        <div className="flex items-center gap-2 mt-1 text-[9px] text-muted-foreground">
                          <span>{record.reportCount} report{record.reportCount !== 1 ? 's' : ''}</span>
                          {record.verified && (
                            <span className="text-safe font-semibold">Verified</span>
                          )}
                          <span className="capitalize">{record.source}</span>
                        </div>
                      </div>
                      <a
                        href={`https://solscan.io/account/${addr}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-primary shrink-0"
                      >
                        <ExternalLink size={10} />
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {/* No matches */}
              {scanned && !hasMatches && !scanning && (
                <div className="flex items-center gap-2 p-3 rounded-md bg-safe/5 border border-safe/15">
                  <ShieldCheck size={14} className="text-safe shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold text-safe">No known scam addresses detected</p>
                    <p className="text-[9px] text-muted-foreground">
                      Checked {wallet.delegateApprovals.length} delegate address{wallet.delegateApprovals.length !== 1 ? 'es' : ''} against the database.
                    </p>
                  </div>
                </div>
              )}

              {/* Community report section */}
              <div className="pt-2 border-t border-border">
                <button
                  onClick={() => setShowReport(!showReport)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Flag size={10} />
                  Report a scam address
                </button>

                <AnimatePresence>
                  {showReport && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-2 p-3 rounded-md bg-secondary/40 border border-border space-y-2">
                        <input
                          value={reportAddr}
                          onChange={(e) => setReportAddr(e.target.value)}
                          placeholder="Solana address to report..."
                          className="w-full bg-secondary/60 border border-border rounded px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
                        />
                        <div className="flex items-center gap-2">
                          <input
                            value={reportLabel}
                            onChange={(e) => setReportLabel(e.target.value)}
                            placeholder="Description (optional)"
                            className="flex-1 bg-secondary/60 border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
                          />
                          <select
                            value={reportCategory}
                            onChange={(e) => setReportCategory(e.target.value as ScamRecord['category'])}
                            className="bg-secondary/60 border border-border rounded px-2 py-2 text-xs text-foreground focus:outline-none focus:border-primary/40"
                          >
                            <option value="drainer">Drainer</option>
                            <option value="phishing">Phishing</option>
                            <option value="rugpull">Rug Pull</option>
                            <option value="spam">Spam</option>
                            <option value="other">Other</option>
                          </select>
                        </div>
                        <button
                          onClick={handleReport}
                          disabled={reporting || !reportAddr.trim()}
                          className="flex items-center gap-2 px-3 py-2 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                        >
                          {reporting ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : reported ? (
                            <><Check size={12} /> Reported</>
                          ) : (
                            <><Send size={12} /> Submit Report</>
                          )}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
