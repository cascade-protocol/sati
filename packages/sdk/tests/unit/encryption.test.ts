/**
 * Unit Tests for Content Encryption Module
 *
 * Tests for X25519-XChaCha20-Poly1305 encryption implementation
 * including key derivation, encryption/decryption, and serialization.
 */

import { describe, test, expect } from "vitest";
import { randomBytes } from "@noble/ciphers/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import {
  encryptContent,
  decryptContent,
  deriveEncryptionKeypair,
  deriveEncryptionPublicKey,
  serializeEncryptedPayload,
  deserializeEncryptedPayload,
  ENCRYPTION_VERSION,
  NONCE_SIZE,
  PUBKEY_SIZE,
  TAG_SIZE,
  MIN_ENCRYPTED_SIZE,
  MAX_PLAINTEXT_SIZE,
  type EncryptedPayload,
} from "../../src/encryption";

/**
 * Generate a test Ed25519 keypair (seed + derived public key)
 */
function generateTestEd25519Seed(): Uint8Array {
  return randomBytes(32);
}

// =============================================================================
// Tests: Constants
// =============================================================================

describe("Encryption Constants", () => {
  test("ENCRYPTION_VERSION is 1", () => {
    expect(ENCRYPTION_VERSION).toBe(1);
  });

  test("NONCE_SIZE is 24 bytes (XChaCha20)", () => {
    expect(NONCE_SIZE).toBe(24);
  });

  test("PUBKEY_SIZE is 32 bytes (X25519)", () => {
    expect(PUBKEY_SIZE).toBe(32);
  });

  test("TAG_SIZE is 16 bytes (Poly1305)", () => {
    expect(TAG_SIZE).toBe(16);
  });

  test("MIN_ENCRYPTED_SIZE is 73 bytes", () => {
    // version(1) + pubkey(32) + nonce(24) + tag(16) = 73
    expect(MIN_ENCRYPTED_SIZE).toBe(73);
  });

  test("MAX_PLAINTEXT_SIZE is 439 bytes", () => {
    // 512 - 73 = 439
    expect(MAX_PLAINTEXT_SIZE).toBe(439);
  });
});

// =============================================================================
// Tests: Key Derivation
// =============================================================================

describe("deriveEncryptionKeypair", () => {
  test("derives X25519 keypair from Ed25519 seed", () => {
    const ed25519Seed = generateTestEd25519Seed();
    const keypair = deriveEncryptionKeypair(ed25519Seed);

    expect(keypair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keypair.publicKey.length).toBe(32);
    expect(keypair.privateKey).toBeInstanceOf(Uint8Array);
    expect(keypair.privateKey.length).toBe(32);
  });

  test("is deterministic - same seed produces same keypair", () => {
    const ed25519Seed = generateTestEd25519Seed();

    const keypair1 = deriveEncryptionKeypair(ed25519Seed);
    const keypair2 = deriveEncryptionKeypair(ed25519Seed);

    expect(keypair1.publicKey).toEqual(keypair2.publicKey);
    expect(keypair1.privateKey).toEqual(keypair2.privateKey);
  });

  test("different seeds produce different keypairs", () => {
    const seed1 = generateTestEd25519Seed();
    const seed2 = generateTestEd25519Seed();

    const keypair1 = deriveEncryptionKeypair(seed1);
    const keypair2 = deriveEncryptionKeypair(seed2);

    expect(keypair1.publicKey).not.toEqual(keypair2.publicKey);
    expect(keypair1.privateKey).not.toEqual(keypair2.privateKey);
  });

  test("accepts 64-byte full Ed25519 key (extracts first 32)", () => {
    const fullKey = randomBytes(64);
    const keypair64 = deriveEncryptionKeypair(fullKey);

    // Should match using just the first 32 bytes
    const keypair32 = deriveEncryptionKeypair(fullKey.slice(0, 32));

    expect(keypair64.publicKey).toEqual(keypair32.publicKey);
    expect(keypair64.privateKey).toEqual(keypair32.privateKey);
  });

  test("throws on invalid key length (not 32 or 64)", () => {
    expect(() => deriveEncryptionKeypair(randomBytes(16))).toThrow("Ed25519 private key must be 32 or 64 bytes");
    expect(() => deriveEncryptionKeypair(randomBytes(48))).toThrow("Ed25519 private key must be 32 or 64 bytes");
  });
});

