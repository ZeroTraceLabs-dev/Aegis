import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Send,
  X,
  Loader2,
  ChevronDown,
  Sparkles,
  Bot,
  User,
  Minimize2,
  Maximize2,
  ShieldCheck,
} from 'lucide-react';
import cerberusAvatar from '@/assets/cerberus-avatar.jpg';
import { motion, AnimatePresence } from 'framer-motion';
import {
  streamCerberusChat,
  createMessage,
  CERBERUS_QUICK_ACTIONS,
  type CerberusMessage,
} from '@/lib/cerberusService';
import { useAuth } from '@/hooks/useAuth';
import { addToWhitelist, isWhitelisted } from '@/lib/whitelistStore';

/* ── Cerberus branding icon ────────────────────────────────── */

function CerberusIcon({ size = 32 }: { size?: number }) {
  return (
    <div
      className="relative flex items-center justify-center rounded-full overflow-hidden cerberus-icon-bg ring-2 ring-primary/25 shadow-lg shadow-primary/10"
      style={{ width: size, height: size }}
    >
      <img src={cerberusAvatar} alt="Cerberus" className="w-full h-full object-cover" />
      <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-safe animate-pulse" />
    </div>
  );
}

/* ── Message bubble ────────────────────────────────────────── */

function WhitelistActionButton({ address, label }: { address: string; label: string }) {
  const [added, setAdded] = React.useState(isWhitelisted(address));

  const handleAdd = () => {
    const success = addToWhitelist(address, label, 'cerberus');
    if (success) setAdded(true);
  };

  if (added) {
    return (
      <div className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-md bg-safe/10 border border-safe/25 text-[9px] font-bold text-safe">
        <ShieldCheck size={10} /> Trusted: {label} ({address.slice(0, 4)}...{address.slice(-4)})
      </div>
    );
  }

  return (
    <button
      onClick={handleAdd}
      className="flex items-center gap-1.5 mt-2 px-2.5 py-1.5 rounded-md bg-safe/10 border border-safe/30 text-[9px] font-bold text-safe hover:bg-safe/20 hover:border-safe/50 transition-all"
    >
      <ShieldCheck size={10} />
      Trust "{label}" ({address.slice(0, 4)}...{address.slice(-4)})
    </button>
  );
}

function MessageBubble({ msg }: { msg: CerberusMessage }) {
  const isUser = msg.role === 'user';
  const whitelistActions = !isUser ? parseWhitelistActions(msg.content) : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-[10px] overflow-hidden ${
        isUser ? 'bg-secondary text-foreground' : 'cerberus-icon-bg ring-1 ring-primary/15'
      }`}>
        {isUser ? <User size={14} /> : <img src={cerberusAvatar} alt="Cerberus" className="w-full h-full object-cover" />}
      </div>

      {/* Content */}
      <div className={`max-w-[85%] rounded-lg px-3 py-2 text-[11px] leading-relaxed ${
        isUser
          ? 'bg-primary/15 text-foreground border border-primary/20'
          : 'bg-secondary/60 text-foreground border border-border'
      }`}>
        <div className="cerberus-markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
        {whitelistActions.map((action) => (
          <WhitelistActionButton key={action.address} address={action.address} label={action.label} />
        ))}
      </div>
    </motion.div>
  );
}

/** Parse whitelist action markers from Cerberus response */
function parseWhitelistActions(text: string): { address: string; label: string }[] {
  const regex = /\[WHITELIST_ACTION:\s*([1-9A-HJ-NP-Za-km-z]{32,44}),\s*(.+?)\]/g;
  const results: { address: string; label: string }[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    results.push({ address: match[1], label: match[2].trim() });
  }
  return results;
}

/** Minimal markdown renderer */
function renderMarkdown(text: string): string {
  // Strip whitelist action markers from displayed text
  let cleaned = text.replace(/\[WHITELIST_ACTION:\s*[1-9A-HJ-NP-Za-km-z]{32,44},\s*.+?\]/g, '');

  let html = cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const code = match.replace(/```\w*\n?/g, '').replace(/```/g, '');
    return `<pre class="bg-background/60 rounded px-2 py-1 my-1 text-[10px] overflow-x-auto border border-border">${code}</pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-background/60 px-1 rounded text-primary text-[10px]">$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="text-foreground font-bold">$1</strong>');

  // Line breaks
  html = html.replace(/\n/g, '<br />');

  return html;
}

