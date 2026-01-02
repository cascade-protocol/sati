/**
 * Unit Tests for Ed25519 Signature Operations
 *
 * Tests the signature utilities using real Ed25519 cryptography
 * via @solana/kit's Web Crypto implementation, verifying that:
 * 1. Signatures are correctly generated and verifiable
 * 2. createFeedbackSignatures produces valid dual signatures
 * 3. Signature binding: agent->interactionHash, counterparty->SIWS message
 * 4. Wrong keypairs fail verification
 *
 * Universal Layout (130 bytes):
 * - Agent signs: keccak256(domain, schema, task_ref, data_hash)
 * - Counterparty signs: SIWS human-readable message
 */

import { describe, test, expect } from "vitest";
import {
  signMessage,
  verifySignature,
  createTestKeypair,
  createFeedbackSignatures,
  verifyFeedbackSignatures,
  createValidationSignatures,
  createReputationSignature,
  randomBytes32,
} from "../helpers";
import { computeInteractionHash, Outcome } from "../../src/hashes";

// =============================================================================
// Test Utilities
// =============================================================================

async function randomAddress() {
  const keypair = await createTestKeypair();
  return keypair.address;
}

// =============================================================================
// Tests: Core Ed25519 Operations
// =============================================================================

describe("Ed25519 Core Operations", () => {
  describe("signMessage", () => {
    test("produces 64-byte signature", async () => {
      const keypair = await createTestKeypair();
      const message = randomBytes32();

      const signature = await signMessage(message, keypair.keyPair);

      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64);
    });

    test("produces deterministic signatures for same message", async () => {
      const keypair = await createTestKeypair(1);
      const message = randomBytes32();

      const sig1 = await signMessage(message, keypair.keyPair);
      const sig2 = await signMessage(message, keypair.keyPair);

      expect(sig1).toEqual(sig2);
    });

    test("produces different signatures for different messages", async () => {
      const keypair = await createTestKeypair();
      const message1 = randomBytes32();
      const message2 = randomBytes32();

      const sig1 = await signMessage(message1, keypair.keyPair);
      const sig2 = await signMessage(message2, keypair.keyPair);

      expect(sig1).not.toEqual(sig2);
    });
  });

  describe("verifySignature", () => {
    test("verifies valid signature", async () => {
      const keypair = await createTestKeypair();
      const message = randomBytes32();

      const signature = await signMessage(message, keypair.keyPair);
      const isValid = await verifySignature(message, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    test("rejects signature with wrong message", async () => {
      const keypair = await createTestKeypair();
      const message = randomBytes32();
      const wrongMessage = randomBytes32();

      const signature = await signMessage(message, keypair.keyPair);
      const isValid = await verifySignature(wrongMessage, signature, keypair.publicKey);

      expect(isValid).toBe(false);
    });

    test("rejects signature with wrong public key", async () => {
      const keypair = await createTestKeypair();
      const wrongKeypair = await createTestKeypair(99);
      const message = randomBytes32();

      const signature = await signMessage(message, keypair.keyPair);
      const isValid = await verifySignature(message, signature, wrongKeypair.publicKey);

      expect(isValid).toBe(false);
    });

    test("rejects tampered signature", async () => {
      const keypair = await createTestKeypair();
      const message = randomBytes32();

      const signature = await signMessage(message, keypair.keyPair);

      // Tamper with signature
      const tamperedSig = new Uint8Array(signature);
      tamperedSig[0] ^= 0xff;

      const isValid = await verifySignature(message, tamperedSig, keypair.publicKey);

      expect(isValid).toBe(false);
    });
  });
});

// =============================================================================
// Tests: Feedback Signatures
// =============================================================================

describe("createFeedbackSignatures", () => {
  test("produces two signatures and counterparty message", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const result = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, Outcome.Positive);

    expect(result.signatures).toHaveLength(2);
    expect(result.counterpartyMessage).toBeInstanceOf(Uint8Array);
    expect(result.counterpartyMessage.length).toBeGreaterThan(0);
  });

  test("first signature is from agent", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const result = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, Outcome.Positive);

    expect(result.signatures[0].pubkey).toBe(agent.address);
  });

  test("second signature is from counterparty", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const result = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, Outcome.Positive);

    expect(result.signatures[1].pubkey).toBe(counterparty.address);
  });

  test("agent signature verifies against interaction hash", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const result = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, Outcome.Positive);

    // Agent signs interaction hash (blind to outcome, no tokenAccount in hash)
    const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

    const isValid = await verifySignature(interactionHash, result.signatures[0].sig, agent.publicKey);

    expect(isValid).toBe(true);
  });

  test("counterparty signature verifies against SIWS message", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const result = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, Outcome.Positive);

    // Counterparty signs SIWS message (human-readable format)
    const isValid = await verifySignature(result.counterpartyMessage, result.signatures[1].sig, counterparty.publicKey);

    expect(isValid).toBe(true);
  });

  test("different outcomes produce different counterparty messages", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const resultPositive = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    const resultNegative = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Negative,
    );

    // Agent signatures should be the same (blind to outcome)
    expect(resultPositive.signatures[0].sig).toEqual(resultNegative.signatures[0].sig);

    // Counterparty signatures should be different (SIWS message includes outcome)
    expect(resultPositive.signatures[1].sig).not.toEqual(resultNegative.signatures[1].sig);

    // SIWS messages should be different
    expect(resultPositive.counterpartyMessage).not.toEqual(resultNegative.counterpartyMessage);
  });

  test("SIWS message contains human-readable content", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const result = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, Outcome.Positive);

    const messageText = new TextDecoder().decode(result.counterpartyMessage);

    // Should contain SATI header and outcome
    expect(messageText).toContain("SATI");
    expect(messageText).toContain("Positive");
  });
});

