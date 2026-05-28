/**
 * Client-side Solana RPC endpoint.
 *
 * Read from VITE_HELIUS_RPC_URL at build time. Must be the full URL including
 * the API key, e.g. https://mainnet.helius-rpc.com/?api-key=<KEY>.
 *
 * Fail loudly when missing — a misconfigured build that silently fell back
 * to public RPC would mask the failure mode that prompted this change
 * (revoked key -> 401s -> useWalletScan returns empty -> Wallet tab blank).
 */
const RPC_URL = import.meta.env.VITE_HELIUS_RPC_URL;

if (!RPC_URL) {
  throw new Error(
    'VITE_HELIUS_RPC_URL is not set. Provide the full RPC URL (including api-key query param) in your .env file and in your Netlify environment variables.',
  );
}

export const RPC_ENDPOINT: string = RPC_URL;
