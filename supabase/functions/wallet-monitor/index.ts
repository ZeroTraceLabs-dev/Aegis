import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Wallet Monitor (v3) — Cerberus Background Scanner
 *
 * Defense-in-depth: verifies user has active notification channels
 * BEFORE scanning or dispatching alerts. If all channels are disabled,
 * the wallet is auto-disabled in monitored_wallets (self-healing).
 *
 * v3 changes:
 *   - Alert dedup via ON CONFLICT on unique index (wallet_address, signature)
 *   - Graceful handling of duplicate inserts
 *
 * Trigger modes:
 *   - POST with service role key (cron job / external scheduler)
 *   - POST with user JWT + wallet_address (manual scan for one wallet)
 *
 * verify_jwt: false — auth handled internally.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const HELIUS_API_KEY = Deno.env.get("HELIUS_API_KEY");
if (!HELIUS_API_KEY) {
  throw new Error("Missing HELIUS_API_KEY environment variable");
}
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
const LAMPORTS_PER_SOL = 1_000_000_000;

interface MonitoredWallet {
  id: string;
  user_id: string;
  wallet_address: string;
  enabled: boolean;
  last_signature: string | null;
  last_checked_at: string | null;
  threshold_sol_outflow: number;
  threshold_token_outflow_usd: number;
  alert_on_new_delegates: boolean;
  alert_on_authority_changes: boolean;
  alert_on_nft_transfers: boolean;
  alert_on_large_outflows: boolean;
  alert_on_any_outflow: boolean;
}

interface AlertPayload {
  type: string;
  title: string;
  body: string;
  enrichWithCerberus: boolean;
  user_id: string;
}

interface ClassifiedAlert {
  category: string;
  severity: string;
  title: string;
  body: string;
  programs: string[];
  signature: string;
}

// ── Check if user has ANY active notification channel ───────

interface NotifPrefs {
  telegram_enabled: boolean;
  telegram_chat_id: string | null;
  discord_enabled: boolean;
  discord_user_id: string | null;
  email_enabled: boolean;
  alert_email: string | null;
}

function hasActiveChannels(prefs: NotifPrefs | null): boolean {
  if (!prefs) return false;
  const hasTelegram = prefs.telegram_enabled && !!prefs.telegram_chat_id;
  const hasDiscord = prefs.discord_enabled && !!prefs.discord_user_id;
  const hasEmail = prefs.email_enabled && !!prefs.alert_email;
  return hasTelegram || hasDiscord || hasEmail;
}

// ── Transaction classifier ──────────────────────────────────

