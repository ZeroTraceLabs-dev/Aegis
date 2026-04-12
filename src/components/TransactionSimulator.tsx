import React, { useState, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ScanSearch,
  Play,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Info,
  ChevronDown,
  Copy,
  Check,
  ExternalLink,
  Cpu,
  Trash2,
  Globe,
  Coins,
  FileCode,
  Lock,
  Unlock,
  Link2,
  Wallet,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  simulateTransaction,
  type SimulationResult,
  type SimulationFlag,
  type SimulatedProgramCall,
} from '@/lib/txSimulatorService';
import { scanUrl, type UrlScanResult } from '@/lib/urlScannerService';
import { scanContractAddress, type CaScanResult } from '@/lib/caScannerService';

type InputType = 'transaction' | 'url' | 'address' | 'unknown';

interface UnifiedResult {
  type: InputType;
  txResult?: SimulationResult;
  urlResult?: UrlScanResult;
  caResult?: CaScanResult;
}

// --- Input type detection ---
function detectInputType(input: string): InputType {
  const trimmed = input.trim();
  if (!trimmed) return 'unknown';

  // URL detection
  if (/^https?:\/\//i.test(trimmed) || /^[a-z0-9][-a-z0-9]*\.[a-z]{2,}/i.test(trimmed)) {
    // Has a dot and looks like a domain or starts with http
    if (trimmed.includes('.') && !trimmed.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      return 'url';
    }
  }

  // Solana address detection (base58, 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed)) {
    return 'address';
  }

  // Base64 transaction (longer, contains base64 chars, may have padding)
  if (/^[A-Za-z0-9+/]+=*$/.test(trimmed) && trimmed.length > 50) {
    return 'transaction';
  }

  // If it has dots / slashes, likely URL
  if (trimmed.includes('.') && (trimmed.includes('/') || trimmed.includes(':'))) {
    return 'url';
  }

  return 'unknown';
}

function inputTypeLabel(type: InputType): { label: string; icon: React.ReactNode; color: string } {
  switch (type) {
    case 'transaction':
      return { label: 'Transaction', icon: <FileCode size={10} />, color: 'text-primary bg-primary/10 border-primary/20' };
    case 'url':
      return { label: 'URL', icon: <Globe size={10} />, color: 'text-cyan-400 bg-cyan-400/10 border-cyan-400/20' };
    case 'address':
      return { label: 'Address', icon: <Coins size={10} />, color: 'text-accent bg-accent/10 border-accent/20' };
    default:
      return { label: 'Unknown', icon: <ScanSearch size={10} />, color: 'text-muted-foreground bg-secondary border-border' };
  }
}

function abbr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function FlagIcon({ severity }: { severity: SimulationFlag['severity'] }) {
  switch (severity) {
    case 'danger': return <ShieldAlert size={12} className="text-destructive shrink-0" />;
    case 'warning': return <AlertTriangle size={12} className="text-yellow-400 shrink-0" />;
    case 'info': return <Info size={12} className="text-primary shrink-0" />;
  }
}

function flagBg(severity: SimulationFlag['severity']): string {
  switch (severity) {
    case 'danger': return 'bg-destructive/10 border-destructive/20';
    case 'warning': return 'bg-yellow-400/10 border-yellow-400/20';
    case 'info': return 'bg-primary/5 border-primary/15';
  }
}

function riskColor(level: string): string {
  switch (level) {
    case 'safe': return 'text-safe';
    case 'low': return 'text-cyan-400';
    case 'medium': return 'text-yellow-400';
    case 'high': return 'text-orange-400';
    case 'critical': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
}

function riskBg(level: string): string {
  switch (level) {
    case 'safe': return 'bg-safe/10 border-safe/20';
    case 'low': return 'bg-cyan-400/10 border-cyan-400/20';
    case 'medium': return 'bg-yellow-400/10 border-yellow-400/20';
    case 'high': return 'bg-orange-400/10 border-orange-400/20';
    case 'critical': return 'bg-destructive/10 border-destructive/20';
    default: return 'bg-secondary border-border';
  }
}

function ProgramBadge({ program }: { program: SimulatedProgramCall }) {
  return (
    <a
      href={`https://solscan.io/account/${program.programId}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold border transition-colors hover:opacity-80 ${
        program.isSuspicious
          ? 'bg-destructive/10 border-destructive/20 text-destructive'
          : 'bg-secondary/60 border-border text-foreground'
      }`}
    >
      {program.isSuspicious && <ShieldAlert size={10} />}
      <span>{program.label}</span>
      <span className="text-muted-foreground font-mono">{abbr(program.programId)}</span>
      <ExternalLink size={8} className="text-muted-foreground" />
    </a>
  );
}

// --- Flags section (shared) ---
function FlagsSection({ flags }: { flags: SimulationFlag[] }) {
  if (!flags.length) return null;
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Analysis Flags
      </span>
      {flags.map((flag, i) => (
        <div key={i} className={`flex items-start gap-2 px-3 py-2 rounded-md border ${flagBg(flag.severity)}`}>
          <FlagIcon severity={flag.severity} />
          <span className="text-[11px] text-foreground leading-relaxed">{flag.message}</span>
        </div>
      ))}
    </div>
  );
}

