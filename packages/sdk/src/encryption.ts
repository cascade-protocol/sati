/**
 * SATI Content Encryption Module
 *
 * End-to-end encrypted content using X25519-XChaCha20-Poly1305.
 *
 * ## Overview
 * - X25519 key exchange with ephemeral keypair (forward secrecy)
 * - XChaCha20-Poly1305 authenticated encryption (24-byte nonce)
 * - HKDF-SHA256 for key derivation
 * - Ed25519 → X25519 key conversion for Solana wallet compatibility
 *
 * ## Wire Format
 * | Offset | Size | Field |
 * |--------|------|-------|
 * | 0 | 1 | Version (0x01) |
 * | 1 | 32 | Ephemeral X25519 public key |
 * | 33 | 24 | XChaCha20 nonce |
 * | 57 | variable | Ciphertext + Poly1305 tag (16 bytes) |
 *
 * @packageDocumentation
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { randomBytes } from "@noble/ciphers/utils.js";
import { x25519, ed25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";

// ============================================================================
// Constants
// ============================================================================

/** Current encryption protocol version */
export const ENCRYPTION_VERSION = 1;

/** XChaCha20 nonce size in bytes */
export const NONCE_SIZE = 24;

/** X25519 public key size in bytes */
export const PUBKEY_SIZE = 32;

/** Poly1305 authentication tag size in bytes */
export const TAG_SIZE = 16;

/** X25519 private key size in bytes */
export const PRIVKEY_SIZE = 32;

/**
 * Minimum encrypted payload size in bytes.
 * version (1) + ephemeral pubkey (32) + nonce (24) + tag (16) = 73 bytes
 */
export const MIN_ENCRYPTED_SIZE = 1 + PUBKEY_SIZE + NONCE_SIZE + TAG_SIZE;

/** Maximum content size (from schemas.ts) */
const MAX_CONTENT_SIZE = 512;

/** Maximum plaintext size after accounting for encryption overhead */
export const MAX_PLAINTEXT_SIZE = MAX_CONTENT_SIZE - MIN_ENCRYPTED_SIZE;

/** HKDF info string for domain separation */
const HKDF_INFO = new TextEncoder().encode("sati-v1");

// ============================================================================
// Types
// ============================================================================

/**
 * Encrypted payload structure.
 *
 * Contains all components needed for decryption:
 * - version: Protocol version for future upgrades
 * - ephemeralPubkey: Sender's X25519 public key for ECDH
 * - nonce: XChaCha20 nonce (24 bytes)
 * - ciphertext: Encrypted data + 16-byte Poly1305 tag
 */
export interface EncryptedPayload {
  /** Protocol version (currently 1) */
  version: number;
  /** Ephemeral X25519 public key (32 bytes) */
  ephemeralPubkey: Uint8Array;
  /** XChaCha20 nonce (24 bytes) */
  nonce: Uint8Array;
  /** Ciphertext including 16-byte Poly1305 authentication tag */
  ciphertext: Uint8Array;
}

/**
 * X25519 keypair for encryption operations.
 */
export interface EncryptionKeypair {
  /** X25519 public key (32 bytes) */
  publicKey: Uint8Array;
  /** X25519 private key (32 bytes) */
  privateKey: Uint8Array;
}

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive an X25519 encryption keypair from an Ed25519 private key.
 *
 * This allows using existing Solana wallet keys for encryption.
 * The conversion is deterministic - same Ed25519 key always produces
 * the same X25519 keypair.
 *
 * @param ed25519PrivateKey - Ed25519 private key (32 or 64 bytes)
 * @returns X25519 keypair for encryption operations
 *
 * @example
 * ```typescript
 * // From Solana wallet secret key (64 bytes = 32 private + 32 public)
 * const { publicKey, privateKey } = deriveEncryptionKeypair(wallet.secretKey.slice(0, 32));
 *
 * // Use publicKey to receive encrypted content
 * // Use privateKey to decrypt received content
 * ```
 */