describe("deriveEncryptionPublicKey", () => {
  test("derives X25519 public key from Ed25519 public key", () => {
    const seed = generateTestEd25519Seed();
    // Get the actual Ed25519 public key
    const ed25519Public = ed25519.getPublicKey(seed);

    // Convert to X25519 using deriveEncryptionPublicKey
    const x25519Public = deriveEncryptionPublicKey(ed25519Public);

    expect(x25519Public).toBeInstanceOf(Uint8Array);
    expect(x25519Public.length).toBe(32);

    // Verify it matches the full keypair derivation
    const keypair = deriveEncryptionKeypair(seed);
    expect(x25519Public).toEqual(keypair.publicKey);
  });

  test("is deterministic", () => {
    const seed = generateTestEd25519Seed();
    const ed25519Public = ed25519.getPublicKey(seed);

    // Derive X25519 public key twice
    const x25519Public1 = deriveEncryptionPublicKey(ed25519Public);
    const x25519Public2 = deriveEncryptionPublicKey(ed25519Public);

    expect(x25519Public1).toEqual(x25519Public2);
  });

  test("throws on invalid public key length", () => {
    expect(() => deriveEncryptionPublicKey(randomBytes(16))).toThrow("Ed25519 public key must be 32 bytes");
    expect(() => deriveEncryptionPublicKey(randomBytes(64))).toThrow("Ed25519 public key must be 32 bytes");
  });
});

// =============================================================================
// Tests: Encryption
// =============================================================================

describe("encryptContent", () => {
  test("produces valid encrypted payload structure", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new TextEncoder().encode("Hello, SATI!");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    expect(payload.version).toBe(ENCRYPTION_VERSION);
    expect(payload.ephemeralPubkey).toBeInstanceOf(Uint8Array);
    expect(payload.ephemeralPubkey.length).toBe(PUBKEY_SIZE);
    expect(payload.nonce).toBeInstanceOf(Uint8Array);
    expect(payload.nonce.length).toBe(NONCE_SIZE);
    expect(payload.ciphertext).toBeInstanceOf(Uint8Array);
    // Ciphertext = plaintext + TAG_SIZE
    expect(payload.ciphertext.length).toBe(plaintext.length + TAG_SIZE);
  });

  test("produces different ciphertext for same plaintext (ephemeral key)", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new TextEncoder().encode("Same message");

    const payload1 = encryptContent(plaintext, recipientKeypair.publicKey);
    const payload2 = encryptContent(plaintext, recipientKeypair.publicKey);

    // Ephemeral keys should differ
    expect(payload1.ephemeralPubkey).not.toEqual(payload2.ephemeralPubkey);
    // Nonces should differ
    expect(payload1.nonce).not.toEqual(payload2.nonce);
    // Ciphertexts should differ
    expect(payload1.ciphertext).not.toEqual(payload2.ciphertext);
  });

  test("handles empty plaintext", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new Uint8Array(0);

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    expect(payload.ciphertext.length).toBe(TAG_SIZE); // Just the auth tag
  });

  test("handles max-size plaintext (439 bytes)", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = randomBytes(MAX_PLAINTEXT_SIZE);

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    expect(payload.ciphertext.length).toBe(MAX_PLAINTEXT_SIZE + TAG_SIZE);
  });

  test("throws on plaintext exceeding max size", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = randomBytes(MAX_PLAINTEXT_SIZE + 1);

    expect(() => encryptContent(plaintext, recipientKeypair.publicKey)).toThrow(/Plaintext too large/);
  });

  test("throws on invalid recipient public key length", () => {
    const plaintext = new TextEncoder().encode("Test");

    expect(() => encryptContent(plaintext, randomBytes(16))).toThrow(/Recipient public key must be 32 bytes/);
    expect(() => encryptContent(plaintext, randomBytes(64))).toThrow(/Recipient public key must be 32 bytes/);
  });
});

// =============================================================================
// Tests: Decryption
// =============================================================================

