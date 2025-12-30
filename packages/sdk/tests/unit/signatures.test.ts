/**
 * Unit Tests for Ed25519 Signature Operations
 *
 * Tests the signature utilities using real Ed25519 cryptography
 * via @solana/kit's Web Crypto implementation, verifying that:
 * 1. Signatures are correctly generated and verifiable
 * 2. createFeedbackSignatures produces valid dual signatures
 * 3. Signature binding matches spec (agent->interaction, counterparty->feedback)
 * 4. Wrong keypairs fail verification
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
import {
  computeInteractionHash,
  computeFeedbackHash,
  computeValidationHash,
  computeReputationHash,
  Outcome,
} from "../../src/hashes";

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
  test("produces two signatures", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const signatures = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    expect(signatures).toHaveLength(2);
  });

  test("first signature is from agent", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const signatures = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    expect(signatures[0].pubkey).toBe(agent.address);
  });

  test("second signature is from counterparty", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const signatures = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    expect(signatures[1].pubkey).toBe(counterparty.address);
  });

  test("agent signature verifies against interaction hash", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const signatures = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    // Agent signs interaction hash (blind to outcome)
    const interactionHash = computeInteractionHash(sasSchema, taskRef, agent.address, dataHash);

    const isValid = await verifySignature(interactionHash, signatures[0].sig, agent.publicKey);

    expect(isValid).toBe(true);
  });

  test("counterparty signature verifies against feedback hash", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);
    const outcome = Outcome.Positive;

    const signatures = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, outcome);

    // Counterparty signs feedback hash (includes outcome)
    const feedbackHash = computeFeedbackHash(sasSchema, taskRef, agent.address, outcome);

    const isValid = await verifySignature(feedbackHash, signatures[1].sig, counterparty.publicKey);

    expect(isValid).toBe(true);
  });

  test("different outcomes produce different counterparty signatures", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    const sigPositive = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    const sigNegative = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Negative,
    );

    // Agent signatures should be the same (blind to outcome)
    expect(sigPositive[0].sig).toEqual(sigNegative[0].sig);

    // Counterparty signatures should be different (includes outcome)
    expect(sigPositive[1].sig).not.toEqual(sigNegative[1].sig);
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

    const signatures = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, outcome);

    const result = await verifyFeedbackSignatures(sasSchema, taskRef, agent.address, dataHash, outcome, signatures);

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

    const signatures = await createFeedbackSignatures(sasSchema, taskRef, agent, counterparty, dataHash, outcome);

    // Swap the signatures
    const swappedSigs = [signatures[1], signatures[0]];

    const result = await verifyFeedbackSignatures(sasSchema, taskRef, agent.address, dataHash, outcome, swappedSigs);

    // Both should fail because signatures are bound to wrong hashes
    expect(result.valid).toBe(false);
  });

  test("wrong outcome fails counterparty verification", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();

    const agent = await createTestKeypair(1);
    const counterparty = await createTestKeypair(2);

    // Create signatures for Positive outcome
    const signatures = await createFeedbackSignatures(
      sasSchema,
      taskRef,
      agent,
      counterparty,
      dataHash,
      Outcome.Positive,
    );

    // Verify with wrong outcome (Negative)
    const result = await verifyFeedbackSignatures(
      sasSchema,
      taskRef,
      agent.address,
      dataHash,
      Outcome.Negative, // Wrong outcome
      signatures,
    );

    expect(result.agentValid).toBe(true); // Agent didn't sign outcome
    expect(result.counterpartyValid).toBe(false); // Counterparty signed different outcome
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// Tests: Validation Signatures
// =============================================================================

describe("createValidationSignatures", () => {
  test("produces two signatures", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const validator = await createTestKeypair(2);

    const signatures = await createValidationSignatures(sasSchema, taskRef, agent, validator, dataHash, 85);

    expect(signatures).toHaveLength(2);
  });

  test("validator signature verifies against validation hash", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const validator = await createTestKeypair(2);
    const response = 95;

    const signatures = await createValidationSignatures(sasSchema, taskRef, agent, validator, dataHash, response);

    const validationHash = computeValidationHash(sasSchema, taskRef, agent.address, response);

    const isValid = await verifySignature(validationHash, signatures[1].sig, validator.publicKey);

    expect(isValid).toBe(true);
  });

  test("different response scores produce different validator signatures", async () => {
    const sasSchema = await randomAddress();
    const taskRef = randomBytes32();
    const dataHash = randomBytes32();
    const agent = await createTestKeypair(1);
    const validator = await createTestKeypair(2);

    const sig0 = await createValidationSignatures(sasSchema, taskRef, agent, validator, dataHash, 0);

    const sig100 = await createValidationSignatures(sasSchema, taskRef, agent, validator, dataHash, 100);

    // Agent signatures should be the same (blind)
    expect(sig0[0].sig).toEqual(sig100[0].sig);

    // Validator signatures should differ (includes response)
    expect(sig0[1].sig).not.toEqual(sig100[1].sig);
  });
});

// =============================================================================
// Tests: Reputation Signature
// =============================================================================

describe("createReputationSignature", () => {
  test("produces single signature (SingleSigner mode)", async () => {
    const sasSchema = await randomAddress();
    const agent = await createTestKeypair(1);
    const provider = await createTestKeypair(2);

    const signatures = await createReputationSignature(sasSchema, agent.address, provider, 75);

    expect(signatures).toHaveLength(1);
    expect(signatures[0].pubkey).toBe(provider.address);
  });

  test("provider signature verifies against reputation hash", async () => {
    const sasSchema = await randomAddress();
    const agent = await createTestKeypair(1);
    const provider = await createTestKeypair(2);
    const score = 90;

    const signatures = await createReputationSignature(sasSchema, agent.address, provider, score);

    const reputationHash = computeReputationHash(sasSchema, agent.address, provider.address, score);

    const isValid = await verifySignature(reputationHash, signatures[0].sig, provider.publicKey);

    expect(isValid).toBe(true);
  });

  test("different scores produce different signatures", async () => {
    const sasSchema = await randomAddress();
    const agent = await createTestKeypair(1);
    const provider = await createTestKeypair(2);

    const sig50 = await createReputationSignature(sasSchema, agent.address, provider, 50);
    const sig75 = await createReputationSignature(sasSchema, agent.address, provider, 75);

    expect(sig50[0].sig).not.toEqual(sig75[0].sig);
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
