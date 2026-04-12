// supabase/functions/nft-prices/index.ts
// Supabase Edge Function -- server-side proxy for Magic Eden NFT floor prices (no CORS)

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

// ── Helpers ──

async function fetchSolPrice(): Promise<number> {
  try {
    const resp = await fetch(
      `https://api.jup.ag/price/v2?ids=${SOL_MINT}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (resp.ok) {
      const data = await resp.json();
      const p = data?.data?.[SOL_MINT]?.price;
      if (p) return typeof p === "string" ? parseFloat(p) : Number(p);
    }
  } catch (e) {
    console.error("SOL price fetch error:", e);
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
      return stats?.floorPrice || 0; // lamports
    }
  } catch {}
  return 0;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Main handler ──

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

    // Step 1: SOL price
    const solPrice = await fetchSolPrice();
    console.log(`SOL price: $${solPrice.toFixed(2)}`);

    // Step 2: Group NFTs by collection address
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

    // Step 3: For each collection, look up ME symbol via sample mint, then get floor
    for (const [_collAddr, mints] of Object.entries(collToMints)) {
      const sampleMint = mints[0];

      try {
        // Get ME collection symbol from a sample mint
        const tokenInfo = await fetchMETokenInfo(sampleMint);

        if (tokenInfo.collection) {
          // Get collection floor price
          const floorLamports = await fetchMECollectionFloor(
            tokenInfo.collection
          );

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
            console.log(
              `Collection ${tokenInfo.collection}: no floor data`
            );
          }
        } else {
          console.log(`Mint ${sampleMint.slice(0, 8)}: not found on ME`);
          // Move all mints in this collection to orphans for individual lookup
          orphans.push(...mints);
        }
      } catch (e) {
        console.error(`Collection lookup error:`, e);
        orphans.push(...mints);
      }

      await delay(250);
    }

    // Step 4: Orphan NFTs -- try individual ME token lookups
    const orphanLimit = Math.min(orphans.length, 30);
    for (let i = 0; i < orphanLimit; i++) {
      const mint = orphans[i];
      if (floors[mint]) continue; // already priced

      try {
        const tokenInfo = await fetchMETokenInfo(mint);

        // Try collection floor first
        if (tokenInfo.collection) {
          const floorLamports = await fetchMECollectionFloor(
            tokenInfo.collection
          );
          if (floorLamports > 0) {
            const floorSol = floorLamports / LAMPORTS_PER_SOL;
            const floorUsd = solPrice > 0 ? floorSol * solPrice : 0;
            floors[mint] = { floorSol, floorUsd, source: "Magic Eden" };
            continue;
          }
        }

        // Fallback: individual listing price
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

      await delay(250);
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