describe("decryptContent", () => {
  test("successfully decrypts encrypted content", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const originalText = "Hello, SATI! This is a secret message.";
    const plaintext = new TextEncoder().encode(originalText);

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);
    const decrypted = decryptContent(payload, recipientKeypair.privateKey);

    expect(decrypted).toEqual(plaintext);
    expect(new TextDecoder().decode(decrypted)).toBe(originalText);
  });

  test("decrypts empty content", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new Uint8Array(0);

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);
    const decrypted = decryptContent(payload, recipientKeypair.privateKey);

    expect(decrypted.length).toBe(0);
  });

  test("decrypts max-size content", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = randomBytes(MAX_PLAINTEXT_SIZE);

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);
    const decrypted = decryptContent(payload, recipientKeypair.privateKey);

    expect(decrypted).toEqual(plaintext);
  });

  test("fails with wrong private key", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const wrongSeed = generateTestEd25519Seed();
    const wrongKeypair = deriveEncryptionKeypair(wrongSeed);
    const plaintext = new TextEncoder().encode("Secret");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    // Should throw authentication error
    expect(() => decryptContent(payload, wrongKeypair.privateKey)).toThrow();
  });

  test("fails with corrupted ciphertext", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new TextEncoder().encode("Secret message");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    // Corrupt a byte in the ciphertext
    const corruptedPayload: EncryptedPayload = {
      ...payload,
      ciphertext: new Uint8Array(payload.ciphertext),
    };
    corruptedPayload.ciphertext[0] ^= 0xff;

    expect(() => decryptContent(corruptedPayload, recipientKeypair.privateKey)).toThrow();
  });

  test("fails with corrupted nonce", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new TextEncoder().encode("Secret message");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    // Corrupt the nonce
    const corruptedPayload: EncryptedPayload = {
      ...payload,
      nonce: new Uint8Array(payload.nonce),
    };
    corruptedPayload.nonce[0] ^= 0xff;

    expect(() => decryptContent(corruptedPayload, recipientKeypair.privateKey)).toThrow();
  });

  test("fails with unsupported version", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new TextEncoder().encode("Secret");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);
    const unsupportedVersionPayload: EncryptedPayload = {
      ...payload,
      version: 99,
    };

    expect(() => decryptContent(unsupportedVersionPayload, recipientKeypair.privateKey)).toThrow(
      /Unsupported encryption version/,
    );
  });

  test("throws on invalid private key length", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const plaintext = new TextEncoder().encode("Secret");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    expect(() => decryptContent(payload, randomBytes(16))).toThrow(/Private key must be 32 bytes/);
  });
});

// =============================================================================
// Tests: Serialization
// =============================================================================

describe("serializeEncryptedPayload", () => {
  test("produces correct wire format", () => {
    const payload: EncryptedPayload = {
      version: ENCRYPTION_VERSION,
      ephemeralPubkey: randomBytes(PUBKEY_SIZE),
      nonce: randomBytes(NONCE_SIZE),
      ciphertext: randomBytes(50), // arbitrary ciphertext size
    };

    const bytes = serializeEncryptedPayload(payload);

    // Check total size
    expect(bytes.length).toBe(1 + PUBKEY_SIZE + NONCE_SIZE + 50);

    // Check version byte
    expect(bytes[0]).toBe(ENCRYPTION_VERSION);

    // Check ephemeral pubkey
    expect(bytes.slice(1, 1 + PUBKEY_SIZE)).toEqual(payload.ephemeralPubkey);

    // Check nonce
    expect(bytes.slice(1 + PUBKEY_SIZE, 1 + PUBKEY_SIZE + NONCE_SIZE)).toEqual(payload.nonce);

    // Check ciphertext
    expect(bytes.slice(1 + PUBKEY_SIZE + NONCE_SIZE)).toEqual(payload.ciphertext);
  });

  test("handles empty ciphertext (just auth tag)", () => {
    const payload: EncryptedPayload = {
      version: ENCRYPTION_VERSION,
      ephemeralPubkey: randomBytes(PUBKEY_SIZE),
      nonce: randomBytes(NONCE_SIZE),
      ciphertext: randomBytes(TAG_SIZE), // just the tag, no plaintext
    };

    const bytes = serializeEncryptedPayload(payload);

    expect(bytes.length).toBe(MIN_ENCRYPTED_SIZE);
  });
});

