import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import nacl from "npm:tweetnacl@1.0.3";

/* ════════════════════════════════════════════════���══════════════
   ZeroTraceLabs — Discord Bot (Cerberus) v5
   Slash commands: /scan, /ask, /check
   Internal routes: /register, /alert, /dm
   ═══════════════════════════════════════════════════════════════ */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INTERACTION_PING = 1;
const INTERACTION_APPLICATION_COMMAND = 2;
const RESPONSE_PONG = 1;
const RESPONSE_DEFERRED = 5;
const DISCORD_API = "https://discord.com/api/v10";
const SOLANA_RPC = "https://mainnet.helius-rpc.com/?api-key=8f69d10b-adcf-45e3-a26f-055938e2648a";
const CERBERUS_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/cerberus-core`;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';

let _publicKey: string | null = null;

async function getPublicKey(): Promise<string> {
  if (_publicKey) return _publicKey;
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set');
  const resp = await fetch(`${DISCORD_API}/applications/@me`, {
    headers: { 'Authorization': `Bot ${token}` },
  });
  if (!resp.ok) throw new Error(`Failed to fetch app info: ${resp.status}`);
  const app = await resp.json();
  _publicKey = app.verify_key;
  return _publicKey!;
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

async function verifySignature(body: string, signature: string, timestamp: string): Promise<boolean> {
  try {
    const pubKey = await getPublicKey();
    const encoder = new TextEncoder();
    const message = encoder.encode(timestamp + body);
    return nacl.sign.detached.verify(message, hexToUint8Array(signature), hexToUint8Array(pubKey));
  } catch (e) {
    console.error('[Discord] Signature verification error:', e);
    return false;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getOption(options: { name: string; value: string }[] | undefined, name: string): string {
  return options?.find(o => o.name === name)?.value || '';
}

async function solanaRpc(method: string, params: unknown[]): Promise<unknown> {
  const resp = await fetch(SOLANA_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await resp.json();
  return data.result;
}

async function callCerberus(payload: Record<string, unknown>): Promise<string> {
  try {
    const resp = await fetch(CERBERUS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'apikey': SUPABASE_ANON,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return `Cerberus error: ${resp.status}`;
    const data = await resp.json();
    return data.response || JSON.stringify(data.briefing) || 'No response from Cerberus.';
  } catch (e) {
    return `Cerberus unavailable: ${e}`;
  }
}

async function editResponse(appId: string, token: string, content: Record<string, unknown>): Promise<void> {
  const url = `${DISCORD_API}/webhooks/${appId}/${token}/messages/@original`;
  await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
}

async function postToChannel(channelId: string, content: Record<string, unknown>): Promise<boolean> {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!botToken) return false;
  try {
    const resp = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Open a DM channel with a user and send a message.
 * This is how we send PRIVATE alerts to individual users.
 */
async function sendDM(userId: string, content: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN');
  if (!botToken) return { success: false, error: 'DISCORD_BOT_TOKEN not set' };

  try {
    // Step 1: Create DM channel
    const dmResp = await fetch(`${DISCORD_API}/users/@me/channels`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recipient_id: userId }),
    });

    if (!dmResp.ok) {
      const err = await dmResp.text();
      return { success: false, error: `Failed to open DM channel: ${err}` };
    }

    const dmChannel = await dmResp.json();

    // Step 2: Send message to DM channel
    const msgResp = await fetch(`${DISCORD_API}/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    });

    if (!msgResp.ok) {
      const err = await msgResp.text();
      return { success: false, error: `Failed to send DM: ${err}` };
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: String(e) };
  }
}

// Brand colors
const COLOR_CERBERUS = 0x00FFDD;
const COLOR_HEALTHY  = 0x00FF88;
const COLOR_CAUTION  = 0xFFAA00;
const COLOR_DANGER   = 0xFF3333;

function scoreColor(score: number): number {
  if (score >= 70) return COLOR_HEALTHY;
  if (score >= 40) return COLOR_CAUTION;
  return COLOR_DANGER;
}