/* ── Main CerberusChat panel ──────���─────────���─────────���──���─── */

export function CerberusChat() {
  const { connected, publicKey } = useWallet();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<CerberusMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when opened
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming) return;

    const userMsg = createMessage('user', text.trim());
    const assistantMsg = createMessage('assistant', '');

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);

    // Build context
    const context: Record<string, unknown> = {};
    if (publicKey) context.walletAddress = publicKey.toBase58();
    if (user?.email) context.userEmail = user.email;

    await streamCerberusChat({
      messages: [...messages, userMsg],
      context,
      onDelta: (delta) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + delta };
          }
          return updated;
        });
      },
      onDone: () => {
        setStreaming(false);
      },
      onError: (error) => {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: `Error: ${error}` };
          }
          return updated;
        });
        setStreaming(false);
      },
    });
  }, [messages, streaming, publicKey, user]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const isLoggedIn = !!user;

  return (
    <>
      {/* ── Floating trigger button ── */}
      <AnimatePresence>
        {!open && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={() => setOpen(true)}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-full bg-card border border-primary/30 card-glow hover:border-primary/60 transition-all group"
            title="Ask Cerberus"
          >
            <CerberusIcon size={36} />
            <span className="text-[11px] font-bold text-foreground hidden sm:inline">Cerberus</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Chat panel ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className={`fixed z-50 bg-card border border-border rounded-xl shadow-2xl flex flex-col overflow-hidden cerberus-panel ${
              expanded
                ? 'inset-4 sm:inset-8'
                : 'bottom-6 right-6 w-[380px] h-[520px] max-h-[80vh]'
            }`}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-secondary/30">
              <div className="flex items-center gap-2.5">
                <CerberusIcon size={28} />
                <div>
                  <h3 className="text-[11px] font-bold text-foreground">Cerberus</h3>
                  <p className="text-[8px] text-muted-foreground">Aegis Security Agent</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title={expanded ? 'Minimize' : 'Expand'}
                >
                  {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Close"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 cerberus-scroll">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="cerberus-icon-bg w-20 h-20 rounded-full flex items-center justify-center mb-4 overflow-hidden ring-2 ring-primary/25 shadow-lg shadow-primary/10">
                    <img src={cerberusAvatar} alt="Cerberus" className="w-full h-full object-cover" />
                  </div>
                  <h4 className="text-xs font-bold text-foreground mb-1">Cerberus Security Agent</h4>
                  <p className="text-[10px] text-muted-foreground mb-5 max-w-[260px] leading-relaxed">
                    Your AI-powered wallet security assistant. Ask me about risks, tokens, phishing, or anything security-related.
                  </p>

                  {/* Quick actions */}
                  <div className="flex flex-wrap gap-1.5 justify-center max-w-[320px]">
                    {CERBERUS_QUICK_ACTIONS.map((action) => (
                      <button
                        key={action.label}
                        onClick={() => sendMessage(action.prompt)}
                        disabled={!isLoggedIn}
                        className="px-2.5 py-1.5 rounded-md bg-secondary/60 border border-border text-[9px] font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>

                  {!isLoggedIn && (
                    <p className="mt-4 text-[9px] text-muted-foreground">
                      Sign in to chat with Cerberus
                    </p>
                  )}
                </div>
              )}

              {messages.map((msg) => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}

              {/* Streaming indicator */}
              {streaming && messages.length > 0 && messages[messages.length - 1].content === '' && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 size={12} className="animate-spin text-primary" />
                  <span className="text-[9px]">Cerberus is thinking...</span>
                </div>
              )}
            </div>

            {/* Input */}
            <form onSubmit={handleSubmit} className="px-3 py-2.5 border-t border-border bg-secondary/20">
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={isLoggedIn ? 'Ask Cerberus anything...' : 'Sign in to chat'}
                  disabled={!isLoggedIn || streaming}
                  className="flex-1 bg-secondary/60 border border-border rounded-md px-3 py-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 disabled:opacity-40 transition-colors"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || !isLoggedIn || streaming}
                  className="p-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {streaming ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[8px] text-muted-foreground">
                  Powered by OpenAI
                </span>
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMessages([])}
                    className="text-[8px] text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear chat
                  </button>
                )}
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}