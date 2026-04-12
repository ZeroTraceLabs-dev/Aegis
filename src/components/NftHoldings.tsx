import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  Grid3x3, List, ExternalLink, ImageOff, Search,
  ChevronDown, ChevronRight, Layers, FolderOpen,
  ShieldAlert, Eye, EyeOff, AlertTriangle,
  Flame, Loader2, CheckCircle, X, Flag, FlagOff,
} from 'lucide-react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { getSpamScore } from '@/hooks/useAssetMetadata';
import { scoreSpam } from '@/lib/spamDetector';
import type { SpamResult } from '@/lib/spamDetector';
import { burnSingleNft, burnBatchNfts } from '@/lib/burnNft';
import type { BurnResult } from '@/lib/burnNft';
import { isAcknowledged, acknowledgeRisk, subscribeRisk } from '@/lib/riskStore';
import { isManuallyFlagged, flagAsSpam, unflagSpam, subscribeManualSpam } from '@/lib/manualSpamStore';
import { BurnLog, burnResultToEntry } from './BurnLog';
import type { BurnLogEntry } from './BurnLog';
import { usePrices } from './PriceContext';
import { getCollectionMap, getCollectionName } from '@/lib/priceService';
import { toast } from '@/hooks/use-toast';

interface NftHoldingsProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
}

function abbr(addr: string): string {
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function normalizeImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice(7)}`;
  if (url.startsWith('ar://')) return `https://arweave.net/${url.slice(5)}`;
  return url;
}

interface EnrichedNft {
  mint: string;
  name: string;
  symbol: string;
  image: string;
  floor: { floor: number; source: string } | null;
  collectionId: string;
  collectionName: string;
  spam: SpamResult;
  /** true when auto-detected OR manually flagged, BUT NOT acknowledged */
  effectiveSpam: boolean;
  manualFlag: boolean;
}

interface CollectionGroup {
  id: string;
  name: string;
  nfts: EnrichedNft[];
  totalFloor: number;
  coverImage: string;
  spamCount: number;
}

function getOrScoreSpam(mint: string, name: string, symbol: string, image: string, collectionId: string): SpamResult {
  const cached = getSpamScore(mint);
  if (cached) return cached;
  return scoreSpam(name, symbol, image, {
    hasCollection: !!collectionId,
    noVerifiedCreator: true,
  });
}

/**
 * Determine effective spam status:
 * - If the user acknowledged the risk (`spam-{mint}`), it is NOT spam.
 * - If manually flagged, it IS spam (unless acknowledged).
 * - Otherwise use auto-detection.
 */
function resolveEffectiveSpam(mint: string, autoSpam: SpamResult): { effectiveSpam: boolean; manualFlag: boolean } {
  const riskId = `spam-${mint}`;
  const acknowledged = isAcknowledged(riskId);
  const manual = isManuallyFlagged(mint);

  if (acknowledged) {
    // User said "I acknowledge this risk" — treat as NOT spam
    return { effectiveSpam: false, manualFlag: manual };
  }
  if (manual) {
    return { effectiveSpam: true, manualFlag: true };
  }
  return { effectiveSpam: autoSpam.isSpam, manualFlag: false };
}

