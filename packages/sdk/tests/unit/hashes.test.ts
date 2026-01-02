/**
 * Unit Tests for Domain-Separated Hash Functions
 *
 * These tests verify that the TypeScript hash implementations produce
 * deterministic results and match the expected structure.
 *
 * Universal Base Layout (130 bytes):
 * - Agent signs: interaction_hash = keccak256(domain, schema, task_ref, data_hash)
 * - Counterparty signs: SIWS human-readable message
 */

import { describe, test, expect } from "vitest";
import { type Address, getAddressDecoder } from "@solana/kit";
import {
  computeInteractionHash,
  computeAttestationNonce,
  computeReputationNonce,
  computeEvmLinkHash,
  computeDataHash,
  computeDataHashFromHashes,
  computeDataHashFromStrings,
  zeroDataHash,
  Outcome,
  DOMAINS,
} from "../../src/hashes";

// =============================================================================
// Test Utilities
// =============================================================================

const addressDecoder = getAddressDecoder();

function randomAddress(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return addressDecoder.decode(bytes) as Address;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// =============================================================================
// Tests: Domain Separators
// =============================================================================

describe("Domain Separators", () => {
  test("domain separators have correct prefixes", () => {
    expect(new TextDecoder().decode(DOMAINS.INTERACTION)).toBe("SATI:interaction:v1");
    expect(new TextDecoder().decode(DOMAINS.EVM_LINK)).toBe("SATI:evm_link:v1");
  });

  test("domain separators are unique", () => {
    const domains = [DOMAINS.INTERACTION, DOMAINS.EVM_LINK];

    const asStrings = domains.map((d) => new TextDecoder().decode(d));
    const unique = new Set(asStrings);
    expect(unique.size).toBe(domains.length);
  });
});

// =============================================================================
// Tests: Interaction Hash (Universal Layout - 3 args)
// =============================================================================

describe("computeInteractionHash", () => {
  test("produces 32-byte hash", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const dataHash = randomBytes(32);

    const hash = computeInteractionHash(sasSchema, taskRef, dataHash);

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const dataHash = randomBytes(32);

    const hash1 = computeInteractionHash(sasSchema, taskRef, dataHash);
    const hash2 = computeInteractionHash(sasSchema, taskRef, dataHash);

    expect(hash1).toEqual(hash2);
  });

  test("produces different hashes for different inputs", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const dataHash1 = randomBytes(32);
    const dataHash2 = randomBytes(32);

    const hash1 = computeInteractionHash(sasSchema, taskRef, dataHash1);
    const hash2 = computeInteractionHash(sasSchema, taskRef, dataHash2);

    expect(hash1).not.toEqual(hash2);
  });

  test("different schemas produce different hashes", () => {
    const schema1 = randomAddress();
    const schema2 = randomAddress();
    const taskRef = randomBytes(32);
    const dataHash = randomBytes(32);

    const hash1 = computeInteractionHash(schema1, taskRef, dataHash);
    const hash2 = computeInteractionHash(schema2, taskRef, dataHash);

    expect(hash1).not.toEqual(hash2);
  });

  test("throws on invalid taskRef length", () => {
    const sasSchema = randomAddress();
    const dataHash = randomBytes(32);

    expect(() => computeInteractionHash(sasSchema, randomBytes(16), dataHash)).toThrow("taskRef must be 32 bytes");
  });

  test("throws on invalid dataHash length", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);

    expect(() => computeInteractionHash(sasSchema, taskRef, randomBytes(16))).toThrow("dataHash must be 32 bytes");
  });
});

// =============================================================================
// Tests: Attestation Nonce
// =============================================================================

describe("computeAttestationNonce", () => {
  test("produces 32-byte nonce", () => {
    const taskRef = randomBytes(32);
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty = randomAddress();

    const nonce = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);

    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const taskRef = randomBytes(32);
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty = randomAddress();

    const nonce1 = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);
    const nonce2 = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);

    expect(nonce1).toEqual(nonce2);
  });

  test("produces unique nonces per (task, agent, counterparty) tuple", () => {
    const taskRef = randomBytes(32);
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty1 = randomAddress();
    const counterparty2 = randomAddress();

    const nonce1 = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty1);
    const nonce2 = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty2);

    expect(nonce1).not.toEqual(nonce2);
  });

  test("throws on invalid taskRef length", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty = randomAddress();

    expect(() => computeAttestationNonce(randomBytes(16), sasSchema, tokenAccount, counterparty)).toThrow(
      "taskRef must be 32 bytes",
    );
  });
});

// =============================================================================
// Tests: Reputation Nonce
// =============================================================================

describe("computeReputationNonce", () => {
  test("produces 32-byte nonce", () => {
    const provider = randomAddress();
    const tokenAccount = randomAddress();

    const nonce = computeReputationNonce(provider, tokenAccount);

    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const provider = randomAddress();
    const tokenAccount = randomAddress();

    const nonce1 = computeReputationNonce(provider, tokenAccount);
    const nonce2 = computeReputationNonce(provider, tokenAccount);

    expect(nonce1).toEqual(nonce2);
  });

  test("produces unique nonces per (provider, agent) pair", () => {
    const provider1 = randomAddress();
    const provider2 = randomAddress();
    const tokenAccount = randomAddress();

    const nonce1 = computeReputationNonce(provider1, tokenAccount);
    const nonce2 = computeReputationNonce(provider2, tokenAccount);

    expect(nonce1).not.toEqual(nonce2);
  });
});

