import React, { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Radio,
  ShieldAlert,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  KeyRound,
  Shield,
  XCircle,
  ExternalLink,
  Pause,
  Play,
  Trash2,
  Image,
  Cpu,
  Filter,
  EyeOff,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  startMonitoring,
  stopMonitoring,
  subscribeMonitor,
  getMonitorEvents,
  clearMonitorEvents,
  isMonitoring,
  isAutoPaused,
  type WalletEvent,
  type EventCategory,
  type EventSeverity,
} from '@/lib/walletMonitorService';

function categoryIcon(cat: EventCategory) {
  switch (cat) {
    case 'inflow': return <ArrowDownLeft size={12} />;
    case 'outflow': return <ArrowUpRight size={12} />;
    case 'approval': return <KeyRound size={12} />;
    case 'authority': return <ShieldAlert size={12} />;
    case 'nft-transfer': return <Image size={12} />;
    case 'close': return <XCircle size={12} />;
    case 'program': return <Cpu size={12} />;
    default: return <Radio size={12} />;
  }
}

function categoryLabel(cat: EventCategory): string {
  switch (cat) {
    case 'inflow': return 'Inflow';
    case 'outflow': return 'Outflow';
    case 'approval': return 'Delegate';
    case 'authority': return 'Authority';
    case 'nft-transfer': return 'NFT';
    case 'close': return 'Close';
    case 'program': return 'Program';
    default: return 'Other';
  }
}

function severityColor(sev: EventSeverity): string {
  switch (sev) {
    case 'danger': return 'text-destructive';
    case 'warning': return 'text-yellow-400';
    case 'info': return 'text-primary';
  }
}

function severityBg(sev: EventSeverity): string {
  switch (sev) {
    case 'danger': return 'bg-destructive/10 border-destructive/20';
    case 'warning': return 'bg-yellow-400/10 border-yellow-400/20';
    case 'info': return 'bg-secondary/40 border-border';
  }
}

