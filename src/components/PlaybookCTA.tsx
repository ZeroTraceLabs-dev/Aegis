import React from 'react';
import { ShieldCheck, ArrowRight, BookOpen } from 'lucide-react';
import { motion } from 'framer-motion';

/**
 * Playbook CTA -- reusable call-to-action for the paid security playbook.
 * Variants:
 *   - "inline" (compact, used within checklist)
 *   - "banner" (prominent, used as standalone)
 */

// Placeholder URL -- user will provide the real one
const PLAYBOOK_URL = 'https://buy.stripe.com/bJe6oHcpz2jn2WUgma4gg00';

interface PlaybookCTAProps {
  variant?: 'inline' | 'banner';
  context?: string; // contextual message
}

export function PlaybookCTA({ variant = 'inline', context }: PlaybookCTAProps) {
  if (variant === 'banner') {
    return (
      <motion.a
        href={PLAYBOOK_URL}
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ scale: 1.01 }}
        className="block rounded-lg overflow-hidden relative group"
      >
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-brand opacity-15 group-hover:opacity-25 transition-opacity" />
        <div className="relative p-5 flex items-center gap-4 border border-primary/20 rounded-lg bg-card">
          {/* Icon */}
          <div className="w-12 h-12 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <BookOpen size={22} className="text-primary" />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-bold text-foreground mb-0.5">
              The Complete Solana Security Playbook
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {context || 'Step-by-step guide to protect your wallet, spot scams before they happen, and recover from attacks. Used by 1000+ traders.'}
            </p>
          </div>

          {/* Arrow */}
          <div className="flex items-center gap-1 text-primary shrink-0">
            <span className="text-xs font-semibold hidden sm:inline">Get the Playbook</span>
            <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
          </div>
        </div>
      </motion.a>
    );
  }

  // Inline variant
  return (
    <a
      href={PLAYBOOK_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-md bg-primary/5 border border-primary/15 hover:bg-primary/10 hover:border-primary/25 transition-colors group"
    >
      <ShieldCheck size={14} className="text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[11px] font-semibold text-foreground">
          {context || 'Want the full security playbook?'}
        </span>
        <span className="text-[10px] text-muted-foreground block">
          Complete guide with advanced techniques and recovery steps
        </span>
      </div>
      <ArrowRight size={12} className="text-primary group-hover:translate-x-0.5 transition-transform shrink-0" />
    </a>
  );
}