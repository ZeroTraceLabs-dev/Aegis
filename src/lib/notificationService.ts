/**
 * Notification Service
 *
 * Manages browser notifications AND external channel dispatch
 * (Telegram, Discord, Email) via Supabase edge function.
 *
 * Browser notification settings are stored in localStorage.
 * External channel preferences are stored in Supabase notification_preferences table.
 */

import { supabase } from '@/lib/supabaseClient';

const STORAGE_KEY = 'ztl-notification-settings';

// ---------- Browser notification settings (localStorage) ----------

export interface NotificationSettings {
  enabled: boolean;
  healthDrops: boolean;
  spamAirdrops: boolean;
  delegateChanges: boolean;
  authorityChanges: boolean;
  largeOutflows: boolean;
}

const DEFAULT_SETTINGS: NotificationSettings = {
  enabled: true,
  healthDrops: true,
  spamAirdrops: true,
  delegateChanges: true,
  authorityChanges: true,
  largeOutflows: true,
};

let settings: NotificationSettings = { ...DEFAULT_SETTINGS };
let permissionGranted = false;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    settings = { ...DEFAULT_SETTINGS };
  }
}

function notify() {
  listeners.forEach((fn) => fn());
}

// Initialize
load();
if ('Notification' in window) {
  permissionGranted = Notification.permission === 'granted';
}

export function subscribeNotificationSettings(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getNotificationSettings(): NotificationSettings {
  return { ...settings };
}

export function updateNotificationSettings(updates: Partial<NotificationSettings>) {
  settings = { ...settings, ...updates };
  persist();
  notify();
}

export function isNotificationSupported(): boolean {
  return 'Notification' in window;
}

export function getPermissionStatus(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') { permissionGranted = true; return true; }
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  permissionGranted = result === 'granted';
  notify();
  return permissionGranted;
}

/** Send a browser notification */
export function sendBrowserNotification(
  type: keyof Omit<NotificationSettings, 'enabled'>,
  title: string,
  body: string,
  options?: { tag?: string; icon?: string },
) {
  if (!settings.enabled || !settings[type] || !permissionGranted) return;
  try {
    const n = new Notification(title, {
      body,
      icon: options?.icon || 'https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg',
      tag: options?.tag || `ztl-${type}-${Date.now()}`,
      badge: 'https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg',
      silent: false,
    });
    setTimeout(() => n.close(), 8000);
  } catch (err) {
    console.warn('[Notifications] Browser notification failed:', err);
  }
}

// Keep old name as alias for backward compat
export const sendNotification = sendBrowserNotification;

// ---------- External channel preferences (Supabase) ----------

export interface ChannelPreferences {
  emailEnabled: boolean;
  alertEmail: string;
  telegramEnabled: boolean;
  telegramChatId: string;
  discordEnabled: boolean;
  discordUserId: string;
  notifyHealthDrops: boolean;
  notifySpamAirdrops: boolean;
  notifyDelegateChanges: boolean;
  notifyAuthorityChanges: boolean;
  notifySuspiciousActivity: boolean;
}

const DEFAULT_CHANNEL_PREFS: ChannelPreferences = {
  emailEnabled: true,
  alertEmail: '',
  telegramEnabled: false,
  telegramChatId: '',
  discordEnabled: false,
  discordUserId: '',
  notifyHealthDrops: true,
  notifySpamAirdrops: true,
  notifyDelegateChanges: true,
  notifyAuthorityChanges: true,
  notifySuspiciousActivity: true,
};

let channelPrefs: ChannelPreferences = { ...DEFAULT_CHANNEL_PREFS };
let channelPrefsLoaded = false;

/** Load channel preferences from Supabase */
export async function loadChannelPreferences(): Promise<ChannelPreferences> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ...DEFAULT_CHANNEL_PREFS };

    const { data, error } = await supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error || !data) {
      channelPrefs = { ...DEFAULT_CHANNEL_PREFS };
    } else {
      channelPrefs = {
        emailEnabled: data.email_enabled ?? true,
        alertEmail: data.alert_email ?? '',
        telegramEnabled: data.telegram_enabled ?? false,
        telegramChatId: data.telegram_chat_id ?? '',
        discordEnabled: data.discord_enabled ?? false,
        discordUserId: data.discord_user_id ?? '',
        notifyHealthDrops: data.notify_health_drops ?? true,
        notifySpamAirdrops: data.notify_spam_airdrops ?? true,
        notifyDelegateChanges: data.notify_delegate_changes ?? true,
        notifyAuthorityChanges: data.notify_authority_changes ?? true,
        notifySuspiciousActivity: data.notify_suspicious_activity ?? true,
      };
    }
    channelPrefsLoaded = true;
    notify();
    return { ...channelPrefs };
  } catch {
    return { ...DEFAULT_CHANNEL_PREFS };
  }
}