function severityDot(sev: EventSeverity): string {
  switch (sev) {
    case 'danger': return 'bg-destructive';
    case 'warning': return 'bg-yellow-400';
    case 'info': return 'bg-primary';
  }
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function EventRow({ event }: { event: WalletEvent }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      className={`flex items-start gap-3 p-3 rounded-md border transition-colors ${severityBg(event.severity)}`}
    >
      {/* Icon */}
      <div className={`mt-0.5 shrink-0 ${severityColor(event.severity)}`}>
        {categoryIcon(event.category)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
          <span className={`text-[11px] font-bold ${severityColor(event.severity)}`}>
            {event.title}
          </span>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${severityDot(event.severity)}`} />
          <span className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-secondary/60 border border-border text-muted-foreground">
            {categoryLabel(event.category)}
          </span>
          <span className="text-[9px] text-muted-foreground">{timeAgo(event.timestamp)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          {event.description}
        </p>
        {event.programs.length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {event.programs.map((p, i) => (
              <span
                key={i}
                className="text-[8px] font-mono px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground"
              >
                {p}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Solscan link */}
      <a
        href={`https://solscan.io/tx/${event.signature}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-primary transition-colors shrink-0 mt-0.5"
        title="View on Solscan"
      >
        <ExternalLink size={10} />
      </a>
    </motion.div>
  );
}

type FilterType = 'all' | 'danger' | 'transfers' | 'delegates';

export function WalletMonitor() {
  const { publicKey, connected } = useWallet();
  const [events, setEvents] = useState<WalletEvent[]>([]);
  const [monitoring, setMonitoring] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tabPaused, setTabPaused] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');

  // Subscribe to monitor events
  useEffect(() => {
    const unsub = subscribeMonitor(() => {
      setEvents(getMonitorEvents());
      setMonitoring(isMonitoring());
      setTabPaused(isAutoPaused());
    });
    return unsub;
  }, []);

  // Start/stop monitoring on wallet connect/disconnect
  useEffect(() => {
    if (connected && publicKey && !paused) {
      startMonitoring(publicKey.toBase58());
    } else if (!connected) {
      stopMonitoring();
    }
    return () => {
      stopMonitoring();
    };
  }, [connected, publicKey, paused]);

  // Filtered events
  const filtered = useMemo(() => {
    switch (filter) {
      case 'danger':
        return events.filter((e) => e.severity === 'danger' || e.severity === 'warning');
      case 'transfers':
        return events.filter((e) => e.category === 'inflow' || e.category === 'outflow' || e.category === 'nft-transfer');
      case 'delegates':
        return events.filter((e) => e.category === 'approval' || e.category === 'authority');
      default:
        return events;
    }
  }, [events, filter]);

  // Severity counts
  const counts = useMemo(() => {
    const c = { danger: 0, warning: 0, info: 0 };
    for (const e of events) c[e.severity]++;
    return c;
  }, [events]);

  if (!connected) return null;

  const handleToggle = () => {
    if (paused) {
      setPaused(false);
      if (publicKey) startMonitoring(publicKey.toBase58());
    } else {
      setPaused(true);
      stopMonitoring();
    }
  };

  const handleClear = () => {
    clearMonitorEvents();
    setEvents([]);
  };

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'danger', label: 'Alerts' },
    { key: 'transfers', label: 'Transfers' },
    { key: 'delegates', label: 'Delegates' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-primary" />
          <h3 className="section-header text-xs font-semibold uppercase tracking-wider text-foreground">
            Live Monitor
          </h3>

          {/* Status */}
          {!paused && monitoring && !tabPaused && (
            <div className="flex items-center gap-1.5">
              <span className="inline-flex rounded-full h-2 w-2 bg-safe" />
              <span className="text-[9px] text-safe font-medium">LIVE</span>
            </div>
          )}
          {tabPaused && (
            <div className="flex items-center gap-1 text-[9px] text-yellow-400 font-semibold">
              <EyeOff size={9} />
              AUTO-PAUSED
            </div>
          )}
          {paused && !tabPaused && (
            <span className="text-[9px] text-yellow-400 font-semibold">PAUSED</span>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {counts.danger > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-destructive bg-destructive/10 px-1.5 py-0.5 rounded border border-destructive/20">
              <ShieldAlert size={9} />
              {counts.danger}
            </span>
          )}
          {counts.warning > 0 && (
            <span className="flex items-center gap-1 text-[9px] font-bold text-yellow-400 bg-yellow-400/10 px-1.5 py-0.5 rounded border border-yellow-400/20">
              <AlertTriangle size={9} />
              {counts.warning}
            </span>
          )}

          <button
            onClick={handleToggle}
            className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title={paused ? 'Resume monitoring' : 'Pause monitoring'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>

          {events.length > 0 && (
            <button
              onClick={handleClear}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Clear events"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      {events.length > 0 && (
        <div className="flex items-center gap-1 mb-3">
          <Filter size={10} className="text-muted-foreground mr-1" />
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`text-[9px] font-semibold px-2 py-1 rounded transition-colors ${
                filter === f.key
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Events list */}
      {filtered.length > 0 ? (
        <div className="space-y-1.5 max-h-[350px] overflow-y-auto">
          <AnimatePresence mode="popLayout">
            {filtered.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </AnimatePresence>
        </div>
      ) : (
        <div className="text-center py-8">
          <Radio size={20} className="mx-auto text-muted-foreground mb-2 opacity-40" />
          <p className="text-[11px] text-muted-foreground">
            {paused
              ? 'Monitoring paused — press play to resume'
              : tabPaused
                ? 'Auto-paused while tab is hidden — switch back to resume'
                : events.length > 0
                  ? 'No events match this filter'
                  : 'Listening for wallet activity...'}
          </p>
          <p className="text-[9px] text-muted-foreground mt-1">
            New transactions will appear here in real time
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-border flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground">
          {filtered.length}/{events.length} event{events.length !== 1 ? 's' : ''}
          {filter !== 'all' && ' (filtered)'}
        </span>
        <span className="text-[9px] text-muted-foreground">
          Auto-pauses when tab hidden
        </span>
      </div>
    </motion.div>
  );
}
