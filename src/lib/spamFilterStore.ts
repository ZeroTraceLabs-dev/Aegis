/**
 * Spam Filter Store — per-wallet client-side spam list.
 *
 * Marks tokens and NFT collections that the user wants hidden from their
 * Wallet tab. Pure UI signal — does NOT touch the chain, does NOT sign or
 * burn anything, does NOT modify the user's actual on-chain holdings.
 *
 * Storage shape (localStorage):
 *   key   : `spam_list_{walletAddress}`
 *   value : { spamTokenMints: string[], spamNftCollections: string[] }
 *
 * One record per connected wallet. Different wallets keep independent lists.
 * Pattern mirrors whitelistStore / evacuationStore.
 */

const KEY_PREFIX = 'spam_list_';

interface SpamRecord {
  spamTokenMints: string[];
  spamNftCollections: string[];
}

let currentWallet: string | null = null;
let tokenMints: Set<string> = new Set();
let nftCollections: Set<string> = new Set();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

function persist() {
  if (!currentWallet) return;
  try {
    const record: SpamRecord = {
      spamTokenMints: [...tokenMints],
      spamNftCollections: [...nftCollections],
    };
    localStorage.setItem(KEY_PREFIX + currentWallet, JSON.stringify(record));
  } catch {
    /* swallow quota errors — spam list is low-stakes */
  }
}

function load(walletAddress: string) {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + walletAddress);
    if (!raw) {
      tokenMints = new Set();
      nftCollections = new Set();
      return;
    }
    const parsed = JSON.parse(raw) as Partial<SpamRecord>;
    tokenMints = new Set(Array.isArray(parsed.spamTokenMints) ? parsed.spamTokenMints : []);
    nftCollections = new Set(Array.isArray(parsed.spamNftCollections) ? parsed.spamNftCollections : []);
  } catch {
    tokenMints = new Set();
    nftCollections = new Set();
  }
}

export function initSpamFilterForWallet(walletAddress: string) {
  if (currentWallet === walletAddress) return;
  currentWallet = walletAddress;
  load(walletAddress);
  notify();
}

export function clearSpamFilter() {
  currentWallet = null;
  tokenMints = new Set();
  nftCollections = new Set();
  notify();
}

export function subscribeSpamFilter(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function isTokenSpam(mint: string): boolean {
  return tokenMints.has(mint);
}

export function isNftCollectionSpam(collectionId: string): boolean {
  return nftCollections.has(collectionId);
}

export function markTokenSpam(mint: string) {
  if (tokenMints.has(mint)) return;
  tokenMints.add(mint);
  persist();
  notify();
}

export function unmarkTokenSpam(mint: string) {
  if (!tokenMints.has(mint)) return;
  tokenMints.delete(mint);
  persist();
  notify();
}

export function markNftCollectionSpam(id: string) {
  if (nftCollections.has(id)) return;
  nftCollections.add(id);
  persist();
  notify();
}

export function unmarkNftCollectionSpam(id: string) {
  if (!nftCollections.has(id)) return;
  nftCollections.delete(id);
  persist();
  notify();
}
