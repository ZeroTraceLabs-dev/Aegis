/**
 * Wallet Tracking Service
 *
 * Client-side interface for the `monitored_wallets` table.
 * Tracking is auto-enabled when the user enables notifications.
 * No separate UI needed — NotificationManager calls syncTrackingWithNotifications.
 */

import { supabase } from '@/lib/supabaseClient';

export interface WalletTrackingConfig {
  id?: string;
  walletAddress: string;
  enabled: boolean;
  thresholdSolOutflow: number;
  thresholdTokenOutflowUsd: number;
  alertOnDelegates: boolean;
  alertOnAuthority: boolean;
  alertOnNftTransfer: boolean;
  alertOnLargeOutflow: boolean;
  alertOnAnyOutflow: boolean;
  lastCheckedAt: string | null;
}

/** Cerberus-recommended defaults */
export const CERBERUS_DEFAULTS: Omit<WalletTrackingConfig, 'id' | 'walletAddress' | 'lastCheckedAt'> = {
  enabled: true,
  thresholdSolOutflow: 0.5,
  thresholdTokenOutflowUsd: 50,
  alertOnDelegates: true,
  alertOnAuthority: true,
  alertOnNftTransfer: true,
  alertOnLargeOutflow: true,
  alertOnAnyOutflow: false,
};

function rowToConfig(row: Record<string, unknown>): WalletTrackingConfig {
  return {
    id: row.id as string,
    walletAddress: row.wallet_address as string,
    enabled: row.enabled as boolean,
    thresholdSolOutflow: Number(row.threshold_sol_outflow ?? 0.5),
    thresholdTokenOutflowUsd: Number(row.threshold_token_outflow_usd ?? 50),
    alertOnDelegates: (row.alert_on_new_delegates as boolean) ?? true,
    alertOnAuthority: (row.alert_on_authority_changes as boolean) ?? true,
    alertOnNftTransfer: (row.alert_on_nft_transfers as boolean) ?? true,
    alertOnLargeOutflow: (row.alert_on_large_outflows as boolean) ?? true,
    alertOnAnyOutflow: (row.alert_on_any_outflow as boolean) ?? false,
    lastCheckedAt: row.last_checked_at as string | null,
  };
}

/** Get monitoring config for the current user's wallet */
export async function getTrackingConfig(walletAddress: string): Promise<WalletTrackingConfig | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('monitored_wallets')
    .select('*')
    .eq('user_id', user.id)
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error || !data) return null;
  return rowToConfig(data);
}

/**
 * Auto-sync tracking when notifications are enabled.
 * Called from NotificationManager — no separate UI needed.
 * Enabling any notification channel = wallet gets tracked.
 * Disabling all channels = tracking disabled.
 */
export async function syncTrackingWithNotifications(
  walletAddress: string,
  notificationsEnabled: boolean,
  thresholdOverrides?: Partial<WalletTrackingConfig>,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  if (!notificationsEnabled) {
    // Disable tracking when all notifications off
    const { error } = await supabase
      .from('monitored_wallets')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('wallet_address', walletAddress);
    return !error;
  }

  const merged = { ...CERBERUS_DEFAULTS, ...thresholdOverrides };

  const row = {
    user_id: user.id,
    wallet_address: walletAddress,
    enabled: true,
    threshold_sol_outflow: merged.thresholdSolOutflow,
    threshold_token_outflow_usd: merged.thresholdTokenOutflowUsd,
    alert_on_new_delegates: merged.alertOnDelegates,
    alert_on_authority_changes: merged.alertOnAuthority,
    alert_on_nft_transfers: merged.alertOnNftTransfer,
    alert_on_large_outflows: merged.alertOnLargeOutflow,
    alert_on_any_outflow: merged.alertOnAnyOutflow,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('monitored_wallets')
    .upsert(row, { onConflict: 'user_id,wallet_address' });

  return !error;
}

/** Update tracking thresholds */
export async function updateTrackingThresholds(
  walletAddress: string,
  updates: Partial<WalletTrackingConfig>,
): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (updates.thresholdSolOutflow !== undefined) row.threshold_sol_outflow = updates.thresholdSolOutflow;
  if (updates.thresholdTokenOutflowUsd !== undefined) row.threshold_token_outflow_usd = updates.thresholdTokenOutflowUsd;
  if (updates.alertOnDelegates !== undefined) row.alert_on_new_delegates = updates.alertOnDelegates;
  if (updates.alertOnAuthority !== undefined) row.alert_on_authority_changes = updates.alertOnAuthority;
  if (updates.alertOnNftTransfer !== undefined) row.alert_on_nft_transfers = updates.alertOnNftTransfer;
  if (updates.alertOnLargeOutflow !== undefined) row.alert_on_large_outflows = updates.alertOnLargeOutflow;
  if (updates.alertOnAnyOutflow !== undefined) row.alert_on_any_outflow = updates.alertOnAnyOutflow;

  const { error } = await supabase
    .from('monitored_wallets')
    .update(row)
    .eq('user_id', user.id)
    .eq('wallet_address', walletAddress);

  return !error;
}