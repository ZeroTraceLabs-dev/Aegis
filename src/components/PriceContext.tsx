import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  subscribe,
  getAllPrices,
  getSolPrice,
  getUsdValue,
  formatUsd,
  getNftFloor,
  hasPrice,
  ensureSolPrice,
  fetchJupiterPrices,
  fetchNftFloorPrices,
  injectPrices,
  injectNftFloor,
} from '@/lib/priceService';
import { getTokenPrices } from '@/lib/tokenService';
import { coinGeckoService } from '@/lib/coinGeckoService';

interface PriceContextValue {
  prices: Map<string, number>;
  solPrice: number;
  loading: boolean;
  getUsdValue: typeof getUsdValue;
  formatUsd: typeof formatUsd;
  getNftFloor: typeof getNftFloor;
  getSolPrice: typeof getSolPrice;
}

const PriceContext = createContext<PriceContextValue>({
  prices: new Map(),
  solPrice: 0,
  loading: false,
  getUsdValue,
  formatUsd,
  getNftFloor,
  getSolPrice,
});

export function usePrices() {
  return useContext(PriceContext);
}

interface PriceProviderProps {
  children: React.ReactNode;
  allMints: string[];
  nftMints: string[];
}

export function PriceProvider({ children, allMints, nftMints }: PriceProviderProps) {
  const [rev, setRev] = useState(0);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pipelineRanRef = useRef(false);

  // Subscribe to priceService notifications (whenever notify() fires)
  useEffect(() => {
    const unsub = subscribe(() => {
      setRev((prev) => prev + 1);
    });
    return unsub;
  }, []);

  // Stable keys for deps
  const allMintsKey = useMemo(() => allMints.join(','), [allMints]);
  const nftMintsKey = useMemo(() => nftMints.join(','), [nftMints]);

  // Sequential price pipeline: SOL -> Jupiter -> tokenService -> CoinGecko -> NFT floors -> CoinGecko NFT fallback
  useEffect(() => {
    if (!allMintsKey || allMints.length <= 1) {
      pipelineRanRef.current = false;
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const fungibleMints = allMints.filter((m) => m !== 'native');

        // ── Phase 1: SOL + Jupiter in parallel (fastest bulk source) ──
        console.log(`[PriceContext] Phase 1: SOL + Jupiter for ${fungibleMints.length} mints`);
        await Promise.all([
          ensureSolPrice(),
          fetchJupiterPrices(fungibleMints),
        ]);

        // Quick SOL retry if it still failed
        if (getSolPrice() <= 0) {
          await ensureSolPrice();
        }

        // ── Phase 2: Backfills + NFT floors run in PARALLEL ──
        // These are independent -- no reason to wait for one before starting the other
        const backfillPromise = (async () => {
          // 2a: tokenService backfill
          const afterJupiter = fungibleMints.filter((m) => !hasPrice(m));
          if (afterJupiter.length > 0) {
            console.log(`[PriceContext] Phase 2a: tokenService backfill ${afterJupiter.length} mints`);
            try {
              const extra = await getTokenPrices(afterJupiter);
              if (extra.prices) {
                const injected = injectPrices(extra.prices);
                if (injected > 0) console.log(`[PriceContext] tokenService resolved ${injected} prices`);
              }
            } catch (err) {
              console.warn('[PriceContext] tokenService backfill error:', err);
            }
          }

          // 2b: CoinGecko fallback for still-unpriced
          const afterTokenService = fungibleMints.filter((m) => !hasPrice(m));
          if (afterTokenService.length > 0) {
            console.log(`[PriceContext] Phase 2b: CoinGecko fallback for ${afterTokenService.length} mints`);
            try {
              const batchSize = 80;
              for (let i = 0; i < afterTokenService.length; i += batchSize) {
                const batch = afterTokenService.slice(i, i + batchSize);
                const cgData = await coinGeckoService.getTokenPriceData(batch, 'solana');
                if (cgData) {
                  const pricesToInject: Record<string, number> = {};
                  for (const [addr, priceData] of Object.entries(cgData)) {
                    if (priceData?.usd && priceData.usd > 0) {
                      const original = batch.find((m) => m.toLowerCase() === addr.toLowerCase()) || addr;
                      pricesToInject[original] = priceData.usd;
                    }
                  }
                  const filled = injectPrices(pricesToInject);
                  if (filled > 0) console.log(`[PriceContext] CoinGecko resolved ${filled} prices`);
                }
                if (i + batchSize < afterTokenService.length) {
                  await new Promise((r) => setTimeout(r, 1500));
                }
              }
            } catch (err) {
              console.warn('[PriceContext] CoinGecko fallback error:', err);
            }
          }
        })();

        const nftPromise = (async () => {
          if (nftMints.length === 0) return;

          // 3a: NFT floors via edge function
          console.log(`[PriceContext] Phase 3a: NFT floor prices for ${nftMints.length} NFTs`);
          await fetchNftFloorPrices(nftMints);

          // 3b: CoinGecko NFT floor fallback
          const unpricedNfts = nftMints.filter((m) => !hasPrice(m));
          if (unpricedNfts.length > 0) {
            console.log(`[PriceContext] Phase 3b: CoinGecko NFT fallback for ${unpricedNfts.length} NFTs`);
            try {
              const batchSize = 50;
              for (let i = 0; i < unpricedNfts.length; i += batchSize) {
                const batch = unpricedNfts.slice(i, i + batchSize);
                const cgData = await coinGeckoService.getTokenPriceData(batch, 'solana');
                if (cgData) {
                  for (const [addr, priceData] of Object.entries(cgData)) {
                    if (priceData?.usd && priceData.usd > 0) {
                      const original = batch.find((m) => m.toLowerCase() === addr.toLowerCase()) || addr;
                      injectNftFloor(original, priceData.usd, 'CoinGecko');
                    }
                  }
                }
                if (i + batchSize < unpricedNfts.length) {
                  await new Promise((r) => setTimeout(r, 1500));
                }
              }
            } catch (err) {
              console.warn('[PriceContext] CoinGecko NFT fallback error:', err);
            }
          }
        })();

        // Wait for both tracks to finish
        await Promise.all([backfillPromise, nftPromise]);

        // Final summary
        const finalPriced = allMints.filter((m) => hasPrice(m)).length;
        const nftPriced = nftMints.filter((m) => hasPrice(m)).length;
        console.log(`[PriceContext] Pipeline complete: ${finalPriced}/${allMints.length} fungible, ${nftPriced}/${nftMints.length} NFTs priced`);

        pipelineRanRef.current = true;
      } catch (err) {
        console.warn('[PriceContext] Pipeline error:', err);
      } finally {
        setLoading(false);
      }
    }, 100);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMintsKey, nftMintsKey]);

  const value = useMemo<PriceContextValue>(() => ({
    prices: getAllPrices(),
    solPrice: getSolPrice(),
    loading,
    getUsdValue,
    formatUsd,
    getNftFloor,
    getSolPrice,
  }), [rev, loading]);

  return (
    <PriceContext.Provider value={value}>
      {children}
    </PriceContext.Provider>
  );
}