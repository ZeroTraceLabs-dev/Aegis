import React, { useState, useEffect } from 'react';
import { Scan, ChevronDown, ChevronUp, AlertTriangle, CheckCircle, ExternalLink, Check, ShieldOff, Loader2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { TokenIcon } from './TokenIcon';
import { usePrices } from './PriceContext';
import {
  acknowledgeRisk,
  unacknowledgeRisk,
  isAcknowledged,
  subscribeRisk,
  isDelegateSafe,
  markDelegateSafe,
  unmarkDelegateSafe,
} from '@/lib/riskStore';
import { getSpamScore } from '@/hooks/useAssetMetadata';
import { scoreSpam } from '@/lib/spamDetector';
import { isManuallyFlagged, unflagSpam } from '@/lib/manualSpamStore';

interface RiskEvaluationProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

type Tab = 'asset' | 'permission' | 'transaction';

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function getDisplay(mint: string, fallback: string, metadata: Map<string, TokenMeta>) {
  const meta = metadata.get(mint);
  return {
    symbol: (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : fallback,
    name: (meta?.name && !meta.name.includes('..')) ? meta.name : '',
    image: meta?.image || '',
  };
}

/* ── Risk explanation map ────────────────���─────────���─── */

const RISK_EXPLANATIONS: Record<string, { title: string; bullets: string[] }> = {
  delegate: {
    title: 'Open Delegate Approval',
    bullets: [
      'A delegate is a third-party address that has been granted permission to transfer or burn this asset on your behalf.',
      'If the delegate address is malicious or compromised, they can move this asset out of your wallet at any time without your confirmation.',
      'This is commonly set during interactions with DeFi protocols, NFT marketplaces, or token swaps -- but should be revoked after use.',
      'Revoking removes the delegate\'s permission immediately. Your asset stays in your wallet and remains fully under your control.',
    ],
  },
  spam: {
    title: 'Spam / Scam NFT Detected',
    bullets: [
      'This NFT was identified as likely spam, a phishing airdrop, or scam noise based on multiple signals.',
      'Common indicators: no verified creator, phishing keywords in name, not part of any collection, flagged by Helius DAS.',
      'Do NOT interact with spam NFTs -- clicking links in their name or metadata can lead to wallet-draining phishing sites.',
      'The safest action is to ignore these completely. Do not attempt to sell, transfer, or burn them.',
    ],
  },
  dust: {
    title: 'Potential Dust Token',
    bullets: [
      'This token has an extremely small balance (< 0.001), which is a common signature of airdropped dust tokens.',
      'Dust tokens are often used in phishing attacks -- interacting with them (selling, swapping, or clicking associated links) can trigger malicious transactions.',
      'The safest action is to ignore dust tokens entirely. Do not attempt to swap or transfer them.',
    ],
  },
  zdec: {
    title: 'Zero-Decimal Fungible Token',
    bullets: [
      'This token has 0 decimals but is classified as fungible (not an NFT), which is unusual for legitimate SPL tokens.',
      'Zero-decimal fungible tokens are sometimes used in scam airdrops or fake token schemes designed to lure you to phishing sites.',
      'Exercise caution before interacting with this token. Verify its legitimacy on Solscan or a trusted explorer.',
    ],
  },
  failedTx: {
    title: 'Failed Transaction',
    bullets: [
      'This transaction was submitted but failed on-chain. While not always dangerous, failed transactions can indicate a rejected exploit attempt.',
      'If you did not initiate this transaction, it may be a sign that a previously approved delegate or dApp tried to execute a malicious action.',
      'Review the transaction details on Solscan to understand what was attempted.',
    ],
  },
  permDelegate: {
    title: 'Active Delegate Permission',
    bullets: [
      'This address currently has permission to move or burn the associated asset from your wallet without requiring your signature.',
      'If you no longer use the dApp or marketplace that set this delegate, you should revoke it immediately to prevent unauthorized transfers.',
      'Revoking is a simple on-chain transaction that costs a minimal SOL fee and takes effect instantly.',
    ],
  },
};

function RiskExplainer({ type }: { type: keyof typeof RISK_EXPLANATIONS }) {
  const info = RISK_EXPLANATIONS[type];
  if (!info) return null;
  return (
    <div className="mt-2 mb-1 px-3 py-2.5 rounded-md bg-secondary/60 border border-border">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Info size={11} className="text-primary shrink-0" />
        <span className="text-[10px] font-bold text-foreground uppercase tracking-wider">{info.title}</span>
      </div>
      <ul className="space-y-1.5 ml-0.5">
        {info.bullets.map((b, i) => (
          <li key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground leading-relaxed">
            <span className="text-primary mt-0.5 shrink-0">&#8226;</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Risk action buttons (Acknowledge + Revoke) ──────── */

function RiskActions({
  riskId,
  ackLabel,
  showRevoke,
  onRevoke,
  revoking,
  revoked,
  isSpamRisk,
  spamMint,
  isDelegateRisk,
  delegateMint,
  delegateAddr,
}: {
  riskId: string;
  ackLabel: string;
  showRevoke?: boolean;
  onRevoke?: () => void;
  revoking?: boolean;
  revoked?: boolean;
  isSpamRisk?: boolean;
  spamMint?: string;
  isDelegateRisk?: boolean;
  delegateMint?: string;
  delegateAddr?: string;
}) {
  const [checked, setChecked] = useState(isAcknowledged(riskId));

  useEffect(() => {
    const unsub = subscribeRisk(() => setChecked(isAcknowledged(riskId)));
    return unsub;
  }, [riskId]);

  const toggleAck = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (checked) {
      unacknowledgeRisk(riskId);
    } else {
      acknowledgeRisk(riskId);
    }
  };

  /* Spam-specific: clear both acknowledge + manual flag */
  const handleNotSpam = (e: React.MouseEvent) => {
    e.stopPropagation();
    acknowledgeRisk(riskId);
    if (spamMint && isManuallyFlagged(spamMint)) unflagSpam(spamMint);
  };

  const handleReflag = (e: React.MouseEvent) => {
    e.stopPropagation();
    unacknowledgeRisk(riskId);
  };

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      {/* Spam risk: show dedicated NOT SPAM / RE-FLAG buttons */}
      {isSpamRisk ? (
        checked ? (
          <>
            <span className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold text-safe">
              <CheckCircle size={11} /> Marked as Not Spam
            </span>
            <button
              onClick={handleReflag}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-semibold bg-secondary/50 border border-border text-muted-foreground hover:border-destructive/40 hover:text-destructive transition-all"
            >
              <AlertTriangle size={10} />
              Re-flag as Spam
            </button>
          </>
        ) : (
          <button
            onClick={handleNotSpam}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-safe/10 border border-safe/30 text-safe hover:bg-safe/20 hover:border-safe/50 transition-all shadow-sm shadow-safe/10"
          >
            <ShieldOff size={11} />
            NOT SPAM -- Remove Flag
          </button>
        )
      ) : (
        /* Non-spam: standard acknowledge checkbox */
        <button
          onClick={toggleAck}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-[10px] font-semibold transition-all border ${
            checked
              ? 'bg-primary/10 border-primary/40 text-primary'
              : 'bg-secondary/50 border-border text-muted-foreground hover:border-primary/30 hover:text-foreground'
          }`}
        >
          <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all ${
            checked ? 'bg-primary border-primary' : 'border-muted-foreground'
          }`}>
            {checked && <Check size={10} className="text-primary-foreground" />}
          </div>
          {checked ? 'Risk Acknowledged' : ackLabel}
        </button>
      )}

      {/* Revoke button (only for delegate risks) */}
      {showRevoke && !revoked && (
        <button
          onClick={(e) => { e.stopPropagation(); onRevoke?.(); }}
          disabled={revoking}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-destructive/15 border border-destructive/40 text-destructive hover:bg-destructive/25 transition-all disabled:opacity-50"
        >
          {revoking ? <Loader2 size={10} className="animate-spin" /> : <ShieldOff size={10} />}
          {revoking ? 'REVOKING...' : 'REVOKE!'}
        </button>
      )}

      {/* Mark Safe button (delegate risks only) */}
      {isDelegateRisk && delegateMint && delegateAddr && !revoked && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            markDelegateSafe(delegateMint, delegateAddr);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-safe/10 border border-safe/30 text-safe hover:bg-safe/20 hover:border-safe/50 transition-all"
        >
          <CheckCircle size={10} />
          MARK SAFE
        </button>
      )}

      {showRevoke && revoked && (
        <span className="flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold text-safe">
          <CheckCircle size={10} /> REVOKED
        </span>
      )}
    </div>
  );
}

/* ── Determine risk type from risk id ───────��─────────�� */

function getRiskType(riskId: string): keyof typeof RISK_EXPLANATIONS | null {
  if (riskId.startsWith('del-')) return 'delegate';
  if (riskId.startsWith('dust-')) return 'dust';
  if (riskId.startsWith('zdec-')) return 'zdec';
  if (riskId.startsWith('spam-')) return 'spam';
  if (riskId.startsWith('tx-')) return 'failedTx';
  if (riskId.startsWith('perm-')) return 'permDelegate';
  return null;
}

/* ── Main Component ���─────────���──────────────��────────── */

export function RiskEvaluation({ wallet, metadata }: RiskEvaluationProps) {
  const { getUsdValue, formatUsd, getNftFloor, prices } = usePrices();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [tab, setTab] = useState<Tab>('asset');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revoked, setRevoked] = useState<Set<string>>(new Set());

  void prices;

  /* ── Revoke handler ── */
  async function handleRevoke(mint: string, delegate: string) {
    if (!publicKey) return;
    const key = `${mint}-${delegate}`;
    setRevoking(key);
    try {
      const { PublicKey, Transaction } = await import('@solana/web3.js');
      const { createRevokeInstruction } = await import('@solana/spl-token');

      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        mint: new PublicKey(mint),
      });
      if (tokenAccounts.value.length === 0) throw new Error('Token account not found');

      const tokenAccountPk = tokenAccounts.value[0].pubkey;
      const ix = createRevokeInstruction(tokenAccountPk, publicKey);
      const tx = new Transaction().add(ix);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');
      setRevoked((prev) => new Set(prev).add(key));
    } catch (err) {
      console.error('Revoke failed:', err);
    } finally {
      setRevoking(null);
    }
  }

  // Re-render on risk store changes (for safe delegate toggling)
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = subscribeRisk(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  // BY ASSET -- skip delegates marked safe
  const assetRisks = wallet.tokenAccounts.map((t) => {
    const risks: { id: string; msg: string; delegate?: string }[] = [];
    const delegateApproval = wallet.delegateApprovals.find((d) => d.mint === t.mint);
    if (delegateApproval && !isDelegateSafe(delegateApproval.mint, delegateApproval.delegate)) {
      risks.push({
        id: `del-${t.mint}`,
        msg: `Open delegate approval detected -- ${abbr(delegateApproval.delegate)} can transfer this asset`,
        delegate: delegateApproval.delegate,
      });
    }
    if (!t.isNft && t.uiAmount > 0 && t.uiAmount < 0.001) risks.push({ id: `dust-${t.mint}`, msg: 'Potential dust token -- extremely small balance may indicate a phishing airdrop' });
    if (t.decimals === 0 && !t.isNft) risks.push({ id: `zdec-${t.mint}`, msg: 'Zero-decimal fungible token -- unusual token structure, verify legitimacy' });

    // Spam NFT detection (auto + manual flag)
    if (t.isNft) {
      const display0 = getDisplay(t.mint, t.symbol, metadata);
      const cached = getSpamScore(t.mint);
      const spamResult = cached || scoreSpam(
        display0.name || t.symbol,
        display0.symbol || '',
        display0.image || '',
        { noVerifiedCreator: true, hasCollection: false },
      );
      const manuallyFlagged = isManuallyFlagged(t.mint);
      const spamAcknowledged = isAcknowledged(`spam-${t.mint}`);
      // Only show spam risk if not already acknowledged ("not spam")
      if ((spamResult.isSpam || manuallyFlagged) && !spamAcknowledged) {
        const topReason = manuallyFlagged && !spamResult.isSpam
          ? 'Manually flagged as spam by user'
          : (spamResult.reasons[0] || 'Multiple spam signals detected');
        risks.push({
          id: `spam-${t.mint}`,
          msg: `Spam/scam NFT -- ${topReason}${spamResult.isSpam ? ` (score: ${spamResult.score}/100)` : ''}`,
        });
      }
    }

    const display = getDisplay(t.mint, t.symbol, metadata);
    const usd = getUsdValue(t.mint, t.uiAmount) || (t.isNft ? getNftFloor(t.mint)?.floor : null) || null;
    return { ...t, risks, display, usd };
  }).sort((a, b) => b.risks.length - a.risks.length);

  // BY PERMISSION
  const permRisks = wallet.delegateApprovals.map((a) => {
    const display = getDisplay(a.mint, a.mintSymbol, metadata);
    const usd = getUsdValue(a.mint, a.amount) || getNftFloor(a.mint)?.floor || null;
    const riskId = `perm-${a.mint}-${a.delegate}`;
    return { ...a, display, usd, riskId };
  });

  // BY TRANSACTION
  const txRisks = wallet.signatures.map((s) => ({
    ...s,
    risks: s.err ? [{ id: `tx-${s.signature}`, msg: 'Transaction failed -- may indicate a rejected exploit attempt or reverted malicious call' }] : [],
  }));

  const totalAtRisk = permRisks.reduce((s, p) => s + (p.usd || 0), 0);

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'asset', label: 'BY ASSET', count: assetRisks.filter((a) => a.risks.length > 0).length },
    { key: 'permission', label: 'BY PERMISSION', count: permRisks.length },
    { key: 'transaction', label: 'BY TRANSACTION', count: txRisks.filter((t) => t.risks.length > 0).length },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Scan size={18} className="text-accent" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">RISK EVALUATION</h3>
        </div>
        {totalAtRisk > 0 && (
          <span className="text-xs text-destructive font-bold">TOTAL AT RISK: {formatUsd(totalAtRisk)}</span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-secondary/50 p-1 rounded-md">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`flex-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors ${
              tab === t.key ? 'bg-card text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1 ${tab === t.key ? 'text-destructive' : ''}`}>({t.count})</span>
            )}
          </button>
        ))}
      </div>

      {/* BY ASSET */}
      {tab === 'asset' && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {assetRisks.map((ar) => {
            const key = `asset-${ar.mint}`;
            const isExp = expanded === key;
            return (
              <div key={key} className={`border rounded-md ${ar.risks.length > 0 ? 'border-destructive/20' : 'border-border'}`}>
                <button
                  className="w-full flex items-center gap-3 p-2.5 text-left"
                  onClick={() => setExpanded(isExp ? null : key)}
                >
                  <TokenIcon src={ar.display.image} symbol={ar.display.symbol} size={32} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-foreground">{ar.display.symbol}</span>
                      {ar.display.name && <span className="text-[10px] text-muted-foreground truncate">{ar.display.name}</span>}
                      {ar.isNft && <span className="text-[9px] px-1 py-0.5 bg-accent/20 text-accent rounded">NFT</span>}
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">{abbr(ar.mint)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {ar.usd !== null && <span className="text-[10px] font-semibold text-foreground">{formatUsd(ar.usd)}</span>}
                    {ar.risks.length > 0 ? (
                      <AlertTriangle size={14} className="text-destructive" />
                    ) : (
                      <CheckCircle size={14} className="text-safe" />
                    )}
                    {isExp ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                  </div>
                </button>
                <AnimatePresence>
                  {isExp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-border"
                    >
                      <div className="p-3 space-y-1.5 text-xs">
                        <div className="text-muted-foreground">Balance: {ar.uiAmount.toFixed(ar.decimals > 0 ? 4 : 0)}</div>
                        {ar.risks.length > 0 ? (
                          ar.risks.map((r) => {
                            const riskType = getRiskType(r.id);
                            const revokeKey = r.delegate ? `${ar.mint}-${r.delegate}` : null;
                            const isDelegateRisk = r.id.startsWith('del-');
                            return (
                              <div key={r.id}>
                                <div className="flex items-start gap-1.5 text-destructive">
                                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                  <span>{r.msg}</span>
                                </div>
                                {riskType && <RiskExplainer type={riskType} />}
                                <RiskActions
                                  riskId={r.id}
                                  ackLabel="I acknowledge this risk"
                                  showRevoke={isDelegateRisk && !!r.delegate}
                                  onRevoke={r.delegate ? () => handleRevoke(ar.mint, r.delegate!) : undefined}
                                  revoking={revokeKey ? revoking === revokeKey : false}
                                  revoked={revokeKey ? revoked.has(revokeKey) : false}
                                  isSpamRisk={r.id.startsWith('spam-')}
                                  spamMint={r.id.startsWith('spam-') ? ar.mint : undefined}
                                  isDelegateRisk={isDelegateRisk}
                                  delegateMint={isDelegateRisk ? ar.mint : undefined}
                                  delegateAddr={isDelegateRisk ? r.delegate : undefined}
                                />
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-safe flex items-center gap-1.5">
                            <CheckCircle size={11} /> No risks detected
                          </div>
                        )}
                        <a
                          href={`https://solscan.io/token/${ar.mint}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          View on Solscan <ExternalLink size={10} />
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {assetRisks.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No assets to evaluate</p>}
        </div>
      )}

      {/* BY PERMISSION */}
      {tab === 'permission' && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {permRisks.length === 0 ? (
            <p className="text-xs text-safe text-center py-4">No open permissions found</p>
          ) : (
            permRisks.map((p) => {
              const key = `perm-${p.mint}-${p.delegate}`;
              const isExp = expanded === key;
              const revokeKey = `${p.mint}-${p.delegate}`;
              const isRevoked = revoked.has(revokeKey);
              return (
                <div key={key} className={`border rounded-md ${isRevoked ? 'border-safe/20' : 'border-destructive/20'}`}>
                  <button
                    className="w-full flex items-center gap-3 p-2.5 text-left"
                    onClick={() => setExpanded(isExp ? null : key)}
                  >
                    <TokenIcon src={p.display.image} symbol={p.display.symbol} size={32} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-foreground">{p.display.symbol}</span>
                        {p.display.name && <span className="text-[10px] text-muted-foreground truncate">{p.display.name}</span>}
                        {p.isNft && <span className="text-[9px] px-1 py-0.5 bg-accent/20 text-accent rounded">NFT</span>}
                      </div>
                      <p className="text-[10px] text-muted-foreground">Delegate: {abbr(p.delegate)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.usd !== null && <span className="text-xs font-bold text-destructive">{formatUsd(p.usd)}</span>}
                      {isRevoked && <span className="text-[10px] text-safe font-bold">REVOKED</span>}
                      {isExp ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </div>
                  </button>
                  <AnimatePresence>
                    {isExp && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="border-t border-border"
                      >
                        <div className="p-3 space-y-2 text-xs">
                          <div className="px-3 py-2 rounded bg-destructive/10 border border-destructive/30">
                            <span className="text-destructive font-bold">
                              DELEGATED: {p.amount.toFixed(p.decimals > 0 ? 4 : 0)}
                              {p.usd ? ` (${formatUsd(p.usd)})` : ''}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">DELEGATE: </span>
                            <span className="font-mono text-foreground">{p.delegate}</span>
                            <a href={`https://solscan.io/account/${p.delegate}`} target="_blank" rel="noopener noreferrer" className="inline-flex ml-1">
                              <ExternalLink size={10} className="text-primary" />
                            </a>
                          </div>

                          <RiskExplainer type="permDelegate" />

                          <RiskActions
                            riskId={p.riskId}
                            ackLabel="I recognize this delegate"
                            showRevoke={!isRevoked}
                            onRevoke={() => handleRevoke(p.mint, p.delegate)}
                            revoking={revoking === revokeKey}
                            revoked={isRevoked}
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* BY TRANSACTION */}
      {tab === 'transaction' && (
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {txRisks.map((tx) => {
            const key = `tx-${tx.signature}`;
            const isExp = expanded === key;
            return (
              <div key={key} className={`border rounded-md ${tx.risks.length > 0 ? 'border-destructive/20' : 'border-border'}`}>
                <button
                  className="w-full flex items-center gap-3 p-2.5 text-left"
                  onClick={() => setExpanded(isExp ? null : key)}
                >
                  <div className={`w-2 h-2 rounded-full shrink-0 ${tx.err ? 'bg-destructive' : 'bg-safe'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-[10px] text-foreground truncate">{tx.signature}</p>
                    {tx.blockTime && (
                      <p className="text-[10px] text-muted-foreground">{new Date(tx.blockTime * 1000).toLocaleString()}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {tx.risks.length > 0 && <AlertTriangle size={12} className="text-destructive" />}
                    {isExp ? <ChevronUp size={12} className="text-muted-foreground" /> : <ChevronDown size={12} className="text-muted-foreground" />}
                  </div>
                </button>
                <AnimatePresence>
                  {isExp && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-border"
                    >
                      <div className="p-3 space-y-1.5 text-xs">
                        {tx.risks.length > 0 ? (
                          tx.risks.map((r) => {
                            const riskType = getRiskType(r.id);
                            return (
                              <div key={r.id}>
                                <div className="flex items-start gap-1.5 text-destructive">
                                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                  <span>{r.msg}</span>
                                </div>
                                {riskType && <RiskExplainer type={riskType} />}
                                <RiskActions riskId={r.id} ackLabel="I recognize this transaction" />
                              </div>
                            );
                          })
                        ) : (
                          <div className="text-safe flex items-center gap-1.5">
                            <CheckCircle size={11} /> Transaction succeeded
                          </div>
                        )}
                        <a
                          href={`https://solscan.io/tx/${tx.signature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          View on Solscan <ExternalLink size={10} />
                        </a>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
          {txRisks.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No transactions to evaluate</p>}
        </div>
      )}
    </div>
  );
}