// --- URL result view ---
function UrlResultView({ result }: { result: UrlScanResult }) {
  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md border ${riskBg(result.riskLevel)}`}>
        {result.riskLevel === 'safe' || result.riskLevel === 'low' ? (
          <ShieldCheck size={18} className={riskColor(result.riskLevel)} />
        ) : (
          <ShieldAlert size={18} className={riskColor(result.riskLevel)} />
        )}
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${riskColor(result.riskLevel)} uppercase`}>
              {result.riskLevel} Risk
            </span>
            <span className="text-[10px] text-muted-foreground">(Score: {result.score}/100)</span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Globe size={10} className="text-muted-foreground" />
            <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[300px]">{result.domain}</span>
          </div>
        </div>
      </div>

      {/* Typosquat match */}
      {result.matchedLegitDomain && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-destructive/10 border border-destructive/20">
          <AlertTriangle size={14} className="text-destructive shrink-0" />
          <div className="text-[11px]">
            <span className="font-bold text-destructive">Possible typosquat detected</span>
            <span className="text-muted-foreground"> -- did you mean </span>
            <span className="font-mono font-bold text-foreground">{result.matchedLegitDomain}</span>
            <span className="text-muted-foreground">?</span>
          </div>
        </div>
      )}

      <FlagsSection flags={result.flags} />
    </div>
  );
}