describe("verifyFeedbackSignatures", () => {
  test("valid signatures pass verification", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const outcome = Outcome.Neutral;

    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const signResult = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, outcome);

    const result = await verifyFeedbackSignatures(
      sasSchema,
      taskRef,
      agent.address,
      dataHash,
      outcome,
      signResult.signatures,
      signResult.counterpartyMessage,
    );

    expect(result.valid).toBe(true);
    expect(result.agentValid).toBe(true);
    expect(result.counterpartyValid).toBe(true);
  });

  test("wrong signature count fails", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();

    const agent = await createTestKeypair(1);

    const result = await verifyFeedbackSignatures(
      sasSchema,
      taskRef,
      agent.address,
      dataHash,
      Outcome.Positive,
      [], // No signatures
      new Uint8Array(0),
    );

    expect(result.valid).toBe(false);
  });

  test("swapped signatures fail", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const outcome = Outcome.Positive;

    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const signResult = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, outcome);

    // Swap the signatures
    const swappedSigs = [signResult.signatures[1], signResult.signatures[0]];

    const result = await verifyFeedbackSignatures(
      sasSchema,
      taskRef,
      agent.address,
      dataHash,
      outcome,
      swappedSigs,
      signResult.counterpartyMessage,
    );

    // Both should fail because signatures are bound to wrong messages
    expect(result.valid).toBe(false);
  });

  test("wrong counterparty message fails verification", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();

    const agent = await createTestKeypair(1);
    const wrongAgent = await createTestKeypair(99); // Different agent
    const counterparty = await createTestKeypair(2);

    // Create signatures for the original agent
    const signResult = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    // Try to verify with wrong tokenAccount
    // The counterparty signed for agent.address, not wrongAgent.address
    const result = await verifyFeedbackSignatures(
      sasSchema,
      taskRef,
      wrongAgent.address, // Wrong tokenAccount!
      dataHash,
      Outcome.Positive,
      signResult.signatures,
      signResult.counterpartyMessage,
    );

    expect(result.agentValid).toBe(true); // Agent signature is still valid
    expect(result.counterpartyValid).toBe(false); // Counterparty signed for different tokenAccount
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// Tests: Validation Signatures
// =============================================================================

describe("createValidationSignatures", () => {
  test("produces two signatures and counterparty message", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const validator = await createTestKeypair(2);

    const result = await createValidationSignatures(sasSchema, taskRef, agent, validator, dataHash, Outcome.Positive);

    expect(result.signatures).toHaveLength(2);
    expect(result.counterpartyMessage).toBeInstanceOf(Uint8Array);
  });

  test("validator signature verifies against SIWS message", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const validator = await createTestKeypair(2);

    const result = await createValidationSignatures(sasSchema, taskRef, agent, validator, dataHash, Outcome.Positive);

    const isValid = await verifySignature(result.counterpartyMessage, result.signatures[1].sig, validator.publicKey);

    expect(isValid).toBe(true);
  });

  test("different outcomes produce different validator signatures", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const validator = await createTestKeypair(2);

    const resultPositive = await createValidationSignatures(
      sasSchema,
      taskRef,
      agent,
      validator,
      dataHash,
      Outcome.Positive,
    );

    const resultNegative = await createValidationSignatures(
      sasSchema,
      taskRef,
      agent,
      validator,
      dataHash,
      Outcome.Negative,
    );

    // Agent signatures should be the same (blind)
    expect(resultPositive.signatures[0].sig).toEqual(resultNegative.signatures[0].sig);

    // Validator signatures should differ (outcome in SIWS message)
    expect(resultPositive.signatures[1].sig).not.toEqual(resultNegative.signatures[1].sig);
  });
});