function classifyTransaction(
  tx: Record<string, unknown>,
  walletAddress: string,
  config: MonitoredWallet
): ClassifiedAlert | null {
  try {
    const meta = tx.meta as Record<string, unknown> | null;
    const transaction = tx.transaction as Record<string, unknown> | null;
    const signature = (tx.transaction as Record<string, unknown>)?.signatures?.[0] as string ||
                       (tx as Record<string, unknown>).signature as string || 'unknown';

    if (!meta || !transaction) return null;
    if (meta.err) return null;

    const message = transaction.message as Record<string, unknown>;
    if (!message) return null;

    const accountKeys: string[] = [];
    const accountKeysRaw = message.accountKeys as Array<Record<string, unknown> | string>;
    if (accountKeysRaw) {
      for (const k of accountKeysRaw) {
        if (typeof k === 'string') accountKeys.push(k);
        else if (k.pubkey) accountKeys.push(k.pubkey as string);
      }
    }

    const walletIndex = accountKeys.indexOf(walletAddress);
    if (walletIndex === -1) return null;

    // ── Signer detection ──
    // In Solana's tx layout, the first `numRequiredSignatures` entries of
    // accountKeys are signers. If our wallet's index is past that boundary,
    // the wallet did NOT sign this transaction — i.e. someone else made it
    // happen. Lookup-table accounts (v0 transactions) are always non-signers,
    // so this check is correct for both legacy and v0 transactions.
    const header = message.header as Record<string, unknown> | undefined;
    const numRequiredSignatures = (header?.numRequiredSignatures as number) || 0;
    const walletWasSigner = walletIndex < numRequiredSignatures;

    const preBalances = (meta.preBalances as number[]) || [];
    const postBalances = (meta.postBalances as number[]) || [];
    const preSol = (preBalances[walletIndex] || 0) / LAMPORTS_PER_SOL;
    const postSol = (postBalances[walletIndex] || 0) / LAMPORTS_PER_SOL;
    const solChange = postSol - preSol;

    const programs = new Set<string>();
    const instructions = (message.instructions as Array<Record<string, unknown>>) || [];
    const innerInstructions = (meta.innerInstructions as Array<Record<string, unknown>>) || [];

    for (const ix of instructions) {
      const pid = ix.programId as string || accountKeys[ix.programIdIndex as number] || '';
      programs.add(labelProgram(pid));
    }
    for (const inner of innerInstructions) {
      const innerIxs = (inner.instructions as Array<Record<string, unknown>>) || [];
      for (const ix of innerIxs) {
        const pid = ix.programId as string || '';
        if (pid) programs.add(labelProgram(pid));
      }
    }

    const logMessages = (meta.logMessages as string[]) || [];
    const logText = logMessages.join(' ');

    // ── Authority change (CRITICAL) ──
    if (logText.includes('SetAuthority') || logText.includes('AuthorityType')) {
      if (!config.alert_on_authority_changes) return null;
      return {
        category: 'authorityChanges',
        severity: 'danger',
        title: 'CRITICAL: Authority Change Detected',
        body: `An authority change was executed on wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. ` +
              `This could allow another address to control your tokens. ` +
              `TX: ${signature.slice(0, 12)}... | Programs: ${[...programs].join(', ')}`,
        programs: [...programs],
        signature,
      };
    }

    // ── Delegate approval (HIGH) ──
    if (logText.includes('Approve') && !logText.includes('Revoke')) {
      if (!config.alert_on_new_delegates) return null;
      const approveCount = (logText.match(/Approve/g) || []).length;
      return {
        category: 'delegateChanges',
        severity: approveCount > 1 ? 'danger' : 'warning',
        title: approveCount > 1 ? `DANGER: ${approveCount} Delegate Approvals in One TX` : 'New Delegate Approved',
        body: `${approveCount > 1 ? 'Multiple delegates' : 'A delegate'} approved on wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. ` +
              `Delegates can spend tokens on your behalf. Was this you? ` +
              `TX: ${signature.slice(0, 12)}... | Programs: ${[...programs].join(', ')}`,
        programs: [...programs],
        signature,
      };
    }

    // ── NFT transfer (outbound — wallet signed) ──
    // Only fires when the wallet is a signer, i.e. an outgoing NFT transfer
    // the user authorized. Inbound NFTs (wallet not signer) are handled by
    // the unsolicited-inflow branch below — the right framing for those is
    // "an item arrived you didn't sign for," not "you transferred an NFT."
    if (walletWasSigner && (programs.has('Metaplex') || logText.includes('metaq')) && logText.includes('Transfer')) {
      if (!config.alert_on_nft_transfers) return null;
      return {
        category: 'spamAirdrops',
        severity: 'warning',
        title: 'NFT Transfer Detected',
        body: `An NFT was transferred from wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. ` +
              `Verify this was intentional. TX: ${signature.slice(0, 12)}...`,
        programs: [...programs],
        signature,
      };
    }

    // ── SOL outflow detection ──
    if (solChange < 0) {
      const outflowSol = Math.abs(solChange);

      if (outflowSol >= config.threshold_sol_outflow && config.alert_on_large_outflows) {
        const drainPercent = preSol > 0 ? (outflowSol / preSol) * 100 : 0;
        const isDrain = drainPercent > 80;

        return {
          category: 'largeOutflows',
          severity: isDrain ? 'danger' : 'warning',
          title: isDrain
            ? `EMERGENCY: ${outflowSol.toFixed(4)} SOL Drained (${drainPercent.toFixed(0)}% of wallet)`
            : `Large Outflow: ${outflowSol.toFixed(4)} SOL Sent`,
          body: isDrain
            ? `URGENT: ${outflowSol.toFixed(4)} SOL (${drainPercent.toFixed(0)}% of your balance) left wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} in a single transaction. ` +
              `Previous balance: ${preSol.toFixed(4)} SOL -> Now: ${postSol.toFixed(4)} SOL. ` +
              `If this was NOT you, activate Nuclear Evacuation immediately and revoke all approvals. ` +
              `TX: ${signature.slice(0, 12)}... | Programs: ${[...programs].join(', ')}`
            : `${outflowSol.toFixed(4)} SOL sent from wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. ` +
              `Balance: ${preSol.toFixed(4)} -> ${postSol.toFixed(4)} SOL. Was this you? ` +
              `TX: ${signature.slice(0, 12)}... | Programs: ${[...programs].join(', ')}`,
          programs: [...programs],
          signature,
        };
      }

      if (config.alert_on_any_outflow && outflowSol > 0.001) {
        return {
          category: 'largeOutflows',
          severity: 'info',
          title: `Outflow: ${outflowSol.toFixed(4)} SOL`,
          body: `${outflowSol.toFixed(4)} SOL sent from ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. TX: ${signature.slice(0, 12)}...`,
          programs: [...programs],
          signature,
        };
      }
    }

    // ── Token transfers (SPL) ──
    const preTokenBalances = (meta.preTokenBalances as Array<Record<string, unknown>>) || [];
    const postTokenBalances = (meta.postTokenBalances as Array<Record<string, unknown>>) || [];

    for (const pre of preTokenBalances) {
      if ((pre.owner as string) !== walletAddress) continue;
      const mint = pre.mint as string;
      const preAmount = parseFloat((pre.uiTokenAmount as Record<string, unknown>)?.uiAmountString as string || '0');
      const post = postTokenBalances.find((p: Record<string, unknown>) =>
        (p.owner as string) === walletAddress && (p.mint as string) === mint
      );
      const postAmount = post
        ? parseFloat((post.uiTokenAmount as Record<string, unknown>)?.uiAmountString as string || '0')
        : 0;
      const tokenChange = postAmount - preAmount;
      if (tokenChange < 0) {
        const loss = Math.abs(tokenChange);
        const drainPercent = preAmount > 0 ? (loss / preAmount) * 100 : 0;
        if (drainPercent > 80 && config.alert_on_large_outflows) {
          return {
            category: 'largeOutflows',
            severity: 'danger',
            title: `TOKEN DRAIN: ${drainPercent.toFixed(0)}% of ${mint.slice(0, 6)}... Removed`,
            body: `${loss.toFixed(2)} tokens (${drainPercent.toFixed(0)}% of holdings) of mint ${mint.slice(0, 8)}... ` +
                  `drained from wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}. ` +
                  `If this was NOT you, take immediate action. TX: ${signature.slice(0, 12)}...`,
            programs: [...programs],
            signature,
          };
        }
      }
    }

    // ── Unsolicited inflow detection ──
    // Fires when a token or NFT arrives in the wallet from a transaction the
    // wallet did NOT sign. Honest scope: we trigger only on SPL/NFT inflows
    // (not SOL), because SOL inflows have heavy non-malicious sources
    // (marketplace sales, payments, transfers from a friend) where the
    // user knew about the receipt without signing the inbound tx. Token/NFT
    // arrivals to a wallet that didn't sign are the classic airdrop-drainer
    // shape.
    //
    // Routed via category 'spamAirdrops' so it dispatches through the existing
    // notify_spam_airdrops preference column — no new plumbing in
    // send-notification or notification_preferences. Gated by
    // alert_on_nft_transfers since that's the existing flag for the same
    // class of event.
    if (!walletWasSigner && config.alert_on_nft_transfers) {
      type InflowItem = { mint: string; amount: number; isNft: boolean };
      const inflows: InflowItem[] = [];
      for (const post of postTokenBalances) {
        if ((post.owner as string) !== walletAddress) continue;
        const mint = post.mint as string;
        const postUi = post.uiTokenAmount as Record<string, unknown> | undefined;
        const postAmount = parseFloat((postUi?.uiAmountString as string) || '0');
        const decimals = (postUi?.decimals as number) ?? 0;
        const pre = preTokenBalances.find((p: Record<string, unknown>) =>
          (p.owner as string) === walletAddress && (p.mint as string) === mint
        );
        const preAmount = pre
          ? parseFloat(((pre.uiTokenAmount as Record<string, unknown>)?.uiAmountString as string) || '0')
          : 0;
        const change = postAmount - preAmount;
        if (change > 0) {
          inflows.push({ mint, amount: change, isNft: decimals === 0 && change >= 1 });
        }
      }

      if (inflows.length > 0) {
        const anyNft = inflows.some((i) => i.isNft);
        const allNft = inflows.every((i) => i.isNft);
        const itemPhrase = inflows.length === 1
          ? (inflows[0].isNft ? 'An NFT' : `${inflows[0].amount} of a token`)
          : (allNft ? `${inflows.length} NFTs` : (anyNft ? `${inflows.length} items` : `${inflows.length} tokens`));
        const mintList = inflows.slice(0, 3).map((i) => i.mint.slice(0, 8) + '...').join(', ');
        return {
          category: 'spamAirdrops',
          severity: 'warning',
          title: 'Unexpected Item Reached Your Wallet',
          body: `${itemPhrase} arrived in wallet ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)} ` +
                `from a transaction you did not sign. Were you expecting this? ` +
                `If not, do NOT interact with it, claim it, scan any QR code attached to it, or "redeem" it — ` +
                `the safest action is to leave it untouched. ` +
                `Mint(s): ${mintList} | TX: ${signature.slice(0, 12)}...`,
          programs: [...programs],
          signature,
        };
      }
    }

    return null;
  } catch (e) {
    console.error('[wallet-monitor] Classification error:', e);
    return null;
  }
}