export function getChannelPreferences(): ChannelPreferences {
  return { ...channelPrefs };
}

export function isChannelPrefsLoaded(): boolean {
  return channelPrefsLoaded;
}

/** Save channel preferences to Supabase */
export async function saveChannelPreferences(updates: Partial<ChannelPreferences>): Promise<boolean> {
  channelPrefs = { ...channelPrefs, ...updates };
  notify();

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const row = {
      user_id: user.id,
      email_enabled: channelPrefs.emailEnabled,
      alert_email: channelPrefs.alertEmail || null,
      telegram_enabled: channelPrefs.telegramEnabled,
      telegram_chat_id: channelPrefs.telegramChatId || null,
      discord_enabled: channelPrefs.discordEnabled,
      discord_user_id: channelPrefs.discordUserId || null,
      notify_health_drops: channelPrefs.notifyHealthDrops,
      notify_spam_airdrops: channelPrefs.notifySpamAirdrops,
      notify_delegate_changes: channelPrefs.notifyDelegateChanges,
      notify_authority_changes: channelPrefs.notifyAuthorityChanges,
      notify_suspicious_activity: channelPrefs.notifySuspiciousActivity,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('notification_preferences')
      .upsert(row, { onConflict: 'user_id' });

    return !error;
  } catch {
    return false;
  }
}

// ---------- Multi-channel dispatch ----------

type AlertType = 'healthDrops' | 'spamAirdrops' | 'delegateChanges' | 'authorityChanges' | 'largeOutflows';

const ALERT_TO_CHANNEL_KEY: Record<AlertType, keyof ChannelPreferences> = {
  healthDrops: 'notifyHealthDrops',
  spamAirdrops: 'notifySpamAirdrops',
  delegateChanges: 'notifyDelegateChanges',
  authorityChanges: 'notifyAuthorityChanges',
  largeOutflows: 'notifySuspiciousActivity',
};

/**
 * Dispatch notification to ALL enabled channels:
 * browser, email, Telegram, Discord
 */
export async function dispatchNotification(
  type: AlertType,
  title: string,
  body: string,
  options?: { tag?: string },
) {
  // 1) Browser notification (always attempt)
  sendBrowserNotification(type, title, body, options);

  // 2) External channels via edge function
  const channelKey = ALERT_TO_CHANNEL_KEY[type];
  if (!channelPrefs[channelKey]) return; // user disabled this alert type

  // Re-read current prefs to avoid stale closure
  const currentPrefs = channelPrefs;
  const hasExternal =
    (currentPrefs.emailEnabled) ||
    (currentPrefs.telegramEnabled && currentPrefs.telegramChatId) ||
    (currentPrefs.discordEnabled && currentPrefs.discordUserId);

  if (!hasExternal) return;

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
    // Route through send-notification which calls Cerberus for AI-enriched alerts
    fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ type, title, body }),
    }).catch(() => { /* fire and forget */ });
  } catch { /* silent */ }
}

// ---------- Convenience helpers ----------

export function notifyHealthDrop(oldScore: number, newScore: number) {
  if (newScore >= oldScore) return;
  const drop = oldScore - newScore;
  if (drop < 5) return;
  dispatchNotification(
    'healthDrops',
    `Health Score Dropped: ${newScore}`,
    `Your wallet security score dropped by ${drop} points (was ${oldScore}).`,
    { tag: 'health-drop' },
  );
}

export function notifyDelegateChange(action: 'approved' | 'revoked', tokenSymbol: string) {
  dispatchNotification(
    'delegateChanges',
    `Delegate ${action === 'approved' ? 'Approved' : 'Revoked'}`,
    `A delegate was ${action} for ${tokenSymbol}.`,
    { tag: `delegate-${action}` },
  );
}

export function notifyAuthorityChange() {
  dispatchNotification(
    'authorityChanges',
    'Authority Change Detected',
    'A token authority was modified on your wallet. Verify this was intentional.',
    { tag: 'authority-change' },
  );
}

export function notifySpamAirdrop(tokenName: string) {
  dispatchNotification(
    'spamAirdrops',
    'Suspected Spam Airdrop',
    `"${tokenName}" was flagged as a potential spam token in your wallet.`,
    { tag: 'spam-airdrop' },
  );
}