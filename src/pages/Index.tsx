import React, { useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { DashboardContent, TABS } from '@/components/DashboardContent';
import type { DashboardTab } from '@/components/DashboardContent';
import { NotificationManager } from '@/components/NotificationManager';
import { CerberusChat } from '@/components/CerberusChat';
import { SignInButton } from '@/components/SignInButton';
import { ArrowRight } from 'lucide-react';

const LOGO_URL = 'https://storage.googleapis.com/prod-plena-ai-coder-images/bNOycalK.jpg';
const BRAND_URL = 'https://storage.googleapis.com/prod-plena-ai-coder-images/f1nlYrrk.jpg';

export default function Index() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('wallet');

  return (
    <div className="min-h-screen bg-background grid-bg">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        {/* Desktop navbar */}
        <div className="hidden sm:flex max-w-5xl mx-auto px-4 h-14 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <img src={LOGO_URL} alt="ZeroTraceLabs" className="w-12 h-12 rounded-full object-cover ring-2 ring-primary/20 shadow-lg shadow-primary/10" />
              <span className="font-bold text-sm tracking-wider">
                <span className="text-neon-cyan">Aegis</span>
                <span className="text-neon-magenta text-[10px] ml-1">by ZeroTraceLabs</span>
              </span>
            </div>
            <NotificationInline />
          </div>
          <div className="flex items-center gap-3">
            <a href="https://discord.gg/9NaPPj7KMk" target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); window.open('https://discord.gg/9NaPPj7KMk', '_blank', 'noopener,noreferrer'); }} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[#5865F2] hover:bg-[#5865F2]/10 transition-colors" title="Join our Discord">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" /></svg>
              <span className="text-[10px] font-semibold">Discord</span>
            </a>
            <a href="https://buy.stripe.com/bJe6oHcpz2jn2WUgma4gg00" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent/20 text-accent text-[10px] font-semibold hover:bg-accent/5 transition-colors">
              Playbook <ArrowRight size={10} />
            </a>
            <WalletMultiButton />
            <SignInButton />
          </div>
        </div>

        {/* Mobile navbar -- two rows to prevent overlap */}
        <div className="sm:hidden">
          {/* Row 1: Logo + icons */}
          <div className="flex items-center justify-between px-3 h-12">
            <div className="flex items-center gap-2">
              <img src={LOGO_URL} alt="ZeroTraceLabs" className="w-8 h-8 rounded-full object-cover ring-1 ring-primary/20" />
              <span className="font-bold text-xs tracking-wider text-neon-cyan">Aegis</span>
            </div>
            <div className="flex items-center gap-2">
              <a href="https://discord.gg/9NaPPj7KMk" target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); window.open('https://discord.gg/9NaPPj7KMk', '_blank', 'noopener,noreferrer'); }} className="p-1.5 rounded-md text-[#5865F2] hover:bg-[#5865F2]/10 transition-colors" title="Discord">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" /></svg>
              </a>
              <NotificationInline />
            </div>
          </div>
          {/* Row 2: Wallet button full-width on mobile + sign-in CTA */}
          <div className="px-3 pb-2 flex flex-col gap-2">
            <div className="mobile-wallet-btn"><WalletMultiButton /></div>
            <SignInButton />
          </div>
        </div>
      </nav>

      {/* Brand bar + tab nav */}
      <div className="brand-bar">
        <div className="max-w-5xl mx-auto px-4 flex items-center justify-center gap-4 h-12">
          <img src={BRAND_URL} alt="Aegis by ZeroTraceLabs" className="h-7 sm:h-8 object-contain" />
          <div className="h-4 w-px bg-border" />
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Aegis Wallet Security Dashboard</span>
        </div>
      </div>
      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Cerberus AI Agent -- floating chat */}
      <CerberusChat />

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <DashboardContent activeTab={activeTab} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-8">
        <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
            <img src={LOGO_URL} alt="Aegis by ZeroTraceLabs" className="w-5 h-5 rounded-full object-cover" />
            <span>
              <span className="text-neon-cyan">Aegis</span>
              <span className="text-neon-magenta ml-1">by ZeroTraceLabs</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://discord.gg/9NaPPj7KMk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[#5865F2] hover:text-[#5865F2]/80 transition-colors font-semibold"
            >
              Discord
            </a>
            <a
              href="https://buy.stripe.com/bJe6oHcpz2jn2WUgma4gg00"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-accent hover:text-accent/80 transition-colors font-semibold"
            >
              Security Playbook
            </a>
            <p className="text-[10px] text-muted-foreground">Mainnet</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function TabNav({ activeTab, onTabChange }: { activeTab: DashboardTab; onTabChange: (tab: DashboardTab) => void }) {
  return (
    <div className="sticky top-[5.5rem] sm:top-14 z-40 bg-background/90 backdrop-blur-md border-b border-border">
      <div className="max-w-5xl mx-auto px-2 sm:px-4">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1.5 flex-nowrap">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { onTabChange(tab.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all whitespace-nowrap ${
                  isActive
                    ? tab.danger
                      ? 'bg-destructive/15 text-destructive border border-destructive/30'
                      : 'bg-primary/10 text-primary border border-primary/30'
                    : tab.danger
                      ? 'text-destructive/70 hover:bg-destructive/10 hover:text-destructive'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Compact inline notification bell for the navbar.
 * Wraps the full NotificationManager in a popover-style dropdown.
 */
function NotificationInline() {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-primary transition-colors"
        title="Notifications"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
      </button>

      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          {/* Dropdown — stopPropagation prevents backdrop from swallowing link clicks */}
          <div
            className="absolute top-full left-0 mt-2 w-80 z-50 bg-card border border-border rounded-lg shadow-lg overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <NotificationManager />
          </div>
        </>
      )}
    </div>
  );
}
