/**
 * useTokenList — React hook for the Jupiter strict token list.
 * Fetches once, caches globally via tokenService.
 */
import { useState, useEffect } from 'react';
import { fetchTokenList } from '@/lib/tokenService';
import type { TokenData } from '@/types/token';

export function useTokenList() {
  const [tokenList, setTokenList] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const tokens = await fetchTokenList();
        if (alive) {
          setTokenList(tokens);
          setError(null);
        }
      } catch {
        if (alive) setError('Failed to load token list');
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, []);

  return { tokenList, loading, error };
}
