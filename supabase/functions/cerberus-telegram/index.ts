import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * Cerberus Telegram Bot
 *
 * Receives webhook updates from Telegram, routes messages to cerberus-core,
 * and sends the response back via Telegram Bot API.
 *
 * GET ?setup_webhook=true  – Registers the Telegram webhook automatically.
 *
 * Commands:
 *   /start      – Welcome message
 *   /chatid     – Returns the user's chat ID (for notification setup)
 *   /scan <addr> – Quick address scan request
 *   free-form   – Conversational with Cerberus
 *
 * CRITICAL: Chat-id related questions are intercepted BEFORE routing to AI
 * so that Cerberus always provides the actual chat ID without confusion.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TelegramUpdate {
  message?: {
    chat: { id: number; first_name?: string };
    text?: string;
    from?: { first_name?: string; username?: string };
  };
}

async function sendTelegramMessage(chatId: number, text: string, botToken: string) {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Convert simple markdown to Telegram HTML */
function mdToHtml(md: string): string {
  let html = escapeHtml(md);
  html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```\w*\n?/g, '').replace(/```/g, '');
    return `<pre>${code}</pre>`;
  });
  return html;
}

/**
 * Detect if the user is asking about their chat ID in any conversational way.
 * This covers: "what's my chat id", "give me my chat id", "my telegram id",
 * "how do I find my chat id", "chat id please", "id for notifications", etc.
 */
