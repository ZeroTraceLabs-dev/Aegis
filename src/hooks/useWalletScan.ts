/**
 * useWalletScan — scans connected wallet for SOL, SPL tokens, Token-2022, signatures.
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const CALL_GAP = 400;

const KNOWN: Record<string, { symbol: string; name: string }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether USD' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', name: 'Bonk' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH', name: 'Wrapped Ether' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'mSOL', name: 'Marinade Staked SOL' },
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: { symbol: 'bSOL', name: 'BlazeStake Staked SOL' },
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: { symbol: 'PYTH', name: 'Pyth Network' },
  WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk: { symbol: 'WEN', name: 'Wen' },
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: { symbol: 'JTO', name: 'Jito' },
  EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm: { symbol: 'WIF', name: 'dogwifhat' },
};

function resolveToken(mint: string) {
  return KNOWN[mint] ?? {
    symbol: `${mint.slice(0, 4)}..${mint.slice(-4)}`,
    name: `${mint.slice(0, 4)}..${mint.slice(-4)}`,
  };
}

/**
 * Discriminator for which SPL program owns this token account. Carried
 * through from the originating getParsedTokenAccountsByOwner call so
 * downstream consumers (notably the evac fire path) can pick the right
 * program ID when constructing transfer instructions. Mismatching this
 * causes the ATA program to reject the transfer with IncorrectProgramId.
 */
export type TokenProgramTag = 'spl' | 'token-2022';

/**
 * Discriminator for NFT-like assets. Drives transfer-path routing in
 * the fire engine:
 *
 *   'spl'     → SPL Token transferChecked (works for both Token Program
 *               and Token-2022; the tokenProgram tag picks which).
 *   'cnft'    → Metaplex Bubblegum transfer (Merkle-tree compressed).
 *   'core'    → Metaplex Core transferV1 (standalone asset accounts).
 *   'unknown' → format detection didn't classify; excluded from evac
 *               with a clear failure surfaced in setup before arm.
 *
 * Only meaningful when `isNft === true`. Fungible tokens leave it
 * undefined.
 */
export type NftFormat = 'spl' | 'cnft' | 'core' | 'unknown';

export interface TokenAccount {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  uiAmount: number;
  decimals: number;
  delegate?: string;
  delegatedAmount?: number;
  isNft: boolean;
  tokenProgram: TokenProgramTag;
  /** Required when isNft=true so the fire engine can pick the right
   *  transfer SDK. Undefined for fungible tokens. */
  nftFormat?: NftFormat;
}

export interface DelegateApproval {
  mint: string;
  mintSymbol: string;
  delegate: string;
  amount: number;
  decimals: number;
  isNft: boolean;
  tokenAccount: string;
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown | null;
  memo: string | null;
}

export interface WalletData {
  solBalance: number;
  tokenAccounts: TokenAccount[];
  delegateApprovals: DelegateApproval[];
  signatures: SignatureInfo[];
  loading: boolean;
  loadingPhase: string;
  error: string | null;
  failedTxCount: number;
  emptyAccounts: number;
  scanTimestamp: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useWalletData(): WalletData {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();

  const [solBalance, setSolBalance] = useState(0);
  const [tokenAccounts, setTokenAccounts] = useState<TokenAccount[]>([]);
  const [delegateApprovals, setDelegateApprovals] = useState<DelegateApproval[]>([]);
  const [signatures, setSignatures] = useState<SignatureInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failedTxCount, setFailedTxCount] = useState(0);
  const [emptyAccounts, setEmptyAccounts] = useState(0);
  const [scanTimestamp, setScanTimestamp] = useState<number | null>(null);

  const abortRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetState = useCallback(() => {
    setSolBalance(0);
    setTokenAccounts([]);
    setDelegateApprovals([]);
    setSignatures([]);
    setFailedTxCount(0);
    setEmptyAccounts(0);
    setError(null);
    setScanTimestamp(null);
    setLoadingPhase('');
  }, []);