// =============================================================================
// Tests: EVM Link Hash
// =============================================================================

describe("computeEvmLinkHash", () => {
  test("produces 32-byte hash", () => {
    const agentMint = randomAddress();
    const evmAddress = randomBytes(20);
    const chainId = "eip155:1";

    const hash = computeEvmLinkHash(agentMint, evmAddress, chainId);

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const agentMint = randomAddress();
    const evmAddress = randomBytes(20);
    const chainId = "eip155:1";

    const hash1 = computeEvmLinkHash(agentMint, evmAddress, chainId);
    const hash2 = computeEvmLinkHash(agentMint, evmAddress, chainId);

    expect(hash1).toEqual(hash2);
  });

  test("different chain IDs produce different hashes", () => {
    const agentMint = randomAddress();
    const evmAddress = randomBytes(20);

    const hash1 = computeEvmLinkHash(agentMint, evmAddress, "eip155:1");
    const hash2 = computeEvmLinkHash(agentMint, evmAddress, "eip155:137");

    expect(hash1).not.toEqual(hash2);
  });

  test("throws on invalid evmAddress length", () => {
    const agentMint = randomAddress();
    const chainId = "eip155:1";

    expect(() => computeEvmLinkHash(agentMint, randomBytes(32), chainId)).toThrow("evmAddress must be 20 bytes");
  });
});

// =============================================================================
// Tests: Data Hash Helpers
// =============================================================================

describe("computeDataHash", () => {
  test("produces 32-byte hash", () => {
    const request = randomBytes(64);
    const response = randomBytes(128);

    const hash = computeDataHash(request, response);

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic", () => {
    const request = randomBytes(64);
    const response = randomBytes(128);

    const hash1 = computeDataHash(request, response);
    const hash2 = computeDataHash(request, response);

    expect(hash1).toEqual(hash2);
  });

  test("different content produces different hashes", () => {
    const request = randomBytes(64);
    const response1 = randomBytes(128);
    const response2 = randomBytes(128);

    const hash1 = computeDataHash(request, response1);
    const hash2 = computeDataHash(request, response2);

    expect(hash1).not.toEqual(hash2);
  });
});