export function deriveEncryptionKeypair(ed25519PrivateKey: Uint8Array): EncryptionKeypair {
  // Handle both 32-byte seed and 64-byte full key
  const seed = ed25519PrivateKey.length === 64 ? ed25519PrivateKey.slice(0, 32) : ed25519PrivateKey;

  if (seed.length !== 32) {
    throw new Error("Ed25519 private key must be 32 or 64 bytes");
  }

  // Get Ed25519 public key from seed
  const ed25519Public = ed25519.getPublicKey(seed);

  // Convert Ed25519 public key to X25519 (using v2 API)
  const x25519Public = ed25519.utils.toMontgomery(ed25519Public);

  // Convert Ed25519 private key to X25519 (using v2 API)
  const x25519Private = ed25519.utils.toMontgomerySecret(seed);

  return {
    publicKey: x25519Public,
    privateKey: x25519Private,
  };
}

/**
 * Derive X25519 public key from Ed25519 public key.
 *
 * Use this when you only have the recipient's Ed25519 public key
 * (e.g., from their Solana address).
 *
 * @param ed25519PublicKey - Ed25519 public key (32 bytes)
 * @returns X25519 public key for encryption
 *
 * @example
 * ```typescript
 * // Encrypt content for a Solana address
 * const x25519Pubkey = deriveEncryptionPublicKey(recipientEd25519Pubkey);
 * const encrypted = encryptContent(plaintext, x25519Pubkey);
 * ```
 */
export function deriveEncryptionPublicKey(ed25519PublicKey: Uint8Array): Uint8Array {
  if (ed25519PublicKey.length !== 32) {
    throw new Error("Ed25519 public key must be 32 bytes");
  }
  // Convert Ed25519 public key to X25519 (using v2 API)
  return ed25519.utils.toMontgomery(ed25519PublicKey);
}

// ============================================================================
// Encryption / Decryption
// ============================================================================

/**
 * Encrypt content for a recipient.
 *
 * Uses ephemeral X25519 keypair for forward secrecy - each encryption
 * generates a new keypair, so compromising a single ciphertext doesn't
 * reveal past or future messages.
 *
 * @param plaintext - Content to encrypt (max 439 bytes)
 * @param recipientPubkey - Recipient's X25519 public key (32 bytes)
 * @returns Encrypted payload with all components needed for decryption
 * @throws If plaintext exceeds maximum size or recipient key is invalid
 *
 * @example
 * ```typescript
 * const plaintext = new TextEncoder().encode("Great service!");
 * const encrypted = encryptContent(plaintext, recipientX25519Pubkey);
 * const bytes = serializeEncryptedPayload(encrypted);
 * ```
 */
export function encryptContent(plaintext: Uint8Array, recipientPubkey: Uint8Array): EncryptedPayload {
  if (plaintext.length > MAX_PLAINTEXT_SIZE) {
    throw new Error(`Plaintext too large: ${plaintext.length} bytes (max ${MAX_PLAINTEXT_SIZE})`);
  }

  if (recipientPubkey.length !== PUBKEY_SIZE) {
    throw new Error(`Recipient public key must be ${PUBKEY_SIZE} bytes`);
  }

  // Generate ephemeral X25519 keypair
  const ephemeralPrivate = randomBytes(PRIVKEY_SIZE);
  const ephemeralPublic = x25519.getPublicKey(ephemeralPrivate);

  // Perform X25519 key exchange
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivate, recipientPubkey);

  // Derive encryption key using HKDF with ephemeral public key as salt
  const encryptionKey = hkdf(sha256, sharedSecret, ephemeralPublic, HKDF_INFO, 32);

  // Generate random nonce
  const nonce = randomBytes(NONCE_SIZE);

  // Encrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(encryptionKey, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  // Zero out sensitive material
  ephemeralPrivate.fill(0);
  sharedSecret.fill(0);
  encryptionKey.fill(0);

  return {
    version: ENCRYPTION_VERSION,
    ephemeralPubkey: ephemeralPublic,
    nonce,
    ciphertext,
  };
}

/**
 * Decrypt content using recipient's private key.
 *
 * @param payload - Encrypted payload from encryptContent
 * @param privateKey - Recipient's X25519 private key (32 bytes)
 * @returns Decrypted plaintext
 * @throws If decryption fails (wrong key, corrupted data, or tampered ciphertext)
 *
 * @example
 * ```typescript
 * const payload = deserializeEncryptedPayload(encryptedBytes);
 * const plaintext = decryptContent(payload, myX25519PrivateKey);
 * const text = new TextDecoder().decode(plaintext);
 * ```
 */