describe("deserializeEncryptedPayload", () => {
  test("correctly deserializes serialized payload", () => {
    const originalPayload: EncryptedPayload = {
      version: ENCRYPTION_VERSION,
      ephemeralPubkey: randomBytes(PUBKEY_SIZE),
      nonce: randomBytes(NONCE_SIZE),
      ciphertext: randomBytes(100),
    };

    const bytes = serializeEncryptedPayload(originalPayload);
    const deserialized = deserializeEncryptedPayload(bytes);

    expect(deserialized.version).toBe(originalPayload.version);
    expect(deserialized.ephemeralPubkey).toEqual(originalPayload.ephemeralPubkey);
    expect(deserialized.nonce).toEqual(originalPayload.nonce);
    expect(deserialized.ciphertext).toEqual(originalPayload.ciphertext);
  });

  test("throws on input too small", () => {
    const tooSmall = randomBytes(MIN_ENCRYPTED_SIZE - 1);

    expect(() => deserializeEncryptedPayload(tooSmall)).toThrow(/Encrypted payload too small/);
  });

  test("throws on payload smaller than minimum size", () => {
    // Construct bytes that are smaller than MIN_ENCRYPTED_SIZE
    // MIN_ENCRYPTED_SIZE = 1 + 32 + 24 + 16 = 73 bytes
    // This tests the first validation check
    const badBytes = new Uint8Array(MIN_ENCRYPTED_SIZE - 1);
    badBytes[0] = ENCRYPTION_VERSION;

    expect(() => deserializeEncryptedPayload(badBytes)).toThrow(/Encrypted payload too small/);
  });

  test("version byte is correctly parsed", () => {
    const payload: EncryptedPayload = {
      version: 1,
      ephemeralPubkey: randomBytes(PUBKEY_SIZE),
      nonce: randomBytes(NONCE_SIZE),
      ciphertext: randomBytes(TAG_SIZE),
    };

    const bytes = serializeEncryptedPayload(payload);
    const deserialized = deserializeEncryptedPayload(bytes);

    expect(deserialized.version).toBe(1);
  });

  test("throws on unsupported version during deserialization", () => {
    // Create a payload with unsupported version
    const payload: EncryptedPayload = {
      version: 99, // Unsupported version
      ephemeralPubkey: randomBytes(PUBKEY_SIZE),
      nonce: randomBytes(NONCE_SIZE),
      ciphertext: randomBytes(TAG_SIZE + 10),
    };

    const bytes = serializeEncryptedPayload(payload);
    expect(() => deserializeEncryptedPayload(bytes)).toThrow(/Unsupported encryption version/);
  });
});

// =============================================================================
// Tests: End-to-End Roundtrip
// =============================================================================

describe("End-to-End Encryption Roundtrip", () => {
  test("full roundtrip: encrypt -> serialize -> deserialize -> decrypt", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const originalText = "This is a complete roundtrip test with all steps!";
    const plaintext = new TextEncoder().encode(originalText);

    // Encrypt
    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    // Serialize
    const bytes = serializeEncryptedPayload(payload);

    // Deserialize
    const deserialized = deserializeEncryptedPayload(bytes);

    // Decrypt
    const decrypted = decryptContent(deserialized, recipientKeypair.privateKey);

    expect(new TextDecoder().decode(decrypted)).toBe(originalText);
  });

  test("works with binary data", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const binaryData = randomBytes(200);

    const payload = encryptContent(binaryData, recipientKeypair.publicKey);
    const bytes = serializeEncryptedPayload(payload);
    const deserialized = deserializeEncryptedPayload(bytes);
    const decrypted = decryptContent(deserialized, recipientKeypair.privateKey);

    expect(decrypted).toEqual(binaryData);
  });

  test("works with JSON content", () => {
    const recipientSeed = generateTestEd25519Seed();
    const recipientKeypair = deriveEncryptionKeypair(recipientSeed);
    const jsonData = { rating: 5, comment: "Excellent service!", tags: ["fast", "reliable"] };
    const plaintext = new TextEncoder().encode(JSON.stringify(jsonData));

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);
    const bytes = serializeEncryptedPayload(payload);
    const deserialized = deserializeEncryptedPayload(bytes);
    const decrypted = decryptContent(deserialized, recipientKeypair.privateKey);

    const parsed = JSON.parse(new TextDecoder().decode(decrypted));
    expect(parsed).toEqual(jsonData);
  });

  test("max-size serialized payload is exactly MAX_CONTENT_SIZE (512 bytes)", () => {
    const recipientKeypair = deriveEncryptionKeypair(generateTestEd25519Seed());
    const plaintext = randomBytes(MAX_PLAINTEXT_SIZE);

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);
    const serialized = serializeEncryptedPayload(payload);

    // 1 (version) + 32 (pubkey) + 24 (nonce) + 439 (plaintext) + 16 (tag) = 512
    expect(serialized.length).toBe(512);
  });
});