export function NftHoldings({ wallet, metadata }: NftHoldingsProps) {
  const { getNftFloor, formatUsd, prices } = usePrices();
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [groupMode, setGroupMode] = useState<'collection' | 'all'>('collection');
  const [search, setSearch] = useState('');
  // Start all collections collapsed; spam-flagged ones stay open
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(['__all_collapsed_init__']));
  const [collapsedInit, setCollapsedInit] = useState(false);
  const [showSpam, setShowSpam] = useState(false);

  // Subscribe to riskStore + manualSpamStore changes to re-render
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub1 = subscribeRisk(() => forceUpdate((n) => n + 1));
    const unsub2 = subscribeManualSpam(() => forceUpdate((n) => n + 1));
    return () => { unsub1(); unsub2(); };
  }, []);

  // Burn state
  const [burning, setBurning] = useState<Set<string>>(new Set());
  const [burned, setBurned] = useState<Set<string>>(new Set());
  const [burnErrors, setBurnErrors] = useState<Map<string, string>>(new Map());
  const [batchBurning, setBatchBurning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmBatchBurn, setConfirmBatchBurn] = useState(false);

  // Burn log
  const [burnLog, setBurnLog] = useState<BurnLogEntry[]>([]);

  const nfts = wallet.tokenAccounts.filter((t) => t.isNft);
  const collectionMap = useMemo(() => getCollectionMap(), [prices]);

  // Build enriched NFT list with effective spam status
  const enrichedNfts = useMemo(() => {
    return nfts
      .filter((nft) => !burned.has(nft.mint))
      .map((nft): EnrichedNft => {
        const meta = metadata.get(nft.mint);
        const name = (meta?.name && !meta.name.includes('..')) ? meta.name : `NFT ${abbr(nft.mint)}`;
        const symbol = (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : '';
        const image = normalizeImageUrl(meta?.image || '');
        const floor = getNftFloor(nft.mint);
        const collectionId = collectionMap[nft.mint] || '';
        const collectionName = collectionId
          ? (getCollectionName(collectionId) || abbr(collectionId))
          : '';
        const spam = getOrScoreSpam(nft.mint, name, symbol, image, collectionId);
        const { effectiveSpam, manualFlag } = resolveEffectiveSpam(nft.mint, spam);
        return { mint: nft.mint, name, symbol, image, floor, collectionId, collectionName, spam, effectiveSpam, manualFlag };
      });
  }, [nfts, metadata, getNftFloor, prices, collectionMap, burned]);

  const spamNfts = useMemo(() => enrichedNfts.filter((n) => n.effectiveSpam), [enrichedNfts]);
  const spamCount = spamNfts.length;
  const cleanCount = enrichedNfts.length - spamCount;

  const filtered = useMemo(() => {
    let list = enrichedNfts;
    if (!showSpam) list = list.filter((n) => !n.effectiveSpam);
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (n) =>
        n.name.toLowerCase().includes(q) ||
        n.symbol.toLowerCase().includes(q) ||
        n.mint.toLowerCase().includes(q) ||
        n.collectionName.toLowerCase().includes(q),
    );
  }, [enrichedNfts, search, showSpam]);

  const collections = useMemo((): CollectionGroup[] => {
    const groups = new Map<string, EnrichedNft[]>();
    for (const nft of filtered) {
      const key = nft.collectionId || '__uncategorized__';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(nft);
    }

    const result: CollectionGroup[] = [];
    for (const [id, groupNfts] of groups) {
      const totalFloor = groupNfts.reduce((sum, n) => sum + (n.floor?.floor || 0), 0);
      const coverImage = groupNfts.find((n) => n.image)?.image || '';
      const name = id === '__uncategorized__'
        ? 'Uncategorized'
        : (groupNfts[0]?.collectionName || abbr(id));
      const sc = groupNfts.filter((n) => n.effectiveSpam).length;
      result.push({ id, name, nfts: groupNfts, totalFloor, coverImage, spamCount: sc });
    }

    result.sort((a, b) => {
      if (a.id === '__uncategorized__') return 1;
      if (b.id === '__uncategorized__') return -1;
      return b.nfts.length - a.nfts.length;
    });

    return result;
  }, [filtered]);

  // Auto-collapse ALL collections on first render
  React.useEffect(() => {
    if (!collapsedInit && collections.length > 0) {
      const allIds = collections.map((c) => c.id);
      setCollapsed(new Set(allIds));
      setCollapsedInit(true);
    }
  }, [collections, collapsedInit]);

  const totalNftValue = useMemo(() => {
    return enrichedNfts.filter((n) => !n.effectiveSpam).reduce((sum, nft) => sum + (nft.floor?.floor || 0), 0);
  }, [enrichedNfts]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Name lookup helper for burn log
  const nameForMint = useCallback((mint: string) => {
    const meta = metadata.get(mint);
    return (meta?.name && !meta.name.includes('..')) ? meta.name : `NFT ${abbr(mint)}`;
  }, [metadata]);

  /* ── Burn single NFT ── */
  const handleBurnSingle = useCallback(async (mint: string) => {
    if (!publicKey || burning.has(mint)) return;
    setBurning((prev) => new Set(prev).add(mint));
    setBurnErrors((prev) => { const n = new Map(prev); n.delete(mint); return n; });

    const result = await burnSingleNft(
      mint,
      publicKey.toBase58(),
      connection,
      sendTransaction,
    );

    setBurning((prev) => { const n = new Set(prev); n.delete(mint); return n; });

    // Add to burn log
    setBurnLog((prev) => [...prev, burnResultToEntry(result, nameForMint(mint))]);

    if (result.success) {
      setBurned((prev) => new Set(prev).add(mint));
      toast({ title: 'NFT burned', description: `${nameForMint(mint)} burned. ~0.00203 SOL reclaimed.` });
    } else {
      setBurnErrors((prev) => new Map(prev).set(mint, result.error || 'Burn failed'));
      toast({ title: 'Burn failed', description: result.error || 'Unknown error', variant: 'destructive' });
    }
  }, [publicKey, connection, sendTransaction, burning, nameForMint]);

  /* ── Burn all spam ── */
  const handleBurnAllSpam = useCallback(async () => {
    if (!publicKey || batchBurning) return;
    const mints = spamNfts.map((n) => n.mint);
    if (mints.length === 0) return;

    setBatchBurning(true);
    setBatchProgress({ done: 0, total: mints.length });
    setConfirmBatchBurn(false);

    const results = await burnBatchNfts(
      mints,
      publicKey.toBase58(),
      connection,
      sendTransaction,
      (done, total, partial) => {
        setBatchProgress({ done, total });
        for (const r of partial) {
          if (r.success) {
            setBurned((prev) => new Set(prev).add(r.mint));
          }
        }
      },
      5,
    );

    setBatchBurning(false);
    setBatchProgress(null);

    // Add all results to burn log
    const logEntries = results.map((r) => burnResultToEntry(r, nameForMint(r.mint)));
    setBurnLog((prev) => [...prev, ...logEntries]);

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    for (const r of results) {
      if (r.success) {
        setBurned((prev) => new Set(prev).add(r.mint));
      }
    }

    if (successCount > 0 || failCount > 0) {
      const rentReclaimed = (successCount * 0.00203).toFixed(4);
      toast({
        title: 'Batch burn complete',
        description: `${successCount} burned${failCount > 0 ? `, ${failCount} failed` : ''}. ~${rentReclaimed} SOL reclaimed.`,
        variant: failCount > 0 ? 'destructive' : 'default',
      });
    }
  }, [publicKey, connection, sendTransaction, batchBurning, spamNfts, nameForMint]);

  /* ── Manual flag toggle ── */
  const handleToggleManualFlag = useCallback((mint: string) => {
    if (isManuallyFlagged(mint)) {
      unflagSpam(mint);
    } else {
      flagAsSpam(mint);
    }
  }, []);

  /* ── Acknowledge single NFT (mark as not spam) ── */
  const handleAcknowledgeSingle = useCallback((mint: string) => {
    acknowledgeRisk(`spam-${mint}`);
    if (isManuallyFlagged(mint)) unflagSpam(mint);
  }, []);

  /* ── Unflag entire collection ── */
  const handleUnflagCollection = useCallback((groupNfts: EnrichedNft[]) => {
    for (const nft of groupNfts) {
      if (nft.effectiveSpam) {
        // Acknowledge the risk so it's no longer treated as spam
        acknowledgeRisk(`spam-${nft.mint}`);
        // Also remove manual flag if present
        if (nft.manualFlag) unflagSpam(nft.mint);
      }
    }
  }, []);

  if (nfts.length === 0 && burned.size === 0) return null;

  const hasCollections = collections.some((c) => c.id !== '__uncategorized__');
  const estimatedRent = spamCount * 0.00203;

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Grid3x3 size={18} className="text-accent" />
          <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            NFT Holdings
          </h3>
          <span className="text-xs text-muted-foreground">({cleanCount})</span>
          {hasCollections && (
            <span className="text-[10px] text-muted-foreground/60 ml-1">
              {collections.filter((c) => c.id !== '__uncategorized__').length} collections
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {totalNftValue > 0 && (
            <span className="text-xs font-bold text-accent">{formatUsd(totalNftValue)}</span>
          )}

          {spamCount > 0 && (
            <button
              onClick={() => setShowSpam(!showSpam)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-semibold transition-all border ${
                showSpam
                  ? 'bg-destructive/15 border-destructive/40 text-destructive'
                  : 'bg-secondary/50 border-border text-muted-foreground hover:text-foreground hover:border-primary/30'
              }`}
              title={showSpam ? 'Hide spam NFTs' : `Show ${spamCount} spam NFTs`}
            >
              {showSpam ? <EyeOff size={11} /> : <Eye size={11} />}
              <ShieldAlert size={11} />
              <span>{spamCount}</span>
            </button>
          )}

          {hasCollections && (
            <div className="flex gap-1 bg-secondary/50 p-0.5 rounded">
              <button
                className={`p-1 rounded text-[10px] px-2 flex items-center gap-1 transition-colors ${
                  groupMode === 'collection' ? 'bg-card text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setGroupMode('collection')}
              >
                <Layers size={12} />
              </button>
              <button
                className={`p-1 rounded text-[10px] px-2 flex items-center gap-1 transition-colors ${
                  groupMode === 'all' ? 'bg-card text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
                onClick={() => setGroupMode('all')}
              >
                <FolderOpen size={12} />
              </button>
            </div>
          )}

          <div className="flex gap-1 bg-secondary/50 p-0.5 rounded">
            <button
              className={`p-1 rounded ${viewMode === 'grid' ? 'bg-card text-primary' : 'text-muted-foreground'}`}
              onClick={() => setViewMode('grid')}
            >
              <Grid3x3 size={14} />
            </button>
            <button
              className={`p-1 rounded ${viewMode === 'list' ? 'bg-card text-primary' : 'text-muted-foreground'}`}
              onClick={() => setViewMode('list')}
            >
              <List size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Spam banner with burn all */}
      {spamCount > 0 && !showSpam && (
        <div className="mb-4 px-3 py-3 rounded-md bg-destructive/8 border border-destructive/25">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldAlert size={14} className="text-destructive shrink-0" />
              <div>
                <p className="text-[11px] font-semibold text-destructive">
                  {spamCount} spam/scam NFT{spamCount !== 1 ? 's' : ''} detected and hidden
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Burning reclaims ~{estimatedRent.toFixed(4)} SOL in rent
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSpam(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-secondary/60 border border-border text-foreground hover:bg-secondary hover:border-primary/30 transition-all"
              >
                <Eye size={11} />
                Show Spam
              </button>
              {publicKey && !batchBurning && (
                <button
                  onClick={() => setConfirmBatchBurn(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-orange-500/15 border border-orange-500/40 text-orange-400 hover:bg-orange-500/25 transition-all"
                >
                  <Flame size={11} />
                  Burn All Spam
                </button>
              )}
              {batchBurning && batchProgress && (
                <span className="flex items-center gap-1.5 text-[10px] text-orange-400 font-semibold">
                  <Loader2 size={11} className="animate-spin" />
                  Burning {batchProgress.done}/{batchProgress.total}...
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Batch burn confirmation dialog */}
      {confirmBatchBurn && (
        <div className="mb-4 px-4 py-4 rounded-md bg-orange-500/10 border border-orange-500/30">
          <div className="flex items-start gap-3">
            <Flame size={20} className="text-orange-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-bold text-orange-400 mb-1">
                Burn {spamCount} spam NFT{spamCount !== 1 ? 's' : ''}?
              </p>
              <p className="text-[10px] text-muted-foreground mb-1">
                This will permanently destroy these NFTs and close their token accounts.
                You will reclaim approximately <span className="text-accent font-semibold">{estimatedRent.toFixed(4)} SOL</span> in rent.
              </p>
              <p className="text-[10px] text-orange-400/80 mb-2">
                NFTs you have acknowledged in Risk Evaluation are excluded from this batch.
              </p>
              <p className="text-[10px] text-orange-400/80 mb-3">
                This action is irreversible. Only burn NFTs you are sure are spam/garbage.
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleBurnAllSpam}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-bold bg-orange-500/20 border border-orange-500/50 text-orange-400 hover:bg-orange-500/30 transition-all"
                >
                  <Flame size={11} />
                  Yes, Burn All Spam
                </button>
                <button
                  onClick={() => setConfirmBatchBurn(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[10px] font-medium bg-secondary/50 border border-border text-muted-foreground hover:text-foreground transition-all"
                >
                  <X size={11} />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      {nfts.length > 4 && (
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search NFTs or collections..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-secondary/50 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/40"
          />
        </div>
      )}

      {/* Grouped view */}
      {groupMode === 'collection' && hasCollections ? (
        <div className="space-y-3">
          {collections.map((group) => {
            const isCollapsed = collapsed.has(group.id);
            return (
              <div key={group.id} className="border border-border rounded-lg overflow-hidden bg-secondary/20">
                <button
                  className="w-full flex items-center gap-3 p-3 hover:bg-secondary/40 transition-colors text-left"
                  onClick={() => toggleCollapse(group.id)}
                >
                  <div className="w-9 h-9 rounded-md overflow-hidden bg-background shrink-0 flex items-center justify-center">
                    {group.coverImage ? (
                      <img
                        src={group.coverImage}
                        alt={group.name}
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <Layers size={16} className="text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-foreground truncate">{group.name}</p>
                      {group.spamCount > 0 && (
                        <span className="text-[8px] px-1.5 py-0.5 bg-destructive/20 text-destructive rounded font-bold uppercase">
                          {group.spamCount} spam
                        </span>
                      )}
                      {group.spamCount > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleUnflagCollection(group.nfts); }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold bg-safe/10 border border-safe/30 text-safe hover:bg-safe/20 hover:border-safe/50 transition-all"
                          title={`Unflag all ${group.spamCount} spam NFTs in this collection`}
                        >
                          <ShieldAlert size={10} />
                          Unflag Collection
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {group.nfts.length} item{group.nfts.length !== 1 ? 's' : ''}
                      {group.totalFloor > 0 && (
                        <span className="text-accent ml-2 font-medium">{formatUsd(group.totalFloor)}</span>
                      )}
                    </p>
                  </div>
                  {isCollapsed
                    ? <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                    : <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                  }
                </button>
                {!isCollapsed && (
                  <div className="px-3 pb-3">
                    {viewMode === 'grid' ? (
                      <NftGrid nfts={group.nfts} formatUsd={formatUsd} burning={burning} burned={burned} burnErrors={burnErrors} onBurn={handleBurnSingle} onToggleFlag={handleToggleManualFlag} onAcknowledge={handleAcknowledgeSingle} hasWallet={!!publicKey} />
                    ) : (
                      <NftList nfts={group.nfts} formatUsd={formatUsd} burning={burning} burned={burned} burnErrors={burnErrors} onBurn={handleBurnSingle} onToggleFlag={handleToggleManualFlag} onAcknowledge={handleAcknowledgeSingle} hasWallet={!!publicKey} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {viewMode === 'grid' ? (
            <NftGrid nfts={filtered} formatUsd={formatUsd} burning={burning} burned={burned} burnErrors={burnErrors} onBurn={handleBurnSingle} onToggleFlag={handleToggleManualFlag} onAcknowledge={handleAcknowledgeSingle} hasWallet={!!publicKey} />
          ) : (
            <NftList nfts={filtered} formatUsd={formatUsd} burning={burning} burned={burned} burnErrors={burnErrors} onBurn={handleBurnSingle} onToggleFlag={handleToggleManualFlag} onAcknowledge={handleAcknowledgeSingle} hasWallet={!!publicKey} />
          )}
        </>
      )}

      {filtered.length === 0 && search && (
        <p className="text-xs text-muted-foreground text-center py-6">
          No NFTs matching &quot;{search}&quot;
        </p>
      )}

      {/* Burned count */}
      {burned.size > 0 && (
        <div className="mt-3 flex items-center gap-2 text-[10px] text-safe">
          <CheckCircle size={11} />
          <span>{burned.size} NFT{burned.size !== 1 ? 's' : ''} burned this session &mdash; ~{(burned.size * 0.00203).toFixed(4)} SOL reclaimed</span>
        </div>
      )}

      {/* Burn Log */}
      <BurnLog entries={burnLog} onClear={() => setBurnLog([])} />
    </div>
  );
}

/* ─── Spam badge component ────────────────────────────────── */

function SpamBadge({ spam, manualFlag }: { spam: SpamResult; manualFlag: boolean }) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div className="relative">
      <button
        className={`flex items-center gap-1 px-1.5 py-0.5 border rounded text-[8px] font-bold uppercase tracking-wide ${
          manualFlag
            ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
            : 'bg-destructive/20 text-destructive border-destructive/30'
        }`}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowTooltip(!showTooltip); }}
      >
        {manualFlag ? <Flag size={8} /> : <AlertTriangle size={8} />}
        {manualFlag ? 'FLAGGED' : 'SPAM'}
      </button>
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-0 mb-1.5 w-56 p-2.5 bg-card border border-destructive/30 rounded-md shadow-lg">
          {manualFlag && !spam.isSpam ? (
            <p className="text-[9px] text-orange-400 font-bold">Manually flagged as spam</p>
          ) : (
            <>
              <p className="text-[9px] font-bold text-destructive mb-1.5 uppercase">
                Spam Score: {spam.score}/100
                {manualFlag && ' + Manual flag'}
              </p>
              {spam.reasons.length > 0 && (
                <ul className="space-y-0.5">
                  {spam.reasons.map((r, i) => (
                    <li key={i} className="text-[9px] text-muted-foreground flex items-start gap-1">
                      <span className="text-destructive mt-0.5 shrink-0">&#8226;</span>
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <p className="text-[8px] text-muted-foreground mt-1.5 italic">
            Acknowledge in Risk Evaluation to unmark
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Manual flag button ────���────────────────────────��───── */

function ManualFlagButton({ mint, manualFlag, effectiveSpam, autoSpam, onToggle, onAcknowledge }: {
  mint: string;
  manualFlag: boolean;
  effectiveSpam: boolean;
  autoSpam: boolean;
  onToggle: (mint: string) => void;
  onAcknowledge: (mint: string) => void;
}) {
  // Auto-detected spam (not manually flagged) -> show "NOT SPAM" to acknowledge
  if (effectiveSpam && autoSpam && !manualFlag) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAcknowledge(mint); }}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold bg-safe/10 border border-safe/30 text-safe hover:bg-safe/20 hover:border-safe/50 transition-all shadow-sm shadow-safe/10"
        title="Mark as not spam -- removes spam flag"
      >
        <ShieldAlert size={11} />
        NOT SPAM
      </button>
    );
  }

  // Manually flagged -> show unflag
  if (manualFlag) {
    return (
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(mint); }}
        className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold bg-orange-500/20 border border-orange-500/50 text-orange-400 hover:bg-orange-500/30 shadow-sm shadow-orange-500/10 transition-all"
        title="Remove spam flag"
      >
        <FlagOff size={11} />
        UNFLAG SPAM
      </button>
    );
  }

  // Clean NFT -> show flag button
  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(mint); }}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 hover:border-destructive/50 transition-all"
      title="Flag as spam"
    >
      <Flag size={11} />
      FLAG SPAM
    </button>
  );
}

/* ─── Burn button (inline on card) ───────��───────────────── */

function BurnButton({
  mint,
  effectiveSpam,
  burning,
  burned,
  error,
  onBurn,
  hasWallet,
  size = 'sm',
}: {
  mint: string;
  effectiveSpam: boolean;
  burning: boolean;
  burned: boolean;
  error?: string;
  onBurn: (mint: string) => void;
  hasWallet: boolean;
  size?: 'sm' | 'md';
}) {
  const [confirmVisible, setConfirmVisible] = useState(false);

  if (!effectiveSpam || !hasWallet) return null;
  if (burned) {
    return (
      <span className="flex items-center gap-1 text-[9px] text-safe font-bold">
        <CheckCircle size={9} /> Burned
      </span>
    );
  }

  const isSm = size === 'sm';

  return (
    <div className="relative">
      {!confirmVisible ? (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmVisible(true); }}
          disabled={burning}
          className={`flex items-center gap-1 font-bold bg-orange-500/15 border border-orange-500/40 text-orange-400 hover:bg-orange-500/25 rounded transition-all disabled:opacity-50 ${
            isSm ? 'px-1.5 py-0.5 text-[8px]' : 'px-2 py-1 text-[10px]'
          }`}
          title="Burn this NFT and reclaim rent"
        >
          {burning ? <Loader2 size={isSm ? 8 : 10} className="animate-spin" /> : <Flame size={isSm ? 8 : 10} />}
          {isSm ? 'BURN' : 'BURN NFT'}
        </button>
      ) : (
        <div className="absolute z-50 bottom-full right-0 mb-1 p-2.5 bg-card border border-orange-500/40 rounded-md shadow-lg w-44">
          <p className="text-[9px] font-bold text-orange-400 mb-1.5">Burn this NFT?</p>
          <p className="text-[8px] text-muted-foreground mb-2">This is permanent and cannot be undone.</p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onBurn(mint); setConfirmVisible(false); }}
              disabled={burning}
              className="flex items-center gap-1 px-2 py-1 text-[8px] font-bold bg-orange-500/20 border border-orange-500/50 text-orange-400 hover:bg-orange-500/30 rounded transition-all"
            >
              <Flame size={8} /> Yes, Burn
            </button>
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmVisible(false); }}
              className="px-2 py-1 text-[8px] font-medium bg-secondary/50 border border-border text-muted-foreground rounded hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className="text-[8px] text-destructive mt-0.5 max-w-[120px] truncate" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}

/* ─── Grid sub-component ─���────────────────��─────────��────── */

interface NftSubProps {
  nfts: EnrichedNft[];
  formatUsd: (v: number) => string;
  burning: Set<string>;
  burned: Set<string>;
  burnErrors: Map<string, string>;
  onBurn: (mint: string) => void;
  onToggleFlag: (mint: string) => void;
  onAcknowledge: (mint: string) => void;
  hasWallet: boolean;
}

function NftGrid({ nfts, formatUsd, burning, burned, burnErrors, onBurn, onToggleFlag, onAcknowledge, hasWallet }: NftSubProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {nfts.map((nft) => (
        <a
          key={nft.mint}
          href={`https://solscan.io/token/${nft.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className={`group border rounded-lg overflow-hidden transition-all bg-secondary/30 ${
            nft.effectiveSpam
              ? 'border-destructive/30 opacity-60 hover:opacity-80'
              : 'border-border hover:border-primary/40 hover:shadow-neon'
          }`}
        >
          <div className="aspect-square bg-background relative overflow-hidden">
            {nft.image ? (
              <>
                <img
                  src={nft.image}
                  alt={nft.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={(e) => {
                    const el = e.target as HTMLImageElement;
                    el.style.display = 'none';
                    const fallback = el.parentElement?.querySelector('.nft-fallback') as HTMLElement;
                    if (fallback) fallback.style.display = 'flex';
                  }}
                />
                <div className="nft-fallback absolute inset-0 items-center justify-center bg-secondary hidden">
                  <ImageOff size={32} className="text-muted-foreground" />
                </div>
              </>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-secondary">
                <div className="text-center">
                  <ImageOff size={28} className="text-muted-foreground mx-auto mb-1" />
                  <span className="text-[9px] text-muted-foreground">Loading...</span>
                </div>
              </div>
            )}

            {/* Top-left badges: spam badge + manual flag */}
            <div className="absolute top-1 left-1 flex flex-col gap-1">
              {nft.effectiveSpam && <SpamBadge spam={nft.spam} manualFlag={nft.manualFlag} />}
              <ManualFlagButton mint={nft.mint} manualFlag={nft.manualFlag} effectiveSpam={nft.effectiveSpam} autoSpam={nft.spam.isSpam} onToggle={onToggleFlag} onAcknowledge={onAcknowledge} />
            </div>

            {/* Top-right: burn button for spam */}
            {nft.effectiveSpam && (
              <div className="absolute top-1 right-1">
                <BurnButton
                  mint={nft.mint}
                  effectiveSpam={nft.effectiveSpam}
                  burning={burning.has(nft.mint)}
                  burned={burned.has(nft.mint)}
                  error={burnErrors.get(nft.mint)}
                  onBurn={onBurn}
                  hasWallet={hasWallet}
                  size="sm"
                />
              </div>
            )}

            {nft.floor && !nft.effectiveSpam && (
              <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-background/80 backdrop-blur-sm rounded text-[9px] font-bold text-accent border border-accent/20">
                {formatUsd(nft.floor.floor)}
              </div>
            )}
          </div>
          <div className="p-2.5">
            <p className="text-[11px] font-semibold text-foreground truncate">{nft.name}</p>
            {nft.symbol && (
              <p className="text-[9px] text-muted-foreground uppercase">{nft.symbol}</p>
            )}
            <div className="flex items-center justify-between mt-1">
              <span className="text-[9px] font-mono text-muted-foreground">{abbr(nft.mint)}</span>
              <ExternalLink size={9} className="text-muted-foreground group-hover:text-primary transition-colors" />
            </div>
          </div>
        </a>
      ))}
    </div>
  );
}

/* ─── List sub-component ───���─────────────────────────────── */

function NftList({ nfts, formatUsd, burning, burned, burnErrors, onBurn, onToggleFlag, onAcknowledge, hasWallet }: NftSubProps) {
  return (
    <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
      {nfts.map((nft) => (
        <div
          key={nft.mint}
          className={`flex items-center gap-3 p-2.5 rounded-md transition-colors ${
            nft.effectiveSpam ? 'hover:bg-destructive/5 opacity-60' : 'hover:bg-secondary/50'
          }`}
        >
          <div className="w-14 h-14 rounded-lg overflow-hidden bg-secondary shrink-0 flex items-center justify-center relative">
            {nft.effectiveSpam && (
              <div className="absolute top-0.5 left-0.5 z-10">
                <SpamBadge spam={nft.spam} manualFlag={nft.manualFlag} />
              </div>
            )}
            {nft.image ? (
              <img
                src={nft.image}
                alt={nft.name}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <ImageOff size={20} className="text-muted-foreground" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-foreground truncate">{nft.name}</p>
            </div>
            {nft.symbol && <p className="text-[10px] text-muted-foreground">{nft.symbol}</p>}
            <p className="text-[10px] font-mono text-muted-foreground">{abbr(nft.mint)}</p>
          </div>
          {nft.floor && !nft.effectiveSpam && (
            <div className="text-right">
              <p className="text-xs font-semibold text-accent">{formatUsd(nft.floor.floor)}</p>
              <p className="text-[10px] text-muted-foreground">{nft.floor.source}</p>
            </div>
          )}
          {/* Manual flag button */}
          <ManualFlagButton mint={nft.mint} manualFlag={nft.manualFlag} effectiveSpam={nft.effectiveSpam} autoSpam={nft.spam.isSpam} onToggle={onToggleFlag} onAcknowledge={onAcknowledge} />
          {/* Burn button */}
          <BurnButton
            mint={nft.mint}
            effectiveSpam={nft.effectiveSpam}
            burning={burning.has(nft.mint)}
            burned={burned.has(nft.mint)}
            error={burnErrors.get(nft.mint)}
            onBurn={onBurn}
            hasWallet={hasWallet}
            size="md"
          />
          <a href={`https://solscan.io/token/${nft.mint}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={11} className="text-muted-foreground hover:text-primary" />
          </a>
        </div>
      ))}
    </div>
  );
}