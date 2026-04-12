# Rebuild Evidence & Incident Report

## Incident Summary
- **Date**: April 4, 2026
- **Issue**: Infrastructure failure during Supabase connection wiped all custom source files from workspace
- **Error**: Persistent `Cannot read properties of null` (null userid/vmid) -- workspace container detached
- **Impact**: All custom components, services, hooks, and Supabase edge functions built across previous sessions were lost
- **Cause**: Workspace environment reset during Supabase connection process. File system became inaccessible (all tool operations failed with internal null reference error). When workspace recovered, only template files remained.

## What Was Lost (Built Across Previous Sessions)

### Components (src/components/)
1. **PermissionScanner** -- Scanned connected wallet for token approvals/delegations, displayed them with risk indicators, individual revoke buttons
2. **NftHoldings** -- Displayed wallet NFTs with images, names, collection info, floor price valuations. Had `totalNftValue` computed via useMemo with `prices` in deps
3. **HealthScore** -- Overall wallet security rating/score. Had `totalPortfolioUsd` and `totalAtRisk` computed via useMemo with `prices` in deps
4. **RiskEvaluation** -- Assessed risk of delegated assets, computed `totalAtRisk` inline with `prices` destructured
5. **PortfolioBreakdown** -- Full token + NFT portfolio with USD values. `assetsWithUsd` and `totalUsd` computed inline with `prices` destructured
6. **Revoke All** -- Batch revoke functionality for all detected permissions

### Services (src/lib/)
7. **priceService.ts** -- Price fetching pipeline (sequential, no race conditions):
   - `ensureSolPrice()` -- Jupiter, guaranteed first
   - `fetchJupiterPrices()` -- all fungible tokens + SOL
   - `fetchNftFloorPrices()` -- called Supabase edge function with NFT mints + collection map
8. **configAddress.ts** -- Config account address exports
9. **NFT collection map** -- Mapping of NFT mints to collection identifiers

### Supabase Edge Function
10. **nft-prices** (supabase/functions/nft-prices/index.ts):
    - Server-side proxy to bypass CORS restrictions
    - Called Magic Eden API for each NFT:
      - Looked up token on ME to find collection symbol
      - Fetched collection floor price stats from ME
      - Returned floor in SOL and USD
    - Status: Was deployed and confirmed active before wipe

### Design System
11. **Dark premium UI theme** -- Custom index.css and tailwind.config with dark theme tokens
12. **Custom WalletMultiButton styling** -- Matched overall dark theme
13. **Component architecture** -- Separate files per section (not monolithic)

### Environment
14. **.env file** -- Supabase URL and anon key (created during session, likely also lost)

## Known Fixes That Were Being Applied
- NFT floor prices via server-side edge function (CORS fix for Magic Eden API)
- Sequential price pipeline to prevent race conditions
- All useMemo hooks had `prices` in dependency arrays for proper recomputation
- `react-router-dom` duplicate BrowserRouter issue (App.tsx imports BrowserRouter but main.tsx already wraps it)

## Current State of Workspace
- Only default template files remain: App.tsx, main.tsx, Index.tsx, NotFound.tsx, utils.ts
- shadcn UI components intact (those are part of the base template)
- package.json intact with all dependencies listed
- No supabase/ directory exists
- App.tsx still has duplicate BrowserRouter import (known bug from template)

## What Would Help for Rebuild
- Any screenshots of the running app from previous sessions
- Code diffs visible in the Noah AI chat UI from previous sessions
- The exact component props/interfaces used
- Specific Solana RPC calls made for permission scanning
- Collection map data structure
