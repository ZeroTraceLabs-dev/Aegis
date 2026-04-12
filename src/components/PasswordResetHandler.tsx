import React, { useState, useEffect } from 'react';
import { Lock, Loader2, Check, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

/**
 * Handles the password reset callback.
 * When user clicks the reset link in their email, Supabase redirects
 * back with ?reset=true and a session. This component renders
 * the "set new password" form.
 */
export function PasswordResetHandler() {
  const { updatePassword, user } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  // Check if we're on a reset callback
  const [isResetFlow, setIsResetFlow] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === 'true' && user) {
      setIsResetFlow(true);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user]);

  if (!isResetFlow || done) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    const { error: err } = await updatePassword(newPassword);
    setLoading(false);

    if (err) {
      setError(err);
    } else {
      setDone(true);
      // Auto-dismiss after 3s
      setTimeout(() => setIsResetFlow(false), 3000);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <motion.form
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-card border border-border rounded-lg p-6 card-glow mx-4"
      >
        <div className="text-center mb-5">
          <KeyRound size={28} className="mx-auto text-primary mb-3" />
          <h3 className="text-sm font-bold text-foreground mb-1">Set New Password</h3>
          <p className="text-[10px] text-muted-foreground">
            Enter your new password below.
          </p>
        </div>

        <div className="space-y-3">
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
              placeholder="New password"
              autoComplete="new-password"
              className="w-full pl-9 pr-3 py-2.5 bg-secondary/60 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>

          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(''); }}
              placeholder="Confirm new password"
              autoComplete="new-password"
              className="w-full pl-9 pr-3 py-2.5 bg-secondary/60 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-[10px] text-destructive"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <><Check size={14} /> Update Password</>
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsResetFlow(false)}
          className="mt-3 w-full text-center text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          Skip for now
        </button>
      </motion.form>
    </div>
  );
}