function scoreTier(score: number): string {
  if (score >= 70) return '🟢 Healthy';
  if (score >= 40) return '🟡 Caution';
  return '🔴 Danger';
}

function severityColor(sev: string): number {
  switch (sev?.toLowerCase()) {
    case 'critical': return 0xFF0000;
    case 'high': return COLOR_DANGER;
    case 'med': case 'medium': return COLOR_CAUTION;
    case 'low': return COLOR_HEALTHY;
    default: return COLOR_CERBERUS;
  }
}

function severityEmoji(sev: string): string {
  switch (sev?.toLowerCase()) {
    case 'critical': return '🔴';
    case 'high': return '🟠';
    case 'med': case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '🛡️';
  }
}

function isValidSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

// ═══ COMMAND HANDLERS ═══

async function handleScan(appId: string, interactionToken: string, wallet: string): Promise<void> {
  if (!isValidSolanaAddress(wallet)) {
    await editResponse(appId, interactionToken, {
      embeds: [{ title: '❌ Invalid Address', description: `\`${wallet}\` is not a valid Solana address.`, color: COLOR_DANGER }],
    });
    return;
  }

  try {
    const [balanceResult, tokenResult, sigResult] = await Promise.all([
      solanaRpc('getBalance', [wallet]),
      solanaRpc('getTokenAccountsByOwner', [wallet, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]),
      solanaRpc('getSignaturesForAddress', [wallet, { limit: 10 }]),
    ]);

    const solBalance = ((balanceResult as any)?.value || 0) / 1e9;
    const tokenAccounts = (tokenResult as any)?.value || [];
    const signatures = (sigResult as any[]) || [];
    const failedTxCount = signatures.filter((s: any) => s.err !== null).length;

    let nftCount = 0, fungibleCount = 0;
    const delegates: { mint: string; delegate: string }[] = [];

    for (const acc of tokenAccounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      const decimals = info.tokenAmount?.decimals || 0;
      const amount = parseFloat(info.tokenAmount?.amount || '0');
      if (decimals === 0 && amount >= 1) nftCount++;
      else if (amount > 0) fungibleCount++;
      if (info.delegate && info.delegatedAmount) {
        const da = parseFloat(info.delegatedAmount.amount || '0');
        if (da > 0) delegates.push({ mint: info.mint, delegate: info.delegate });
      }
    }

    let healthScore = 70;
    healthScore += Math.min(fungibleCount * 2, 10);
    healthScore -= delegates.length * 8;
    healthScore -= failedTxCount * 3;
    if (solBalance > 0.01) healthScore += 5;
    healthScore = Math.max(0, Math.min(100, healthScore));

    const snapshot = {
      walletAddress: wallet, solBalance, healthScore, tokenCount: fungibleCount, nftCount,
      spamNftCount: 0,
      delegateApprovals: delegates.map(d => ({ ...d, symbol: d.mint.slice(0, 6), usdValue: 0 })),
      riskyTokens: [], failedTxCount,
      emptyAccounts: tokenAccounts.filter((a: any) => parseFloat(a.account?.data?.parsed?.info?.tokenAmount?.amount || '0') === 0).length,
      recentEvents: [],
    };

    const cerberusText = await callCerberus({ mode: 'briefing', channel: 'discord', walletSnapshot: snapshot });
    const assessment = cerberusText.length > 2000 ? cerberusText.slice(0, 2000) + '...' : cerberusText;

    await editResponse(appId, interactionToken, {
      embeds: [
        {
          title: `🛡️ Wallet Scan — ${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
          color: scoreColor(healthScore),
          fields: [
            { name: 'Health Score', value: `**${healthScore}/100** ${scoreTier(healthScore)}`, inline: true },
            { name: 'SOL Balance', value: `${solBalance.toFixed(4)} SOL`, inline: true },
            { name: 'Tokens', value: `${fungibleCount} fungible, ${nftCount} NFTs`, inline: true },
            { name: 'Delegates', value: `${delegates.length} active`, inline: true },
            { name: 'Failed Txns', value: `${failedTxCount}`, inline: true },
            { name: 'Recent Txns', value: `${signatures.length}`, inline: true },
          ],
          footer: { text: 'ZeroTraceLabs • Cerberus Security' },
          timestamp: new Date().toISOString(),
        },
        { title: '🔍 Cerberus Assessment', description: assessment, color: COLOR_CERBERUS },
      ],
    });
  } catch (e) {
    console.error('[Discord] Scan error:', e);
    await editResponse(appId, interactionToken, {
      embeds: [{ title: '⚠️ Scan Failed', description: `Could not complete scan for \`${wallet}\`.\n\nError: ${e}`, color: COLOR_DANGER }],
    });
  }
}

