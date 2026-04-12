/** Token data from Jupiter strict token list */
export interface TokenData {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI: string;
  tags: string[];
  daily_volume: number;
  created_at: string;
  freeze_authority: string | null;
  mint_authority: string | null;
  permanent_delegate: string | null;
  minted_at: string | null;
  extensions?: {
    coingeckoId?: string;
    [key: string]: unknown;
  };
}

/** Dexscreener token pair */
export interface TokenPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  quoteToken: { address: string; name: string; symbol: string };
  priceNative: string;
  priceUsd: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: { h24: number; h6: number; h1: number; m5: number };
  priceChange: { m5: number; h1: number; h6: number; h24: number };
  liquidity: { usd: number; base: number; quote: number };
  fdv: number;
  marketCap: number;
  pairCreatedAt?: number;
  labels?: string[];
  info?: {
    imageUrl?: string;
    header?: string;
    openGraph?: string;
    websites?: { label: string; url: string }[];
    socials?: { type: string; url: string }[];
  };
}

/** Dexscreener API response */
export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: TokenPair[];
}

/** Jupiter price API response */
export interface JupiterPriceResponse {
  prices: Record<string, number>;
}

/** User token balance with enriched metadata + price */
export interface UserTokenBalance {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;
  balanceInUsd: number;
  logoURI: string;
  price: number;
}

/* ── CoinGecko Types ──────────────────────────────────── */

export interface CoinGeckoTokenPriceData {
  usd: number;
  usd_market_cap: number;
  usd_24h_vol: number;
  usd_24h_change: number;
  last_updated_at: number;
}

export interface CoinGeckoTokenInfo {
  address: string;
  network?: string;
  price_data: CoinGeckoTokenPriceData | null;
}

export interface CoinGeckoTrendingTokenData {
  price: number;
  price_btc: number;
  price_change_percentage_24h: { usd: number };
  market_cap: number;
  market_cap_rank: number;
  volume: number;
  high_24h: number;
  low_24h: number;
}

export interface CoinGeckoTrendingTokenItem {
  id: string;
  coin_id: number;
  name: string;
  symbol: string;
  market_cap_rank: number;
  thumb: string;
  small: string;
  large: string;
  slug: string;
  price_btc: number;
  score: number;
  data: CoinGeckoTrendingTokenData;
}

export interface CoinGeckoTrendingCoinsResponse {
  coins: Array<{ item: CoinGeckoTrendingTokenItem }>;
  nfts: unknown[];
  categories: unknown[];
}

export interface CoinGeckoCryptocurrencyToken {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  total_volume: number;
  price_change_percentage_24h: number;
  circulating_supply: number;
  total_supply: number;
  ath: number;
  atl: number;
}

export type CoinGeckoNetworkId =
  | 'ethereum'
  | 'solana'
  | 'polygon-pos'
  | 'binance-smart-chain'
  | 'avalanche'
  | 'arbitrum-one'
  | 'optimistic-ethereum'
  | 'fantom'
  | 'cronos'
  | 'moonbeam';

export type CoinGeckoCategoryId =
  | 'solana-ecosystem'
  | 'ethereum-ecosystem'
  | 'polygon-ecosystem'
  | 'decentralized-finance-defi'
  | 'layer-1'
  | 'layer-2'
  | 'meme-token'
  | 'gaming'
  | 'non-fungible-tokens-nft';

export type CoinGeckoDuration = '24h' | '7d' | '30d';