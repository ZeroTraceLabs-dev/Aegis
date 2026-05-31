/**
 * TrustedAddresses — UI for managing the address whitelist.
 *
 * Users can manually add/remove trusted addresses. Whitelisted addresses
 * suppress live monitor alerts and background notifications. Addresses
 * can also be whitelisted via Cerberus chat ("trust this address").
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  UserCheck,
  Bot,
  Copy,
  Check,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
  subscribeWhitelist,
  type WhitelistedAddress,
} from '@/lib/whitelistStore';

function isValidSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function timeAgo(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoStr).toLocaleDateString();
}

function AddressRow({
  entry,
  onRemove,
}: {
  entry: WhitelistedAddress;
  onRemove: (addr: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRemove = () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    onRemove(entry.address);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -10 }}
      className="flex items-center justify-between gap-3 p-3 rounded-md bg-secondary/30 border border-border hover:border-safe/20 transition-colors group"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="p-1.5 rounded bg-safe/10 text-safe shrink-0">
          {entry.source === 'cerberus' ? <Bot size={12} /> : <UserCheck size={12} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-foreground truncate">
              {entry.label}
            </span>
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-secondary border border-border text-muted-foreground shrink-0">
              {entry.source === 'cerberus' ? 'via Cerberus' : 'manual'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] font-mono text-muted-foreground">
              {abbr(entry.address)}
            </span>
            <button
              onClick={handleCopy}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Copy address"
            >
              {copied ? <Check size={9} className="text-safe" /> : <Copy size={9} />}
            </button>
            <a
              href={`https://solscan.io/account/${entry.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-primary transition-colors"
              title="View on Solscan"
            >
              <ExternalLink size={9} />
            </a>
            <span className="text-[8px] text-muted-foreground">
              added {timeAgo(entry.addedAt)}
            </span>
          </div>
        </div>
      </div>

      <button
        onClick={handleRemove}
        className={`p-1.5 rounded transition-colors shrink-0 ${
          confirmRemove
            ? 'bg-destructive/15 text-destructive border border-destructive/30'
            : 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
        }`}
        title={confirmRemove ? 'Click again to confirm removal' : 'Remove from whitelist'}
      >
        {confirmRemove ? <AlertTriangle size={12} /> : <Trash2 size={12} />}
      </button>
    </motion.div>
  );
}

export function TrustedAddresses() {
  const { connected, publicKey } = useWallet();
  const [whitelist, setWhitelist] = useState<WhitelistedAddress[]>(getWhitelist());
  const [expanded, setExpanded] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [inputError, setInputError] = useState('');

  useEffect(() => {
    const unsub = subscribeWhitelist(() => setWhitelist(getWhitelist()));
    return unsub;
  }, []);

  const handleAdd = useCallback(() => {
    const addr = newAddress.trim();
    const label = newLabel.trim();

    if (!addr) { setInputError('Address is required'); return; }
    if (!isValidSolanaAddress(addr)) { setInputError('Invalid Solana address'); return; }
    if (publicKey && addr === publicKey.toBase58()) { setInputError('Cannot whitelist your own wallet'); return; }

    const added = addToWhitelist(addr, label || abbr(addr), 'manual');
    if (!added) { setInputError('Address already whitelisted'); return; }

    setNewAddress('');
    setNewLabel('');
    setInputError('');
    setShowAddForm(false);
  }, [newAddress, newLabel, publicKey]);

  const handleRemove = useCallback((addr: string) => {
    removeFromWhitelist(addr);
  }, []);

  if (!connected) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg overflow-hidden card-glow"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between p-4 hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-safe/10 text-safe">
            <ShieldCheck size={16} />
          </div>
          <div className="text-left">
            <h3 className="section-header text-sm font-bold text-foreground flex items-center gap-2">
              Trusted Addresses
              {whitelist.length > 0 && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-safe/15 text-safe font-bold">
                  {whitelist.length}
                </span>
              )}
            </h3>
            <p className="text-[10px] text-muted-foreground">
              Whitelisted addresses suppress alerts from Cerberus
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp size={14} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={14} className="text-muted-foreground" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border"
          >
            <div className="p-4 space-y-3">
              {/* Info banner */}
              <div className="flex items-start gap-2 p-2.5 rounded-md bg-primary/5 border border-primary/15">
                <ShieldCheck size={12} className="text-primary mt-0.5 shrink-0" />
                <p className="text-[9px] text-muted-foreground leading-relaxed">
                  Addresses you trust (exchanges, your own wallets, friends). 
                  Transactions involving these addresses won't trigger Cerberus alerts.
                  You can also tell Cerberus "trust this address" in chat to add one.
                </p>
              </div>

              {/* Address list */}
              {whitelist.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  <AnimatePresence mode="popLayout">
                    {whitelist.map((entry) => (
                      <AddressRow key={entry.address} entry={entry} onRemove={handleRemove} />
                    ))}
                  </AnimatePresence>
                </div>
              ) : !showAddForm ? (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <ShieldCheck size={20} className="text-muted-foreground mb-2" />
                  <p className="text-[10px] text-muted-foreground">No trusted addresses yet</p>
                  <p className="text-[9px] text-muted-foreground mt-1 max-w-[240px]">
                    Add addresses you frequently transact with to reduce unnecessary alerts.
                  </p>
                </div>
              ) : null}

              {/* Add form */}
              <AnimatePresence>
                {showAddForm && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="space-y-2 p-3 rounded-md bg-secondary/30 border border-border"
                  >
                    <div>
                      <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Address
                      </label>
                      <input
                        type="text"
                        value={newAddress}
                        onChange={(e) => { setNewAddress(e.target.value); setInputError(''); }}
                        placeholder="Solana address..."
                        className="mt-1 w-full px-3 py-2 rounded-md bg-background border border-border text-[11px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Label (optional)
                      </label>
                      <input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="e.g. Coinbase, My hardware wallet..."
                        className="mt-1 w-full px-3 py-2 rounded-md bg-background border border-border text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
                      />
                    </div>
                    {inputError && (
                      <p className="text-[9px] text-destructive font-semibold">{inputError}</p>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={handleAdd}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-safe/10 border border-safe/30 text-safe hover:bg-safe/20 transition-colors"
                      >
                        <Plus size={10} />
                        Add
                      </button>
                      <button
                        onClick={() => { setShowAddForm(false); setInputError(''); setNewAddress(''); setNewLabel(''); }}
                        className="px-3 py-1.5 rounded-md text-[10px] font-semibold bg-secondary border border-border text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Add button */}
              {!showAddForm && (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-semibold bg-secondary/60 border border-border text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors w-full justify-center"
                >
                  <Plus size={11} />
                  Add Trusted Address
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