async function handleAsk(appId: string, interactionToken: string, question: string): Promise<void> {
  const response = await callCerberus({ message: question, channel: 'discord', mode: 'chat' });
  const text = response.length > 4000 ? response.slice(0, 4000) + '...' : response;
  await editResponse(appId, interactionToken, {
    embeds: [{ title: '🛡️ Cerberus', description: text, color: COLOR_CERBERUS, footer: { text: `Asked: ${question.slice(0, 100)}` }, timestamp: new Date().toISOString() }],
  });
}

async function handleCheck(appId: string, interactionToken: string, input: string): Promise<void> {
  const prompt = `Analyze this for security risks. It could be a URL, Solana address, or transaction. Determine what it is and assess the risk:\n\n\`${input}\``;
  const response = await callCerberus({ message: prompt, channel: 'discord', mode: 'chat' });
  const text = response.length > 4000 ? response.slice(0, 4000) + '...' : response;
  await editResponse(appId, interactionToken, {
    embeds: [{ title: '🔎 Security Check', description: text, color: COLOR_CERBERUS, footer: { text: `Checked: ${input.slice(0, 80)}` }, timestamp: new Date().toISOString() }],
  });
}

// ═���═ INTERNAL: POST ALERT TO CHANNEL (community-wide) ═══

async function handleChannelAlert(req: Request): Promise<Response> {
  try {
    const { title, body, type, color } = await req.json();
    const channelId = Deno.env.get('DISCORD_CHANNEL_ID');
    if (!channelId) return json({ error: 'DISCORD_CHANNEL_ID not configured' }, 500);
    const embedColor = color || (type === 'danger' ? COLOR_DANGER : type === 'warning' ? COLOR_CAUTION : COLOR_CERBERUS);
    const ok = await postToChannel(channelId, {
      embeds: [{
        title: `🛡️ ${title || 'Cerberus Alert'}`,
        description: (body || '').slice(0, 4000),
        color: embedColor,
        footer: { text: 'Cerberus — ZeroTraceLabs Security Agent' },
        timestamp: new Date().toISOString(),
        thumbnail: { url: 'https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg' },
      }],
    });
    return json({ success: ok });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

// ═══ INTERNAL: SEND DM TO USER (private alerts) ═══

async function handleDMAlert(req: Request): Promise<Response> {
  try {
    const { discord_user_id, title, body, severity, type } = await req.json();

    if (!discord_user_id) {
      return json({ error: 'Missing discord_user_id' }, 400);
    }
    if (!title || !body) {
      return json({ error: 'Missing title or body' }, 400);
    }

    const sev = severity || 'info';
    const emoji = severityEmoji(sev);
    const color = severityColor(sev);

    const fields: { name: string; value: string; inline?: boolean }[] = [];
    if (type) {
      fields.push({
        name: 'Alert Type',
        value: type.replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase()),
        inline: true,
      });
    }
    fields.push({ name: 'Severity', value: `${emoji} ${sev.toUpperCase()}`, inline: true });

    const result = await sendDM(discord_user_id, {
      embeds: [{
        title: `${emoji} ${title}`,
        description: body.slice(0, 4096),
        color,
        fields,
        footer: { text: 'Cerberus — ZeroTraceLabs Security Agent' },
        timestamp: new Date().toISOString(),
        thumbnail: { url: 'https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg' },
      }],
    });

    return json(result);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

// ═══ SLASH COMMAND REGISTRATION ═══

const COMMANDS = [
  {
    name: 'scan',
    description: 'Scan a Solana wallet for security risks',
    options: [{ name: 'wallet', description: 'Solana wallet address to scan', type: 3, required: true }],
  },
  {
    name: 'ask',
    description: 'Ask Cerberus a wallet security question',
    options: [{ name: 'question', description: 'Your security question', type: 3, required: true }],
  },
  {
    name: 'check',
    description: 'Check a URL, address, or transaction for risks',
    options: [{ name: 'input', description: 'URL, Solana address, or base64 transaction to check', type: 3, required: true }],
  },
];

async function registerCommands(): Promise<Response> {
  const token = Deno.env.get('DISCORD_BOT_TOKEN');
  const appId = Deno.env.get('DISCORD_APPLICATION_ID');
  if (!token || !appId) return json({ error: 'Missing DISCORD_BOT_TOKEN or DISCORD_APPLICATION_ID' }, 500);
  const resp = await fetch(`${DISCORD_API}/applications/${appId}/commands`, {
    method: 'PUT',
    headers: { 'Authorization': `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(COMMANDS),
  });
  const result = await resp.json();
  if (!resp.ok) return json({ error: 'Failed to register commands', details: result }, 502);
  return json({ success: true, commands: result.length || result.map?.((c: any) => c.name) || result });
}

// ═══ MAIN HANDLER ═══

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    if (url.pathname.endsWith('/register')) return await registerCommands();
    if (url.pathname.endsWith('/alert')) return await handleChannelAlert(req);
    if (url.pathname.endsWith('/dm')) return await handleDMAlert(req);

    // Discord interaction endpoint
    const signature = req.headers.get('x-signature-ed25519');
    const timestamp = req.headers.get('x-signature-timestamp');
    const body = await req.text();

    if (!signature || !timestamp) return json({ error: 'Missing signature headers' }, 401);
    const isValid = await verifySignature(body, signature, timestamp);
    if (!isValid) return json({ error: 'Invalid signature' }, 401);

    const interaction = JSON.parse(body);

    if (interaction.type === INTERACTION_PING) return json({ type: RESPONSE_PONG });

    if (interaction.type === INTERACTION_APPLICATION_COMMAND) {
      const { name, options } = interaction.data;
      const appId = Deno.env.get('DISCORD_APPLICATION_ID') || '';
      const interactionToken = interaction.token;

      const promise = (async () => {
        try {
          switch (name) {
            case 'scan': await handleScan(appId, interactionToken, getOption(options, 'wallet')); break;
            case 'ask': await handleAsk(appId, interactionToken, getOption(options, 'question')); break;
            case 'check': await handleCheck(appId, interactionToken, getOption(options, 'input')); break;
            default: await editResponse(appId, interactionToken, { content: `Unknown command: /${name}` });
          }
        } catch (e) {
          console.error(`[Discord] Command /${name} failed:`, e);
          try {
            await editResponse(appId, interactionToken, {
              embeds: [{ title: '⚠️ Error', description: `Something went wrong processing \`/${name}\`. Please try again.`, color: COLOR_DANGER }],
            });
          } catch { /* ignore */ }
        }
      })();

      try { (globalThis as any).EdgeRuntime?.waitUntil?.(promise); } catch { /* */ }
      return json({ type: RESPONSE_DEFERRED });
    }

    return json({ type: RESPONSE_PONG });
  } catch (err) {
    console.error('[Discord] Fatal error:', err);
    return json({ error: String(err) }, 500);
  }
});
