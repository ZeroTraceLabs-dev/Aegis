/**
 * CoinGecko Price & Market Data Service
 *
 * Singleton service for fetching real-time token prices, market data,
 * trending tokens, and cryptocurrency information via CoinGecko API.
 *
 * Supports free tier (demo key) and pro tier endpoints.
 */
import type {
  CoinGeckoTokenPriceData,
  CoinGeckoTokenInfo,
  CoinGeckoTrendingCoinsResponse,
  CoinGeckoCryptocurrencyToken,
  CoinGeckoNetworkId,
  CoinGeckoCategoryId,
  CoinGeckoDuration,
} from '@/types/token';

class CoinGeckoService {
  private readonly apiKey: string | undefined;
  private readonly proApiKey: string | undefined;
  private readonly baseUrl = 'https://api.coingecko.com/api/v3';
  private readonly proBaseUrl = 'https://pro-api.coingecko.com/api/v3';

  constructor() {
    this.apiKey = import.meta.env.VITE_COINGECKO_API_KEY;
    this.proApiKey = import.meta.env.VITE_COINGECKO_PRO_API_KEY;
  }

  /* ── Internal helpers ───────────────────────────────── */

  private _getApiUrl(endpoint: string, isProEndpoint = false): string {
    const baseUrl = isProEndpoint && this.proApiKey ? this.proBaseUrl : this.baseUrl;
    const apiKeyParam =
      isProEndpoint && this.proApiKey
        ? `x_cg_pro_api_key=${this.proApiKey}`
        : this.apiKey
          ? `x_cg_demo_api_key=${this.apiKey}`
          : '';

    const separator = endpoint.includes('?') ? '&' : '?';
    return apiKeyParam ? `${baseUrl}${endpoint}${separator}${apiKeyParam}` : `${baseUrl}${endpoint}`;
  }

  /* ── Token Price Data ───────────────────��───────────── */

  /**
   * Get token price data by contract addresses for any blockchain network.
   * Returns a map of address -> CoinGeckoTokenPriceData.
   */
  async getTokenPriceData(
    tokenAddresses: string | string[],
    network: CoinGeckoNetworkId = 'solana',
  ): Promise<Record<string, CoinGeckoTokenPriceData> | undefined> {
    try {
      const addressList = Array.isArray(tokenAddresses) ? tokenAddresses.join(',') : tokenAddresses;
      const endpoint = `/simple/token_price/${network}?contract_addresses=${addressList}&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true`;

      const url = this._getApiUrl(endpoint, false);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });

      if (!response.ok) {
        console.log(`[CoinGecko] HTTP error: ${response.status}`);
        return undefined;
      }

      return await response.json();
    } catch (error) {
      console.log(`[CoinGecko] getTokenPriceData error: ${(error as Error).message}`);
      return undefined;
    }
  }

  /* ── Token Info ─────────────────────────────────────── */

  /**
   * Get detailed token information. Falls back to basic price data if Pro API unavailable.
   */
  async getTokenInfo(
    tokenAddress: string,
    network: CoinGeckoNetworkId = 'solana',
  ): Promise<CoinGeckoTokenInfo | undefined> {
    try {
      if (this.proApiKey) {
        const endpoint = `/onchain/networks/${network}/tokens/${tokenAddress}/info`;
        const url = this._getApiUrl(endpoint, true);
        const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (response.ok) return await response.json();
      }

      // Fallback to basic price data
      const priceData = await this.getTokenPriceData([tokenAddress], network);
      return {
        address: tokenAddress,
        network,
        price_data: priceData?.[tokenAddress.toLowerCase()] || null,
      };
    } catch (error) {
      console.log(`[CoinGecko] getTokenInfo error: ${(error as Error).message}`);
      return undefined;
    }
  }

  /* ── Trending Coins ──��──────────────────────────────── */

  /**
   * Get trending coins across all platforms (free API).
   */
  async getTrendingCoins(): Promise<CoinGeckoTrendingCoinsResponse | undefined> {
    try {
      const url = this._getApiUrl('/search/trending', false);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.log(`[CoinGecko] getTrendingCoins error: ${(error as Error).message}`);
      return undefined;
    }
  }

  /* ── Top Gainers / Losers ───────���───────────────��───── */

  /**
   * Get top gainers. Uses Pro API if available, otherwise falls back to trending.
   */
  async getTopGainers(
    duration: CoinGeckoDuration = '24h',
    topCoins = 100,
  ): Promise<unknown> {
    try {
      if (!this.proApiKey) return await this.getTrendingCoins();

      const endpoint = `/coins/top_gainers_losers?vs_currency=usd&duration=${duration}&top_coins=${topCoins}`;
      const url = this._getApiUrl(endpoint, true);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.log(`[CoinGecko] getTopGainers error: ${(error as Error).message}`);
      return undefined;
    }
  }

  /* ── Cryptocurrency Market Data ────────────���────────── */

  /**
   * Get cryptocurrency market data by category.
   */
  async getCryptocurrencyByCategory(
    category: CoinGeckoCategoryId = 'solana-ecosystem',
    page = 1,
    perPage = 10,
  ): Promise<CoinGeckoCryptocurrencyToken[] | undefined> {
    try {
      const endpoint = `/coins/markets?vs_currency=usd&category=${category}&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=24h`;
      const url = this._getApiUrl(endpoint, false);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.log(`[CoinGecko] getCryptocurrencyByCategory error: ${(error as Error).message}`);
      return undefined;
    }
  }

  /**
   * Get all cryptocurrencies without a category filter, ordered by market cap.
   */
  async getAllCryptocurrencies(page = 1, perPage = 10): Promise<CoinGeckoCryptocurrencyToken[] | undefined> {
    try {
      const endpoint = `/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=${page}&sparkline=false&price_change_percentage=24h`;
      const url = this._getApiUrl(endpoint, false);
      const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return undefined;
      return await response.json();
    } catch (error) {
      console.log(`[CoinGecko] getAllCryptocurrencies error: ${(error as Error).message}`);
      return undefined;
    }
  }
}

/** Singleton instance */
export const coinGeckoService = new CoinGeckoService();
