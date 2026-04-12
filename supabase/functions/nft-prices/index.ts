import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const LAMPORTS_PER_SOL = 1_000_000_000;
const SOL_MINT = "So11111111111111111111111111111111111111112";
const ME_BASE = "https://api-mainnet.magiceden.dev/v2";

async function fetchSolPrice(): Promise<number> {
  // Try Jupiter first
  try {
    const resp = await fetch(
      `https://api.jup.ag/price/v2?ids=${SOL_MINT}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      const p = data?.data?.[SOL_MINT]?.price;
      if (p) {
        const num = typeof p === "string" ? parseFloat(p) : Number(p);
        if (num > 0) return num;
      }
    }
  } catch (e) {
    console.error("Jupiter SOL price fetch error:", e);
  }
  // Fallback to CoinGecko
  try {
    const cgKey = Deno.env.get("COINGECKO_API_KEY") || "";
    const suffix = cgKey ? `&x_cg_demo_api_key=${cgKey}` : "";
    const resp = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd${suffix}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      if (data?.solana?.usd > 0) return data.solana.usd;
    }
  } catch (e) {
    console.error("CoinGecko SOL price fetch error:", e);
  }
  return 0;
}

async function fetchMETokenInfo(
  mint: string
): Promise<{ collection?: string; listPrice?: number }> {
  try {
    const resp = await fetch(`${ME_BASE}/tokens/${mint}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        collection: data?.collection,
        listPrice: data?.listPrice,
      };
    }
  } catch {}
  return {};
}

