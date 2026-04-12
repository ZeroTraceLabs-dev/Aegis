/**
 * Token Balance & List Service
 *
 * Utilities for fetching the Jupiter strict token list,
 * individual token data, Dexscreener lookups, and price data.
 * Uses dynamic imports for @solana/web3.js to avoid top-level crashes.
 */
import type {
  TokenData,
  DexScreenerResponse,
  JupiterPriceResponse,
} from '@/types/token';

/* ── Jupiter Strict Token List ────────────────────��───── */

let _tokenListCache: TokenData[] | null = null;
let _tokenListPromise: Promise<TokenData[]> | null = null;

/**
 * Fetch the full Jupiter verified (strict) token list.
 * Cached after first successful fetch.
 */
export async function fetchTokenList(): Promise<TokenData[]> {
  if (_tokenListCache) return _tokenListCache;
  if (_tokenListPromise) return _tokenListPromise;

  _tokenListPromise = (async () => {
    try {
      const resp = await fetch('https://token.jup.ag/strict', {
        signal: AbortSignal.timeout(15000),
      });
      if (!resp.ok) return [];
      const tokens: TokenData[] = await resp.json();
      _tokenListCache = tokens;
      console.log(`[TokenService] Loaded ${tokens.length} tokens from Jupiter strict list`);
      return tokens;
    } catch (err) {
      console.warn('[TokenService] Failed to fetch token list:', err);
      return [];
    } finally {
      _tokenListPromise = null;
    }
  })();

  return _tokenListPromise;
}

/**
 * Build a Map<mintAddress, TokenData> from the cached token list.
 * Triggers a fetch if the list hasn't been loaded yet.
 */
export async function getTokenListMap(): Promise<Map<string, TokenData>> {
  const list = await fetchTokenList();
  return new Map(list.map((t) => [t.address, t]));
}

/* ── Single Token Lookup ──────────────────���───────────── */

/**
 * Get token metadata by mint address from Jupiter /token/:mint endpoint.
 */
export async function getTokenDataByAddress(mint: string): Promise<TokenData | undefined> {
  if (!mint) return undefined;
  try {
    const resp = await fetch(`https://tokens.jup.ag/token/${mint}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) return undefined;
    return await resp.json();
  } catch {
    return undefined;
  }
}

/* ── Dexscreener Ticker → Address ─────────────────────── */

/**
 * Resolve a token ticker symbol to its Solana mint address via Dexscreener.
 */
export async function getTokenAddressFromTicker(ticker: string): Promise<string | null> {
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${ticker}`, {
      signal: AbortSignal.timeout(10000),
    });
    const data: DexScreenerResponse = await resp.json();
    if (!data.pairs || data.pairs.length === 0) return null;

    const solanaPairs = data.pairs
      .filter((p) => p.chainId === 'solana')
      .filter((p) => p.baseToken.symbol.toLowerCase() === ticker.toLowerCase())
      .sort((a, b) => (b.fdv || 0) - (a.fdv || 0));

    return solanaPairs[0]?.baseToken.address || null;
  } catch {
    return null;
  }
}

/* ── Balance Helpers (dynamic imports) ────────────────── */

/**
 * Get SOL balance for a wallet address.
 */
export async function getSolBalance(
  publicKeyStr: string,
  rpcEndpoint: string,
): Promise<number> {
  try {
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
    const conn = new Connection(rpcEndpoint, 'confirmed');
    const balance = await conn.getBalance(new PublicKey(publicKeyStr));
    return balance / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

/**
 * Get all parsed token accounts for a wallet.
 */
export async function getTokenAccounts(
  publicKeyStr: string,
  rpcEndpoint: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  try {
    const { Connection, PublicKey } = await import('@solana/web3.js');
    const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
    const conn = new Connection(rpcEndpoint, 'confirmed');
    const accounts = await conn.getParsedTokenAccountsByOwner(
      new PublicKey(publicKeyStr),
      { programId: TOKEN_PROGRAM_ID },
    );
    return accounts.value;
  } catch {
    return [];
  }
}

/* ── Jupiter Price API ─────��───────────────────────���──── */

/**
 * Fetch token prices from Jupiter fe-api for an array of mint addresses.
 */
export async function getTokenPrices(
  tokenAddresses: string[],
): Promise<JupiterPriceResponse> {
  if (tokenAddresses.length === 0) return { prices: {} };

  try {
    const ids = tokenAddresses.join(',');
    const resp = await fetch(
      `https://fe-api.jup.ag/api/v1/prices?list_address=${ids}`,
      { signal: AbortSignal.timeout(15000) },
    );
    if (!resp.ok) return { prices: {} };

    const json = await resp.json();
    // Handle both response shapes: { prices: {...} } and { data: {...} }
    const raw = json?.prices || json?.data || {};
    const prices: Record<string, number> = {};

    for (const [addr, val] of Object.entries(raw)) {
      if (typeof val === 'number') {
        prices[addr] = val;
      } else if (val && typeof val === 'object' && 'price' in (val as Record<string, unknown>)) {
        const p = (val as Record<string, unknown>).price;
        const num = typeof p === 'string' ? parseFloat(p) : Number(p);
        if (!isNaN(num) && num > 0) prices[addr] = num;
      }
    }

    return { prices };
  } catch {
    return { prices: {} };
  }
}
