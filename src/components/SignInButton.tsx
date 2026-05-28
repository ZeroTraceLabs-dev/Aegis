import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Loader2, LogIn, LogOut } from 'lucide-react';
import { useSession } from '@/hooks/useSession';

/**
 * Sign-In With Solana CTA + sign-out toggle.
 *
 * Renders nothing when no wallet is connected (the WalletMultiButton handles
 * connect). Once connected, shows either "Sign in to enable alerts" or, when
 * a session exists, a sign-out button.
 */
export function SignInButton() {
  const wallet = useWallet();
  const { session, signInWithWallet, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    if (!wallet.connected || !wallet.publicKey || busy) return;
    setBusy(true);
    setError(null);
    const { error: err } = await signInWithWallet(wallet);
    if (err) setError(err);
    setBusy(false);
  }, [wallet, busy, signInWithWallet]);

  const handleSignOut = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    await signOut();
    setBusy(false);
  }, [busy, signOut]);

  if (!wallet.connected) return null;

  if (session) {
    return (
      <button
        onClick={handleSignOut}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-muted-foreground text-[10px] font-semibold hover:text-foreground hover:border-border/80 transition-colors disabled:opacity-50"
        title="Sign out (alerts will stop)"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <LogOut size={12} />}
        <span>Sign Out</span>
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSignIn}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-primary/40 bg-primary/10 text-primary text-[10px] font-semibold hover:bg-primary/20 transition-colors disabled:opacity-50"
        title="Sign with your wallet to enable background monitoring and external alerts"
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />}
        <span>{busy ? 'Signing…' : 'Sign in to enable alerts'}</span>
      </button>
      {error && (
        <span className="text-[9px] text-destructive max-w-[200px] truncate" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
