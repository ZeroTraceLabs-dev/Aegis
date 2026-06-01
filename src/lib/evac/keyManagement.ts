/**
 * Evac Key Management — generates the gas sub-wallet keypair, encrypts the
 * private key using a key derived from a signature produced by the user's
 * MAIN wallet, and persists the encrypted blob to localStorage. Decryption
 * requires the user to re-sign the same deterministic message.
 *
 * Security model:
 *   - Plaintext private key never touches the network and never sits in
 *     localStorage.
 *   - The encryption key lives only in derived-key form (CryptoKey) inside
 *     the running tab. After encrypt or decrypt, we zero out the raw secret
 *     byte arrays we held.
 *   - Worst case if browser storage is compromised: attacker has the
 *     encrypted blob, useless without the user re-signing the encryption
 *     message with the main wallet.
 *   - We pin the message to a versioned literal so a future rotation
 *     (`...v2`) can be introduced without colliding with this scheme.
 */

import type { WalletContextState } from '@solana/wallet-adapter-react';
import type { EncryptedBlob, GasWalletRecord } from './configStore';

const ENCRYPTION_MESSAGE = 'Cerberus evac gas wallet encryption v1';

// ── base64 helpers (browser-safe) ─────────────────────────────

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Signature → AES-GCM key ───────────────────────────────────

/**
 * Asks the user's main wallet to sign the versioned encryption message
 * and returns the raw signature bytes (64 bytes for ed25519). The
 * signature is deterministic for a given wallet+message pair on every
 * wallet I'm aware of (Phantom, Solflare, Backpack), so re-signing later
 * reproduces the same encryption key and can decrypt the stored blob.
 */
async function getSignatureBytes(wallet: WalletContextState): Promise<Uint8Array> {
  if (!wallet.signMessage) {
    throw new Error('This wallet does not support message signing. Try Phantom or Solflare.');
  }
  const msg = new TextEncoder().encode(ENCRYPTION_MESSAGE);
  return await wallet.signMessage(msg);
}

/**
 * Derive a 256-bit AES-GCM key from the signature bytes via SHA-256.
 * Returns a non-exportable CryptoKey so the raw bytes can't be extracted
 * via the Web Crypto API after derivation.
 */
async function deriveEncryptionKey(signatureBytes: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.digest('SHA-256', signatureBytes as BufferSource);
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt'],
  );
}

// ── Encrypt / decrypt ─────────────────────────────────────────

async function encryptSecret(secret: Uint8Array, key: CryptoKey): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    secret as BufferSource,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
  };
}

async function decryptSecret(blob: EncryptedBlob, key: CryptoKey): Promise<Uint8Array> {
  const iv = base64ToBytes(blob.iv);
  const ciphertext = base64ToBytes(blob.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new Uint8Array(plain);
}

// ── Public API ────────────────────────────────────────────────

export interface GeneratedGasWallet {
  pubkey: string;
  /** raw 64-byte Solana secret key; caller is expected to encrypt and zero this immediately. */
  secret: Uint8Array;
}

/** Generate a fresh Solana keypair entirely client-side. */
export async function generateGasWallet(): Promise<GeneratedGasWallet> {
  const web3 = await import('@solana/web3.js');
  const kp = web3.Keypair.generate();
  return {
    pubkey: kp.publicKey.toBase58(),
    secret: new Uint8Array(kp.secretKey),
  };
}

/**
 * Encrypt + return the GasWalletRecord ready for persistence. Zeros the
 * raw secret on the caller's behalf — caller must not retain a reference
 * to `secret` after this call.
 */
export async function encryptGasWallet(
  wallet: WalletContextState,
  pubkey: string,
  secret: Uint8Array,
): Promise<GasWalletRecord> {
  const sigBytes = await getSignatureBytes(wallet);
  const key = await deriveEncryptionKey(sigBytes);
  // Wipe the signature copy as soon as the derived key exists.
  sigBytes.fill(0);
  try {
    const encryptedPrivkey = await encryptSecret(secret, key);
    return { pubkey, encryptedPrivkey };
  } finally {
    secret.fill(0);
  }
}

/**
 * Re-derive the encryption key from a fresh signature and decrypt the
 * stored gas-wallet private key. The returned bytes are the raw 64-byte
 * Solana secret key; the CALLER must zero this Uint8Array after use.
 *
 * Throws if the signature doesn't decrypt (wrong wallet connected, etc.).
 */
export async function decryptGasWalletSecret(
  wallet: WalletContextState,
  record: GasWalletRecord,
): Promise<Uint8Array> {
  const sigBytes = await getSignatureBytes(wallet);
  const key = await deriveEncryptionKey(sigBytes);
  sigBytes.fill(0);
  return decryptSecret(record.encryptedPrivkey, key);
}
