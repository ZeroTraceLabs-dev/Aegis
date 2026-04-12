/**
 * NuclearEvacuation — Emergency asset evacuation to a pre-configured safe wallet.
 *
 * Features:
 * - Configure a "safe wallet" escape address
 * - One-click emergency evacuation: bundles SOL + all tokens + NFTs into batch transfers
 * - Clear trust model explanation: user always signs, ZTL never holds keys
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Shield,
  Loader2,
  Copy,
  Check,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Rocket,
  Info,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { WalletData } from '@/hooks/useWalletScan';
import {
  getSafeWallet,
  setSafeWallet,
  subscribeEvacuation,
} from '@/lib/evacuationStore';
import { usePrices } from './PriceContext';

interface NuclearEvacuationProps {
  wallet: WalletData;
}

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function isValidSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
}

type EvacStatus = 'idle' | 'building' | 'signing' | 'confirming' | 'done' | 'error';

export function NuclearEvacuation({ wallet }: NuclearEvacuationProps) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { getUsdValue, getNftFloor, formatUsd, prices } = usePrices();

  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [inputAddr, setInputAddr] = useState('');
  const [inputError, setInputError] = useState('');
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<EvacStatus>('idle');
  const [statusMsg, setStatusMsg] = useState('');
  const [txSigs, setTxSigs] = useState<string[]>([]);
  const [confirmEvac, setConfirmEvac] = useState(false);

  // Subscribe to evacuation store
  const [safeAddr, setSafeAddr] = useState(getSafeWallet());
  useEffect(() => {
    const unsub = subscribeEvacuation(() => setSafeAddr(getSafeWallet()));
    return unsub;
  }, []);

  // Asset summary
  const assetSummary = useMemo(() => {
    const solValue = getUsdValue('native', wallet.solBalance) || 0;
    const tokens = wallet.tokenAccounts.filter((t) => !t.isNft && t.uiAmount > 0);
    const nfts = wallet.tokenAccounts.filter((t) => t.isNft);
    let tokenValue = 0;
    let nftValue = 0;
    for (const t of tokens) {
      const v = getUsdValue(t.mint, t.uiAmount);
      if (v) tokenValue += v;
    }
    for (const n of nfts) {
      const f = getNftFloor(n.mint);
      if (f) nftValue += f.floor;
    }
    return {
      solBalance: wallet.solBalance,
      solValue,
      tokenCount: tokens.length,
      tokenValue,
      nftCount: nfts.length,
      nftValue,
      totalValue: solValue + tokenValue + nftValue,
    };
  }, [wallet, getUsdValue, getNftFloor, prices]);

  function handleSaveAddr() {
    const addr = inputAddr.trim();
    if (!addr) {
      setInputError('Address is required');
      return;
    }
    if (!isValidSolanaAddress(addr)) {
      setInputError('Invalid Solana address');
      return;
    }
    if (publicKey && addr === publicKey.toBase58()) {
      setInputError('Cannot be the same as your connected wallet');
      return;
    }
    setInputError('');
    setSafeWallet(addr);
    setEditMode(false);
  }

  function handleClear() {
    setSafeWallet(null);
    setInputAddr('');
    setEditMode(false);
  }

  function handleCopy() {
    if (safeAddr) {
      navigator.clipboard.writeText(safeAddr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleEvacuate() {
    if (!publicKey || !safeAddr || status === 'building' || status === 'signing' || status === 'confirming') return;

    setStatus('building');
    setStatusMsg('Building evacuation transactions...');
    setTxSigs([]);
    setConfirmEvac(false);

    try {
      const { PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const {
        createTransferInstruction,
        getAssociatedTokenAddress,
        createAssociatedTokenAccountInstruction,
        TOKEN_PROGRAM_ID,
        TOKEN_2022_PROGRAM_ID,
      } = await import('@solana/spl-token');

      const destination = new PublicKey(safeAddr);
      const signatures: string[] = [];
      const BATCH_SIZE = 5;

      // Helper: detect which program owns a token account
      async function findTokenAccount(mintStr: string, owner: typeof publicKey) {
        const mint = new PublicKey(mintStr);
        // Try SPL first
        const splAccs = await connection.getParsedTokenAccountsByOwner(owner, { mint, programId: TOKEN_PROGRAM_ID });
        if (splAccs.value.length > 0) return { mint, programId: TOKEN_PROGRAM_ID, account: splAccs.value[0].pubkey };
        // Try Token-2022
        const t22Accs = await connection.getParsedTokenAccountsByOwner(owner, { mint, programId: TOKEN_2022_PROGRAM_ID });
        if (t22Accs.value.length > 0) return { mint, programId: TOKEN_2022_PROGRAM_ID, account: t22Accs.value[0].pubkey };
        return null;
      }

      // Combine all transferable assets
      const allTransferable = wallet.tokenAccounts.filter((t) => t.amount > 0);
      const totalBatches = Math.ceil(allTransferable.length / BATCH_SIZE) + 1; // +1 for SOL
      let currentBatch = 0;

      for (let i = 0; i < allTransferable.length; i += BATCH_SIZE) {
        currentBatch++;
        const batch = allTransferable.slice(i, i + BATCH_SIZE);
        const tx = new Transaction();
        let ixCount = 0;

        for (const token of batch) {
          try {
            const found = await findTokenAccount(token.mint, publicKey);
            if (!found) { console.warn(`Skip ${token.mint}: no account found`); continue; }

            const destAta = await getAssociatedTokenAddress(found.mint, destination, false, found.programId);
            const destAccount = await connection.getAccountInfo(destAta);
            if (!destAccount) {
              tx.add(createAssociatedTokenAccountInstruction(publicKey, destAta, destination, found.mint, found.programId));
            }

            const amountToSend = token.isNft ? BigInt(1) : BigInt(token.amount);
            tx.add(createTransferInstruction(found.account, destAta, publicKey, amountToSend, [], found.programId));
            ixCount++;
          } catch (err) {
            console.warn(`Skip ${token.mint}:`, err);
          }
        }

        if (ixCount > 0) {
          setStatus('signing');
          setStatusMsg(`Batch ${currentBatch}/${totalBatches}: Sign transfer of ${ixCount} asset${ixCount > 1 ? 's' : ''}...`);
          try {
            const sig = await sendTransaction(tx, connection);
            setStatus('confirming');
            setStatusMsg(`Batch ${currentBatch}/${totalBatches}: Confirming...`);
            await connection.confirmTransaction(sig, 'confirmed');
            signatures.push(sig);
          } catch (batchErr) {
            console.error(`Batch ${currentBatch} failed:`, batchErr);
            // Continue with remaining batches instead of aborting entirely
            setStatusMsg(`Batch ${currentBatch} failed, continuing...`);
          }
        }
      }

      // Transfer remaining SOL (leave ~0.005 for rent)
      if (wallet.solBalance > 0.006) {
        currentBatch++;
        const lamportsToSend = Math.floor((wallet.solBalance - 0.005) * LAMPORTS_PER_SOL);
        if (lamportsToSend > 0) {
          const tx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: publicKey,
              toPubkey: destination,
              lamports: lamportsToSend,
            })
          );
          setStatus('signing');
          setStatusMsg(`Batch ${currentBatch}/${totalBatches}: Sign SOL transfer...`);
          try {
            const sig = await sendTransaction(tx, connection);
            setStatus('confirming');
            setStatusMsg(`Batch ${currentBatch}/${totalBatches}: Confirming SOL...`);
            await connection.confirmTransaction(sig, 'confirmed');
            signatures.push(sig);
          } catch (solErr) {
            console.error('SOL transfer failed:', solErr);
          }
        }
      }

      setTxSigs(signatures);
      if (signatures.length > 0) {
        setStatus('done');
        setStatusMsg(`Evacuation complete. ${signatures.length} transaction${signatures.length > 1 ? 's' : ''} confirmed.`);
      } else {
        setStatus('error');
        setStatusMsg('No transactions were confirmed. Check your wallet and try again.');
      }
    } catch (err) {
      console.error('Evacuation failed:', err);
      setStatus('error');
      setStatusMsg(err instanceof Error ? err.message : 'Evacuation failed');
    }
  }

  if (!connected) return null;

  const isProcessing = status === 'building' || status === 'signing' || status === 'confirming';

  return (
    <motion.div
      data-nuclear-evacuation
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg overflow-hidden card-glow-nuclear"
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-secondary/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-destructive/10 border border-destructive/20">
            <Rocket size={16} className="text-destructive" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Nuclear Evacuation</h3>
            <p className="text-[10px] text-muted-foreground">
              {safeAddr ? `Safe wallet: ${abbr(safeAddr)}` : 'Configure escape wallet for emergencies'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {safeAddr && (
            <span className="text-[9px] font-bold text-safe bg-safe/10 px-2 py-0.5 rounded border border-safe/20">
              CONFIGURED
            </span>
          )}
          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-5 space-y-4">
              {/* Trust model info */}
              <div className="flex items-start gap-2 p-3 rounded-md bg-primary/5 border border-primary/20">
                <Info size={14} className="text-primary shrink-0 mt-0.5" />
                <div className="text-[10px] text-muted-foreground leading-relaxed">
                  <span className="text-foreground font-semibold">Your keys, your control.</span> Evacuation requires your signature for every transaction.
                  ZeroTrace never stores keys or requests delegate authority. We prepare the escape route — you hold the keys.
                </div>
              </div>

              {/* Safe wallet config */}
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-semibold">ESCAPE WALLET</p>

                {safeAddr && !editMode ? (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-secondary/40 border border-border">
                    <Shield size={14} className="text-safe shrink-0" />
                    <span className="font-mono text-xs text-foreground flex-1 truncate">{safeAddr}</span>
                    <button onClick={handleCopy} className="p-1 hover:bg-secondary rounded transition-colors" title="Copy">
                      {copied ? <Check size={12} className="text-safe" /> : <Copy size={12} className="text-muted-foreground" />}
                    </button>
                    <a
                      href={`https://solscan.io/account/${safeAddr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 hover:bg-secondary rounded transition-colors"
                    >
                      <ExternalLink size={12} className="text-muted-foreground" />
                    </a>
                    <button
                      onClick={() => { setInputAddr(safeAddr || ''); setEditMode(true); }}
                      className="text-[10px] text-primary hover:text-primary/80 font-semibold"
                    >
                      EDIT
                    </button>
                    <button
                      onClick={handleClear}
                      className="text-[10px] text-destructive hover:text-destructive/80 font-semibold"
                    >
                      REMOVE
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={inputAddr}
                      onChange={(e) => { setInputAddr(e.target.value); setInputError(''); }}
                      placeholder="Enter safe wallet address (e.g. a hardware wallet)..."
                      className="w-full px-3 py-2 bg-secondary/60 border border-border rounded-md text-xs font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {inputError && <p className="text-[10px] text-destructive">{inputError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={handleSaveAddr}
                        className="px-3 py-1.5 text-[10px] font-bold bg-primary/15 text-primary border border-primary/30 rounded hover:bg-primary/25 transition-colors"
                      >
                        SAVE
                      </button>
                      {editMode && (
                        <button
                          onClick={() => setEditMode(false)}
                          className="px-3 py-1.5 text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors"
                        >
                          CANCEL
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Asset summary */}
              {safeAddr && !editMode && (
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-semibold">ASSETS TO EVACUATE</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="p-2 rounded bg-secondary/40 border border-border text-center">
                      <p className="text-xs font-bold text-foreground">{assetSummary.solBalance.toFixed(4)} SOL</p>
                      <p className="text-[9px] text-muted-foreground">{formatUsd(assetSummary.solValue)}</p>
                    </div>
                    <div className="p-2 rounded bg-secondary/40 border border-border text-center">
                      <p className="text-xs font-bold text-foreground">{assetSummary.tokenCount} Tokens</p>
                      <p className="text-[9px] text-muted-foreground">{formatUsd(assetSummary.tokenValue)}</p>
                    </div>
                    <div className="p-2 rounded bg-secondary/40 border border-border text-center">
                      <p className="text-xs font-bold text-foreground">{assetSummary.nftCount} NFTs</p>
                      <p className="text-[9px] text-muted-foreground">{formatUsd(assetSummary.nftValue)}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-foreground mt-2 font-semibold">
                    Total estimated: <span className="text-primary">{formatUsd(assetSummary.totalValue)}</span>
                  </p>
                </div>
              )}

              {/* Evacuation button + status */}
              {safeAddr && !editMode && (
                <div className="space-y-3">
                  {!confirmEvac && status !== 'done' && (
                    <button
                      onClick={() => setConfirmEvac(true)}
                      disabled={isProcessing || wallet.tokenAccounts.length === 0}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-destructive/15 border-2 border-destructive/40 rounded-lg text-destructive text-sm font-bold hover:bg-destructive/25 hover:border-destructive/60 transition-all disabled:opacity-40"
                    >
                      <AlertTriangle size={16} />
                      EMERGENCY EVACUATE ALL ASSETS
                    </button>
                  )}

                  {confirmEvac && status !== 'done' && !isProcessing && (
                    <div className="p-4 rounded-lg bg-destructive/10 border-2 border-destructive/30 space-y-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={16} className="text-destructive shrink-0 mt-0.5" />
                        <div className="text-[11px] text-foreground leading-relaxed">
                          <span className="font-bold text-destructive">CONFIRM EVACUATION:</span> This will transfer ALL assets (SOL, tokens, NFTs) from your connected
                          wallet to <span className="font-mono text-primary">{abbr(safeAddr)}</span>. You will need to sign multiple transactions.
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleEvacuate}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-destructive/20 border border-destructive/50 rounded-md text-destructive text-xs font-bold hover:bg-destructive/30 transition-colors"
                        >
                          <Rocket size={14} />
                          CONFIRM EVACUATION
                        </button>
                        <button
                          onClick={() => setConfirmEvac(false)}
                          className="px-4 py-2.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors"
                        >
                          CANCEL
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Processing status */}
                  {isProcessing && (
                    <div className="flex items-center gap-3 p-3 rounded-md bg-accent/10 border border-accent/20">
                      <Loader2 size={16} className="animate-spin text-accent" />
                      <span className="text-xs text-accent font-semibold">{statusMsg}</span>
                    </div>
                  )}

                  {/* Done status */}
                  {status === 'done' && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 p-3 rounded-md bg-safe/10 border border-safe/20">
                        <Shield size={16} className="text-safe" />
                        <span className="text-xs text-safe font-bold">{statusMsg}</span>
                      </div>
                      {txSigs.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-[9px] text-muted-foreground uppercase">Transaction signatures:</p>
                          {txSigs.map((sig, i) => (
                            <a
                              key={i}
                              href={`https://solscan.io/tx/${sig}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-mono text-primary hover:text-primary/80"
                            >
                              {sig.slice(0, 20)}...
                              <ExternalLink size={8} />
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error status */}
                  {status === 'error' && (
                    <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
                      <AlertTriangle size={16} className="text-destructive" />
                      <span className="text-xs text-destructive">{statusMsg}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}