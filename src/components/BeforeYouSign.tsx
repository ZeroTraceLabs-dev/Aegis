import React, { useEffect, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  ClipboardCheck,
  ChevronDown,
  CheckCircle2,
  Circle,
  Shield,
  Sparkles,
  Lock,
  AlertTriangle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getChecklist,
  getChecklistProgress,
  toggleStep,
  subscribeChecklist,
  type ChecklistStep,
} from '@/lib/checklistStore';
import { PlaybookCTA } from './PlaybookCTA';

const CATEGORY_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  'pre-sign': {
    label: 'Before You Sign',
    icon: <AlertTriangle size={12} />,
    color: 'text-yellow-400',
  },
  'wallet-hygiene': {
    label: 'Wallet Hygiene',
    icon: <Shield size={12} />,
    color: 'text-primary',
  },
  advanced: {
    label: 'Advanced Protection',
    icon: <Lock size={12} />,
    color: 'text-accent',
  },
};

function StepItem({ step, onToggle }: { step: ChecklistStep; onToggle: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`rounded-md border transition-colors ${
        step.completed
          ? 'border-safe/20 bg-safe/5'
          : 'border-border hover:border-border/80 bg-secondary/20'
      }`}
    >
      <div className="flex items-start gap-3 p-3">
        {/* Checkbox */}
        <button
          onClick={onToggle}
          className="mt-0.5 shrink-0 group"
          aria-label={step.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {step.completed ? (
            <CheckCircle2 size={18} className="text-safe" />
          ) : (
            <Circle size={18} className="text-muted-foreground group-hover:text-primary transition-colors" />
          )}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-left"
          >
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-semibold ${
                  step.completed ? 'text-muted-foreground line-through' : 'text-foreground'
                }`}
              >
                {step.title}
              </span>
              <ChevronDown
                size={12}
                className={`text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
              {step.description}
            </p>
          </button>

          {/* Expanded detail */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {step.detail}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

export function BeforeYouSign() {
  const { connected } = useWallet();
  const [checklist, setChecklist] = useState<ChecklistStep[]>(getChecklist());
  const [progress, setProgress] = useState(getChecklistProgress());
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const unsub = subscribeChecklist(() => {
      setChecklist(getChecklist());
      setProgress(getChecklistProgress());
    });
    return unsub;
  }, []);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, ChecklistStep[]>();
    for (const step of checklist) {
      const list = map.get(step.category) || [];
      list.push(step);
      map.set(step.category, list);
    }
    return map;
  }, [checklist]);

  if (!connected || checklist.length === 0) return null;

  const isComplete = progress.percent === 100;

  // Pick a contextual CTA message based on progress
  const ctaContext =
    progress.percent === 0
      ? 'New here? Get the complete security playbook to protect your wallet.'
      : progress.percent < 50
        ? "You're getting started. The playbook covers everything in depth."
        : progress.percent < 100
          ? "Almost there! The playbook has advanced techniques you won't find elsewhere."
          : "Great job! The playbook has recovery strategies and pro-level OPSEC.";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border rounded-lg p-5 card-glow"
    >
      {/* Header with progress */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <ClipboardCheck size={16} className="text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Security Checklist
          </h3>
          <span className="text-[10px] text-muted-foreground">
            ({progress.completed}/{progress.total})
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Progress percentage */}
          <div className="flex items-center gap-2">
            {isComplete && <Sparkles size={12} className="text-safe" />}
            <span className={`text-xs font-bold ${isComplete ? 'text-safe' : 'text-foreground'}`}>
              {progress.percent}%
            </span>
          </div>
          <ChevronDown
            size={14}
            className={`text-muted-foreground transition-transform ${collapsed ? '' : 'rotate-180'}`}
          />
        </div>
      </button>

      {/* Progress bar */}
      <div className="mt-3 h-1.5 bg-secondary rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: isComplete
              ? 'hsl(145, 70%, 45%)'
              : 'linear-gradient(90deg, hsl(192, 100%, 55%), hsl(330, 100%, 60%))',
          }}
          initial={{ width: 0 }}
          animate={{ width: `${progress.percent}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>

      {/* Completion badge */}
      {isComplete && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-safe/10 border border-safe/20"
        >
          <CheckCircle2 size={14} className="text-safe" />
          <span className="text-[11px] font-semibold text-safe">
            All security checks completed -- your wallet hygiene is solid.
          </span>
        </motion.div>
      )}

      {/* Collapsible content */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-5">
              {/* Category groups */}
              {Array.from(grouped.entries()).map(([category, steps]) => {
                const meta = CATEGORY_META[category];
                const catCompleted = steps.filter((s) => s.completed).length;

                return (
                  <div key={category}>
                    {/* Category header */}
                    <div className="flex items-center gap-2 mb-2">
                      <span className={meta.color}>{meta.icon}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {meta.label}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        ({catCompleted}/{steps.length})
                      </span>
                    </div>

                    {/* Steps */}
                    <div className="space-y-1.5">
                      {steps.map((step) => (
                        <StepItem
                          key={step.id}
                          step={step}
                          onToggle={() => toggleStep(step.id)}
                        />
                      ))}
                    </div>

                    {/* Inline CTA after the pre-sign category */}
                    {category === 'pre-sign' && (
                      <div className="mt-3">
                        <PlaybookCTA variant="inline" context={ctaContext} />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Banner CTA at the bottom */}
              <div className="pt-2">
                <PlaybookCTA
                  variant="banner"
                  context={
                    isComplete
                      ? 'Level up your OPSEC with the complete playbook -- advanced recovery strategies, hardware wallet setup, and more.'
                      : 'Master every security technique in the full playbook -- protect your bags like a pro.'
                  }
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
