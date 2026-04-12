import React, { useState, useEffect } from 'react';
import { Trash2, ShieldOff, Loader2 } from 'lucide-react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { WalletData } from '@/hooks/useWalletScan';
import { isDelegateSafe, subscribeRisk } from '@/lib/riskStore';
import { toast } from '@/hooks/use-toast';

interface WalletActionsProps {
  wallet: WalletData;
}

export function WalletActions({ wallet }: WalletActionsProps) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [revokeStatus, setRevokeStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [closeStatus, setCloseStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [reclaimedSol, setReclaimedSol] = useState(0);

  // Re-render on safe delegate changes
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = subscribeRisk(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  // Reset statuses when wallet data changes (re-scan)
  useEffect(() => {
    setRevokeStatus('idle');
    setCloseStatus('idle');
    setReclaimedSol(0);
  }, [wallet.delegateApprovals, wallet.tokenAccounts]);

  const emptyAccounts = wallet.tokenAccounts.filter((t) => t.amount === 0);

  // Only revoke delegates NOT marked safe
  const unsafeApprovals = wallet.delegateApprovals.filter(
    (a) => !isDelegateSafe(a.mint, a.delegate)
  );
  const safeCount = wallet.delegateApprovals.length - unsafeApprovals.length;

  async function handleRevokeAll() {
    if (!publicKey || unsafeApprovals.length === 0) return;
    setRevokeStatus('loading');
    try {
      const { PublicKey, Transaction } = await import('@solana/web3.js');
      const { createRevokeInstruction } = await import('@solana/spl-token');

      const tx = new Transaction();
      for (const approval of unsafeApprovals) {
        const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
          mint: new PublicKey(approval.mint),
        });
        if (accounts.value.length > 0) {
          tx.add(createRevokeInstruction(accounts.value[0].pubkey, publicKey));
        }
      }
      if (tx.instructions.length > 0) {
        const sig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(sig, 'confirmed');
      }
      setRevokeStatus('done');
      toast({ title: 'All unsafe delegates revoked', description: `Revoked ${tx.instructions.length} delegate approval${tx.instructions.length > 1 ? 's' : ''}` });
    } catch (err) {
      console.error('Revoke all failed:', err);
      setRevokeStatus('error');
      toast({ title: 'Revoke all failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
  }

  async function handleCloseEmpty() {
    if (!publicKey || emptyAccounts.length === 0) return;
    setCloseStatus('loading');
    try {
      const { PublicKey, Transaction } = await import('@solana/web3.js');
      const { createCloseAccountInstruction } = await import('@solana/spl-token');

      const batchSize = 10;
      let totalReclaimed = 0;

      for (let i = 0; i < emptyAccounts.length; i += batchSize) {
        const batch = emptyAccounts.slice(i, i + batchSize);
        const tx = new Transaction();

        for (const acc of batch) {
          const accounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
            mint: new PublicKey(acc.mint),
          });
          if (accounts.value.length > 0) {
            tx.add(createCloseAccountInstruction(accounts.value[0].pubkey, publicKey, publicKey));
            totalReclaimed += 0.00203;
          }
        }

        if (tx.instructions.length > 0) {
          const sig = await sendTransaction(tx, connection);
          await connection.confirmTransaction(sig, 'confirmed');
        }
      }

      setReclaimedSol(totalReclaimed);
      setCloseStatus('done');
      toast({ title: 'Empty accounts closed', description: `Reclaimed ~${totalReclaimed.toFixed(4)} SOL` });
    } catch (err) {
      console.error('Close accounts failed:', err);
      setCloseStatus('error');
      toast({ title: 'Close accounts failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' });
    }
  }

  if (unsafeApprovals.length === 0 && emptyAccounts.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">WALLET ACTIONS</h3>

      <div className="flex flex-wrap gap-3">
        {unsafeApprovals.length > 0 && (
          <button
            onClick={handleRevokeAll}
            disabled={revokeStatus === 'loading' || revokeStatus === 'done'}
            className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border border-destructive/30 rounded-md text-destructive text-xs font-semibold hover:bg-destructive/20 transition-colors disabled:opacity-50"
          >
            {revokeStatus === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <ShieldOff size={14} />}
            {revokeStatus === 'done'
              ? 'ALL UNSAFE REVOKED'
              : revokeStatus === 'loading'
                ? 'REVOKING...'
                : `REVOKE ALL UNSAFE (${unsafeApprovals.length})`}
          </button>
        )}

        {safeCount > 0 && unsafeApprovals.length > 0 && (
          <span className="flex items-center gap-1 px-3 py-2 text-[10px] text-safe font-semibold bg-safe/5 border border-safe/20 rounded-md">
            {safeCount} safe delegate{safeCount > 1 ? 's' : ''} preserved
          </span>
        )}

        {emptyAccounts.length > 0 && (
          <button
            onClick={handleCloseEmpty}
            disabled={closeStatus === 'loading' || closeStatus === 'done'}
            className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/30 rounded-md text-primary text-xs font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {closeStatus === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {closeStatus === 'done'
              ? `CLOSED -- RECLAIMED ~${reclaimedSol.toFixed(4)} SOL`
              : closeStatus === 'loading'
                ? 'CLOSING...'
                : `CLOSE ${emptyAccounts.length} EMPTY ACCOUNTS`
            }
          </button>
        )}
      </div>
    </div>
  );
}