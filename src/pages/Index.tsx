import React, { useState } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { DashboardContent, TABS } from '@/components/DashboardContent';
import type { DashboardTab } from '@/components/DashboardContent';
import { NotificationManager } from '@/components/NotificationManager';
import { CerberusChat } from '@/components/CerberusChat';
import { Bell } from 'lucide-react';

export default function Index() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('wallet');

  return (
    <div className="min-h-screen bg-background">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border">
        {/* Desktop navbar */}
        <div className="hidden sm:flex max-w-6xl mx-auto px-4 h-14 items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="wordmark text-foreground text-[2rem] font-bold border-b-2 border-primary pb-1 leading-none">Cerberus</span>
            <NotificationInline />
          </div>
          <div className="flex items-center gap-3">
            <a
              href="https://discord.gg/9NaPPj7KMk"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => { e.preventDefault(); window.open('https://discord.gg/9NaPPj7KMk', '_blank', 'noopener,noreferrer'); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              title="Join our Discord"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" /></svg>
              <span className="text-[10px]">Discord</span>
            </a>
            <WalletMultiButton />
          </div>
        </div>

        {/* Mobile navbar -- two rows */}
        <div className="sm:hidden">
          <div className="flex items-center justify-between px-3 h-12">
            <span className="wordmark text-foreground text-[1.05rem]">Cerberus</span>
            <div className="flex items-center gap-2">
              <a
                href="https://discord.gg/9NaPPj7KMk"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); window.open('https://discord.gg/9NaPPj7KMk', '_blank', 'noopener,noreferrer'); }}
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Discord"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.11 13.11 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.947 2.418-2.157 2.418z" /></svg>
              </a>
              <NotificationInline />
            </div>
          </div>
          <div className="px-3 pb-2">
            <div className="mobile-wallet-btn"><WalletMultiButton /></div>
          </div>
        </div>
      </nav>

      <TabNav activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Cerberus AI Agent -- floating chat */}
      <CerberusChat />

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-6">
        <DashboardContent activeTab={activeTab} />
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-8">
        <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="wordmark text-foreground text-xs">Cerberus</span>
            <span aria-hidden="true">·</span>
            <a
              href="https://x.com/TrickyRoxxx"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              by @TrickyRoxxx
            </a>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://discord.gg/9NaPPj7KMk"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Discord
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
      <div className="max-w-6xl mx-auto px-2 sm:px-4">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide py-1.5 flex-nowrap">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { onTabChange(tab.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap ${
                  isActive
                    ? tab.danger
                      ? 'bg-destructive/15 text-destructive border border-destructive/40'
                      : 'bg-primary/15 text-primary border border-primary/40'
                    : tab.danger
                      ? 'text-destructive/70 hover:bg-destructive/10 hover:text-destructive'
                      : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
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

  // Active state is wired through to oxblood the moment a real unread-count
  // signal exists. There's no source plumbed to the navbar yet — the
  // NotificationManager surfaces no aggregate unread count — so this stays
  // false. Default state is intentionally dim so the bell recedes against
  // the wordmark; once a signal flows in, swap this to that signal.
  const hasUnread = false;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`relative p-1.5 rounded-md hover:bg-secondary transition-colors ${
          hasUnread
            ? 'text-primary'
            : 'text-muted-foreground/60 hover:text-foreground'
        }`}
        title="Notifications"
        aria-label={hasUnread ? 'Notifications (unread)' : 'Notifications'}
      >
        <Bell size={14} />
        {hasUnread && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-primary" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full left-0 mt-2 w-80 z-50 bg-card border border-border rounded-md overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <NotificationManager />
          </div>
        </>
      )}
    </div>
  );
}
