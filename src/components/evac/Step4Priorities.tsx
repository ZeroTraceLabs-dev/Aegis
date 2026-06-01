import { useMemo, useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, EyeOff } from 'lucide-react';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { usePrices } from '@/components/PriceContext';
import {
  setPriority,
  defaultPriority,
  getPriority,
  type PriorityTier,
  type AssetCategory,
  type PriorityConfig,
} from '@/lib/evac/configStore';
import {
  subscribeSpamFilter,
  isTokenSpam,
  isNftCollectionSpam,
} from '@/lib/spamFilterStore';
import { getCollectionMap } from '@/lib/priceService';

interface Step4Props {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

const TIER_LABEL: Record<PriorityTier, string> = {
  critical: 'Critical',
  priority: 'Priority',
  standard: 'Standard',
};

const TIER_DESC: Record<PriorityTier, string> = {
  critical: 'Evacuated first',
  priority: 'Evacuated second',
  standard: 'Evacuated last',
};

const TIER_ORDER: PriorityTier[] = ['critical', 'priority', 'standard'];

/**
 * Step 4 — Asset priority configuration.
 *
 * Three category cards (SOL, Tokens, NFTs) each assigned to a tier
 * (Critical, Priority, Standard). Multiple categories can share a tier;
 * the evac execution will work through tier-by-tier in order. Within a
 * category, the default sub-ordering is by USD value descending — shown
 * in a collapsible preview below each card.
 *
 * Spam-marked tokens and NFT collections are auto-excluded and shown in
 * a separate "Skipped (spam)" section so the user can see what was left
 * out of the priority list.
 */
export function Step4Priorities({ wallet, metadata }: Step4Props) {
  const { getUsdValue, formatUsd, getSolPrice } = usePrices();
  const [, forceUpdate] = useState(0);

  // Subscribe to spam list mutations so counts stay current.
  useEffect(() => {
    const unsub = subscribeSpamFilter(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  const [config, setConfig] = useState<PriorityConfig>(
    () => getPriority() ?? defaultPriority(),
  );

  // ── Enriched asset lists, filtered by spam, sorted by USD desc ────

  const tokens = useMemo(() => {
    const rows = wallet.tokenAccounts
      .filter((t) => !t.isNft && t.uiAmount > 0)
      .map((t) => {
        const meta = metadata.get(t.mint);
        const symbol = (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : t.symbol;
        const usd = getUsdValue(t.mint, t.uiAmount) ?? 0;
        return { mint: t.mint, symbol, usd, spam: isTokenSpam(t.mint) };
      });
    rows.sort((a, b) => b.usd - a.usd);
    return rows;
  }, [wallet.tokenAccounts, metadata, getUsdValue]);

  const nftCollections = useMemo(() => {
    const collectionMap = getCollectionMap();
    const buckets = new Map<string, { id: string; count: number; floor: number; spam: boolean }>();
    for (const t of wallet.tokenAccounts) {
      if (!t.isNft) continue;
      const cid = collectionMap[t.mint] || '__uncategorized__';
      const cur = buckets.get(cid) ?? { id: cid, count: 0, floor: 0, spam: isNftCollectionSpam(cid) };
      cur.count += 1;
      buckets.set(cid, cur);
    }
    return Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  }, [wallet.tokenAccounts]);

  const visibleTokens = tokens.filter((t) => !t.spam);
  const spamTokens = tokens.filter((t) => t.spam);
  const visibleNftCollections = nftCollections.filter((c) => !c.spam);
  const spamNftCollections = nftCollections.filter((c) => c.spam);

  const solUsd = wallet.solBalance * getSolPrice();

  const counts: Record<AssetCategory, { label: string; sub: string }> = {
    sol: {
      label: 'SOL',
      sub: solUsd > 0 ? `${wallet.solBalance.toFixed(4)} SOL · ${formatUsd(solUsd)}` : `${wallet.solBalance.toFixed(4)} SOL`,
    },
    tokens: {
      label: 'SPL Tokens',
      sub: visibleTokens.length === 1 ? '1 token' : `${visibleTokens.length} tokens`,
    },
    nfts: {
      label: 'NFTs',
      sub: visibleNftCollections.length === 1 ? '1 collection' : `${visibleNftCollections.length} collections`,
    },
  };

  // ── Tier reassignment ────────────────────────────────────────────

  const findTier = useCallback((cat: AssetCategory): PriorityTier => {
    for (const tier of TIER_ORDER) {
      if (config.tiers[tier].includes(cat)) return tier;
    }
    return 'standard';
  }, [config]);

  const moveToTier = useCallback((cat: AssetCategory, newTier: PriorityTier) => {
    setConfig((prev) => {
      const next: PriorityConfig = {
        tiers: {
          critical: prev.tiers.critical.filter((c) => c !== cat),
          priority: prev.tiers.priority.filter((c) => c !== cat),
          standard: prev.tiers.standard.filter((c) => c !== cat),
        },
        overrides: prev.overrides,
      };
      next.tiers[newTier] = [...next.tiers[newTier], cat];
      return next;
    });
  }, []);

  const handleSave = () => {
    setPriority(config);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[13px] font-semibold text-foreground mb-1">
          Set evacuation order
        </p>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          When seconds matter, the order Cerberus moves things in matters.
          Assign each category to a tier. Critical evacuates first, then
          Priority, then Standard. Multiple categories can share a tier.
        </p>
      </div>

      {/* Category cards */}
      <div className="space-y-2">
        {(['sol', 'tokens', 'nfts'] as AssetCategory[]).map((cat) => (
          <CategoryCard
            key={cat}
            category={cat}
            label={counts[cat].label}
            sub={counts[cat].sub}
            currentTier={findTier(cat)}
            onTierChange={(tier) => moveToTier(cat, tier)}
            previewItems={cat === 'sol'
              ? [{ key: 'SOL', label: 'Native SOL', sub: counts.sol.sub }]
              : cat === 'tokens'
                ? visibleTokens.map((t) => ({
                    key: t.mint,
                    label: t.symbol,
                    sub: t.usd > 0 ? formatUsd(t.usd) : '—',
                  }))
                : visibleNftCollections.map((c) => ({
                    key: c.id,
                    label: c.id === '__uncategorized__' ? 'Uncategorized' : abbr(c.id),
                    sub: c.count === 1 ? '1 item' : `${c.count} items`,
                  }))
            }
          />
        ))}
      </div>

      {/* Skipped (spam) */}
      {(spamTokens.length > 0 || spamNftCollections.length > 0) && (
        <SkippedSection
          tokens={spamTokens.map((t) => t.symbol)}
          collections={spamNftCollections.map((c) =>
            c.id === '__uncategorized__' ? 'Uncategorized' : abbr(c.id),
          )}
        />
      )}

      <button
        type="button"
        onClick={handleSave}
        className="w-full px-4 py-2.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold hover:opacity-90 transition-opacity"
      >
        Save priority order
      </button>

      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Default sub-ordering within each category is by USD value descending —
        highest-value items go first. Reasonable for most users; expandable
        previews above let you see exactly what's queued.
      </p>
    </div>
  );
}

interface CategoryCardProps {
  category: AssetCategory;
  label: string;
  sub: string;
  currentTier: PriorityTier;
  onTierChange: (tier: PriorityTier) => void;
  previewItems: { key: string; label: string; sub: string }[];
}

function CategoryCard({ label, sub, currentTier, onTierChange, previewItems }: CategoryCardProps) {
  const [open, setOpen] = useState(false);
  const empty = previewItems.length === 0;

  return (
    <div className="border border-border rounded-md bg-background">
      <div className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-foreground">{label}</p>
          <p className="text-[10px] text-muted-foreground">{sub}</p>
        </div>
        <div className="flex gap-1">
          {TIER_ORDER.map((tier) => {
            const active = tier === currentTier;
            return (
              <button
                key={tier}
                type="button"
                onClick={() => onTierChange(tier)}
                className={`px-2 py-1 rounded text-[10px] font-medium uppercase tracking-wider transition-colors border ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
                }`}
                title={TIER_DESC[tier]}
              >
                {TIER_LABEL[tier]}
              </button>
            );
          })}
        </div>
      </div>
      {!empty && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full px-3 pb-2 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Advanced — preview default order ({previewItems.length})
        </button>
      )}
      {open && !empty && (
        <div className="border-t border-border px-3 py-2 max-h-48 overflow-y-auto space-y-1">
          {previewItems.map((item, idx) => (
            <div key={item.key} className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground/60 font-mono w-5 shrink-0">{idx + 1}.</span>
              <span className="text-foreground truncate flex-1">{item.label}</span>
              <span className="text-muted-foreground shrink-0">{item.sub}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkippedSection({ tokens, collections }: { tokens: string[]; collections: string[] }) {
  const [open, setOpen] = useState(false);
  const total = tokens.length + collections.length;

  return (
    <div className="border border-border rounded-md bg-background">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full p-3 flex items-center gap-2 text-left hover:bg-secondary/30 transition-colors"
      >
        <EyeOff size={12} className="text-muted-foreground" />
        <span className="flex-1 text-[11px] font-medium text-foreground">
          Skipped (spam) — {total}
        </span>
        {open ? <ChevronDown size={12} className="text-muted-foreground" /> : <ChevronRight size={12} className="text-muted-foreground" />}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-2 text-[10px] text-muted-foreground">
          {tokens.length > 0 && (
            <div>
              <p className="uppercase tracking-wider text-[9px] mb-1">Tokens</p>
              <p className="font-mono break-words">{tokens.join(', ')}</p>
            </div>
          )}
          {collections.length > 0 && (
            <div>
              <p className="uppercase tracking-wider text-[9px] mb-1">Collections</p>
              <p className="font-mono break-words">{collections.join(', ')}</p>
            </div>
          )}
          <p className="pt-1 text-muted-foreground/70 leading-relaxed">
            Items you've marked as spam in the Wallet tab are excluded
            from the evacuation list entirely.
          </p>
        </div>
      )}
    </div>
  );
}

function abbr(s: string): string {
  if (s.length <= 12) return s;
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}