// =============================================================================
// Tests: Reputation Signature
// =============================================================================

describe("createReputationSignature", () => {
  test("produces single signature (SingleSigner mode)", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const provider = await createTestKeypair(1);

    const signatures = await createReputationSignature(sasSchema, taskRef, dataHash, provider);

    expect(signatures).toHaveLength(1);
    expect(signatures[0].pubkey).toBe(provider.address);
  });

  test("provider signature verifies against interaction hash", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const provider = await createTestKeypair(1);

    const signatures = await createReputationSignature(sasSchema, taskRef, dataHash, provider);

    const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

    const isValid = await verifySignature(interactionHash, signatures[0].sig, provider.publicKey);

    expect(isValid).toBe(true);
  });

  test("different data hashes produce different signatures", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash1 = randomBytes32();
    const dataHash2 = randomBytes32();
    const provider = await createTestKeypair(1);

    const sig1 = await createReputationSignature(sasSchema, taskRef, dataHash1, provider);
    const sig2 = await createReputationSignature(sasSchema, taskRef, dataHash2, provider);

    expect(sig1[0].sig).not.toEqual(sig2[0].sig);
  });
});

// =============================================================================
// Tests: Test Keypair Utility
// =============================================================================

describe("createTestKeypair", () => {
  test("creates keypair with all required fields", async () => {
    const keypair = await createTestKeypair();

    expect(keypair.keyPair).toBeDefined();
    expect(keypair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keypair.publicKey.length).toBe(32);
    expect(typeof keypair.address).toBe("string");
  });

  test("deterministic keypairs with seed", async () => {
    const keypair1 = await createTestKeypair(42);
    const keypair2 = await createTestKeypair(42);

    expect(keypair1.address).toBe(keypair2.address);
    expect(keypair1.publicKey).toEqual(keypair2.publicKey);
  });

  test("different seeds produce different keypairs", async () => {
    const keypair1 = await createTestKeypair(1);
    const keypair2 = await createTestKeypair(2);

    expect(keypair1.address).not.toBe(keypair2.address);
  });

  test("random keypair without seed", async () => {
    const keypair1 = await createTestKeypair();
    const keypair2 = await createTestKeypair();

    expect(keypair1.address).not.toBe(keypair2.address);
  });

  test("seeded keypairs have seed property", async () => {
    const keypair = await createTestKeypair(5);

    expect(keypair.seed).toBeDefined();
    expect(keypair.seed).toBeInstanceOf(Uint8Array);
    expect(keypair.seed?.length).toBe(32);
  });

  test("random keypairs do not have seed property", async () => {
    const keypair = await createTestKeypair();

    expect(keypair.seed).toBeUndefined();
  });
});
