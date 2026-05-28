/**
 * AlertHistory — Shows past Cerberus background alerts
 *
 * Pulls from alert_history table. Shows severity, timestamp,
 * title, description, channels it was sent to, and acknowledge button.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  History,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ExternalLink,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  Inbox,
  Radar,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useSession } from '@/hooks/useSession';

interface AlertRecord {
  id: string;
  wallet_address: string;
  signature: string | null;
  category: string;
  severity: string;
  title: string;
  description: string;
  enriched_body: string | null;
  programs: string[];
  channels_sent: string[];
  acknowledged: boolean;
  created_at: string;
}

function severityConfig(sev: string) {
  switch (sev) {
    case 'danger': return { icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30', label: 'DANGER' };
    case 'warning': return { icon: Shield, color: 'text-chart-warning', bg: 'bg-chart-warning/10', border: 'border-chart-warning/30', label: 'WARNING' };
    default: return { icon: ShieldCheck, color: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30', label: 'INFO' };
  }
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function AlertHistory() {
  const { user } = useSession();
  const [alerts, setAlerts] = useState<AlertRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  const loadAlerts = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from('alert_history')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) setAlerts(data as AlertRecord[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  const handleAcknowledge = useCallback(async (id: string) => {
    await supabase.from('alert_history').update({ acknowledged: true }).eq('id', id);
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, acknowledged: true } : a));
  }, []);

  const unacknowledgedCount = alerts.filter((a) => !a.acknowledged).length;

  if (!user) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg overflow-hidden card-glow"
    >
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-secondary text-muted-foreground">
            <History size={16} />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              Alert History
              {unacknowledgedCount > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive font-bold">
                  {unacknowledgedCount} NEW
                </span>
              )}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              Past Cerberus background alerts
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border"
          >
            <div className="p-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={16} className="animate-spin text-muted-foreground" />
                </div>
              ) : alerts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Inbox size={24} className="text-muted-foreground mb-2" />
                  <p className="text-[11px] text-muted-foreground">No alerts yet</p>
                  <p className="text-[9px] text-muted-foreground mt-1">
                    Background alerts appear here when Cerberus detects suspicious activity while you're offline.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
                  {alerts.map((alert) => {
                    const sev = severityConfig(alert.severity);
                    const Icon = sev.icon;
                    const isExpanded = expandedAlert === alert.id;

                    return (
                      <div
                        key={alert.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          alert.acknowledged
                            ? 'border-border bg-secondary/20'
                            : `${sev.border} ${sev.bg}`
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2 flex-1 min-w-0">
                            <Icon size={14} className={`${sev.color} mt-0.5 flex-shrink-0`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${sev.bg} ${sev.color}`}>
                                  {sev.label}
                                </span>
                                <span className="text-[9px] text-muted-foreground">{timeAgo(alert.created_at)}</span>
                                {alert.channels_sent.length > 0 && (
                                  <div className="flex items-center gap-0.5">
                                    {alert.channels_sent.map((ch, i) => (
                                      <span key={i} className="text-[7px] px-1 py-0.5 rounded bg-secondary text-muted-foreground">
                                        {ch}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              <p className="text-[11px] font-semibold text-foreground mt-1 truncate">
                                {alert.title}
                              </p>

                              {isExpanded && (
                                <div className="mt-2 space-y-2">
                                  <p className="text-[10px] text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                    {alert.enriched_body || alert.description}
                                  </p>
                                  {alert.programs.length > 0 && (
                                    <div className="flex items-center gap-1 flex-wrap">
                                      {alert.programs.map((p, i) => (
                                        <span key={i} className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                                          {p}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {alert.signature && (
                                    <a
                                      href={`https://solscan.io/tx/${alert.signature}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[9px] text-primary hover:underline"
                                    >
                                      <ExternalLink size={9} /> View on Solscan
                                    </a>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => setExpandedAlert(isExpanded ? null : alert.id)}
                              className="p-1 hover:bg-secondary rounded transition-colors"
                            >
                              {isExpanded ? <ChevronUp size={10} className="text-muted-foreground" /> : <ChevronDown size={10} className="text-muted-foreground" />}
                            </button>
                            {!alert.acknowledged && (
                              <button
                                onClick={() => handleAcknowledge(alert.id)}
                                className="p-1 hover:bg-safe/10 rounded transition-colors"
                                title="Mark as reviewed"
                              >
                                <Check size={10} className="text-safe" />
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Monitoring status */}
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                  <Radar size={10} className="text-primary" />
                  Background monitoring active
                </div>
                <button
                  onClick={loadAlerts}
                  className="text-[9px] text-primary hover:text-primary/80 transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