function isChatIdQuestion(text: string): boolean {
  const lower = text.toLowerCase().replace(/[^a-z0-9\s]/g, '');
  const patterns = [
    /chat\s*id/,
    /telegram\s*id/,
    /my\s*id/,
    /get\s*(my)?\s*id/,
    /whats?\s*(my)?\s*id/,
    /give\s*(me)?\s*(my)?\s*id/,
    /need\s*(my)?\s*id/,
    /find\s*(my)?\s*id/,
    /show\s*(me)?\s*(my)?\s*id/,
    /tell\s*(me)?\s*(my)?\s*id/,
    /id\s*for\s*notification/,
    /id\s*for\s*alert/,
    /notification.*id/,
    /setup.*telegram/,
    /connect.*telegram/,
    /link.*telegram/,
  ];
  return patterns.some(p => p.test(lower));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── GET ?setup_webhook=true — auto-register Telegram webhook ──
    const url = new URL(req.url);
    if (url.searchParams.get('setup_webhook') === 'true') {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const webhookUrl = `${supabaseUrl}/functions/v1/cerberus-telegram`;

      const tgRes = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ['message'],
            drop_pending_updates: true,
          }),
        },
      );
      const tgData = await tgRes.json();
      return new Response(JSON.stringify({ ok: true, telegram: tgData, webhook_url: webhookUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── POST: Telegram webhook update ──
    const update: TelegramUpdate = await req.json();
    const message = update.message;
    if (!message?.text) {
      return new Response('ok', { headers: corsHeaders });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const firstName = message.from?.first_name || 'there';

    // ── /start command ──
    if (text === '/start') {
      await sendTelegramMessage(
        chatId,
        `\u{1F6E1} <b>Cerberus | ZeroTraceLabs</b>\n\n` +
        `Welcome, ${escapeHtml(firstName)}. I'm Cerberus, your AI wallet security agent.\n\n` +
        `I can:\n` +
        `\u2022 Assess wallet security risks with severity + confidence ratings\n` +
        `\u2022 Explain token authority flags and rug-pull risk grades\n` +
        `\u2022 Analyze addresses and URLs for phishing signals\n` +
        `\u2022 Guide you through the ZeroTraceLabs security playbook\n` +
        `\u2022 Give you your Chat ID for notification setup\n\n` +
        `<b>Commands:</b>\n` +
        `/chatid \u2014 Get your Chat ID for alert setup\n` +
        `/scan &lt;address&gt; \u2014 Quick address risk analysis\n\n` +
        `Or just ask me anything \u2014 including \"what's my chat ID?\" and I'll tell you right away.`,
        botToken,
      );
      return new Response('ok', { headers: corsHeaders });
    }

    // ── /chatid command ──
    if (text === '/chatid') {
      await sendTelegramMessage(
        chatId,
        `\u{1F511} <b>Your Chat ID:</b> <code>${chatId}</code>\n\n` +
        `Copy this and paste it into the ZeroTraceLabs dashboard:\n` +
        `Notifications \u2192 Telegram Chat ID field.\n\n` +
        `Once saved, Cerberus will send you real-time alerts here whenever suspicious activity is detected on your wallet.`,
        botToken,
      );
      return new Response('ok', { headers: corsHeaders });
    }

    // ── Conversational chat ID request (INTERCEPTED before AI) ──
    if (isChatIdQuestion(text)) {
      await sendTelegramMessage(
        chatId,
        `\u{1F511} <b>Your Chat ID:</b> <code>${chatId}</code>\n\n` +
        `<b>How to set up Telegram alerts:</b>\n` +
        `1. Go to the ZeroTraceLabs dashboard\n` +
        `2. Open Notifications panel\n` +
        `3. Enable Telegram\n` +
        `4. Paste <code>${chatId}</code> in the Chat ID field\n` +
        `5. Save \u2014 you're done\n\n` +
        `Once connected, I'll send you real-time \"Was this you?\" alerts with AI analysis whenever something suspicious happens on your wallet \u2014 even when you're offline.`,
        botToken,
      );
      return new Response('ok', { headers: corsHeaders });
    }

    // ── /scan command ──
    let userMessage = text;
    if (text.startsWith('/scan')) {
      const addr = text.replace('/scan', '').trim();
      if (!addr) {
        await sendTelegramMessage(chatId, '\u26A0\uFE0F Usage: <code>/scan &lt;solana address&gt;</code>', botToken);
        return new Response('ok', { headers: corsHeaders });
      }
      userMessage = `Analyze this Solana address for security risks: ${addr}. Determine account type, check for authority flags, assess risk level. Use the full structured output (Risk Summary, Why, Next Steps, Confidence).`;
    }

    // ── Send typing action ──
    await fetch(`https://api.telegram.org/bot${botToken}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
    });

    // ── Route to Cerberus Core ──
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const coreResponse = await fetch(`${supabaseUrl}/functions/v1/cerberus-core`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({
        message: userMessage,
        channel: 'telegram',
        mode: 'chat',
        context: {
          telegram_chat_id: chatId,
          user_name: firstName,
        },
      }),
    });

    if (!coreResponse.ok) {
      const errDetail = await coreResponse.text().catch(() => 'unknown');
      console.error(`[CerberusTelegram] Core error: ${coreResponse.status} \u2014 ${errDetail}`);
      await sendTelegramMessage(
        chatId,
        '\u26A0\uFE0F I\'m having trouble processing that request. Try again in a moment.',
        botToken,
      );
      return new Response('ok', { headers: corsHeaders });
    }

    const coreData = await coreResponse.json();
    const reply = coreData.response || 'I couldn\'t generate a response. Please try again.';

    const htmlReply = mdToHtml(reply);

    if (htmlReply.length <= 4096) {
      await sendTelegramMessage(chatId, htmlReply, botToken);
    } else {
      const chunks: string[] = [];
      let current = '';
      for (const line of htmlReply.split('\n')) {
        if ((current + '\n' + line).length > 4000) {
          chunks.push(current);
          current = line;
        } else {
          current += (current ? '\n' : '') + line;
        }
      }
      if (current) chunks.push(current);
      for (const chunk of chunks) {
        await sendTelegramMessage(chatId, chunk, botToken);
      }
    }

    return new Response('ok', { headers: corsHeaders });
  } catch (err) {
    console.error('[CerberusTelegram] Error:', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
