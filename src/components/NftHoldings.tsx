import { useMemo, useState, useEffect } from 'react';
import {
  Grid3x3, List, ExternalLink, ImageOff, Search,
  ChevronDown, ChevronRight, Layers, FolderOpen,
} from 'lucide-react';
import type { WalletData } from '@/hooks/useWalletScan';
import type { TokenMeta } from '@/hooks/useAssetMetadata';
import { usePrices } from './PriceContext';
import { getCollectionMap, getCollectionName } from '@/lib/priceService';
import {
  subscribeSpamFilter,
  isNftCollectionSpam,
  markNftCollectionSpam,
  unmarkNftCollectionSpam,
} from '@/lib/spamFilterStore';
import { SpamMenu } from './SpamMenu';

interface NftHoldingsProps {
  wallet: WalletData;
  metadata: Map<string, TokenMeta>;
  showSpam: boolean;
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
}

interface CollectionGroup {
  id: string;
  name: string;
  nfts: EnrichedNft[];
  totalFloor: number;
  coverImage: string;
}

export function NftHoldings({ wallet, metadata, showSpam }: NftHoldingsProps) {
  const { getNftFloor, formatUsd, prices } = usePrices();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [groupMode, setGroupMode] = useState<'collection' | 'all'>('collection');
  const [search, setSearch] = useState('');
  // Default: every collection is collapsed. We track which ones the user
  // has explicitly expanded — a clean inversion of the old "track collapsed"
  // semantics, which had a brittle init effect that missed late-loading
  // collections (DAS metadata arriving after the first paint).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Re-render on spam list mutations.
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = subscribeSpamFilter(() => forceUpdate((n) => n + 1));
    return unsub;
  }, []);

  const nfts = wallet.tokenAccounts.filter((t) => t.isNft);
  const collectionMap = useMemo(() => getCollectionMap(), [prices]);

  const enrichedNfts = useMemo(() => {
    return nfts.map((nft): EnrichedNft => {
      const meta = metadata.get(nft.mint);
      const name = (meta?.name && !meta.name.includes('..')) ? meta.name : `NFT ${abbr(nft.mint)}`;
      const symbol = (meta?.symbol && !meta.symbol.includes('..')) ? meta.symbol : '';
      const image = normalizeImageUrl(meta?.image || '');
      const floor = getNftFloor(nft.mint);
      const collectionId = collectionMap[nft.mint] || '';
      const collectionName = collectionId
        ? (getCollectionName(collectionId) || abbr(collectionId))
        : '';
      return { mint: nft.mint, name, symbol, image, floor, collectionId, collectionName };
    });
  }, [nfts, metadata, getNftFloor, prices, collectionMap]);

  // A spam mark lives at the collection level. For uncategorized NFTs
  // (collectionId === '') we use the synthetic '__uncategorized__' id, which
  // is markable like any real collection (lets the user hide the whole bucket).
  const spamKey = (collectionId: string) => collectionId || '__uncategorized__';
  const nftIsSpam = (nft: EnrichedNft) => isNftCollectionSpam(spamKey(nft.collectionId));

  const filtered = useMemo(() => {
    const base = search
      ? enrichedNfts.filter(
          (n) =>
            n.name.toLowerCase().includes(search.toLowerCase()) ||
            n.symbol.toLowerCase().includes(search.toLowerCase()) ||
            n.mint.toLowerCase().includes(search.toLowerCase()) ||
            n.collectionName.toLowerCase().includes(search.toLowerCase()),
        )
      : enrichedNfts;
    if (showSpam) return base;
    return base.filter((n) => !nftIsSpam(n));
    // forceUpdate counter via component re-render; not threaded as a dep.
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
      result.push({ id, name, nfts: groupNfts, totalFloor, coverImage });
    }

    result.sort((a, b) => {
      if (a.id === '__uncategorized__') return 1;
      if (b.id === '__uncategorized__') return -1;
      return b.nfts.length - a.nfts.length;
    });

    return result;
  }, [filtered]);

  // Totals always exclude spam, regardless of the "Show spam" toggle.
  const nonSpamNfts = useMemo(
    () => enrichedNfts.filter((n) => !nftIsSpam(n)),
    [enrichedNfts],
  );
  const visibleCount = nonSpamNfts.length;
  const totalNftValue = useMemo(
    () => nonSpamNfts.reduce((sum, nft) => sum + (nft.floor?.floor || 0), 0),
    [nonSpamNfts],
  );
  const visibleCollectionCount = useMemo(() => {
    const ids = new Set<string>();
    for (const n of nonSpamNfts) {
      if (n.collectionId) ids.add(n.collectionId);
    }
    return ids.size;
  }, [nonSpamNfts]);

  const toggleCollapse = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (nfts.length === 0) return null;

  const hasCollections = collections.some((c) => c.id !== '__uncategorized__');

  return (
    <div className="bg-card border border-border rounded-lg p-5 card-glow">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Grid3x3 size={18} className="text-accent" />
          <h3 className="section-header text-sm font-semibold text-foreground uppercase tracking-wider">
            NFT Holdings
          </h3>
          <span className="text-xs text-muted-foreground">({visibleCount})</span>
          {visibleCollectionCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60 ml-1">
              {visibleCollectionCount} collection{visibleCollectionCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {totalNftValue > 0 && (
            <span className="text-xs font-bold text-foreground">{formatUsd(totalNftValue)}</span>
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

      {groupMode === 'collection' && hasCollections ? (
        <div className="space-y-3">
          {collections.map((group) => {
            const isCollapsed = !expanded.has(group.id);
            const spam = isNftCollectionSpam(group.id);
            return (
              <div
                key={group.id}
                className={`border border-border rounded-md overflow-hidden bg-secondary/20 ${spam ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-2 pr-2 hover:bg-secondary/40 transition-colors">
                  <button
                    className="flex items-center gap-3 p-3 text-left flex-1 min-w-0"
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
                      <p className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
                        {group.name}
                        {spam && (
                          <span className="text-[8px] uppercase tracking-wider text-muted-foreground border border-border rounded px-1 py-px">
                            spam
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {group.nfts.length} item{group.nfts.length !== 1 ? 's' : ''}
                        {group.totalFloor > 0 && (
                          <span className="text-muted-foreground ml-2 font-medium">{formatUsd(group.totalFloor)}</span>
                        )}
                      </p>
                    </div>
                    {isCollapsed
                      ? <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                      : <ChevronDown size={16} className="text-muted-foreground shrink-0" />
                    }
                  </button>
                  <SpamMenu
                    isSpam={spam}
                    onMark={() => markNftCollectionSpam(group.id)}
                    onUnmark={() => unmarkNftCollectionSpam(group.id)}
                  />
                </div>
                {!isCollapsed && (
                  <div className="px-3 pb-3">
                    {viewMode === 'grid'
                      ? <NftGrid nfts={group.nfts} formatUsd={formatUsd} />
                      : <NftList nfts={group.nfts} formatUsd={formatUsd} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {viewMode === 'grid'
            ? <NftGrid nfts={filtered} formatUsd={formatUsd} />
            : <NftList nfts={filtered} formatUsd={formatUsd} />}
        </>
      )}

      {filtered.length === 0 && search && (
        <p className="text-xs text-muted-foreground text-center py-6">
          No NFTs matching &quot;{search}&quot;
        </p>
      )}
    </div>
  );
}

interface NftSubProps {
  nfts: EnrichedNft[];
  formatUsd: (v: number) => string;
}

function NftGrid({ nfts, formatUsd }: NftSubProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {nfts.map((nft) => (
        <a
          key={nft.mint}
          href={`https://solscan.io/token/${nft.mint}`}
          target="_blank"
          rel="noopener noreferrer"
          className="group border border-border rounded-md overflow-hidden transition-colors bg-secondary/30 hover:border-primary/40"
        >
          <div className="aspect-square bg-background relative overflow-hidden">
            {nft.image ? (
              <>
                <img
                  src={nft.image}
                  alt={nft.name}
                  loading="lazy"
                  className="absolute inset-0 w-full h-full object-cover"
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

            {nft.floor && (
              <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-background/80 backdrop-blur-sm rounded text-[9px] font-bold text-foreground border border-border">
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

function NftList({ nfts, formatUsd }: NftSubProps) {
  return (
    <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
      {nfts.map((nft) => (
        <div
          key={nft.mint}
          className="flex items-center gap-3 p-2.5 rounded-md transition-colors hover:bg-secondary/50"
        >
          <div className="w-14 h-14 rounded-lg overflow-hidden bg-secondary shrink-0 flex items-center justify-center">
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
            <p className="text-xs font-semibold text-foreground truncate">{nft.name}</p>
            {nft.symbol && <p className="text-[10px] text-muted-foreground">{nft.symbol}</p>}
            <p className="text-[10px] font-mono text-muted-foreground">{abbr(nft.mint)}</p>
          </div>
          {nft.floor && (
            <div className="text-right">
              <p className="text-xs font-semibold text-foreground">{formatUsd(nft.floor.floor)}</p>
              <p className="text-[10px] text-muted-foreground">{nft.floor.source}</p>
            </div>
          )}
          <a href={`https://solscan.io/token/${nft.mint}`} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={11} className="text-muted-foreground hover:text-primary" />
          </a>
        </div>
      ))}
    </div>
  );
}