function labelProgram(pid: string): string {
  const known: Record<string, string> = {
    '11111111111111111111111111111111': 'System',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'SPL Token',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'Token-2022',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'ATA',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Raydium',
    'ComputeBudget111111111111111111111111111111': 'Compute Budget',
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex',
  };
  return known[pid] || pid.slice(0, 8) + '...';
}

// ── Fetch recent transactions from Solana RPC ───────────────

async function fetchRecentTransactions(
  walletAddress: string,
  lastSignature: string | null,
  limit: number = 20
): Promise<Record<string, unknown>[]> {
  const sigParams: Record<string, unknown> = { limit };
  if (lastSignature) {
    sigParams.until = lastSignature;
  }

  const sigRes = await fetch(HELIUS_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getSignaturesForAddress',
      params: [walletAddress, sigParams],
    }),
  });

  const sigData = await sigRes.json();
  const signatures = (sigData.result || []) as Array<Record<string, unknown>>;
  if (signatures.length === 0) return [];

  console.log(`[wallet-monitor] ${walletAddress.slice(0, 8)}... has ${signatures.length} new signatures`);

  const txPromises = signatures.map(async (sig: Record<string, unknown>) => {
    try {
      const txRes = await fetch(HELIUS_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getTransaction',
          params: [sig.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }],
        }),
      });
      const txData = await txRes.json();
      if (txData.result) {
        txData.result.signature = sig.signature;
        return txData.result;
      }
      return null;
    } catch {
      return null;
    }
  });

  const txResults = await Promise.all(txPromises);
  return txResults.filter(Boolean) as Record<string, unknown>[];
}