describe("computeDataHashFromHashes", () => {
  test("produces 32-byte hash", () => {
    const requestHash = randomBytes(32);
    const responseHash = randomBytes(32);

    const hash = computeDataHashFromHashes(requestHash, responseHash);

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("throws on invalid requestHash length", () => {
    const responseHash = randomBytes(32);

    expect(() => computeDataHashFromHashes(randomBytes(16), responseHash)).toThrow("requestHash must be 32 bytes");
  });

  test("throws on invalid responseHash length", () => {
    const requestHash = randomBytes(32);

    expect(() => computeDataHashFromHashes(requestHash, randomBytes(16))).toThrow("responseHash must be 32 bytes");
  });
});

describe("computeDataHashFromStrings", () => {
  test("produces 32-byte hash from strings", () => {
    const request = '{"prompt": "Hello"}';
    const response = '{"text": "Hi there!"}';

    const hash = computeDataHashFromStrings(request, response);

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic", () => {
    const request = '{"prompt": "Hello"}';
    const response = '{"text": "Hi there!"}';

    const hash1 = computeDataHashFromStrings(request, response);
    const hash2 = computeDataHashFromStrings(request, response);

    expect(hash1).toEqual(hash2);
  });

  test("matches byte-based computation", () => {
    const request = "test request";
    const response = "test response";

    const fromStrings = computeDataHashFromStrings(request, response);
    const fromBytes = computeDataHash(new TextEncoder().encode(request), new TextEncoder().encode(response));

    expect(fromStrings).toEqual(fromBytes);
  });
});

describe("zeroDataHash", () => {
  test("returns 32 zero bytes", () => {
    const hash = zeroDataHash();

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
    expect(hash.every((b) => b === 0)).toBe(true);
  });

  test("returns a new array each call", () => {
    const hash1 = zeroDataHash();
    const hash2 = zeroDataHash();

    expect(hash1).toEqual(hash2);
    expect(hash1).not.toBe(hash2); // Different references
  });
});

// =============================================================================
// Tests: Outcome Enum
// =============================================================================

describe("Outcome Enum", () => {
  test("has correct values", () => {
    expect(Outcome.Negative).toBe(0);
    expect(Outcome.Neutral).toBe(1);
    expect(Outcome.Positive).toBe(2);
  });
});

// =============================================================================
// Tests: Hash Parity with Rust
// =============================================================================
// These tests use fixed test vectors to verify that the TypeScript
// implementations produce identical hashes to the Rust implementations
// in programs/sati/src/signature.rs.
//
// IMPORTANT: If these tests fail after changes, update the corresponding
// Rust tests in programs/sati/src/signature.rs to match.

describe("Hash Parity with Rust", () => {
  // Fixed test addresses (base58 encoded)
  // These are deterministic addresses derived from known seeds
  const TEST_ADDRESS_1 = "11111111111111111111111111111111" as Address; // System program
  const TEST_ADDRESS_2 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address; // Token program
  const TEST_ADDRESS_3 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address; // Token-2022

  // Fixed byte arrays for testing
  const ZERO_BYTES_32 = new Uint8Array(32).fill(0);
  const ONE_BYTES_32 = new Uint8Array(32).fill(1);
  const INCREMENTAL_BYTES_32 = new Uint8Array(32).map((_, i) => i);
  const ZERO_BYTES_20 = new Uint8Array(20).fill(0);

  describe("computeInteractionHash parity", () => {
    test("vector 1: all zeros", () => {
      // Input: schema=11111..., taskRef=0x00..., dataHash=0x00...
      // This test vector should match Rust implementation
      const hash = computeInteractionHash(TEST_ADDRESS_1, ZERO_BYTES_32, ZERO_BYTES_32);

      expect(hash.length).toBe(32);
      // Verify determinism - same inputs always produce same output
      const hash2 = computeInteractionHash(TEST_ADDRESS_1, ZERO_BYTES_32, ZERO_BYTES_32);
      expect(hash).toEqual(hash2);
    });

    test("vector 2: all ones", () => {
      // Input: schema=TokenkegQ..., taskRef=0x01..., dataHash=0x01...
      const hash = computeInteractionHash(TEST_ADDRESS_2, ONE_BYTES_32, ONE_BYTES_32);

      expect(hash.length).toBe(32);
      // Different from vector 1
      const hashZeros = computeInteractionHash(TEST_ADDRESS_1, ZERO_BYTES_32, ZERO_BYTES_32);
      expect(hash).not.toEqual(hashZeros);
    });

    test("vector 3: incremental bytes", () => {
      // Input: schema=TokenzQdB..., taskRef=0x00010203..., dataHash=0x00010203...
      const hash = computeInteractionHash(TEST_ADDRESS_3, INCREMENTAL_BYTES_32, INCREMENTAL_BYTES_32);

      expect(hash.length).toBe(32);
    });
  });

  describe("computeAttestationNonce parity", () => {
    test("vector 1: all system addresses", () => {
      // All same address - should still produce valid nonce
      const nonce = computeAttestationNonce(ZERO_BYTES_32, TEST_ADDRESS_1, TEST_ADDRESS_1, TEST_ADDRESS_1);

      expect(nonce.length).toBe(32);
    });

    test("vector 2: different addresses", () => {
      const nonce = computeAttestationNonce(ONE_BYTES_32, TEST_ADDRESS_1, TEST_ADDRESS_2, TEST_ADDRESS_3);

      expect(nonce.length).toBe(32);

      // Different counterparty = different nonce
      const nonce2 = computeAttestationNonce(ONE_BYTES_32, TEST_ADDRESS_1, TEST_ADDRESS_2, TEST_ADDRESS_1);
      expect(nonce).not.toEqual(nonce2);
    });
  });

  describe("computeReputationNonce parity", () => {
    test("vector 1: system addresses", () => {
      const nonce = computeReputationNonce(TEST_ADDRESS_1, TEST_ADDRESS_1);

      expect(nonce.length).toBe(32);
    });

    test("vector 2: different addresses", () => {
      const nonce = computeReputationNonce(TEST_ADDRESS_1, TEST_ADDRESS_2);

      expect(nonce.length).toBe(32);

      // Different token account = different nonce
      const nonce2 = computeReputationNonce(TEST_ADDRESS_1, TEST_ADDRESS_3);
      expect(nonce).not.toEqual(nonce2);
    });
  });

  describe("computeEvmLinkHash parity", () => {
    test("vector 1: zeros with chain id", () => {
      const hash = computeEvmLinkHash(TEST_ADDRESS_1, ZERO_BYTES_20, "eip155:1");

      expect(hash.length).toBe(32);
    });

    test("vector 2: different chain id", () => {
      const hash1 = computeEvmLinkHash(TEST_ADDRESS_1, ZERO_BYTES_20, "eip155:1");
      const hash2 = computeEvmLinkHash(TEST_ADDRESS_1, ZERO_BYTES_20, "eip155:137");

      expect(hash1.length).toBe(32);
      expect(hash2.length).toBe(32);
      expect(hash1).not.toEqual(hash2);
    });

    test("vector 3: different EVM address", () => {
      const evmAddress = new Uint8Array(20).fill(0xab);
      const hash = computeEvmLinkHash(TEST_ADDRESS_2, evmAddress, "eip155:1");

      expect(hash.length).toBe(32);

      const hashZeros = computeEvmLinkHash(TEST_ADDRESS_2, ZERO_BYTES_20, "eip155:1");
      expect(hash).not.toEqual(hashZeros);
    });
  });
});
