/**
 * BN254 field element utilities using native bigint.
 *
 * BN254 is the elliptic curve used by Light Protocol's ZK proofs.
 * All hashes must be less than the field modulus (~2^254) for circuit compatibility.
 *
 * This module replaces BN.js with native bigint for:
 * - Better performance
 * - No Node.js Buffer dependency
 * - Edge/browser compatibility
 */

import bs58 from "bs58";
import { FIELD_SIZE } from "../constants.js";
import { BN254ErrorCode, createBN254Error } from "../errors.js";

// =============================================================================
// Type Definitions
// =============================================================================

/**
 * BN254 field element type.
 *
 * This is a bigint that is guaranteed to be less than the BN254 field modulus.
 * While we can't enforce this at the type level with branded types (since bigint
 * operations return plain bigint), we validate at creation time.
 */
export type BN254 = bigint;

// =============================================================================
// Validation
// =============================================================================

/**
 * Check if a bigint is within the BN254 field.
 */
export function isBN254(value: bigint): boolean {
  return value >= 0n && value < FIELD_SIZE;
}

/**
 * Assert that a bigint is within the BN254 field.
 * @throws BN254Error if value is out of range
 */
export function assertIsBN254(value: bigint): asserts value is BN254 {
  if (!isBN254(value)) {
    throw createBN254Error(BN254ErrorCode.VALUE_TOO_LARGE, "assertIsBN254", `Value ${value} exceeds BN254 field size`);
  }
}

/**
 * Enforce BN254 field size constraint.
 * @throws BN254Error if value is out of range
 */
function enforceFieldSize(value: bigint): BN254 {
  assertIsBN254(value);
  return value;
}

// =============================================================================
// Creation Functions
// =============================================================================

/**
 * Create a BN254 field element from various input types.
 *
 * @param input - Number, string, bigint, or byte array
 * @param base - Optional base for string parsing: 10, 16, 'hex', or 'base58'
 * @returns BN254 field element
 * @throws BN254Error if value exceeds field size
 */
export function createBN254(
  input: string | number | bigint | Uint8Array | number[],
  base?: number | "hex" | "base58",
): BN254 {
  let value: bigint;

  if (base === "base58") {
    if (typeof input !== "string") {
      throw createBN254Error(BN254ErrorCode.INVALID_BASE58, "createBN254", "Base58 input must be a string");
    }
    const bytes = bs58.decode(input);
    value = bytesToBigIntBE(bytes);
  } else if (typeof input === "bigint") {
    value = input;
  } else if (typeof input === "number") {
    value = BigInt(input);
  } else if (typeof input === "string") {
    if (base === "hex" || base === 16) {
      const cleanHex = input.startsWith("0x") ? input.slice(2) : input;
      value = BigInt(`0x${cleanHex}`);
    } else {
      // Default to decimal
      value = BigInt(input);
    }
  } else if (input instanceof Uint8Array || Array.isArray(input)) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    value = bytesToBigIntBE(bytes);
  } else {
    throw createBN254Error(BN254ErrorCode.VALUE_TOO_LARGE, "createBN254", `Unsupported input type: ${typeof input}`);
  }

  return enforceFieldSize(value);
}

/**
 * Create a BN254 from a 32-byte array (big-endian).
 */
export function bn254FromBytes(bytes: Uint8Array): BN254 {
  if (bytes.length !== 32) {
    throw createBN254Error(BN254ErrorCode.VALUE_TOO_LARGE, "bn254FromBytes", `Expected 32 bytes, got ${bytes.length}`);
  }
  return createBN254(bytes);
}

// =============================================================================
// Conversion Functions
// =============================================================================

/**
 * Convert a BN254 field element to a base58 string.
 */
export function encodeBN254toBase58(value: BN254): string {
  const bytes = bigIntToBytesBE(value, 32);
  return bs58.encode(bytes);
}

/**
 * Convert a BN254 field element to a hex string (with 0x prefix).
 */
export function encodeBN254toHex(value: BN254): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/**
 * Convert a BN254 field element to a 32-byte array (big-endian).
 */
export function bn254ToBytes(value: BN254): Uint8Array {
  return bigIntToBytesBE(value, 32);
}

/**
 * Convert a BN254 field element to a decimal string.
 */
export function bn254ToDecimalString(value: BN254): string {
  return value.toString(10);
}

// =============================================================================
// Byte Array Utilities
// =============================================================================

/**
 * Convert bytes to bigint (big-endian).
 */
export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) | BigInt(byte);
  }
  return result;
}

/**
 * Convert bytes to bigint (little-endian).
 */
export function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) {
    result = (result << 8n) | BigInt(bytes[i]);
  }
  return result;
}

/**
 * Convert bigint to bytes (big-endian).
 */
export function bigIntToBytesBE(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

/**
 * Convert bigint to bytes (little-endian).
 */
export function bigIntToBytesLE(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let remaining = value;
  for (let i = 0; i < length; i++) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

// =============================================================================
// Arithmetic Helpers (for field operations if needed)
// =============================================================================

/**
 * Add two BN254 values with modular reduction.
 */
export function bn254Add(a: BN254, b: BN254): BN254 {
  return (a + b) % FIELD_SIZE;
}

/**
 * Subtract two BN254 values with modular reduction.
 */
export function bn254Sub(a: BN254, b: BN254): BN254 {
  const result = (a - b) % FIELD_SIZE;
  return result < 0n ? result + FIELD_SIZE : result;
}

/**
 * Multiply two BN254 values with modular reduction.
 */
export function bn254Mul(a: BN254, b: BN254): BN254 {
  return (a * b) % FIELD_SIZE;
}

/**
 * Check if a value is smaller than the BN254 field size (big-endian bytes).
 */
export function isSmallerThanFieldSize(bytes: Uint8Array): boolean {
  const value = bytesToBigIntBE(bytes);
  return value < FIELD_SIZE;
}
