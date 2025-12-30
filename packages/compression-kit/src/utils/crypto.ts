/**
 * Web Crypto utilities for Ed25519 operations.
 *
 * Edge-compatible helpers for importing keys and verifying signatures
 * using the Web Crypto API.
 */

/**
 * Import Ed25519 public key bytes as a CryptoKey for Web Crypto verification.
 *
 * @param bytes - 32-byte Ed25519 public key
 * @returns CryptoKey suitable for signature verification
 *
 * @example
 * ```typescript
 * import { importEd25519PublicKey } from "@cascade-fyi/compression-kit";
 * import { verifySignature, signatureBytes } from "@solana/kit";
 *
 * const pubkeyBytes = new Uint8Array(32); // your public key
 * const key = await importEd25519PublicKey(pubkeyBytes);
 * const valid = await verifySignature(key, signatureBytes(sig), message);
 * ```
 */
export async function importEd25519PublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  if (bytes.length !== 32) {
    throw new Error(`Invalid Ed25519 public key length: ${bytes.length}, expected 32`);
  }

  return crypto.subtle.importKey(
    "raw",
    bytes as unknown as BufferSource, // TypeScript DOM types require explicit cast
    { name: "Ed25519" }, // Object form required for Firefox compatibility
    true,
    ["verify"],
  );
}
