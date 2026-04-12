# Cerberus — Migration Manifest

> Single source of truth for everything that constitutes the Cerberus AI security agent.
> Hand this to your infra team when moving off Supabase.

---

## Architecture Overview

```
User (Dashboard)  ──►  cerberus-core (Edge Function)  ──►  OpenAI API
User (Telegram)   ──►  cerberus-telegram (Edge Function)  ──►  cerberus-core  ──►  OpenAI API
Wallet Monitor    ──►  send-notification  ──►  cerberus-core (enrich-alert mode)  ──►  OpenAI API
```

---

## Edge Functions

### `cerberus-core`
- **Purpose**: Central AI brain. Receives chat messages or alert enrichment requests, wraps them with the V2 system prompt, sends to OpenAI, returns streaming or non-streaming responses.
- **Source**: `supabase/functions/cerberus-core/index.ts`
- **Endpoint**: `POST /functions/v1/cerberus-core`
- **Auth**: `verify_jwt: false` (public access, no JWT required)
- **Modes**:
  - `chat` — Conversational, streams response (dashboard) or returns JSON (Telegram/Discord)
  - `enrich-alert` — Ultra-concise alert enrichment (max 100 words)
- **Channels**: `dashboard`, `telegram`, `discord`, `alert`
- **Model**: `gpt-4o-mini`
- **Secrets**: `OPENAI_API_KEY`

### `cerberus-telegram`
- **Purpose**: Telegram bot webhook handler. Receives updates from Telegram, routes to cerberus-core, sends response back via Bot API.
- **Source**: `supabase/functions/cerberus-telegram/index.ts`
- **Endpoint**: `POST /functions/v1/cerberus-telegram` (Telegram webhook)
- **Endpoint**: `GET /functions/v1/cerberus-telegram?setup_webhook=true` (one-time webhook registration)
- **Auth**: `verify_jwt: false` (Telegram sends raw POST, no JWT)
- **Commands**: `/start`, `/chatid`, `/scan <address>`, free-form chat
- **Secrets**: `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-provided)

---

## Frontend Components

### `src/components/CerberusChat.tsx`
- Floating chat panel (bottom-right corner)
- Streaming message display with markdown rendering
- Quick action buttons for common security questions
- Expandable/minimizable panel
- Sends wallet context (address, email) with each message

### `src/lib/cerberusService.ts`
- Client-side streaming interface to cerberus-core
- Handles SSE parsing, delta accumulation, error recovery
- Exports: `streamCerberusChat()`, `createMessage()`, `CERBERUS_QUICK_ACTIONS`

---

## Assets

| File | Purpose |
|------|---------|
| `src/assets/cerberus-avatar.jpg` | Cerberus 3-headed dog avatar (used in chat panel, floating button, message bubbles) |

---

## Secrets Required

| Secret | Used By | Purpose |
|--------|---------|---------|
| `OPENAI_API_KEY` | cerberus-core | OpenAI API access (gpt-4o-mini) |
| `TELEGRAM_BOT_TOKEN` | cerberus-telegram | Telegram Bot API authentication |

These must be set as environment variables / secrets in whatever runtime hosts the functions.

---

## Integration Points

### send-notification → cerberus-core
The `send-notification` edge function calls cerberus-core in `enrich-alert` mode to add AI context to wallet security alerts before sending them to users via Telegram/Discord/email.

```
send-notification  →  POST cerberus-core { mode: "enrich-alert", alertData: {...} }
                   ←  { response: "enriched alert text" }
```

### Dashboard → cerberus-core
The CerberusChat component calls cerberus-core via streaming SSE for real-time conversational responses.

### Telegram → cerberus-telegram → cerberus-core
Telegram webhook delivers user messages to cerberus-telegram, which forwards to cerberus-core and relays the response back via Telegram Bot API.

---

## Environment Variables (Frontend)

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Base URL for edge function calls |
| `VITE_SUPABASE_ANON_KEY` | Fallback auth token for edge function calls |

---

## Setup Steps (Fresh Deployment)

1. **Deploy cerberus-core** — Any serverless runtime that supports Deno/Node. Needs `OPENAI_API_KEY` env var.
2. **Deploy cerberus-telegram** — Same runtime. Needs `TELEGRAM_BOT_TOKEN` env var + network access to cerberus-core.
3. **Register Telegram webhook** — `GET /cerberus-telegram?setup_webhook=true` (one-time)
4. **Set frontend env vars** — Point `VITE_SUPABASE_URL` to your API gateway / function host.
5. **Verify** — Send `/start` to the Telegram bot. Open the dashboard chat panel. Both should respond.

---

## Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| OpenAI API | gpt-4o-mini | LLM inference |
| Telegram Bot API | v7+ | Telegram message send/receive |
| Supabase Edge Runtime | Latest | Current hosting (replaceable with any Deno/Node runtime) |
| `@supabase/supabase-js` | ^2.57.4 | Client-side auth session for token retrieval |

---

## System Prompt Location

The full V2 system prompt lives inside `cerberus-core/index.ts` as the `CERBERUS_SYSTEM_PROMPT` constant. When migrating, this is the single most important piece — it defines Cerberus's personality, severity rubrics, safety rules, escalation policy, and module awareness.

---

*Last updated: 2026-04-05*
