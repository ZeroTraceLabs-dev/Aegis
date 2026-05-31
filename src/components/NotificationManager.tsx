import React, { useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Bell,
  BellOff,
  Shield,
  AlertTriangle,
  KeyRound,
  Package,
  ArrowUpRight,
  ChevronDown,
  Check,
  Mail,
  Send,
  Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getNotificationSettings,
  updateNotificationSettings,
  subscribeNotificationSettings,
  requestNotificationPermission,
  getPermissionStatus,
  isNotificationSupported,
  sendBrowserNotification,
  dispatchNotification,
  type NotificationSettings,
} from '@/lib/notificationService';
import { subscribeAlerts, type WalletEvent } from '@/lib/walletMonitorService';

/**
 * Background monitoring + external alerts (Telegram / Discord / Email) all
 * key on a Supabase auth user_id. With email/password auth removed, those
 * features are inert until wallet-signature auth ships. Controls below are
 * rendered disabled so the affordance is visible.
 */
const EXTERNAL_CHANNELS_AVAILABLE = false;
const SIGNIN_LOCK_TITLE = 'Requires wallet sign-in (coming soon)';

/* ── Toggle row ─────────────────────────────────────────────── */

interface ToggleRowProps {
  label: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
  lockTitle?: string;
}

function ToggleRow({ label, description, icon, enabled, onToggle, disabled, lockTitle }: ToggleRowProps) {
  return (
    <button
      onClick={disabled ? undefined : onToggle}
      disabled={disabled}
      title={disabled ? lockTitle : undefined}
      className={`flex items-center gap-3 w-full p-2.5 rounded-md text-left transition-colors ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : 'hover:bg-secondary/40'
      }`}
    >
      <div className="text-muted-foreground shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-foreground block flex items-center gap-1.5">
          {label}
          {disabled && <Lock size={9} className="text-muted-foreground" />}
        </span>
        <span className="text-[9px] text-muted-foreground">{description}</span>
      </div>
      <div className={`w-8 h-4.5 rounded-full p-0.5 transition-colors ${enabled ? 'bg-primary' : 'bg-secondary'}`}>
        <div className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-3.5' : 'translate-x-0'}`} />
      </div>
    </button>
  );
}

/* ── Telegram icon SVG ──────────────────────────────────────── */

function TelegramIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.2 4.4L2.4 10.8c-.6.2-.6 1 0 1.2l4.6 1.6 1.8 5.6c.2.4.6.4.8.2l2.6-2.2 4.4 3.2c.4.2 1 0 1-.4L21.8 5.2c.2-.6-.2-1-.6-.8z" />
      <path d="M9 13.6l8-6" />
    </svg>
  );
}

/* ── Discord icon SVG ───────────────────────────────────────── */

function DiscordIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M20.27 5.07A17.4 17.4 0 0 0 15.8 3.6a.06.06 0 0 0-.07.03c-.18.33-.39.76-.53 1.1a16 16 0 0 0-4.8 0 11 11 0 0 0-.54-1.1.06.06 0 0 0-.06-.03 17.3 17.3 0 0 0-4.48 1.47.06.06 0 0 0-.03.02C2.27 9.86 1.49 14.5 1.87 19.09a.07.07 0 0 0 .03.05 17.5 17.5 0 0 0 5.33 2.76.06.06 0 0 0 .07-.02 12.8 12.8 0 0 0 1.1-1.81.06.06 0 0 0-.04-.09 11.5 11.5 0 0 1-1.69-.83.07.07 0 0 1 0-.11c.11-.09.23-.17.34-.26a.06.06 0 0 1 .06-.01c3.54 1.66 7.38 1.66 10.88 0a.06.06 0 0 1 .06 0c.11.09.23.18.34.27a.07.07 0 0 1 0 .1 10.8 10.8 0 0 1-1.69.84.06.06 0 0 0-.03.09 14.4 14.4 0 0 0 1.1 1.8.06.06 0 0 0 .07.03A17.4 17.4 0 0 0 22.1 19.14a.07.07 0 0 0 .02-.05c.44-5.28-.75-9.87-3.16-13.93a.05.05 0 0 0-.02-.03z" />
      <circle cx="9" cy="15" r="1" /><circle cx="15" cy="15" r="1" />
    </svg>
  );
}

