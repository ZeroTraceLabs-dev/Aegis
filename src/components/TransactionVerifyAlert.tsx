/**
 * TransactionVerifyAlert — "Was this you?" alert system
 *
 * Listens to the WalletMonitor's alert subscription for suspicious events
 * (outflows, delegates, authority changes). When detected, surfaces a prominent
 * "Was this you?" banner with transaction details, timestamp, and one-tap
 * "NO — EVACUATE" that scrolls to the Nuclear Evacuation panel.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CheckCircle, Rocket, ExternalLink, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { subscribeAlerts, type WalletEvent } from '@/lib/walletMonitorService';
import { getSafeWallet } from '@/lib/evacuationStore';
import { sendBrowserNotification } from '@/lib/notificationService';

interface PendingAlert {
  event: WalletEvent;
  dismissed: boolean;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TransactionVerifyAlert() {
  const [alerts, setAlerts] = useState<PendingAlert[]>([]);

  // Subscribe to danger/warning events from walletMonitorService
  useEffect(() => {
    const unsub = subscribeAlerts((event: WalletEvent) => {
      // Only show "Was this you?" for outflows, approvals, authority, nft-transfers
      const actionable = ['outflow', 'approval', 'authority', 'nft-transfer'];
      if (!actionable.includes(event.category)) return;
      if (event.severity !== 'danger' && event.severity !== 'warning') return;

      setAlerts((prev) => {
        // Deduplicate by signature
        if (prev.some((a) => a.event.signature === event.signature)) return prev;
        return [{ event, dismissed: false }, ...prev].slice(0, 5);
      });

      // Also fire a browser notification
      sendBrowserNotification(
        'largeOutflows',
        `Was this you? — ${event.title}`,
        `${event.description} at ${formatTime(event.timestamp)}. If not, evacuate immediately.`,
        { tag: `verify-${event.signature.slice(0, 8)}` },
      );
    });

    return unsub;
  }, []);

  const handleDismiss = useCallback((sig: string) => {
    setAlerts((prev) =>
      prev.map((a) => a.event.signature === sig ? { ...a, dismissed: true } : a)
    );
  }, []);

  const handleEvacuate = useCallback(() => {
    // Scroll to the nuclear evacuation panel
    const el = document.querySelector('[data-nuclear-evacuation]');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Simulate a click to expand it
      const btn = el.querySelector('button');
      if (btn) btn.click();
    }
  }, []);

  const activeAlerts = alerts.filter((a) => !a.dismissed);
  if (activeAlerts.length === 0) return null;

  const hasSafeWallet = !!getSafeWallet();

  return (
    <div className="space-y-2">
      <AnimatePresence mode="popLayout">
        {activeAlerts.map((alert) => (
          <motion.div
            key={alert.event.signature}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="relative rounded-lg border-2 border-destructive/50 bg-destructive/10 p-4 overflow-hidden"
          >
            {/* Pulsing background */}
            <div className="absolute inset-0 bg-destructive/5 animate-pulse pointer-events-none" />

            <div className="relative">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={16} className="text-destructive" />
                  <span className="text-xs font-bold text-destructive uppercase tracking-wider">
                    Was this you?
                  </span>
                  <span className="text-[9px] text-muted-foreground font-mono">
                    {formatTime(alert.event.timestamp)}
                  </span>
                </div>
                <button
                  onClick={() => handleDismiss(alert.event.signature)}
                  className="p-1 hover:bg-secondary rounded transition-colors"
                >
                  <X size={12} className="text-muted-foreground" />
                </button>
              </div>

              {/* Event details */}
              <div className="mb-3">
                <p className="text-sm font-bold text-foreground">{alert.event.title}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{alert.event.description}</p>
                {alert.event.programs.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {alert.event.programs.map((p, i) => (
                      <span
                        key={i}
                        className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground"
                      >
                        {p}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDismiss(alert.event.signature)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-safe/10 border border-safe/30 rounded-md text-safe text-[10px] font-bold hover:bg-safe/20 transition-colors"
                >
                  <CheckCircle size={12} />
                  YES, THAT WAS ME
                </button>

                <button
                  onClick={handleEvacuate}
                  className="flex items-center gap-1.5 px-3 py-2 bg-destructive/20 border border-destructive/40 rounded-md text-destructive text-[10px] font-bold hover:bg-destructive/30 transition-colors"
                >
                  <Rocket size={12} />
                  {hasSafeWallet ? 'NO — EVACUATE NOW' : 'NO — SET UP EVACUATION'}
                </button>

                <a
                  href={`https://solscan.io/tx/${alert.event.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2 py-2 text-[10px] text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink size={10} />
                  VIEW TX
                </a>
              </div>

              {/* Urgency note */}
              {!hasSafeWallet && (
                <p className="text-[9px] text-muted-foreground mt-2">
                  Configure an escape wallet in the Nuclear Evacuation panel below to enable one-click emergency transfers.
                </p>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