// ── Main handler ────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    let targetWallets: MonitoredWallet[] = [];
    let requestBody: Record<string, unknown> = {};

    try {
      requestBody = await req.json();
    } catch { /* empty body for cron */ }

    const specificWallet = requestBody.wallet_address as string | undefined;

    if (specificWallet) {
      const { data, error } = await admin
        .from('monitored_wallets')
        .select('*')
        .eq('wallet_address', specificWallet)
        .eq('enabled', true);
      if (!error && data) targetWallets = data as MonitoredWallet[];
    } else {
      const { data, error } = await admin
        .from('monitored_wallets')
        .select('*')
        .eq('enabled', true);
      if (!error && data) targetWallets = data as MonitoredWallet[];
    }

    console.log(`[wallet-monitor] Found ${targetWallets.length} enabled wallet(s)`);

    if (targetWallets.length === 0) {
      return new Response(
        JSON.stringify({ scanned: 0, alerts: 0, message: 'No enabled wallets to monitor' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── DEFENSE IN DEPTH: Cross-check notification_preferences ──
    const userIds = [...new Set(targetWallets.map(w => w.user_id))];
    const { data: allPrefs } = await admin
      .from('notification_preferences')
      .select('user_id, telegram_enabled, telegram_chat_id, discord_enabled, discord_user_id, email_enabled, alert_email')
      .in('user_id', userIds);

    const prefsMap = new Map<string, NotifPrefs>();
    if (allPrefs) {
      for (const p of allPrefs) {
        prefsMap.set(p.user_id, p as NotifPrefs);
      }
    }

    // Filter out wallets whose users have NO active channels
    const activeWallets: MonitoredWallet[] = [];
    const autoDisabledWallets: string[] = [];

    for (const wallet of targetWallets) {
      const prefs = prefsMap.get(wallet.user_id) || null;
      if (hasActiveChannels(prefs)) {
        activeWallets.push(wallet);
      } else {
        autoDisabledWallets.push(wallet.wallet_address.slice(0, 8) + '...');
        await admin
          .from('monitored_wallets')
          .update({ enabled: false, updated_at: new Date().toISOString() })
          .eq('id', wallet.id);
        console.log(`[wallet-monitor] Auto-disabled ${wallet.wallet_address.slice(0, 8)}... — no active notification channels`);
      }
    }

    console.log(`[wallet-monitor] Scanning ${activeWallets.length} wallet(s) with active channels (auto-disabled ${autoDisabledWallets.length})`);

    if (activeWallets.length === 0) {
      return new Response(
        JSON.stringify({
          scanned: 0,
          alerts: 0,
          autoDisabled: autoDisabledWallets,
          message: 'All monitored wallets had notifications disabled — tracking auto-disabled',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let totalAlerts = 0;
    const results: Array<{ wallet: string; newTxns: number; alerts: number; errors: string[] }> = [];

    for (const wallet of activeWallets) {
      const walletResult = { wallet: wallet.wallet_address.slice(0, 8) + '...', newTxns: 0, alerts: 0, errors: [] as string[] };

      try {
        const transactions = await fetchRecentTransactions(
          wallet.wallet_address,
          wallet.last_signature,
          25
        );

        walletResult.newTxns = transactions.length;

        if (transactions.length === 0) {
          results.push(walletResult);
          await admin
            .from('monitored_wallets')
            .update({ last_checked_at: new Date().toISOString() })
            .eq('id', wallet.id);
          continue;
        }

        const alerts: ClassifiedAlert[] = [];
        for (const tx of transactions) {
          const alert = classifyTransaction(tx, wallet.wallet_address, wallet);
          if (alert) alerts.push(alert);
        }

        walletResult.alerts = alerts.length;
        totalAlerts += alerts.length;

        for (const alert of alerts) {
          try {
            const payload: AlertPayload = {
              type: alert.category,
              title: alert.title,
              body: alert.body,
              enrichWithCerberus: true,
              user_id: wallet.user_id,
            };

            const notifRes = await fetch(`${supabaseUrl}/functions/v1/send-notification`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify(payload),
            });

            const notifData = await notifRes.json();
            console.log(`[wallet-monitor] Alert dispatched: ${alert.title} -> sent=${JSON.stringify(notifData.sent)}`);

            // Insert with dedup — ON CONFLICT DO NOTHING for duplicate signatures
            const { error: insertError } = await admin.from('alert_history').insert({
              user_id: wallet.user_id,
              wallet_address: wallet.wallet_address,
              signature: alert.signature,
              category: alert.category,
              severity: alert.severity,
              title: alert.title,
              description: alert.body,
              enriched_body: notifData.enriched ? alert.body : null,
              programs: alert.programs,
              channels_sent: notifData.sent || [],
            });

            // 23505 = unique_violation — expected for dedup, not an error
            if (insertError && insertError.code !== '23505') {
              walletResult.errors.push(`db: ${insertError.message}`);
            }
          } catch (e) {
            walletResult.errors.push(`dispatch: ${e}`);
          }
        }

        const newestSig = transactions[0]?.signature as string ||
                          (transactions[0]?.transaction as Record<string, unknown>)?.signatures?.[0] as string;

        if (newestSig) {
          await admin
            .from('monitored_wallets')
            .update({
              last_signature: newestSig,
              last_checked_at: new Date().toISOString(),
            })
            .eq('id', wallet.id);
        }
      } catch (e) {
        walletResult.errors.push(`scan: ${e}`);
      }

      results.push(walletResult);
    }

    console.log(`[wallet-monitor] Complete: ${activeWallets.length} wallets, ${totalAlerts} alerts`);

    return new Response(
      JSON.stringify({
        scanned: activeWallets.length,
        alerts: totalAlerts,
        autoDisabled: autoDisabledWallets.length > 0 ? autoDisabledWallets : undefined,
        results,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('[wallet-monitor] Fatal error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
