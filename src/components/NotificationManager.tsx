import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
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
  MessageCircle,
  Loader2,
  ExternalLink,
  Save,
  Radar,
  Settings2,
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
  loadChannelPreferences,
  getChannelPreferences,
  saveChannelPreferences,
  isChannelPrefsLoaded,
  dispatchNotification,
  type NotificationSettings,
  type ChannelPreferences,
} from '@/lib/notificationService';
import { subscribeAlerts, type WalletEvent } from '@/lib/walletMonitorService';
import {
  syncTrackingWithNotifications,
  getTrackingConfig,
  updateTrackingThresholds,
  CERBERUS_DEFAULTS,
  type WalletTrackingConfig,
} from '@/lib/walletTrackingService';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/hooks/useAuth';

/* ── Toggle row ─────────────────────────────────────────────── */

interface ToggleRowProps {
  label: string;
  description: string;
  icon: React.ReactNode;
  enabled: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, description, icon, enabled, onToggle }: ToggleRowProps) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-3 w-full p-2.5 rounded-md hover:bg-secondary/40 transition-colors text-left"
    >
      <div className="text-muted-foreground shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-foreground block">{label}</span>
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
  const { connected, publicKey } = useWallet();
  const { user } = useAuth();
  const walletAddress = publicKey?.toBase58() || '';
  const [settings, setSettings] = useState<NotificationSettings>(getNotificationSettings());
  const [channelPrefs, setChannelPrefs] = useState<ChannelPreferences>(getChannelPreferences());
  const [permission, setPermission] = useState(getPermissionStatus());
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'types' | 'channels' | 'thresholds'>('channels');
  const [testSent, setTestSent] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [consentPending, setConsentPending] = useState<(() => void) | null>(null);
  const [trackingActive, setTrackingActive] = useState(false);
  const supported = isNotificationSupported();

  // Threshold state
  const [solThreshold, setSolThreshold] = useState(CERBERUS_DEFAULTS.thresholdSolOutflow.toString());
  const [usdThreshold, setUsdThreshold] = useState(CERBERUS_DEFAULTS.thresholdTokenOutflowUsd.toString());
  const [thresholdSaving, setThresholdSaving] = useState(false);
  const [thresholdSaved, setThresholdSaved] = useState(false);

  // Draft state for channel inputs
  const [tgDraft, setTgDraft] = useState('');
  const [dcUserIdDraft, setDcUserIdDraft] = useState('');
  const [emailDraft, setEmailDraft] = useState('');

  // Subscribe to settings changes
  useEffect(() => {
    const unsub = subscribeNotificationSettings(() => {
      setSettings(getNotificationSettings());
      setChannelPrefs(getChannelPreferences());
    });
    return unsub;
  }, []);

  // Load channel prefs + tracking config from Supabase when user logs in
  useEffect(() => {
    if (user) {
      loadChannelPreferences().then((prefs) => {
        setChannelPrefs(prefs);
        setTgDraft(prefs.telegramChatId);
        setDcUserIdDraft(prefs.discordUserId);
        setEmailDraft(prefs.alertEmail);
      });
      // Check if tracking is already active for this wallet
      if (walletAddress) {
        getTrackingConfig(walletAddress).then((cfg) => {
          if (cfg) {
            setTrackingActive(cfg.enabled);
            setSolThreshold(cfg.thresholdSolOutflow.toString());
            setUsdThreshold(cfg.thresholdTokenOutflowUsd.toString());
          }
        });
      }
    }
  }, [user, walletAddress]);

  // Auto-sync tracking whenever any external channel is enabled/disabled
  useEffect(() => {
    if (!user || !walletAddress) return;
    const hasAnyChannel =
      channelPrefs.emailEnabled ||
      (channelPrefs.telegramEnabled && !!channelPrefs.telegramChatId) ||
      (channelPrefs.discordEnabled && !!channelPrefs.discordUserId);
    if (hasAnyChannel && !trackingActive) {
      // Auto-register wallet for background monitoring
      syncTrackingWithNotifications(walletAddress, true, {
        thresholdSolOutflow: parseFloat(solThreshold) || 0.5,
        thresholdTokenOutflowUsd: parseFloat(usdThreshold) || 50,
      }).then((ok) => {
        if (ok) setTrackingActive(true);
      });
    } else if (!hasAnyChannel && trackingActive) {
      syncTrackingWithNotifications(walletAddress, false);
      setTrackingActive(false);
    }
  }, [user, walletAddress, channelPrefs, trackingActive, solThreshold, usdThreshold]);

  // Hook into live monitor alerts
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

  const handleChannelToggle = useCallback(async (key: keyof ChannelPreferences) => {
    const newVal = !channelPrefs[key];
    const updated = { [key]: newVal };

    // If enabling an external channel for the first time, show consent
    const isEnabling = newVal === true;
    const isExternalChannel = key === 'emailEnabled' || key === 'telegramEnabled' || key === 'discordEnabled';

    if (isEnabling && isExternalChannel && !trackingActive && walletAddress) {
      setShowConsent(true);
      setConsentPending(() => async () => {
        setChannelPrefs((prev) => ({ ...prev, ...updated }));
        await saveChannelPreferences(updated);
        await syncTrackingWithNotifications(walletAddress, true, {
          thresholdSolOutflow: parseFloat(solThreshold) || 0.5,
          thresholdTokenOutflowUsd: parseFloat(usdThreshold) || 50,
        });
        setTrackingActive(true);
        setShowConsent(false);
        setConsentPending(null);
      });
      return;
    }

    setChannelPrefs((prev) => {
      const next = { ...prev, ...updated };
      // If all external channels are now off, immediately disable tracking
      const hasAny =
        next.emailEnabled ||
        (next.telegramEnabled && !!next.telegramChatId) ||
        (next.discordEnabled && !!next.discordUserId);
      if (!hasAny && trackingActive && walletAddress) {
        syncTrackingWithNotifications(walletAddress, false).then(() => {
          setTrackingActive(false);
        });
      }
      return next;
    });
    await saveChannelPreferences(updated);
  }, [channelPrefs, trackingActive, walletAddress, solThreshold, usdThreshold]);

  const handleConsentAccept = useCallback(() => {
    if (consentPending) consentPending();
  }, [consentPending]);

  const handleConsentDecline = useCallback(() => {
    setShowConsent(false);
    setConsentPending(null);
  }, []);

  const handleSaveThresholds = useCallback(async () => {
    if (!walletAddress) return;
    setThresholdSaving(true);
    await updateTrackingThresholds(walletAddress, {
      thresholdSolOutflow: parseFloat(solThreshold) || 0.5,
      thresholdTokenOutflowUsd: parseFloat(usdThreshold) || 50,
    });
    setThresholdSaving(false);
    setThresholdSaved(true);
    setTimeout(() => setThresholdSaved(false), 2500);
  }, [walletAddress, solThreshold, usdThreshold]);

  const handleSaveChannels = useCallback(async () => {
    setSaving(true);
    const updates: Partial<ChannelPreferences> = {
      telegramChatId: tgDraft.trim(),
      discordUserId: dcUserIdDraft.trim(),
      alertEmail: emailDraft.trim(),
    };
    const ok = await saveChannelPreferences(updates);
    if (ok) {
      const merged = { ...channelPrefs, ...updates };
      setChannelPrefs(merged);

      // Auto-sync wallet tracking — same rules for all channels
      if (walletAddress) {
        const hasAnyChannel =
          (merged.emailEnabled && !!(merged.alertEmail || user?.email)) ||
          (merged.telegramEnabled && !!merged.telegramChatId) ||
          (merged.discordEnabled && !!merged.discordUserId);

        const thresholds = {
          thresholdSolOutflow: parseFloat(solThreshold) || 0.5,
          thresholdTokenOutflowUsd: parseFloat(usdThreshold) || 50,
        };

        if (hasAnyChannel && !trackingActive) {
          // First time enabling — show consent, then sync + auto-test
          setShowConsent(true);
          // Store wallet address in a stable ref to avoid race
          const capturedWallet = walletAddress;
          setConsentPending(() => async () => {
            await syncTrackingWithNotifications(capturedWallet, true, thresholds);
            setTrackingActive(true);
            setShowConsent(false);
            setConsentPending(null);
            // Auto-fire test notification to verify pipeline
            fireVerificationTest();
          });
        } else if (hasAnyChannel && trackingActive) {
          await syncTrackingWithNotifications(walletAddress, true, thresholds);
        } else if (!hasAnyChannel && trackingActive) {
          await syncTrackingWithNotifications(walletAddress, false);
          setTrackingActive(false);
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    }
    setSaving(false);
  }, [tgDraft, dcUserIdDraft, emailDraft, channelPrefs, walletAddress, trackingActive, solThreshold, usdThreshold, user]);

  // Fires a silent verification test after first-time setup
  const fireVerificationTest = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          type: 'test',
          title: 'Cerberus Activated',
          body: 'Background monitoring is now live. You will receive alerts here when suspicious activity is detected on your wallet.',
          enrichWithCerberus: false,
        }),
      });
    } catch { /* silent */ }
  }, []);

  const handleTestNotification = useCallback(async () => {
    // 1) Browser notification
    sendBrowserNotification(
      'healthDrops',
      'Test Notification',
      'ZeroTraceLabs notifications are working correctly.',
      { tag: 'test' },
    );

    // 2) Force-send to all enabled external channels (bypass alert-type filtering)
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
        await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            type: 'test',
            title: 'Test Notification',
            body: 'ZeroTraceLabs notifications are working correctly. If you see this on Telegram, Discord, or Email — your channels are live.',
            enrichWithCerberus: false,
          }),
        });
      }
    } catch { /* silent */ }

    setTestSent(true);
    setTimeout(() => setTestSent(false), 3000);
  }, []);

  const handleForceScan = useCallback(async () => {
    if (!walletAddress || scanning) return;
    setScanning(true);
    setScanResult(null);
    try {
      const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/wallet-monitor`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ wallet_address: walletAddress }),
      });
      const data = await res.json();
      if (data.results?.[0]) {
        const r = data.results[0];
        setScanResult(`${r.txnsProcessed} txns scanned, ${r.alertsFired} alerts fired`);
      } else {
        setScanResult(data.message || 'Scan complete');
      }
    } catch {
      setScanResult('Scan failed');
    }
    setScanning(false);
    setTimeout(() => setScanResult(null), 5000);
  }, [walletAddress, scanning]);

  if (!connected && !user) return null;

  const tabs = [
    { key: 'channels' as const, label: 'Channels' },
    { key: 'types' as const, label: 'Alert Types' },
    ...(trackingActive ? [{ key: 'thresholds' as const, label: 'Thresholds' }] : []),
  ];

  return (
    <>
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
          {trackingActive && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-bold">TRACKING</span>
          )}
          {/* Channel indicators */}
          <div className="flex items-center gap-1">
            {channelPrefs.emailEnabled && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary" title="Email" />
            )}
            {channelPrefs.telegramEnabled && channelPrefs.telegramChatId && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#29B6F6]" title="Telegram" />
            )}
            {channelPrefs.discordEnabled && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#5865F2]" title="Discord" />
            )}
          </div>
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
                description="Master switch for all notification types and channels"
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
                          description={emailDraft || user?.email ? `Notifications sent to ${emailDraft || user?.email}` : 'Enter an email to receive alerts'}
                          icon={<Mail size={14} />}
                          enabled={channelPrefs.emailEnabled}
                          onToggle={() => handleChannelToggle('emailEnabled')}
                        />
                        {channelPrefs.emailEnabled && (
                          <div className="px-2.5 space-y-1.5">
                            <input
                              value={emailDraft}
                              onChange={(e) => setEmailDraft(e.target.value)}
                              placeholder={user?.email || 'your@email.com'}
                              type="email"
                              className="w-full bg-secondary/60 border border-border rounded px-3 py-2 text-[10px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            <p className="text-[9px] text-muted-foreground leading-relaxed">
                              {user?.email
                                ? <>Defaults to your account email. Enter a different address to override.</>
                                : <>Web3 wallets don't have an email on file. Enter one here to receive alert emails.</>}
                            </p>
                          </div>
                        )}
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
                          enabled={channelPrefs.telegramEnabled}
                          onToggle={() => handleChannelToggle('telegramEnabled')}
                        />
                        {channelPrefs.telegramEnabled && (
                          <div className="px-2.5 space-y-1.5">
                            <input
                              value={tgDraft}
                              onChange={(e) => setTgDraft(e.target.value)}
                              placeholder="Telegram Chat ID (e.g. 123456789)"
                              className="w-full bg-secondary/60 border border-border rounded px-3 py-2 text-[10px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
                            />
                            <p className="text-[9px] text-muted-foreground leading-relaxed">
                              Message <a href="https://t.me/Cerberus_watchbot" target="_blank" rel="noopener noreferrer" className="text-primary font-semibold hover:underline">@Cerberus_watchbot</a> on Telegram to get your Chat ID.
                              Send <span className="font-mono text-foreground">/start</span> then <span className="font-mono text-foreground">/chatid</span>.
                            </p>
                          </div>
                        )}
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
                          enabled={channelPrefs.discordEnabled}
                          onToggle={() => handleChannelToggle('discordEnabled')}
                        />
                        {channelPrefs.discordEnabled && (
                          <div className="px-2.5 space-y-2">
                            <a
                              href="https://discord.gg/9NaPPj7KMk"
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                window.open('https://discord.gg/9NaPPj7KMk', '_blank', 'noopener,noreferrer');
                              }}
                              className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md bg-[#5865F2]/10 border border-[#5865F2]/25 text-[#5865F2] text-[10px] font-semibold hover:bg-[#5865F2]/20 transition-colors"
                            >
                              <DiscordIcon size={12} />
                              Step 1: Join the Aegis Discord
                              <ExternalLink size={8} />
                            </a>
                            <input
                              value={dcUserIdDraft}
                              onChange={(e) => setDcUserIdDraft(e.target.value)}
                              placeholder="Step 2: Your Discord User ID (e.g. 123456789012345678)"
                              className="w-full bg-secondary/60 border border-border rounded px-3 py-2 text-[10px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-[#5865F2]/40 transition-colors"
                            />
                            <p className="text-[9px] text-muted-foreground leading-relaxed">
                              Alerts are sent as <span className="text-foreground font-semibold">private DMs</span> from the Cerberus bot -- only you can see them.
                              To get your User ID: enable Developer Mode in Discord settings, then right-click your name and select "Copy User ID".
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Save button — visible when any channel is enabled */}
                      {(channelPrefs.emailEnabled || channelPrefs.telegramEnabled || channelPrefs.discordEnabled) && (
                        <>
                          <button
                            onClick={handleSaveChannels}
                            disabled={saving}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-primary text-primary-foreground text-[10px] font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
                          >
                            {saving ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : saved ? (
                              <><Check size={12} /> Saved &amp; Synced</>
                            ) : (
                              <><Save size={12} /> Save Channel Settings</>
                            )}
                          </button>
                          {!trackingActive && walletAddress && (
                            <p className="text-[8px] text-muted-foreground text-center">
                              Saving will activate background monitoring for your connected wallet
                            </p>
                          )}
                        </>
                      )}
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
                        onToggle={() => {
                          handleBrowserToggle('healthDrops');
                          saveChannelPreferences({ notifyHealthDrops: !channelPrefs.notifyHealthDrops });
                        }}
                      />
                      <ToggleRow
                        label="Spam Airdrops"
                        description="Alert when suspected spam tokens are detected"
                        icon={<Package size={14} />}
                        enabled={settings.spamAirdrops}
                        onToggle={() => {
                          handleBrowserToggle('spamAirdrops');
                          saveChannelPreferences({ notifySpamAirdrops: !channelPrefs.notifySpamAirdrops });
                        }}
                      />
                      <ToggleRow
                        label="Delegate Changes"
                        description="Alert when token approvals are granted or revoked"
                        icon={<KeyRound size={14} />}
                        enabled={settings.delegateChanges}
                        onToggle={() => {
                          handleBrowserToggle('delegateChanges');
                          saveChannelPreferences({ notifyDelegateChanges: !channelPrefs.notifyDelegateChanges });
                        }}
                      />
                      <ToggleRow
                        label="Authority Changes"
                        description="Alert when token authorities are modified"
                        icon={<AlertTriangle size={14} />}
                        enabled={settings.authorityChanges}
                        onToggle={() => {
                          handleBrowserToggle('authorityChanges');
                          saveChannelPreferences({ notifyAuthorityChanges: !channelPrefs.notifyAuthorityChanges });
                        }}
                      />
                      <ToggleRow
                        label="Suspicious Activity"
                        description="Alert for large outflows and danger events"
                        icon={<ArrowUpRight size={14} />}
                        enabled={settings.largeOutflows}
                        onToggle={() => {
                          handleBrowserToggle('largeOutflows');
                          saveChannelPreferences({ notifySuspiciousActivity: !channelPrefs.notifySuspiciousActivity });
                        }}
                      />
                    </div>
                  )}

                  {/* ── THRESHOLDS TAB ── */}
                  {activeTab === 'thresholds' && trackingActive && (
                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-0.5">
                      <div className="flex items-center gap-2 p-2.5 bg-primary/5 border border-primary/20 rounded-lg">
                        <Radar size={12} className="text-primary flex-shrink-0" />
                        <p className="text-[10px] text-muted-foreground">
                          Cerberus monitors your wallet every 3 minutes while you're offline. Customize when alerts fire.
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 px-1">
                        <div>
                          <label className="text-[9px] text-muted-foreground font-medium block mb-1">SOL Outflow Alert</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              value={solThreshold}
                              onChange={(e) => setSolThreshold(e.target.value)}
                              className="w-full bg-secondary/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono text-foreground focus:outline-none focus:border-primary/40"
                            />
                            <span className="text-[9px] text-muted-foreground">SOL</span>
                          </div>
                          <p className="text-[8px] text-muted-foreground mt-0.5">Alert when single outflow exceeds this</p>
                        </div>
                        <div>
                          <label className="text-[9px] text-muted-foreground font-medium block mb-1">Token Outflow Alert</label>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="10"
                              min="0"
                              value={usdThreshold}
                              onChange={(e) => setUsdThreshold(e.target.value)}
                              className="w-full bg-secondary/60 border border-border rounded px-2 py-1.5 text-[10px] font-mono text-foreground focus:outline-none focus:border-primary/40"
                            />
                            <span className="text-[9px] text-muted-foreground">USD</span>
                          </div>
                          <p className="text-[8px] text-muted-foreground mt-0.5">Alert when token outflow value exceeds this</p>
                        </div>
                      </div>

                      <button
                        onClick={handleSaveThresholds}
                        disabled={thresholdSaving}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary/10 border border-primary/20 rounded-lg text-primary text-[10px] font-semibold hover:bg-primary/20 transition-colors"
                      >
                        {thresholdSaving ? <Loader2 size={10} className="animate-spin" /> : thresholdSaved ? <><Check size={10} /> Saved</> : <><Settings2 size={10} /> Save Thresholds</>}
                      </button>

                      <button
                        onClick={() => {
                          setSolThreshold(CERBERUS_DEFAULTS.thresholdSolOutflow.toString());
                          setUsdThreshold(CERBERUS_DEFAULTS.thresholdTokenOutflowUsd.toString());
                        }}
                        className="w-full text-[9px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Reset to Cerberus Defaults (0.5 SOL / $50 USD)
                      </button>
                    </div>
                  )}

                  {/* Test & Scan footer */}
                  <div className="pt-2 border-t border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={handleTestNotification}
                        className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {testSent ? (
                          <><Check size={10} className="text-safe" /><span className="text-safe">Sent to all channels</span></>
                        ) : (
                          <><Send size={10} /> Send test notification</>
                        )}
                      </button>
                      <span className="text-[9px] text-muted-foreground">
                        {[
                          permission === 'granted' && 'Browser',
                          channelPrefs.emailEnabled && 'Email',
                          channelPrefs.telegramEnabled && channelPrefs.telegramChatId && 'Telegram',
                          channelPrefs.discordEnabled && channelPrefs.discordUserId && 'Discord',
                        ].filter(Boolean).join(' + ') || 'No channels active'}
                      </span>
                    </div>
                    {trackingActive && walletAddress && (
                      <div className="flex items-center justify-between">
                        <button
                          onClick={handleForceScan}
                          disabled={scanning}
                          className="flex items-center gap-2 text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
                        >
                          {scanning ? (
                            <><Loader2 size={10} className="animate-spin" /> Scanning wallet...</>
                          ) : scanResult ? (
                            <><Radar size={10} className="text-primary" /><span className="text-primary">{scanResult}</span></>
                          ) : (
                            <><Radar size={10} /> Force background scan now</>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>

    {/* ── Consent Modal (portaled to body to avoid transform/overflow issues) ── */}
    {showConsent && createPortal(
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          style={{ margin: 0, top: 0, left: 0, width: '100vw', height: '100vh' }}
          onClick={handleConsentDecline}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-xl max-w-md w-full p-6 space-y-4 mx-auto"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/15">
                <Radar size={18} className="text-primary" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-foreground">Enable Background Monitoring</h3>
                <p className="text-[10px] text-muted-foreground">Cerberus needs to track your wallet</p>
              </div>
            </div>

            <div className="p-3 bg-secondary/30 rounded-lg space-y-2">
              <p className="text-[11px] text-foreground leading-relaxed">
                By enabling notifications, your wallet address will be monitored by Cerberus in the background, even when you're not logged in.
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Every 3 minutes, Cerberus checks your recent transactions on-chain for suspicious activity
                (outflows, delegate approvals, authority changes). When something is detected, you'll receive
                an AI-enriched "Was this you?" alert on your configured channels.
              </p>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                ZeroTraceLabs stores your wallet address and notification preferences. We never access your private keys
                or sign transactions. You can disable monitoring at any time by turning off all notification channels.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleConsentAccept}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-primary/15 border border-primary/30 rounded-lg text-primary text-[11px] font-bold hover:bg-primary/25 transition-colors"
              >
                <Shield size={12} />
                I Agree, Enable Monitoring
              </button>
              <button
                onClick={handleConsentDecline}
                className="px-4 py-2.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>,
      document.body
    )}
    </>
  );
}