/* ── Main component ─────────────────────────────────────────── */

export function NotificationManager() {
  const { connected } = useWallet();
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings());
  const [permission, setPermission] = useState(getPermissionStatus());
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'types' | 'channels'>('channels');
  const [testSent, setTestSent] = useState(false);
  const supported = isNotificationSupported();

  // Subscribe to settings changes
  useEffect(() => {
    const unsub = subscribeNotificationSettings(() => {
      setSettings(getNotificationSettings());
    });
    return unsub;
  }, []);

  // Hook into live monitor alerts -> browser notifications.
  // dispatchNotification fires sendBrowserNotification first and only attempts
  // external channels when a Supabase session exists, which it won't until
  // wallet-sig auth ships. So browser pings still work; external silently no-ops.
  useEffect(() => {
    if (!connected) return;
    const unsub = subscribeAlerts((event: WalletEvent) => {
      const tag = `mon-${event.signature.slice(0, 8)}`;
      if (event.category === 'authority') {
        dispatchNotification('authorityChanges', event.title, event.description, { tag });
      } else if (event.category === 'approval') {
        dispatchNotification('delegateChanges', event.title, event.description, { tag });
      } else if (event.category === 'nft-transfer') {
        dispatchNotification('spamAirdrops', event.title, event.description, { tag });
      } else if (event.category === 'outflow' && event.severity !== 'info') {
        dispatchNotification('largeOutflows', event.title, event.description, { tag });
      } else if (event.severity === 'danger') {
        dispatchNotification('largeOutflows', event.title, event.description, { tag });
      }
    });
    return unsub;
  }, [connected]);

  const handleRequestPermission = useCallback(async () => {
    await requestNotificationPermission();
    setPermission(getPermissionStatus());
  }, []);

  const handleBrowserToggle = useCallback((key: keyof NotificationSettings) => {
    updateNotificationSettings({ [key]: !settings[key] });
  }, [settings]);

  const handleTestNotification = useCallback(() => {
    sendBrowserNotification(
      'healthDrops',
      'Test Notification',
      'Cerberus notifications are working correctly.',
      { tag: 'test' },
    );
    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  }, []);

  const tabs = [
    { key: 'channels' as const, label: 'Channels' },
    { key: 'types' as const, label: 'Alert Types' },
  ];

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
          {settings.enabled ? (
            <Bell size={16} className="text-primary" />
          ) : (
            <BellOff size={16} className="text-muted-foreground" />
          )}
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Notifications
          </h3>
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

              {/* Master toggle */}
              <ToggleRow
                label="Enable All Notifications"
                description="Master switch for browser notifications"
                icon={<Bell size={14} />}
                enabled={settings.enabled}
                onToggle={() => handleBrowserToggle('enabled')}
              />

              {settings.enabled && (
                <>
                  {/* Tab bar */}
                  <div className="flex items-center gap-1 border-b border-border pb-0">
                    {tabs.map((tab) => (
                      <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`text-[10px] font-semibold px-3 py-1.5 rounded-t transition-colors ${
                          activeTab === tab.key
                            ? 'bg-secondary/60 text-foreground border-b-2 border-primary'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>

                  {/* ── CHANNELS TAB ── */}
                  {activeTab === 'channels' && (
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-0.5">

                      {/* Browser */}
                      <div className="space-y-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                          Browser
                        </span>
                        {!supported && (
                          <div className="p-2.5 rounded-md bg-yellow-400/10 border border-yellow-400/20 text-[10px] text-yellow-400">
                            Browser notifications not supported in this environment.
                          </div>
                        )}
                        {supported && permission === 'default' && (
                          <button
                            onClick={handleRequestPermission}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary/10 border border-primary/20 text-primary text-[10px] font-semibold hover:bg-primary/20 transition-colors"
                          >
                            <Bell size={12} />
                            Enable Browser Notifications
                          </button>
                        )}
                        {supported && permission === 'denied' && (
                          <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/20 text-[10px] text-muted-foreground">
                            <span className="text-destructive font-semibold">Blocked.</span>{' '}
                            Enable in browser settings.
                          </div>
                        )}
                        {supported && permission === 'granted' && (
                          <div className="flex items-center gap-2 p-2.5 rounded-md bg-safe/5 border border-safe/15 text-[10px] text-safe">
                            <Check size={10} /> Browser notifications enabled
                          </div>
                        )}
                      </div>

                      {/* Email */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                          Email
                        </span>
                        <ToggleRow
                          label="Email Alerts"
                          description="Enter an email to receive alerts"
                          icon={<Mail size={14} />}
                          enabled={false}
                          onToggle={() => {}}
                          disabled={!EXTERNAL_CHANNELS_AVAILABLE}
                          lockTitle={SIGNIN_LOCK_TITLE}
                        />
                      </div>

                      {/* Telegram */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                          Telegram
                        </span>
                        <ToggleRow
                          label="Telegram Alerts"
                          description="Receive alerts via Telegram bot"
                          icon={<TelegramIcon />}
                          enabled={false}
                          onToggle={() => {}}
                          disabled={!EXTERNAL_CHANNELS_AVAILABLE}
                          lockTitle={SIGNIN_LOCK_TITLE}
                        />
                      </div>

                      {/* Discord */}
                      <div className="space-y-1.5">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground px-1">
                          Discord
                        </span>
                        <ToggleRow
                          label="Discord DM Alerts"
                          description="Receive private alerts via Cerberus bot DM"
                          icon={<DiscordIcon />}
                          enabled={false}
                          onToggle={() => {}}
                          disabled={!EXTERNAL_CHANNELS_AVAILABLE}
                          lockTitle={SIGNIN_LOCK_TITLE}
                        />
                      </div>
                    </div>
                  )}

                  {/* ── ALERT TYPES TAB ── */}
                  {activeTab === 'types' && (
                    <div className="space-y-1 max-h-[360px] overflow-y-auto pr-0.5">
                      <ToggleRow
                        label="Health Score Drops"
                        description="Alert when your security score drops significantly"
                        icon={<Shield size={14} />}
                        enabled={settings.healthDrops}
                        onToggle={() => handleBrowserToggle('healthDrops')}
                      />
                      <ToggleRow
                        label="Spam Airdrops"
                        description="Alert when suspected spam tokens are detected"
                        icon={<Package size={14} />}
                        enabled={settings.spamAirdrops}
                        onToggle={() => handleBrowserToggle('spamAirdrops')}
                      />
                      <ToggleRow
                        label="Delegate Changes"
                        description="Alert when token approvals are granted or revoked"
                        icon={<KeyRound size={14} />}
                        enabled={settings.delegateChanges}
                        onToggle={() => handleBrowserToggle('delegateChanges')}
                      />
                      <ToggleRow
                        label="Authority Changes"
                        description="Alert when token authorities are modified"
                        icon={<AlertTriangle size={14} />}
                        enabled={settings.authorityChanges}
                        onToggle={() => handleBrowserToggle('authorityChanges')}
                      />
                      <ToggleRow
                        label="Suspicious Activity"
                        description="Alert for large outflows and danger events"
                        icon={<ArrowUpRight size={14} />}
                        enabled={settings.largeOutflows}
                        onToggle={() => handleBrowserToggle('largeOutflows')}
                      />
                    </div>
                  )}

                  {/* Test footer */}
                  <div className="pt-2 border-t border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={handleTestNotification}
                        className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {testSent ? (
                          <><Check size={10} className="text-safe" /><span className="text-safe">Test sent</span></>
                        ) : (
                          <><Send size={10} /> Send browser test notification</>
                        )}
                      </button>
                      <span className="text-[9px] text-muted-foreground">
                        {permission === 'granted' ? 'Browser' : 'No channels active'}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
