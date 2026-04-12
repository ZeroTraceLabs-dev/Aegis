import React from 'react';
import {
  Shield,
  ScanSearch,
  Activity,
  Lock,
  Zap,
  Eye,
  ArrowRight,
  Bot,
  Flame,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { AuthForm } from '@/components/AuthForm';

const BRAND_URL = 'https://storage.googleapis.com/prod-plena-ai-coder-images/f1nlYrrk.jpg';

const FEATURES = [
  {
    icon: <Shield size={20} />,
    title: 'Health Score',
    description: 'Real-time wallet security grade based on approvals, token risk, and activity patterns.',
    color: 'text-safe',
    glow: 'group-hover:shadow-[0_0_20px_hsl(145_70%_45%/0.15)]',
  },
  {
    icon: <ScanSearch size={20} />,
    title: 'Threat Scanner',
    description: 'Paste any URL, contract address, or transaction to scan for phishing and rug-pull indicators.',
    color: 'text-primary',
    glow: 'group-hover:shadow-[0_0_20px_hsl(192_100%_55%/0.15)]',
  },
  {
    icon: <Lock size={20} />,
    title: 'Permission Scanner',
    description: 'Find and revoke dangerous token delegates and open approvals before they drain you.',
    color: 'text-accent',
    glow: 'group-hover:shadow-[0_0_20px_hsl(330_100%_60%/0.15)]',
  },
  {
    icon: <Eye size={20} />,
    title: 'Token Risk Grades',
    description: 'Every token graded A-F based on mint authority, freeze authority, and supply analysis.',
    color: 'text-yellow-400',
    glow: 'group-hover:shadow-[0_0_20px_hsl(50_100%_55%/0.15)]',
  },
  {
    icon: <Activity size={20} />,
    title: 'Live Monitor',
    description: 'WebSocket-powered real-time feed watching your wallet for suspicious activity 24/7.',
    color: 'text-primary',
    glow: 'group-hover:shadow-[0_0_20px_hsl(192_100%_55%/0.15)]',
  },
  {
    icon: <Zap size={20} />,
    title: 'Security Checklist',
    description: 'Interactive pre-sign checklist to build safe habits and protect against common attack vectors.',
    color: 'text-accent',
    glow: 'group-hover:shadow-[0_0_20px_hsl(330_100%_60%/0.15)]',
  },
  {
    icon: <Bot size={20} />,
    title: 'Cerberus AI Agent',
    description: 'AI security analyst that reads your wallet state and delivers personalized threat briefings and guidance.',
    color: 'text-primary',
    glow: 'group-hover:shadow-[0_0_20px_hsl(192_100%_55%/0.15)]',
  },
  {
    icon: <Flame size={20} />,
    title: 'Spam Burn & Clean',
    description: 'Detect, flag, and batch-burn spam NFTs. Reclaim SOL from empty token accounts in one click.',
    color: 'text-destructive',
    glow: 'group-hover:shadow-[0_0_20px_hsl(0_80%_55%/0.15)]',
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4 } },
};

export function LandingHero() {
  return (
    <div className="relative overflow-hidden">
      {/* Gradient orbs */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-[hsl(192_100%_55%/0.04)] rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-20 right-1/4 w-[400px] h-[400px] bg-[hsl(330_100%_60%/0.03)] rounded-full blur-[100px] pointer-events-none" />

      {/* Hero section */}
      <section className="max-w-5xl mx-auto px-4 pt-16 pb-12 relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          {/* Brand */}
          <div className="mx-auto mb-6 max-w-lg">
            <img
              src={BRAND_URL}
              alt="Aegis by ZeroTraceLabs"
              className="mx-auto h-20 sm:h-28 object-contain"
            />
          </div>

          {/* Tagline */}
          <h1 className="text-3xl sm:text-5xl font-bold mb-3 leading-tight">
            <span className="text-neon-cyan">Aegis</span>
          </h1>
          <p className="text-xs sm:text-sm text-neon-magenta font-semibold tracking-wider uppercase mb-3">
            by ZeroTraceLabs
          </p>
          <p className="text-sm sm:text-base text-muted-foreground max-w-xl mx-auto mb-2 leading-relaxed">
            Scan your Solana wallet for threats, revoke dangerous approvals,
            grade token risk, and monitor activity in real time.
          </p>
          <p className="text-xs text-muted-foreground/70 max-w-md mx-auto mb-8">
            Trusted by security-conscious traders. Your keys, your control. Read-only analysis, always.
          </p>
        </motion.div>

        {/* Auth form */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="mb-6"
        >
          <AuthForm />
        </motion.div>

        {/* Playbook CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center"
        >
          <a
            href="https://buy.stripe.com/bJe6oHcpz2jn2WUgma4gg00"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-accent/30 bg-accent/5 text-accent text-xs font-semibold hover:bg-accent/10 hover:border-accent/50 transition-all group"
          >
            Get the Security Playbook
            <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" />
          </a>
        </motion.div>
      </section>

      {/* Features grid */}
      <section className="max-w-5xl mx-auto px-4 pb-16">
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
        >
          {FEATURES.map((feature) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className={`group bg-card border border-border rounded-lg p-4 transition-all duration-300 hover:border-border/60 ${feature.glow}`}
            >
              <div className={`${feature.color} mb-2.5`}>
                {feature.icon}
              </div>
              <h3 className="text-xs font-bold text-foreground mb-1">
                {feature.title}
              </h3>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </motion.div>
          ))}
        </motion.div>

        {/* Bottom stats bar */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="mt-8 flex items-center justify-center gap-8 text-center"
        >
          {[
            { value: '10+', label: 'Security Modules' },
            { value: '25+', label: 'Threat Checks' },
            { value: '24/7', label: 'Background Monitoring' },
          ].map((stat) => (
            <div key={stat.label}>
              <p className="text-lg sm:text-xl font-bold text-neon-cyan">{stat.value}</p>
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </section>
    </div>
  );
}