  useEffect(() => {
    if (!connected || !publicKey) {
      abortRef.current = true;
      resetState();
      setLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      abortRef.current = false;
      setLoading(true);
      setError(null);

      const owner = publicKey;

      async function safeRpc<T>(fn: () => Promise<T>, fallback: T, label: string): Promise<T> {
        for (let attempt = 0; attempt < 3; attempt++) {
          if (abortRef.current) return fallback;
          try {
            return await fn();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[Scan] ${label} attempt ${attempt + 1}:`, msg);
            if (msg.includes('429') && attempt < 2) await sleep(4000 * Math.pow(2, attempt));
          }
        }
        return fallback;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      function parseAccounts(accounts: any[], tokenProgram: TokenProgramTag) {
        const tokens: TokenAccount[] = [];
        const delegates: DelegateApproval[] = [];
        let empty = 0;

        for (const acc of accounts) {
          const info = acc.account.data.parsed.info;
          const mint: string = info.mint;
          const decimals: number = info.tokenAmount.decimals;
          const amount = parseFloat(info.tokenAmount.amount);
          const uiAmount = info.tokenAmount.uiAmount ?? amount / Math.pow(10, decimals);
          const isNft = decimals === 0 && amount >= 1;
          const res = resolveToken(mint);

          if (amount === 0) empty++;

          tokens.push({
            mint, symbol: res.symbol, name: res.name,
            amount, uiAmount, decimals,
            delegate: info.delegate,
            delegatedAmount: info.delegatedAmount
              ? parseFloat(info.delegatedAmount.amount) / Math.pow(10, decimals)
              : undefined,
            isNft,
            tokenProgram,
            // Anything found via getParsedTokenAccountsByOwner lives in
            // an SPL token account by definition — that's 'spl' format,
            // regardless of whether it's Token Program or Token-2022.
            // cNFT and Core NFTs don't have token accounts and only
            // surface via the DAS path (see DashboardContent merge).
            nftFormat: isNft ? 'spl' : undefined,
          });

          if (info.delegate && info.delegatedAmount) {
            const da = parseFloat(info.delegatedAmount.amount) / Math.pow(10, decimals);
            if (da > 0) {
              delegates.push({ mint, mintSymbol: res.symbol, delegate: info.delegate, amount: da, decimals, isNft,tokenAccount: acc.pubkey.toString() });
            }
          }
        }
        return { tokens, delegates, empty };
      }

      try {
        // 1) SOL balance
        setLoadingPhase('Checking SOL balance...');
        const lamports = await safeRpc(() => connection.getBalance(owner), 0, 'getBalance');
        if (abortRef.current) return;
        setSolBalance(lamports / 1e9);
        await sleep(CALL_GAP);

        // 2) SPL tokens
        setLoadingPhase('Scanning SPL tokens...');
        const splRes = await safeRpc(
          () => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM }),
          { value: [] }, 'SPL',
        );
        if (abortRef.current) return;
        const spl = parseAccounts(splRes.value, 'spl');
        setTokenAccounts(spl.tokens);
        setDelegateApprovals(spl.delegates);
        setEmptyAccounts(spl.empty);
        await sleep(CALL_GAP);

        // 3) Token-2022
        setLoadingPhase('Scanning Token-2022...');
        const t22Res = await safeRpc(
          () => connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022 }),
          { value: [] }, 'Token-2022',
        );
        if (abortRef.current) return;
        const t22 = parseAccounts(t22Res.value, 'token-2022');
        setTokenAccounts((prev) => [...prev, ...t22.tokens]);
        setDelegateApprovals((prev) => [...prev, ...t22.delegates]);
        setEmptyAccounts((prev) => prev + t22.empty);
        await sleep(CALL_GAP);

        // 4) Recent signatures
        setLoadingPhase('Loading recent activity...');
        const sigs = await safeRpc(
          () => connection.getSignaturesForAddress(owner, { limit: 8 }),
          [], 'signatures',
        );
        if (abortRef.current) return;
        const sigData: SignatureInfo[] = sigs.map((s) => ({
          signature: s.signature, slot: s.slot,
          blockTime: s.blockTime ?? null, err: s.err ?? null, memo: s.memo ?? null,
        }));
        setSignatures(sigData);
        setFailedTxCount(sigData.filter((s) => s.err !== null).length);

        setScanTimestamp(Date.now());
        setLoadingPhase('Scan complete');
      } catch (err) {
        console.error('[Scan] Fatal:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!abortRef.current) setLoading(false);
      }
    }, 2000);

    return () => {
      abortRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [connected, publicKey, connection, resetState]);

  return { solBalance, tokenAccounts, delegateApprovals, signatures, loading, loadingPhase, error, failedTxCount, emptyAccounts, scanTimestamp };
}