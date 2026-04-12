# ZeroTraceLabs -- Complete Rebuild Specification
## Wallet Health & Security Dashboard for Solana

---

## TABLE OF CONTENTS
1. [Architecture Overview](#architecture-overview)
2. [Design System](#design-system)
3. [Data Flow Pipeline](#data-flow-pipeline)
4. [File-by-File Specifications](#file-by-file-specifications)
5. [Known Bugs & Required Fixes](#known-bugs--required-fixes)
6. [Environment & Config](#environment--config)

---

## 1. ARCHITECTURE OVERVIEW

### Stack
- React 18 + TypeScript + Vite
- Solana wallet-adapter (WalletMultiButton)
- Helius RPC (mainnet) + DAS API for metadata
- Jupiter Price API v2 (fungible token prices, SOL price)
- Supabase Edge Function -> Magic Eden API v2 (NFT floor prices, server-side proxy)
- Tailwind CSS + shadcn/ui components
- Framer Motion for animations

### Component Tree
```
App.tsx
└── ConnectionProvider (Helius RPC endpoint)
    └── WalletProvider
        └── WalletModalProvider
            └── Routes
                └── Index.tsx
                    └── PriceProvider (PriceContext.tsx)
                        ├── Navbar (logo, wallet button)
                        ├── HealthScore
                        ├── StatsBar
                        ├── PermissionScanner
                        ├── RiskEvaluation
                        ├── PortfolioBreakdown
                        ├── NftHoldings
                        ├── ActivityFeed
                        └── Footer
```

### Key Hooks
- `useWalletData` -- fetches on-chain data via raw Connection methods
- `useTokenMetadata` -- Helius DAS getAssetsByOwner for names/symbols/images
- `PriceContext` -- React Context that orchestrates the 3-stage price pipeline

### Key Services
- `priceService.ts` -- global price cache with pub/sub (EXACT SOURCE SAVED)
- `rpc.ts` -- RPC endpoint constant export

---

## 2. DESIGN SYSTEM

### Theme: Clinical Cyberpunk
- Deep black base backgrounds
- Neon cyan primary (#00FFD1 / hsl(165, 100%, 50%) area)
- Magenta/pink accent for danger states
- JetBrains Mono or similar monospace font throughout
- Scanline overlay effects (subtle CSS repeating-linear-gradient)
- Grid background patterns
- Neon glow box-shadows on cards
- Dark card surfaces with subtle borders

### index.css Tokens (to recreate)
```css
:root {
  /* Base */
  --background: 220 15% 4%;        /* near-black */
  --foreground: 165 10% 90%;       /* light gray-green */

  /* Cards */
  --card: 220 15% 7%;              /* dark surface */
  --card-foreground: 165 10% 90%;

  /* Primary = Neon Cyan */
  --primary: 165 100% 50%;
  --primary-foreground: 220 15% 4%;

  /* Secondary */
  --secondary: 220 15% 12%;
  --secondary-foreground: 165 10% 80%;

  /* Accent = Magenta/Pink for alerts */
  --accent: 330 100% 60%;
  --accent-foreground: 0 0% 100%;

  /* Destructive = Red for critical risks */
  --destructive: 0 80% 55%;
  --destructive-foreground: 0 0% 100%;

  /* Muted */
  --muted: 220 10% 15%;
  --muted-foreground: 220 10% 55%;

  /* Border */
  --border: 165 20% 15%;

  /* Ring */
  --ring: 165 100% 50%;

  /* Custom tokens */
  --gradient-primary: linear-gradient(135deg, hsl(165 100% 50%), hsl(165 80% 35%));
  --gradient-danger: linear-gradient(135deg, hsl(0 80% 55%), hsl(330 100% 60%));
  --shadow-neon: 0 0 20px hsl(165 100% 50% / 0.3);
  --shadow-danger: 0 0 20px hsl(0 80% 55% / 0.3);
  --transition-smooth: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

  /* Scanline overlay */
  --scanline: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    hsl(165 100% 50% / 0.03) 2px,
    hsl(165 100% 50% / 0.03) 4px
  );
}
```

### tailwind.config.ts Extensions
- Map all CSS variables to Tailwind tokens
- Add `fontFamily: { mono: ['JetBrains Mono', 'Fira Code', 'monospace'] }`
- Add custom animations: `glow-pulse`, `scan-line`, `fade-in-up`
- Add `backgroundImage` for grid pattern and scanlines

### WalletMultiButton Custom Styling
- Override default styles to match cyberpunk theme
- Neon cyan border, dark background, cyan text
- Hover: intensified glow
- Connected state: show abbreviated address with cyan accent

---

## 3. DATA FLOW PIPELINE

### Stage 1: Wallet Connect
```
User connects wallet
  -> useWalletData fires (debounced 2s)
  -> Sequential RPC calls with 400ms gaps:
     1. getBalance (SOL)
     2. getParsedTokenAccountsByOwner (TOKEN_PROGRAM_ID)
     3. getParsedTokenAccountsByOwner (TOKEN_2022_PROGRAM_ID)
     4. getSignaturesForAddress (last 8 signatures)
  -> Returns: { solBalance, tokenAccounts[], delegateApprovals[], signatures[], loadingPhase }
```

### Stage 2: Metadata Resolution (parallel with Stage 1 completion)
```
useTokenMetadata fires when tokenAccounts available
  -> Helius DAS POST: getAssetsByOwner
     - displayOptions: { showFungible: true, showNativeBalance: false, showCollectionMetadata: true }
  -> For each asset returned:
     - Store name, symbol, image in metadata Map
     - Call injectDasPrices() for fungible tokens with price_per_token
     - Call extractNftCollections() for NFTs with grouping data
  -> Fallback for unresolved mints:
     - Jupiter per-token API: GET https://api.jup.ag/tokens/v1/{mint}
     - Returns symbol, name, logoURI
```

### Stage 3: Price Pipeline (sequential, orchestrated by PriceContext)
```
PriceContext effect fires when mints stabilize (600ms debounce)
  -> Step 1: ensureSolPrice() -- Jupiter, guaranteed
  -> Step 2: fetchJupiterPrices(allFungibleMints) -- batched 100 at a time
  -> Step 3: fetchNftFloorPrices(nftMints) -- Supabase edge function -> Magic Eden
  -> Each step calls notify() which increments revision
  -> All consumers re-render via usePrices() context hook
```

### Edge Function Pipeline (server-side, no CORS)
```
POST /functions/v1/nft-prices
  Body: { nftMints: string[], collectionMap: Record<string, string> }
  -> Fetch SOL price from Jupiter
  -> Group NFTs by collection (from collectionMap)
  -> For each collection:
     - GET ME /v2/tokens/{sampleMint} -> get collection symbol
     - GET ME /v2/collections/{symbol}/stats -> get floorPrice (lamports)
     - Convert to SOL and USD
  -> For orphan NFTs (no collection mapping):
     - Individual ME token lookups (capped at 30)
     - Try collection floor, fallback to listing price
  -> Return: { solPrice, floors: Record<mint, { floorSol, floorUsd, source }> }
```

---

## 4. FILE-BY-FILE SPECIFICATIONS

### src/lib/rpc.ts
```typescript
// Helius RPC endpoint -- used by both wallet adapter and custom fetches
export const RPC_ENDPOINT = 'https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY';
```

### src/lib/priceService.ts
**EXACT SOURCE SAVED** in REBUILD_CONTEXT_priceService.ts

Key exports:
- `subscribe(fn)` / `getRevision()` -- pub/sub for React integration
- `getPrice(mint)`, `getSolPrice()`, `getUsdValue(mint, amount)`, `getNftFloor(mint)`
- `formatUsd(value)` -- formatted string with K/M suffixes
- `getCollectionMap()` -- returns mint->collection mapping for edge function
- `injectDasPrices(assets)` -- called from useTokenMetadata
- `extractNftCollections(assets)` -- called from useTokenMetadata
- `ensureSolPrice()` -- independent Jupiter fetch for SOL
- `fetchJupiterPrices(mints)` -- batched Jupiter price fetch
- `fetchNftFloorPrices(nftMints)` -- calls Supabase edge function

### src/hooks/useWalletData.ts

**Interface: WalletData**
```typescript
interface TokenAccount {
  mint: string;
  symbol: string;       // from resolveToken() or truncated mint
  name: string;         // from resolveToken() or truncated mint
  amount: number;       // raw amount
  uiAmount: number;     // human-readable (amount / 10^decimals)
  decimals: number;
  delegate?: string;    // delegate authority pubkey if present
  delegatedAmount?: number; // UI-adjusted delegated amount
  isNft: boolean;       // decimals === 0 && amount === 1
  logo?: string;
}

interface DelegateApproval {
  mint: string;
  mintSymbol: string;
  delegate: string;
  amount: number;       // UI-adjusted
  decimals: number;
  isNft: boolean;
}

interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: any | null;
  memo: string | null;
}

interface WalletData {
  solBalance: number;           // in SOL (not lamports)
  tokenAccounts: TokenAccount[];
  delegateApprovals: DelegateApproval[];
  signatures: SignatureInfo[];
  loading: boolean;
  loadingPhase: string;         // "Checking SOL balance..." etc
  error: string | null;
  failedTxCount: number;        // count of signatures where err !== null
  emptyAccounts: number;        // token accounts with amount === 0
  scanTimestamp: number | null;  // Date.now() when scan completed
}
```

**Implementation Notes:**
- Uses `useConnection()` from wallet adapter to get Connection object
- Connection configured with `disableRetryOnRateLimit: true` (important)
- All RPC calls sequential with 400ms gaps (CALL_GAP_MS = 400)
- `safeRpc(fn)` wrapper with exponential backoff retry (3 attempts, 4s/8s/16s)
- 2-second debounce on wallet connect to prevent rapid re-fires
- Abort flag: if wallet disconnects mid-scan, all pending calls abort
- `resolveToken(mint)` has ~15 hardcoded known tokens (SOL, USDC, USDT, BONK, JUP, etc.)
- Everything else gets truncated mint as symbol/name (e.g., "EPjF..Dt1v")
- `parseTokenAccounts(response)` extracts:
  - mint, decimals, amount, uiAmount
  - delegate + delegatedAmount if present
  - isNft flag (decimals === 0)
- Progressive loading phases shown to user:
  - "Checking SOL balance..."
  - "Scanning SPL tokens..."
  - "Scanning Token-2022..."
  - "Loading recent activity..."
  - "Scan complete"

### src/hooks/useTokenMetadata.ts

**Interface:**
```typescript
interface TokenMeta {
  symbol: string;
  name: string;
  image?: string;
  decimals?: number;
}

// Returns: Map<mint, TokenMeta>
```

**Implementation Notes:**
- Called with array of mint addresses from wallet data
- Uses Helius RPC endpoint (same as wallet adapter)

**Tier 1: Helius DAS (primary)**
- POST to Helius RPC with method: "getAssetsByOwner"
- Params: { ownerAddress, displayOptions: { showFungible: true, showNativeBalance: false, showCollectionMetadata: true } }
- Paginated (page: 1, limit: 1000)
- For each asset:
  - Extract: id (mint), content.metadata.name, content.metadata.symbol, content.links.image
  - If token_info.price_info.price_per_token exists: call `injectDasPrices()`
  - If interface is V1_NFT/ProgrammableNFT/V2_NFT or decimals===0: call `extractNftCollections()`
- Global shared Promise prevents duplicate fetches across component instances

**Tier 2: Jupiter per-token API (fallback for unresolved fungible tokens)**
- For each mint not resolved by DAS:
  - GET `https://api.jup.ag/tokens/v1/{mint}`
  - Returns: { symbol, name, logoURI }
- Sequential (one at a time), 500ms gap between requests
- 429 retry with 2-attempt backoff
- Updates metadata map incrementally (UI updates as each resolves)

**Tier 3: Metaplex on-chain PDA (fallback for NFTs)**
- Derive metadata PDA: seeds = ['metadata', METADATA_PROGRAM_ID, mintPubkey]
  - METADATA_PROGRAM_ID = 'metaqbxxUoLD...8PGYkELHCN'
  - Use `new TextEncoder().encode('metadata')` NOT Buffer.from (browser-safe)
  - Use `.toBytes()` NOT `.toBuffer()` (browser-safe)
- Batch getMultipleAccountsInfo (20 per batch, 3s gaps)
- Parse Borsh-serialized metadata: name (32 bytes), symbol (10 bytes), uri (200 bytes)
  - Trim null bytes from strings
- Fetch metadata JSON from URI to get image
- Sequential image fetches with 200ms delays (IPFS/Arweave can be slow)

**CRITICAL: No Buffer.from usage anywhere -- use TextEncoder for browser safety**

### src/components/PriceContext.tsx

**Interface:**
```typescript
interface PriceContextValue {
  prices: Map<string, number>;   // snapshot of priceCache for dependency tracking
  solPrice: number;
  loading: boolean;
  getUsdValue: typeof priceService.getUsdValue;
  formatUsd: typeof priceService.formatUsd;
  getNftFloor: typeof priceService.getNftFloor;
  getSolPrice: typeof priceService.getSolPrice;
}
```

**Implementation Notes:**
- Wraps children in `PriceContext.Provider`
- Subscribes to priceService via `subscribe()` -- increments local `rev` state on each notify
- Receives props: `allMints: string[]`, `nftMints: string[]`
- 600ms debounce before triggering price pipeline
- Pipeline runs sequentially:
  1. `ensureSolPrice()` -- await
  2. `fetchJupiterPrices(allMints)` -- await
  3. `fetchNftFloorPrices(nftMints)` -- await (only if nftMints.length > 0)
- If SOL price still 0 after step 1, retry once after 3s
- Context value memoized on `rev` and `loading`
- `getUsdValue`, `formatUsd`, `getNftFloor`, `getSolPrice` are passed through directly from priceService module (stable function refs)
- `prices` is `new Map(priceCache)` -- creates new ref on each rev for dependency tracking

**CRITICAL: `prices` map must be in useMemo deps of all consumer components that compute USD values**

### src/components/HealthScore.tsx

**Props:** Uses `useWalletData()` and `usePrices()` internally

**Display:**
- Large circular animated gauge showing score 0-100
- Score calculated from:
  - Diversification (number of different tokens)
  - Activity (recent transactions, not all failed)
  - Security (fewer delegates = better, no critical risks)
  - Portfolio value factor
- Sub-scores shown as smaller bars below main gauge
- Side stats: PORTFOLIO value (USD), AT RISK value (USD), FAILED_TX count
- Risk banner at top:
  - Red if delegates found or high failed tx count, shows USD at risk
  - Green if clean

**Key computations (must have `prices` in useMemo deps):**
```typescript
const totalPortfolioUsd = useMemo(() => {
  let total = getUsdValue('native', wallet.solBalance) || 0;
  for (const t of wallet.tokenAccounts) {
    const v = getUsdValue(t.mint, t.uiAmount);
    if (v) total += v;
    // Also check NFT floor
    const floor = getNftFloor(t.mint);
    if (floor && t.isNft) total += floor.floor;
  }
  return total;
}, [wallet, getUsdValue, getNftFloor, prices]); // <-- prices is CRITICAL dep

const totalAtRisk = useMemo(() => {
  let risk = 0;
  for (const a of wallet.delegateApprovals) {
    const v = getUsdValue(a.mint, a.amount);
    if (v) risk += v;
    else {
      const floor = getNftFloor(a.mint);
      if (floor) risk += floor.floor;
    }
  }
  return risk;
}, [wallet.delegateApprovals, getUsdValue, getNftFloor, prices]); // <-- prices CRITICAL
```

### src/components/PermissionScanner.tsx

**Props:** Uses `useWalletData()`, `usePrices()`, `useTokenMetadata()` internally

**Display:**
- Header with scan animation (pulsing rings)
- Summary bar: TOTAL APPROVALS count, VALUE AT RISK: $X
- Each approval is an expandable card showing:
  - **Collapsed:** Token icon (from metadata) | SYMBOL (large bold) | full name | NFT badge | mint CA (abbreviated) | balance + USD | delegation details
  - **Expanded:** Larger identity card with token image, name, balance, AT RISK $X in red, delegate address (full), program ID, explorer links
  - Risk level badge: CRITICAL (red), HIGH (orange), MED (yellow), LOW (green)
  - Inline REVOKE button per approval
- "REVOKE ALL" button at top if multiple approvals

**Revoke Transaction:**
- Creates `createRevokeInstruction` from `@solana/spl-token`
- Sends via wallet adapter's `sendTransaction`
- Shows confirmation feedback

**Value at risk computed inline (no useMemo) but must destructure `prices` from context:**
```typescript
const { getUsdValue, formatUsd, getNftFloor, prices } = usePrices();
void prices; // force re-render dependency

const totalAtRisk = wallet.delegateApprovals.reduce((sum, a) => {
  const v = getUsdValue(a.mint, a.amount);
  if (v) return sum + v;
  const floor = getNftFloor(a.mint);
  if (floor) return sum + floor.floor;
  return sum;
}, 0);
```

### src/components/RiskEvaluation.tsx

**Props:** Uses `useWalletData()`, `usePrices()`, `useTokenMetadata()` internally

**Display:**
- Tabbed into 3 views: BY ASSET | BY PERMISSION | BY TRANSACTION
- Each tab shows categorized risk checklist items

**BY ASSET tab:**
- Per-token risk analysis
- Each asset row shows: icon | SYMBOL | name | mint CA | balance | USD value
- Checkable risk factors per asset:
  - Delegate status (auto-detected from chain)
  - Dust detection (very small amounts of unknown tokens)
  - Token-2022 flags (freeze authority, permanent delegate)
  - Known drainer CA match

**BY PERMISSION tab:**
- Per-delegate breakdown
- Shows full delegate addresses
- Which tokens each delegate controls
- USD value at risk per delegate
- Risk categories:
  - Unlimited approvals
  - Active delegates (auto-detected)
  - Freeze/mint authority
  - Unverified programs

**BY TRANSACTION tab:**
- Per-transaction risk analysis
- Failed tx flagging
- SetAuthority detection
- Rapid sequential approvals
- Disguised approval patterns

**Risk factors (25 total across 4 categories when expanded):**
1. Project Red Flags: disposable domains, cheap TLDs, anon teams, unrealistic APY, no audit
2. Permission & Approval Risks: unlimited approvals, active delegates, freeze/mint authority, unverified programs
3. Transaction Patterns: dust airdrops, known drainer CAs, disguised approvals, rapid sequential approvals, SetAuthority detection
4. Contract & Code Risks: known drainer addresses, closed-source, fresh deploys, proxy patterns, hidden transfers

**Auto-detection:** Real on-chain issues flagged automatically (open delegates, repeated failed txns)

### src/components/PortfolioBreakdown.tsx

**Props:** Uses `useWalletData()`, `usePrices()`, `useTokenMetadata()` internally

**Display:**
- Header with total portfolio value in USD
- Color-coded allocation bar (proportional segments per asset)
- Fungible tokens section:
  - Each row: icon | SYMBOL | name | mint CA | amount | USD value
  - Sorted by USD value descending
  - Delegated amounts shown with their USD value
- NFT section (separate):
  - Each NFT: image | name | floor price from getNftFloor()
  - Total NFT value in section header
- SOL balance as first asset (mint: 'native')

**Key computation (inline, no useMemo, but prices destructured):**
```typescript
const { getUsdValue, formatUsd, getNftFloor, prices } = usePrices();

const allAssets = [
  { mint: 'native', symbol: 'SOL', name: 'Solana', uiAmount: wallet.solBalance, ... },
  ...wallet.tokenAccounts.filter(t => !t.isNft)
];

const assetsWithUsd = allAssets.map(a => ({
  ...a,
  usd: getUsdValue(a.mint, a.uiAmount),
})).sort((a, b) => (b.usd || 0) - (a.usd || 0));

const nftTotalUsd = wallet.tokenAccounts
  .filter(t => t.isNft)
  .reduce((sum, t) => {
    const floor = getNftFloor(t.mint);
    return sum + (floor?.floor || 0);
  }, 0);

const totalUsd = assetsWithUsd.reduce((s, a) => s + (a.usd || 0), 0) + nftTotalUsd;
```

### src/components/NftHoldings.tsx

**Props:** Uses `useWalletData()`, `usePrices()`, `useTokenMetadata()` internally

**Display:**
- Grid/list toggle view
- Each NFT card:
  - Artwork image (from useTokenMetadata DAS data)
  - Name (from metadata, fallback: "NFT xxxx...yyyy")
  - Collection name if available
  - Floor price with source label (Magic Eden / Tensor)
  - Rarity badge if available
- Total NFT portfolio value in header

**Key computation:**
```typescript
const totalNftValue = useMemo(() => {
  return nfts.reduce((sum, nft) => {
    const floor = getNftFloor(nft.mint);
    return sum + (floor?.floor || 0);
  }, 0);
}, [nfts, getNftFloor, prices]); // <-- prices CRITICAL dep
```

### src/components/ActivityFeed.tsx

**Display:**
- List of recent transactions (from wallet.signatures)
- Each row: timestamp | status (success/failed) | signature (abbreviated, links to explorer)
- Failed transactions highlighted in red/magenta
- Memo shown if present
- "View on Explorer" links to solscan.io or explorer.solana.com

**Note:** Lightweight data only -- no full tx parsing (that was removed to avoid 429s)

### src/components/StatsBar.tsx

**Display:**
- Horizontal bar of 4 stats:
  - SOL Balance (raw number)
  - Token Count
  - NFT Count
  - Recent Transactions count
- Simple, clean, monospace numbers

### src/components/WalletActions.tsx

**Display:**
- "Revoke All" button -- batch revoke all detected delegates
- "Close Empty Accounts" button -- close zero-balance token accounts to reclaim rent
  - Batches up to 10 CloseAccount instructions per tx
  - Shows SOL reclaimed

**Implementation:**
- Uses `createRevokeInstruction` and `createCloseAccountInstruction` from `@solana/spl-token`
- Uses wallet adapter's `sendTransaction` + `confirmTransaction`
- Shows progress/confirmation feedback

### src/components/TokenIcon.tsx

**Shared component used by PermissionScanner, RiskEvaluation, PortfolioBreakdown, NftHoldings**

**Props:**
```typescript
interface TokenIconProps {
  src?: string;
  symbol: string;
  size?: number;  // px, default 32
  className?: string;
}
```

**Display:**
- If `src` provided and loads successfully: show image (rounded)
- If image fails to load: colored letter badge (first letter of symbol)
- Loading state: shimmer placeholder
- NFT placeholder icon when no image resolves

### src/pages/Index.tsx

**Layout (top to bottom):**
1. Navbar -- ZeroTraceLabs logo (split neon text: "ZeroTrace" cyan + "Labs" magenta), WalletMultiButton top-right
2. HealthScore -- full width
3. StatsBar -- full width horizontal stats
4. PermissionScanner -- full width (promoted high for risk-first narrative)
5. RiskEvaluation -- full width
6. PortfolioBreakdown -- full width
7. NftHoldings -- full width
8. WalletActions -- full width (revoke all, close accounts)
9. ActivityFeed -- full width
10. Footer -- ZeroTraceLabs branding, links

**PriceProvider wraps all content below Navbar:**
```tsx
<PriceProvider allMints={allMints} nftMints={nftMints}>
  {/* all components */}
</PriceProvider>
```

**allMints** = ['native', ...tokenAccounts.map(t => t.mint)]
**nftMints** = tokenAccounts.filter(t => t.isNft).map(t => t.mint)

### src/App.tsx

**CRITICAL:** main.tsx already has BrowserRouter -- DO NOT add it again in App.tsx
```tsx
import { Routes, Route } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { RPC_ENDPOINT } from '@/lib/rpc';
import Index from '@/pages/Index';
import NotFound from '@/pages/NotFound';

function App() {
  const endpoint = RPC_ENDPOINT;
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ disableRetryOnRateLimit: true }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
```

---

## 5. KNOWN BUGS & REQUIRED FIXES

### Bug 1: Buffer.from crashes browser
- **Location:** useTokenMetadata.ts, Metaplex PDA derivation
- **Cause:** `Buffer.from('metadata')` is Node.js only
- **Fix:** Use `new TextEncoder().encode('metadata')` and `.toBytes()` instead of `.toBuffer()`

### Bug 2: Duplicate BrowserRouter
- **Location:** App.tsx
- **Cause:** main.tsx already wraps in BrowserRouter
- **Fix:** Only use `<Routes>` in App.tsx, no BrowserRouter/router creation

### Bug 3: useMemo stale closures for USD values
- **Location:** HealthScore, NftHoldings -- any component using useMemo with getUsdValue/getNftFloor
- **Cause:** getUsdValue and getNftFloor are stable module-level function refs that never change, so useMemo never recomputes
- **Fix:** Add `prices` (from PriceContext, a new Map ref on each revision) to useMemo dependency arrays

### Bug 4: Multiple useTokenPrices hook instances racing
- **Location:** Was in old architecture (pre-PriceContext)
- **Fix:** Centralized into single PriceContext provider. Only one subscription, one fetch orchestration.

### Bug 5: NFT floors CORS-blocked from browser
- **Location:** Tensor and Magic Eden APIs
- **Cause:** Both APIs block browser CORS requests
- **Fix:** Supabase edge function as server-side proxy (EXACT SOURCE SAVED)

### Bug 6: jupiterFetching boolean lock dropping concurrent calls
- **Location:** priceService.ts (old version)
- **Fix:** Replaced with fetchedMints Set + activeFetch Promise chain. New mints always fetched regardless of timing.

### Bug 7: 429 rate limiting on public RPC
- **Location:** useWalletData.ts
- **Fix:** Use Helius RPC (100k req/day free tier). Sequential calls with 400ms gaps. disableRetryOnRateLimit: true on Connection config.

### Bug 8: getUsdValue reading stale React state
- **Location:** Was in old useTokenPrices hook
- **Fix:** getUsdValue now reads directly from global priceCache (module-level), not from React state snapshot

### Bug 9: DAS getAssetsByOwner doesn't return floor_price
- **Location:** useTokenMetadata.ts
- **Cause:** floor_price is only available via getAssetsByGroup, not getAssetsByOwner
- **Fix:** Don't rely on DAS for NFT floors. Use edge function -> Magic Eden instead.

### Bug 10: SOL price not available for native SOL
- **Location:** priceService.ts
- **Cause:** DAS only returns SOL price if wallet holds wSOL. Most wallets hold native SOL.
- **Fix:** `ensureSolPrice()` independently fetches SOL price from Jupiter before any other operation

---

## 6. ENVIRONMENT & CONFIG

### .env (project root)
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...your_anon_key
```

### Helius API Key
- Embedded in RPC_ENDPOINT in src/lib/rpc.ts
- Free tier: 100k requests/day
- Supports both standard RPC and DAS API
- Get at: https://helius.dev

### Supabase Edge Function
- Name: `nft-prices`
- Path: `supabase/functions/nft-prices/index.ts`
- Deployed via Supabase CLI or dashboard
- No secrets required (uses public Jupiter + Magic Eden APIs)
- CORS headers included for browser access

### Explorer Links
- All explorer links point to mainnet:
  - Solscan: `https://solscan.io/tx/{signature}` or `/account/{address}`
  - Solana Explorer: `https://explorer.solana.com/tx/{signature}`

---

## REBUILD PRIORITY ORDER

1. **Design system** -- index.css + tailwind.config.ts (foundation for everything)
2. **rpc.ts** -- RPC endpoint constant
3. **priceService.ts** -- EXACT SOURCE SAVED, just copy
4. **useWalletData.ts** -- core data hook
5. **useTokenMetadata.ts** -- DAS + Jupiter + Metaplex metadata
6. **PriceContext.tsx** -- orchestrates price pipeline
7. **TokenIcon.tsx** -- shared display component
8. **HealthScore.tsx** -- top-level dashboard view
9. **StatsBar.tsx** -- simple stats
10. **PermissionScanner.tsx** -- risk scanner with revoke
11. **RiskEvaluation.tsx** -- categorized risk checklist
12. **PortfolioBreakdown.tsx** -- token + NFT portfolio
13. **NftHoldings.tsx** -- NFT grid with images
14. **WalletActions.tsx** -- revoke all + close accounts
15. **ActivityFeed.tsx** -- transaction list
16. **Index.tsx** -- page assembly
17. **App.tsx** -- routing + wallet providers
18. **Edge function** -- EXACT SOURCE SAVED, redeploy
19. **.env** -- Supabase credentials
