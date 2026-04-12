import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * Multi-channel notification dispatcher (v16)
 *
 * CRITICAL: verify_jwt disabled at gateway level because Web3 Solana
 * auth tokens are not validated by Supabase's standard JWT gateway check.
 * Auth is verified INSIDE the function via supabase.auth.getUser().
 *
 * Channels:
 *   - Telegram: Bot API via TELEGRAM_BOT_TOKEN
 *   - Discord: PRIVATE DMs via discord-bot /dm route (uses discord_user_id)
 *   - Email: Resend API via RESEND_API_KEY (uses alert_email || auth.users.email)
 *
 * Auth modes:
 *   - User JWT: dispatches to the authenticated user's preferences
 *   - Service role + user_id in body: dispatches on behalf of a user (for poller)
 *
 * Special types:
 *   - type: 'test' — bypasses alert-type filtering, sends to ALL enabled channels
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotificationPayload {
  type: string;
  title: string;
  body: string;
  enrichWithCerberus?: boolean;
  user_id?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildEmailHtml(title: string, body: string): string {
  const escapedTitle = escapeHtml(title);
  const escapedBody = escapeHtml(body)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#0a0a0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0f;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#12121a;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#00d2ff22,#ff006622);padding:24px 32px;border-bottom:1px solid #1e1e2e;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td><img src="https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg" width="36" height="36" style="border-radius:50%;vertical-align:middle;" alt="Cerberus"/></td>
              <td style="padding-left:12px;">
                <span style="color:#00d2ff;font-weight:700;font-size:14px;letter-spacing:0.5px;">Cerberus</span>
                <span style="color:#666;font-size:12px;margin-left:4px;">| ZeroTraceLabs</span>
              </td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <h2 style="color:#e6e6eb;font-size:16px;margin:0 0 16px 0;font-weight:600;">\ud83d\udee1\ufe0f ${escapedTitle}</h2>
          <div style="color:#a0a0b0;font-size:13px;line-height:1.7;">${escapedBody}</div>
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #1e1e2e;">
          <p style="color:#555;font-size:10px;margin:0;text-align:center;">Cerberus \u2014 Your AI Wallet Security Agent<br/>
          <a href="https://zerotrace.io" style="color:#00d2ff;text-decoration:none;">zerotrace.io</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function alertSeverity(type: string): string {
  switch (type) {
    case 'authorityChanges': case 'largeOutflows': return 'high';
    case 'delegateChanges': return 'med';
    case 'spamAirdrops': return 'low';
    case 'healthDrops': return 'med';
    case 'test': return 'info';
    default: return 'info';
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const payload: NotificationPayload = await req.json();
    const { type, title, body, enrichWithCerberus, user_id: explicitUserId } = payload;
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "Missing title or body" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Determine user ID — verify auth inside the function
    let userId: string | null = null;
    let authUserEmail: string | null = null;
    const isServiceRole = authHeader.includes(supabaseServiceKey);

    if (isServiceRole && explicitUserId) {
      userId = explicitUserId;
      const adminClient = createClient(supabaseUrl, supabaseServiceKey);
      const { data: { user: authUser } } = await adminClient.auth.admin.getUserById(explicitUserId);
      authUserEmail = authUser?.email || null;
    } else {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        console.error('[send-notification] Auth failed:', userError?.message);
        return new Response(JSON.stringify({ error: "Unauthorized", detail: userError?.message }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = user.id;
      authUserEmail = user.email || null;
    }

    if (!userId) {
      return new Response(JSON.stringify({ error: "Could not determine user" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[send-notification] User ${userId} | type=${type} | test=${type === 'test'}`);

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    const { data: prefs, error: prefsError } = await adminClient
      .from("notification_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefsError) {
      console.error('[send-notification] Prefs error:', prefsError.message);
    }

    if (!prefs) {
      console.log('[send-notification] No prefs found for user');
      return new Response(JSON.stringify({ sent: [], message: "No notification preferences configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve email: alert_email (explicit) > auth.users.email (fallback)
    const effectiveEmail: string | null = prefs.alert_email || authUserEmail || null;

    console.log(`[send-notification] Prefs: tg=${prefs.telegram_enabled}/${prefs.telegram_chat_id}, dc=${prefs.discord_enabled}/${prefs.discord_user_id}, email=${prefs.email_enabled}/${effectiveEmail ? 'has-email' : 'no-email'}`);

    // Check alert-type filter — SKIP for 'test' type (always send)
    const isTestNotification = type === 'test';
    if (!isTestNotification) {
      const typeToColumn: Record<string, string> = {
        healthDrops: "notify_health_drops",
        spamAirdrops: "notify_spam_airdrops",
        delegateChanges: "notify_delegate_changes",
        authorityChanges: "notify_authority_changes",
        largeOutflows: "notify_suspicious_activity",
      };
      const col = typeToColumn[type];
      if (col && prefs[col] === false) {
        return new Response(JSON.stringify({ sent: [], message: "Alert type disabled by user" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Enrich via Cerberus Core (skip for test)
    let enrichedBody = body;
    let enrichedTitle = title;
    if (enrichWithCerberus !== false && !isTestNotification) {
      try {
        const enrichRes = await fetch(`${supabaseUrl}/functions/v1/cerberus-core`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ mode: 'enrich-alert', channel: 'alert', alertData: { type, title, body } }),
        });
        if (enrichRes.ok) {
          const enrichData = await enrichRes.json();
          if (enrichData.response) {
            enrichedBody = enrichData.response;
            enrichedTitle = `Cerberus Alert: ${title}`;
          }
        }
      } catch {
        console.warn('[send-notification] Cerberus enrichment failed, using raw alert');
      }
    }

    const results: string[] = [];
    const errors: string[] = [];

    // ── Telegram ──
    if (prefs.telegram_enabled && prefs.telegram_chat_id) {
      const telegramBotToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
      if (telegramBotToken) {
        try {
          const tgText = `\ud83d\udee1\ufe0f <b>${escapeHtml(enrichedTitle)}</b>\n\n${escapeHtml(enrichedBody)}\n\n<i>\u2014 Cerberus | ZeroTraceLabs</i>`;
          const tgRes = await fetch(
            `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: prefs.telegram_chat_id,
                text: tgText,
                parse_mode: "HTML",
                disable_web_page_preview: true,
              }),
            }
          );
          if (tgRes.ok) {
            results.push("telegram");
            console.log('[send-notification] Telegram sent OK');
          } else {
            const errText = await tgRes.text();
            console.error(`[send-notification] Telegram error: ${errText}`);
            errors.push(`telegram: ${errText}`);
          }
        } catch (e) {
          errors.push(`telegram: ${e}`);
        }
      } else {
        errors.push("telegram: TELEGRAM_BOT_TOKEN not configured");
      }
    }

    // ── Discord (Private DMs via bot) ──
    if (prefs.discord_enabled && prefs.discord_user_id) {
      try {
        const dmRes = await fetch(`${supabaseUrl}/functions/v1/discord-bot/dm`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            discord_user_id: prefs.discord_user_id,
            title: enrichedTitle,
            body: enrichedBody,
            severity: alertSeverity(type),
            type,
          }),
        });

        if (dmRes.ok) {
          const dmData = await dmRes.json();
          if (dmData.success) {
            results.push('discord-dm');
            console.log('[send-notification] Discord DM sent OK');
          } else {
            errors.push(`discord-dm: ${dmData.error || 'Unknown error'}`);
          }
        } else {
          errors.push(`discord-dm: ${await dmRes.text()}`);
        }
      } catch (e) {
        errors.push(`discord-dm: ${e}`);
      }
    }

    // ── Email (Resend API) — uses alert_email > auth email ──
    if (prefs.email_enabled && effectiveEmail) {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      const fromEmail = Deno.env.get("CERBERUS_FROM_EMAIL") || "Cerberus <alerts@zerotrace.io>";
      if (resendApiKey) {
        try {
          const emailHtml = buildEmailHtml(enrichedTitle, enrichedBody);
          const emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: fromEmail, to: [effectiveEmail], subject: `\ud83d\udee1\ufe0f ${enrichedTitle}`, html: emailHtml }),
          });
          if (emailRes.ok) {
            results.push("email");
            console.log(`[send-notification] Email sent OK to ${effectiveEmail}`);
          } else {
            errors.push(`email: ${await emailRes.text()}`);
          }
        } catch (e) {
          errors.push(`email: ${e}`);
        }
      } else {
        errors.push("email: RESEND_API_KEY not configured");
      }
    } else if (prefs.email_enabled && !effectiveEmail) {
      errors.push("email: No email address available (set alert_email in notification preferences)");
    }

    console.log(`[send-notification] Results: sent=${results.join(',')}, errors=${errors.join(',') || 'none'}`);

    return new Response(
      JSON.stringify({ sent: results, errors: errors.length > 0 ? errors : undefined, enriched: enrichedBody !== body }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error('[send-notification] Fatal error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
