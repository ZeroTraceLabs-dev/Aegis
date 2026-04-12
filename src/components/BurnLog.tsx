import React, { useState } from 'react';
import { Flame, ExternalLink, ChevronDown, ChevronUp, Copy, CheckCircle, X, AlertTriangle } from 'lucide-react';
import type { BurnResult } from '@/lib/burnNft';

interface BurnLogProps {
  entries: BurnLogEntry[];
  onClear: () => void;
}

export interface BurnLogEntry {
  mint: string;
  name: string;
  signature?: string;
  success: boolean;
  error?: string;
  timestamp: number;
  rentReclaimed: number;
}

function abbr(s: string): string {
  if (!s || s.length < 10) return s;
  return `${s.slice(0, 6)}...${s.slice(-4)}`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function burnResultToEntry(result: BurnResult, name: string): BurnLogEntry {
  return {
    mint: result.mint,
    name,
    signature: result.signature,
    success: result.success,
    error: result.error,
    timestamp: Date.now(),
    rentReclaimed: result.rentReclaimed,
  };
}

export function BurnLog({ entries, onClear }: BurnLogProps) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  if (entries.length === 0) return null;

  const successCount = entries.filter((e) => e.success).length;
  const failCount = entries.filter((e) => !e.success).length;
  const totalRent = entries.reduce((s, e) => s + e.rentReclaimed, 0);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="mt-4 border border-border rounded-lg overflow-hidden bg-secondary/20">
      {/* Header */}
      <button
        className="w-full flex items-center gap-2 p-3 hover:bg-secondary/40 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <Flame size={14} className="text-orange-400 shrink-0" />
        <span className="text-[11px] font-bold text-foreground uppercase tracking-wider flex-1">
          Burn Log
        </span>
        <span className="text-[10px] text-muted-foreground">
          {successCount} burned
          {failCount > 0 && <span className="text-destructive ml-1">/ {failCount} failed</span>}
          {totalRent > 0 && (
            <span className="text-accent ml-2">+{totalRent.toFixed(4)} SOL</span>
          )}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          className="text-muted-foreground hover:text-foreground p-0.5"
          title="Clear burn log"
        >
          <X size={12} />
        </button>
        {expanded ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
      </button>

      {/* Entries */}
      {expanded && (
        <div className="border-t border-border max-h-[300px] overflow-y-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="border-b border-border bg-secondary/30">
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">NFT</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">Mint</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">Signature</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">Rent</th>
                <th className="text-left px-3 py-1.5 font-semibold text-muted-foreground uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <tr key={`${entry.mint}-${i}`} className="border-b border-border/50 hover:bg-secondary/20">
                  <td className="px-3 py-2">
                    {entry.success ? (
                      <CheckCircle size={11} className="text-safe" />
                    ) : (
                      <AlertTriangle size={11} className="text-destructive" />
                    )}
                  </td>
                  <td className="px-3 py-2 text-foreground font-medium max-w-[120px] truncate">{entry.name}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-muted-foreground">{abbr(entry.mint)}</span>
                      <button
                        onClick={() => handleCopy(entry.mint)}
                        className="text-muted-foreground hover:text-primary"
                        title="Copy mint address"
                      >
                        {copied === entry.mint ? <CheckCircle size={9} className="text-safe" /> : <Copy size={9} />}
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {entry.signature ? (
                      <div className="flex items-center gap-1">
                        <a
                          href={`https://solscan.io/tx/${entry.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-primary hover:underline"
                        >
                          {abbr(entry.signature)}
                        </a>
                        <button
                          onClick={() => handleCopy(entry.signature!)}
                          className="text-muted-foreground hover:text-primary"
                          title="Copy signature"
                        >
                          {copied === entry.signature ? <CheckCircle size={9} className="text-safe" /> : <Copy size={9} />}
                        </button>
                        <a
                          href={`https://solscan.io/tx/${entry.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-primary"
                          title="View on Solscan"
                        >
                          <ExternalLink size={9} />
                        </a>
                      </div>
                    ) : (
                      <span className="text-destructive italic">{entry.error ? abbr(entry.error) : 'Failed'}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-accent font-semibold">
                    {entry.rentReclaimed > 0 ? `+${entry.rentReclaimed.toFixed(5)}` : '���'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {formatTime(entry.timestamp)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