// --- CA result view ---
function CaResultView({ result }: { result: CaScanResult }) {
  const typeIcon = result.accountType === 'token-mint'
    ? <Coins size={14} />
    : result.accountType === 'program'
      ? <FileCode size={14} />
      : <Wallet size={14} />;

  const typeLabel = result.accountType === 'token-mint'
    ? 'Token Mint'
    : result.accountType === 'program'
      ? 'Program'
      : result.accountType === 'wallet'
        ? 'Wallet'
        : 'Unknown';

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-md border ${riskBg(result.riskLevel)}`}>
        {result.riskLevel === 'safe' || result.riskLevel === 'low' ? (
          <ShieldCheck size={18} className={riskColor(result.riskLevel)} />
        ) : (
          <ShieldAlert size={18} className={riskColor(result.riskLevel)} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold ${riskColor(result.riskLevel)} uppercase`}>
              {result.riskLevel} Risk
            </span>
            <span className="text-[10px] text-muted-foreground">(Score: {result.score}/100)</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-muted-foreground">{typeIcon}</span>
            <span className="text-[10px] font-semibold text-foreground">{result.label}</span>
            <span className="text-[9px] font-mono text-muted-foreground">{abbr(result.address)}</span>
          </div>
        </div>
        <a
          href={`https://solscan.io/account/${result.address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
        >
          <ExternalLink size={12} />
        </a>
      </div>

      {/* Token-specific details */}
      {result.accountType === 'token-mint' && (
        <div className="grid grid-cols-2 gap-2">
          <div className={`p-2.5 rounded-md border text-[10px] ${result.details.hasMintAuthority ? 'bg-destructive/10 border-destructive/20' : 'bg-safe/10 border-safe/20'}`}>
            <div className="flex items-center gap-1 font-bold mb-0.5">
              {result.details.hasMintAuthority ? <Unlock size={10} className="text-destructive" /> : <Lock size={10} className="text-safe" />}
              <span className={result.details.hasMintAuthority ? 'text-destructive' : 'text-safe'}>Mint Authority</span>
            </div>
            <span className="text-muted-foreground">
              {result.details.hasMintAuthority ? 'ACTIVE — supply can be inflated' : 'Revoked — supply is fixed'}
            </span>
          </div>
          <div className={`p-2.5 rounded-md border text-[10px] ${result.details.hasFreezeAuthority ? 'bg-destructive/10 border-destructive/20' : 'bg-safe/10 border-safe/20'}`}>
            <div className="flex items-center gap-1 font-bold mb-0.5">
              {result.details.hasFreezeAuthority ? <Unlock size={10} className="text-destructive" /> : <Lock size={10} className="text-safe" />}
              <span className={result.details.hasFreezeAuthority ? 'text-destructive' : 'text-safe'}>Freeze Authority</span>
            </div>
            <span className="text-muted-foreground">
              {result.details.hasFreezeAuthority ? 'ACTIVE — tokens can be frozen' : 'Revoked — cannot be frozen'}
            </span>
          </div>
        </div>
      )}

      {/* Detail chips */}
      {Object.keys(result.details).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {result.details.symbol && (
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
              Symbol: {String(result.details.symbol)}
            </span>
          )}
          {result.details.name && typeof result.details.name === 'string' && (
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
              Name: {result.details.name}
            </span>
          )}
          {result.details.decimals !== undefined && (
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
              Decimals: {String(result.details.decimals)}
            </span>
          )}
          {result.details.supply !== undefined && typeof result.details.supply === 'number' && (
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
              Supply: {result.details.supply.toLocaleString()}
            </span>
          )}
          {result.details.balance !== undefined && (
            <span className="text-[9px] font-mono px-2 py-0.5 rounded bg-secondary border border-border text-foreground">
              Balance: {String(result.details.balance)} SOL
            </span>
          )}
          {result.details.upgradeable !== undefined && (
            <span className={`text-[9px] font-mono px-2 py-0.5 rounded border ${result.details.upgradeable ? 'bg-yellow-400/10 border-yellow-400/20 text-yellow-400' : 'bg-safe/10 border-safe/20 text-safe'}`}>
              {result.details.upgradeable ? 'Upgradeable' : 'Immutable'}
            </span>
          )}
        </div>
      )}

      {/* Programs */}
      {result.programs.length > 0 && (
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
            Program Info
          </span>
          <div className="flex flex-wrap gap-1.5">
            {result.programs.map((p) => <ProgramBadge key={p.programId} program={p} />)}
          </div>
        </div>
      )}

      <FlagsSection flags={result.flags} />
    </div>
  );
}

// --- Transaction result view (original) ---
function TxResultView({ result }: { result: SimulationResult }) {
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);
  const dangerCount = result.flags.filter((f) => f.severity === 'danger').length;
  const warnCount = result.flags.filter((f) => f.severity === 'warning').length;

  const copyLogs = () => {
    navigator.clipboard.writeText(result.logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {/* Status banner */}
      <div
        className={`flex items-center gap-2 px-3 py-2.5 rounded-md border ${
          !result.success
            ? 'bg-destructive/10 border-destructive/20'
            : dangerCount > 0
              ? 'bg-destructive/10 border-destructive/20'
              : warnCount > 0
                ? 'bg-yellow-400/10 border-yellow-400/20'
                : 'bg-safe/10 border-safe/20'
        }`}
      >
        {!result.success ? (
          <ShieldAlert size={16} className="text-destructive shrink-0" />
        ) : dangerCount > 0 ? (
          <ShieldAlert size={16} className="text-destructive shrink-0" />
        ) : warnCount > 0 ? (
          <AlertTriangle size={16} className="text-yellow-400 shrink-0" />
        ) : (
          <ShieldCheck size={16} className="text-safe shrink-0" />
        )}
        <div>
          <span className="text-xs font-bold text-foreground">
            {!result.success
              ? 'Simulation Failed'
              : dangerCount > 0
                ? `${dangerCount} Danger Flag${dangerCount > 1 ? 's' : ''} Detected`
                : warnCount > 0
                  ? `${warnCount} Warning${warnCount > 1 ? 's' : ''} Detected`
                  : 'No Suspicious Patterns'}
          </span>
          {result.error && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{result.error}</p>
          )}
        </div>
      </div>

      <FlagsSection flags={result.flags} />

      {/* Programs invoked */}
      {result.programs.length > 0 && (
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block mb-2">
            Programs Invoked ({result.programs.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {result.programs.map((p) => <ProgramBadge key={p.programId} program={p} />)}
          </div>
        </div>
      )}

      {/* Compute units */}
      {result.unitsConsumed > 0 && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <Cpu size={10} />
          <span>
            Compute: <span className="font-mono font-semibold text-foreground">{result.unitsConsumed.toLocaleString()}</span> CU
          </span>
        </div>
      )}

      {/* Logs */}
      {result.logs.length > 0 && (
        <div>
          <button
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown size={12} className={`transition-transform ${showLogs ? 'rotate-180' : ''}`} />
            Simulation Logs ({result.logs.length})
          </button>

          <AnimatePresence>
            {showLogs && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 relative">
                  <button
                    onClick={copyLogs}
                    className="absolute top-2 right-2 p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors z-10"
                    title="Copy logs"
                  >
                    {copied ? <Check size={10} className="text-safe" /> : <Copy size={10} />}
                  </button>
                  <div className="bg-secondary/40 border border-border rounded-md p-3 max-h-48 overflow-y-auto">
                    {result.logs.map((log, i) => (
                      <div
                        key={i}
                        className={`text-[9px] font-mono leading-relaxed ${
                          log.includes('failed') || log.includes('Error')
                            ? 'text-destructive'
                            : log.includes('success')
                              ? 'text-safe'
                              : 'text-muted-foreground'
                        }`}
                      >
                        {log}
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// === MAIN COMPONENT ===
export function TransactionSimulator() {
  const { connected } = useWallet();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<UnifiedResult | null>(null);

  const detectedType = useMemo(() => detectInputType(input), [input]);
  const typeInfo = useMemo(() => inputTypeLabel(detectedType), [detectedType]);

  const handleScan = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const type = detectInputType(trimmed);
    setLoading(true);
    setResult(null);

    try {
      switch (type) {
        case 'url': {
          const urlRes = scanUrl(trimmed);
          setResult({ type: 'url', urlResult: urlRes });
          break;
        }
        case 'address': {
          const caRes = await scanContractAddress(trimmed);
          setResult({ type: 'address', caResult: caRes });
          break;
        }
        case 'transaction': {
          const txRes = await simulateTransaction(trimmed);
          setResult({ type: 'transaction', txResult: txRes });
          break;
        }
        default: {
          // Try address first, then transaction
          try {
            if (/^[1-9A-HJ-NP-Za-km-z]{30,50}$/.test(trimmed)) {
              const caRes = await scanContractAddress(trimmed);
              setResult({ type: 'address', caResult: caRes });
            } else {
              const txRes = await simulateTransaction(trimmed);
              setResult({ type: 'transaction', txResult: txRes });
            }
          } catch {
            setResult({
              type: 'unknown',
              txResult: {
                success: false,
                error: 'Could not determine input type. Paste a URL, Solana address, or base64 transaction.',
                balanceChanges: [], programs: [], logs: [],
                flags: [{ severity: 'warning', message: 'Unrecognized input format' }],
                unitsConsumed: 0,
              },
            });
          }
          break;
        }
      }
    } catch {
      setResult({
        type: detectedType,
        txResult: {
          success: false,
          error: 'Unexpected error during scan',
          balanceChanges: [], programs: [], logs: [],
          flags: [{ severity: 'danger', message: 'Scan failed unexpectedly' }],
          unitsConsumed: 0,
        },
      });
    } finally {
      setLoading(false);
    }
  }, [input, detectedType]);

  const handleClear = () => {
    setInput('');
    setResult(null);
  };

  if (!connected) return null;

  const buttonLabel = detectedType === 'url'
    ? 'Scan URL'
    : detectedType === 'address'
      ? 'Scan Address'
      : detectedType === 'transaction'
        ? 'Simulate Transaction'
        : 'Scan';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-1">
        <ScanSearch size={16} className="text-primary" />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
          Threat Scanner
        </h3>
      </div>
      <p className="text-[10px] text-muted-foreground mb-4">
        Paste a URL, token/contract address, or base64 transaction to scan for threats
      </p>

      {/* Input */}
      <div className="space-y-3">
        <div className="relative">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a URL, Solana address (CA), or base64 transaction..."
            className="w-full h-24 bg-secondary/40 border border-border rounded-md p-3 pr-10 text-xs font-mono text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:border-primary/40 transition-colors"
          />

          {/* Clear button */}
          {input && (
            <button
              onClick={handleClear}
              className="absolute top-2 right-2 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Clear"
            >
              <Trash2 size={12} />
            </button>
          )}

          {/* Detected type badge */}
          {input.trim() && detectedType !== 'unknown' && (
            <div className={`absolute bottom-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${typeInfo.color}`}>
              {typeInfo.icon}
              {typeInfo.label}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleScan}
            disabled={loading || !input.trim()}
            className="flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Scanning...
              </>
            ) : (
              <>
                <Play size={14} />
                {buttonLabel}
              </>
            )}
          </button>

          {/* Input type hints */}
          <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1"><Globe size={9} /> URL</span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1"><Coins size={9} /> Address</span>
            <span className="text-border">|</span>
            <span className="flex items-center gap-1"><FileCode size={9} /> Transaction</span>
          </div>
        </div>
      </div>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-4 pt-4 border-t border-border">
              {result.type === 'url' && result.urlResult && (
                <UrlResultView result={result.urlResult} />
              )}
              {result.type === 'address' && result.caResult && (
                <CaResultView result={result.caResult} />
              )}
              {(result.type === 'transaction' || result.type === 'unknown') && result.txResult && (
                <TxResultView result={result.txResult} />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
