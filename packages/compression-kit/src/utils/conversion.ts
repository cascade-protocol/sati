/**
 * Conversion and hashing utilities for Light Protocol.
 *
 * Uses @noble/hashes for Keccak256 - pure JS, works in all environments.
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToBigIntBE, isSmallerThanFieldSize } from "../state/bn254.js";

// =============================================================================
// Hash Functions
// =============================================================================

/**
 * Hash multiple byte arrays with Keccak256 and truncate to BN254 field size.
 *
 * This is the primary hash function used by Light Protocol. It:
 * 1. Concatenates all input arrays
 * 2. Hashes with Keccak256
 * 3. Sets the first byte to 0 to ensure the result fits in BN254 field
 *
 * @param inputs - Array of byte arrays to hash
 * @returns 32-byte hash that fits in BN254 field
 */
export function hashvToBn254FieldSizeBe(inputs: Uint8Array[]): Uint8Array {
  const hasher = keccak_256.create();
  for (const input of inputs) {
    hasher.update(input);
  }
  const hash = hasher.digest();
  // Truncate to 31 bytes by zeroing the first byte
  hash[0] = 0;
  return hash;
}

/**
 * Hash multiple byte arrays with Keccak256, appending 0xFF bump seed.
 *
 * This variant appends a 255 bump seed before hashing, matching the
 * on-chain behavior for certain hash derivations.
 *
 * @param inputs - Array of byte arrays to hash
 * @returns 32-byte hash that fits in BN254 field
 */
export function hashvToBn254FieldSizeBeWithBump(inputs: Uint8Array[]): Uint8Array {
  const hasher = keccak_256.create();
  for (const input of inputs) {
    hasher.update(input);
  }
  hasher.update(new Uint8Array([255]));
  const hash = hasher.digest();
  hash[0] = 0;
  return hash;
}

/**
 * Hash bytes with Keccak256 and find a valid bump seed.
 *
 * @deprecated Use hashvToBn254FieldSizeBe instead.
 *
 * This function iterates through bump seeds (255 down to 0) to find one
 * that produces a hash smaller than the BN254 field size. This is the
 * legacy approach - the simpler truncation method is now preferred.
 *
 * @param bytes - Bytes to hash
 * @returns Tuple of [hash, bumpSeed] or null if no valid bump found
 */
export function hashToBn254FieldSizeBe(bytes: Uint8Array): [Uint8Array, number] | null {
  let bumpSeed = 255;
  while (bumpSeed >= 0) {
    const inputWithBump = new Uint8Array(bytes.length + 1);
    inputWithBump.set(bytes);
    inputWithBump[bytes.length] = bumpSeed;

    const hash = keccak_256(inputWithBump);
    if (hash.length !== 32) {
      throw new Error("Invalid hash length");
    }
    hash[0] = 0;

    if (isSmallerThanFieldSize(hash)) {
      return [hash, bumpSeed];
    }
    bumpSeed--;
  }
  return null;
}

// =============================================================================
// Byte/Hex Conversion
// =============================================================================

/**
 * Convert hex string to bytes.
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to hex string (no 0x prefix).
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert bigint to hex string with 0x prefix.
 */
export function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}

// =============================================================================
// Array Utilities
// =============================================================================

/**
 * Ensure value is an array.
 */
export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Merge bytes arrays into one.
 */
export function mergeBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Compare two byte arrays for equality.
 */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Pad bytes to a fixed length (right-pad with zeros).
 */
export function padBytes(bytes: Uint8Array, length: number): Uint8Array {
  if (bytes.length >= length) return bytes;
  const result = new Uint8Array(length);
  result.set(bytes);
  return result;
}

/**
 * Push unique items to an array.
 * Mutates the array in place.
 */
export function pushUniqueItems<T>(items: T[], target: T[]): void {
  for (const item of items) {
    if (!target.includes(item)) {
      target.push(item);
    }
  }
}

// =============================================================================
// Decimal String Conversion
// =============================================================================

/**
 * Convert bytes to decimal string (for ZK circuit compatibility).
 */
export function bytesToDecimalString(bytes: Uint8Array): string {
  return bytesToBigIntBE(bytes).toString(10);
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate that a hash value is within BN254 field size.
 */
export function validateBN254Hash(hash: Uint8Array): boolean {
  if (hash.length !== 32) return false;
  return isSmallerThanFieldSize(hash);
}

/**
 * Assert hash is valid BN254 field element.
 */
export function assertValidBN254Hash(hash: Uint8Array): void {
  if (!validateBN254Hash(hash)) {
    throw new Error(`Invalid BN254 hash: must be 32 bytes and less than field size`);
  }
}