async function fetchMECollectionFloor(
  collectionSymbol: string
): Promise<number> {
  try {
    const resp = await fetch(
      `${ME_BASE}/collections/${collectionSymbol}/stats`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (resp.ok) {
      const stats = await resp.json();
      return stats?.floorPrice || 0;
    }
  } catch {}
  return 0;
}

// Fallback: try to get floor from ME listing API (v2/collections/{symbol}/listings)
async function fetchMEListingFloor(
  collectionSymbol: string
): Promise<number> {
  try {
    const resp = await fetch(
      `${ME_BASE}/collections/${collectionSymbol}/listings?offset=0&limit=1`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (resp.ok) {
      const listings = await resp.json();
      if (Array.isArray(listings) && listings.length > 0 && listings[0]?.price > 0) {
        return listings[0].price * LAMPORTS_PER_SOL; // convert SOL to lamports to match floorPrice format
      }
    }
  } catch {}
  return 0;
}

// Try CoinGecko for NFT token prices as last resort
async function fetchCoinGeckoNftPrices(
  mints: string[]
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (mints.length === 0) return result;

  const cgKey = Deno.env.get("COINGECKO_API_KEY") || "";
  const suffix = cgKey ? `&x_cg_demo_api_key=${cgKey}` : "";
  
  // Batch in groups of 50
  const batchSize = 50;
  for (let i = 0; i < mints.length; i += batchSize) {
    const batch = mints.slice(i, i + batchSize);
    try {
      const ids = batch.join(",");
      const resp = await fetch(
        `https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${ids}&vs_currencies=usd${suffix}`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (resp.ok) {
        const data = await resp.json();
        for (const [addr, priceObj] of Object.entries(data)) {
          const usd = (priceObj as { usd?: number })?.usd;
          if (usd && usd > 0) {
            // CoinGecko lowercases addresses, match back
            const original = batch.find((m) => m.toLowerCase() === addr.toLowerCase()) || addr;
            result[original] = usd;
          }
        }
      }
    } catch (e) {
      console.error("CoinGecko NFT price batch error:", e);
    }
    if (i + batchSize < mints.length) {
      await delay(1200);
    }
  }
  return result;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { nftMints, collectionMap } = await req.json();

    if (!Array.isArray(nftMints) || nftMints.length === 0) {
      return new Response(
        JSON.stringify({ error: "nftMints must be a non-empty array" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const solPrice = await fetchSolPrice();
    console.log(`SOL price: $${solPrice.toFixed(2)}`);

    const collToMints: Record<string, string[]> = {};
    const orphans: string[] = [];

    for (const mint of nftMints) {
      const coll = collectionMap?.[mint];
      if (coll) {
        if (!collToMints[coll]) collToMints[coll] = [];
        collToMints[coll].push(mint);
      } else {
        orphans.push(mint);
      }
    }

    console.log(
      `Collections: ${Object.keys(collToMints).length}, orphans: ${orphans.length}`
    );

    const floors: Record<
      string,
      { floorSol: number; floorUsd: number; source: string }
    > = {};

    // Process collections
    for (const [_collAddr, mints] of Object.entries(collToMints)) {
      const sampleMint = mints[0];

      try {
        const tokenInfo = await fetchMETokenInfo(sampleMint);

        if (tokenInfo.collection) {
          // Try stats endpoint first
          let floorLamports = await fetchMECollectionFloor(tokenInfo.collection);

          // Fallback to listings endpoint if stats has no floor
          if (floorLamports <= 0) {
            floorLamports = await fetchMEListingFloor(tokenInfo.collection);
          }

          if (floorLamports > 0) {
            const floorSol = floorLamports / LAMPORTS_PER_SOL;
            const floorUsd = solPrice > 0 ? floorSol * solPrice : 0;

            console.log(
              `Collection ${tokenInfo.collection}: floor ${floorSol.toFixed(4)} SOL ($${floorUsd.toFixed(2)})`
            );

            for (const mint of mints) {
              floors[mint] = {
                floorSol,
                floorUsd,
                source: "Magic Eden",
              };
            }
          } else {
            console.log(`Collection ${tokenInfo.collection}: no floor data from stats or listings`);
            // Move to orphans for individual lookup
            orphans.push(...mints);
          }
        } else {
          console.log(`Mint ${sampleMint.slice(0, 8)}: not found on ME`);
          orphans.push(...mints);
        }
      } catch (e) {
        console.error(`Collection lookup error:`, e);
        orphans.push(...mints);
      }

      await delay(200);
    }

    // Process orphans individually via ME
    const orphanLimit = Math.min(orphans.length, 50); // increased from 30
    for (let i = 0; i < orphanLimit; i++) {
      const mint = orphans[i];
      if (floors[mint]) continue;

      try {
        const tokenInfo = await fetchMETokenInfo(mint);

        if (tokenInfo.collection) {
          let floorLamports = await fetchMECollectionFloor(tokenInfo.collection);
          if (floorLamports <= 0) {
            floorLamports = await fetchMEListingFloor(tokenInfo.collection);
          }
          if (floorLamports > 0) {
            const floorSol = floorLamports / LAMPORTS_PER_SOL;
            const floorUsd = solPrice > 0 ? floorSol * solPrice : 0;
            floors[mint] = { floorSol, floorUsd, source: "Magic Eden" };
            continue;
          }
        }

        // Fallback: use listing price
        if (
          tokenInfo.listPrice &&
          tokenInfo.listPrice > 0 &&
          solPrice > 0
        ) {
          floors[mint] = {
            floorSol: tokenInfo.listPrice,
            floorUsd: tokenInfo.listPrice * solPrice,
            source: "ME Listing",
          };
        }
      } catch {}

      await delay(200);
    }

    // CoinGecko fallback for any still-unpriced NFTs
    const stillUnpriced = nftMints.filter((m: string) => !floors[m]);
    if (stillUnpriced.length > 0) {
      console.log(`CoinGecko fallback for ${stillUnpriced.length} unpriced NFTs...`);
      const cgPrices = await fetchCoinGeckoNftPrices(stillUnpriced);
      for (const [mint, usd] of Object.entries(cgPrices)) {
        if (usd > 0 && solPrice > 0) {
          floors[mint] = {
            floorSol: usd / solPrice,
            floorUsd: usd,
            source: "CoinGecko",
          };
        }
      }
    }

    const pricedCount = Object.keys(floors).length;
    console.log(
      `Done: ${pricedCount}/${nftMints.length} NFTs priced, SOL=$${solPrice.toFixed(2)}`
    );

    return new Response(
      JSON.stringify({ solPrice, floors }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});