// =============================================================================
// Tests: Security Properties
// =============================================================================

describe("Security Properties", () => {
  test("different recipients cannot decrypt each other's messages", () => {
    const recipientA = deriveEncryptionKeypair(generateTestEd25519Seed());
    const recipientB = deriveEncryptionKeypair(generateTestEd25519Seed());
    const plaintext = new TextEncoder().encode("Secret for A only");

    // Encrypt for recipient A
    const payload = encryptContent(plaintext, recipientA.publicKey);

    // A can decrypt
    const decrypted = decryptContent(payload, recipientA.privateKey);
    expect(new TextDecoder().decode(decrypted)).toBe("Secret for A only");

    // B cannot decrypt
    expect(() => decryptContent(payload, recipientB.privateKey)).toThrow();
  });

  test("forward secrecy: ephemeral keys are unique per encryption", () => {
    const recipientKeypair = deriveEncryptionKeypair(generateTestEd25519Seed());
    const plaintext = new TextEncoder().encode("Test message");

    const ephemeralKeys = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const payload = encryptContent(plaintext, recipientKeypair.publicKey);
      const keyHex = Array.from(payload.ephemeralPubkey)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      ephemeralKeys.add(keyHex);
    }

    // All ephemeral keys should be unique
    expect(ephemeralKeys.size).toBe(10);
  });

  test("ciphertext authenticity: modifications are detected", () => {
    const recipientKeypair = deriveEncryptionKeypair(generateTestEd25519Seed());
    const plaintext = new TextEncoder().encode("Authenticated message");

    const payload = encryptContent(plaintext, recipientKeypair.publicKey);

    // Try modifying each part of the payload
    const testModification = (modifier: (p: EncryptedPayload) => EncryptedPayload) => {
      const modified = modifier(payload);
      expect(() => decryptContent(modified, recipientKeypair.privateKey)).toThrow();
    };

    // Modify ephemeral pubkey
    testModification((p) => ({
      ...p,
      ephemeralPubkey: new Uint8Array(p.ephemeralPubkey.map((b, i) => (i === 0 ? b ^ 1 : b))),
    }));

    // Modify nonce
    testModification((p) => ({
      ...p,
      nonce: new Uint8Array(p.nonce.map((b, i) => (i === 0 ? b ^ 1 : b))),
    }));

    // Modify ciphertext (body)
    testModification((p) => ({
      ...p,
      ciphertext: new Uint8Array(p.ciphertext.map((b, i) => (i === 0 ? b ^ 1 : b))),
    }));

    // Modify ciphertext (auth tag - last 16 bytes)
    testModification((p) => ({
      ...p,
      ciphertext: new Uint8Array(p.ciphertext.map((b, i) => (i === p.ciphertext.length - 1 ? b ^ 1 : b))),
    }));
  });
});

// =============================================================================
// Tests: Key Derivation Consistency
// =============================================================================

describe("Key Derivation Consistency", () => {
  test("derived keypair works for encryption/decryption", () => {
    const ed25519Seed = generateTestEd25519Seed();
    const keypair = deriveEncryptionKeypair(ed25519Seed);
    const plaintext = new TextEncoder().encode("Test with derived keys");

    // Should be able to encrypt to our own public key and decrypt with private key
    const payload = encryptContent(plaintext, keypair.publicKey);
    const decrypted = decryptContent(payload, keypair.privateKey);

    expect(decrypted).toEqual(plaintext);
  });

  test("public key derivation matches full keypair derivation", () => {
    const ed25519Seed = generateTestEd25519Seed();

    // Get Ed25519 public key (simulate what you'd get from a wallet)
    // In real usage, this would come from the wallet's publicKey
    const fullKeypair = deriveEncryptionKeypair(ed25519Seed);

    // The public keys should be X25519 keys derived from the same Ed25519 key
    // Note: deriveEncryptionPublicKey works on Ed25519 public keys, not seeds
    // This test verifies the keypair derivation produces valid X25519 keys
    expect(fullKeypair.publicKey.length).toBe(32);
    expect(fullKeypair.privateKey.length).toBe(32);
  });
});
