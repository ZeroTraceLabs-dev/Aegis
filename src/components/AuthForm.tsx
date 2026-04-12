import React, { useState } from 'react';
import { Mail, Lock, Loader2, UserPlus, LogIn, ArrowLeft, KeyRound } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';

type FormMode = 'login' | 'register' | 'forgot' | 'reset-sent';

export function AuthForm() {
  const { signIn, signUp, resetPassword } = useAuth();
  const [mode, setMode] = useState<FormMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'forgot') {
      if (!email.trim()) { setError('Enter your email address'); return; }
      setLoading(true);
      const { error: err } = await resetPassword(email.trim());
      setLoading(false);
      if (err) { setError(err); return; }
      setMode('reset-sent');
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError('Email and password are required');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setLoading(true);

    if (mode === 'login') {
      const { error: err } = await signIn(email.trim(), password);
      if (err) setError(err);
    } else {
      const { error: err } = await signUp(email.trim(), password);
      if (err) {
        setError(err);
      } else {
        setRegistered(true);
      }
    }

    setLoading(false);
  };

  // Post-registration success
  if (registered) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-auto bg-card border border-border rounded-lg p-6 card-glow text-center"
      >
        <Mail size={28} className="mx-auto text-primary mb-3" />
        <h3 className="text-sm font-bold text-foreground mb-1">Account Created</h3>
        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
          You're all set. Sign in below to access your dashboard.
        </p>
        <button
          onClick={() => { setRegistered(false); setMode('login'); setPassword(''); }}
          className="flex items-center gap-2 mx-auto px-4 py-2 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
        >
          <LogIn size={14} />
          Sign In
        </button>
      </motion.div>
    );
  }

  // Password reset email sent
  if (mode === 'reset-sent') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm mx-auto bg-card border border-border rounded-lg p-6 card-glow text-center"
      >
        <KeyRound size={28} className="mx-auto text-primary mb-3" />
        <h3 className="text-sm font-bold text-foreground mb-1">Reset Link Sent</h3>
        <p className="text-[11px] text-muted-foreground mb-4 leading-relaxed">
          Check your email at <span className="text-foreground font-semibold">{email}</span> for
          a password reset link.
        </p>
        <button
          onClick={() => { setMode('login'); setPassword(''); setError(''); }}
          className="flex items-center gap-2 mx-auto text-[10px] text-muted-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft size={10} />
          Back to sign in
        </button>
      </motion.div>
    );
  }

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      onSubmit={handleSubmit}
      className="w-full max-w-sm mx-auto bg-card border border-border rounded-lg p-6 card-glow"
    >
      <h3 className="text-sm font-bold text-foreground mb-1 text-center">
        {mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Reset Password'}
      </h3>
      <p className="text-[10px] text-muted-foreground text-center mb-5">
        {mode === 'login'
          ? 'Sign in to access your wallet security dashboard'
          : mode === 'register'
            ? 'Create an account to get started'
            : "Enter your email and we'll send a reset link"}
      </p>

      <div className="space-y-3">
        {/* Email */}
        <div className="relative">
          <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            placeholder="Email address"
            autoComplete="email"
            className="w-full pl-9 pr-3 py-2.5 bg-secondary/60 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>

        {/* Password -- hidden in forgot mode */}
        {mode !== 'forgot' && (
          <div className="relative">
            <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              className="w-full pl-9 pr-3 py-2.5 bg-secondary/60 border border-border rounded-md text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40 transition-colors"
            />
          </div>
        )}

        {/* Forgot password link -- only in login mode */}
        {mode === 'login' && (
          <div className="text-right">
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(''); }}
              className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
            >
              Forgot password?
            </button>
          </div>
        )}

        {/* Error */}
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

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : mode === 'login' ? (
            <><LogIn size={14} /> Sign In</>
          ) : mode === 'register' ? (
            <><UserPlus size={14} /> Create Account</>
          ) : (
            <><KeyRound size={14} /> Send Reset Link</>
          )}
        </button>
      </div>

      {/* Footer links */}
      <div className="mt-4 text-center space-y-1">
        {mode === 'forgot' ? (
          <button
            type="button"
            onClick={() => { setMode('login'); setError(''); }}
            className="flex items-center gap-1 mx-auto text-[10px] text-muted-foreground hover:text-primary transition-colors"
          >
            <ArrowLeft size={10} /> Back to sign in
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors"
          >
            {mode === 'login'
              ? "Don't have an account? Create one"
              : 'Already have an account? Sign in'}
          </button>
        )}
      </div>
    </motion.form>
  );
}