export function decryptContent(payload: EncryptedPayload, privateKey: Uint8Array): Uint8Array {
  if (payload.version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${payload.version}`);
  }

  if (privateKey.length !== PRIVKEY_SIZE) {
    throw new Error(`Private key must be ${PRIVKEY_SIZE} bytes`);
  }

  if (payload.ephemeralPubkey.length !== PUBKEY_SIZE) {
    throw new Error(`Ephemeral public key must be ${PUBKEY_SIZE} bytes`);
  }

  if (payload.nonce.length !== NONCE_SIZE) {
    throw new Error(`Nonce must be ${NONCE_SIZE} bytes`);
  }

  // Perform X25519 key exchange
  const sharedSecret = x25519.getSharedSecret(privateKey, payload.ephemeralPubkey);

  // Derive encryption key using HKDF with ephemeral public key as salt
  const encryptionKey = hkdf(sha256, sharedSecret, payload.ephemeralPubkey, HKDF_INFO, 32);

  // Decrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(encryptionKey, payload.nonce);
  const plaintext = cipher.decrypt(payload.ciphertext);

  // Zero out sensitive material
  sharedSecret.fill(0);
  encryptionKey.fill(0);

  return plaintext;
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serialize encrypted payload to bytes for on-chain storage.
 *
 * Wire format:
 * - byte 0: version
 * - bytes 1-32: ephemeral public key
 * - bytes 33-56: nonce
 * - bytes 57+: ciphertext (includes 16-byte auth tag)
 *
 * @param payload - Encrypted payload to serialize
 * @returns Serialized bytes suitable for storage in content field
 *
 * @example
 * ```typescript
 * const encrypted = encryptContent(plaintext, recipientPubkey);
 * const bytes = serializeEncryptedPayload(encrypted);
 *
 * const feedback: FeedbackData = {
 *   contentType: ContentType.Encrypted,
 *   content: bytes,
 *   // ... other fields
 * };
 * ```
 */
export function serializeEncryptedPayload(payload: EncryptedPayload): Uint8Array {
  const totalSize = 1 + PUBKEY_SIZE + NONCE_SIZE + payload.ciphertext.length;
  const buffer = new Uint8Array(totalSize);

  let offset = 0;

  // Version (1 byte)
  buffer[offset++] = payload.version;

  // Ephemeral public key (32 bytes)
  buffer.set(payload.ephemeralPubkey, offset);
  offset += PUBKEY_SIZE;

  // Nonce (24 bytes)
  buffer.set(payload.nonce, offset);
  offset += NONCE_SIZE;

  // Ciphertext (variable length, includes auth tag)
  buffer.set(payload.ciphertext, offset);

  return buffer;
}

/**
 * Deserialize encrypted payload from bytes.
 *
 * @param bytes - Serialized encrypted payload
 * @returns Deserialized EncryptedPayload
 * @throws If bytes are too small or malformed
 *
 * @example
 * ```typescript
 * if (feedback.contentType === ContentType.Encrypted) {
 *   const payload = deserializeEncryptedPayload(feedback.content);
 *   const plaintext = decryptContent(payload, myPrivateKey);
 * }
 * ```
 */
export function deserializeEncryptedPayload(bytes: Uint8Array): EncryptedPayload {
  if (bytes.length < MIN_ENCRYPTED_SIZE) {
    throw new Error(`Encrypted payload too small: ${bytes.length} bytes (minimum ${MIN_ENCRYPTED_SIZE})`);
  }

  let offset = 0;

  // Version (1 byte)
  const version = bytes[offset++];

  if (version !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${version} (supported: ${ENCRYPTION_VERSION})`);
  }

  // Ephemeral public key (32 bytes)
  const ephemeralPubkey = bytes.slice(offset, offset + PUBKEY_SIZE);
  offset += PUBKEY_SIZE;

  // Nonce (24 bytes)
  const nonce = bytes.slice(offset, offset + NONCE_SIZE);
  offset += NONCE_SIZE;

  // Ciphertext (remaining bytes, includes auth tag)
  const ciphertext = bytes.slice(offset);

  if (ciphertext.length < TAG_SIZE) {
    throw new Error(`Ciphertext too small: must include ${TAG_SIZE}-byte auth tag`);
  }

  return {
    version,
    ephemeralPubkey,
    nonce,
    ciphertext,
  };
}
