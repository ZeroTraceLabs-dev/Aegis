import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { useWallet } from '@solana/wallet-adapter-react';
import type { WalletContextState } from '@solana/wallet-adapter-react';
import { supabase } from '@/lib/supabaseClient';

/**
 * Signed by the user as part of Sign-In With Solana. Single line, no newlines —
 * SIWS messages reject embedded \n in the statement field.
 */
const SIWS_STATEMENT =
  'I accept the Aegis Terms of Service and consent to background wallet monitoring.';

interface SessionState {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signInWithWallet: (wallet: WalletContextState) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState>({
  session: null,
  user: null,
  loading: true,
  signInWithWallet: async () => ({ error: null }),
  signOut: async () => {},
});

/** Pull the signed-in wallet address out of a Supabase Web3 user. */
function getSessionWalletAddress(user: User | null): string | null {
  if (!user) return null;
  const web3Identity = user.identities?.find((i) => i.provider === 'web3');
  const addr = web3Identity?.identity_data?.address;
  return typeof addr === 'string' ? addr : null;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { publicKey, connected } = useWallet();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Auto sign-out on wallet mismatch: if the connected wallet's pubkey differs
  // from the wallet that issued the current session, sign out. Prevents writing
  // rows under the wrong user_id when the user swaps wallets after signing in.
  useEffect(() => {
    if (!session || !user) return;
    const sessionWallet = getSessionWalletAddress(user);
    if (!sessionWallet) return;
    if (!connected || !publicKey) return;
    if (publicKey.toBase58() !== sessionWallet) {
      console.warn('[Session] Connected wallet differs from signed-in wallet — signing out.');
      supabase.auth.signOut();
    }
  }, [session, user, connected, publicKey]);

  const signInWithWallet = useCallback(async (wallet: WalletContextState) => {
    if (!wallet.connected || !wallet.publicKey) {
      return { error: 'Connect a wallet first' };
    }
    try {
      // The wallet-adapter WalletContextState exposes the publicKey + signMessage
      // shape Supabase's SolanaWallet structural type expects.
      const { error } = await supabase.auth.signInWithWeb3({
        chain: 'solana',
        statement: SIWS_STATEMENT,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        wallet: wallet as any,
      });
      if (error) {
        console.error('[Session] signInWithWeb3 failed:', error.message);
        return { error: error.message };
      }
      return { error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown sign-in error';
      console.error('[Session] signInWithWeb3 threw:', msg);
      return { error: msg };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <SessionContext.Provider value={{ session, user, loading, signInWithWallet, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
