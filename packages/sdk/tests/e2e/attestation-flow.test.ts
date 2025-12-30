/**
 * E2E Tests for SATI Attestation Flow
 *
 * Tests the full attestation lifecycle:
 * 1. Agent registration → Token-2022 NFT
 * 2. Schema configuration registration
 * 3. Agent signs interaction hash (blind)
 * 4. Client signs feedback hash (with outcome)
 * 5. Attestation submitted and indexed
 * 6. Query returns correct data
 *
 * Prerequisites:
 * - light test-validator (or devnet with HELIUS_API_KEY)
 * - SATI program deployed
 *
 * Run: pnpm test:e2e
 */

import { describe, test, expect, beforeAll } from "vitest";
import type { KeyPairSigner, Address } from "@solana/kit";
import type { Sati } from "../../src";
import { computeInteractionHash, computeValidationHash, computeReputationHash, Outcome } from "../../src/hashes";

// Import test helpers
import {
  createFeedbackSignatures,
  createValidationSignatures,
  createReputationSignature,
  createTestKeypair,
  randomBytes32,
  setupE2ETest,
  type TestKeypair,
  type E2ETestContext,
} from "../helpers";

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_TIMEOUT = 60000; // 60s for network operations

// =============================================================================
// E2E Tests
// =============================================================================

describe("E2E: Attestation Flow", () => {
  let ctx: E2ETestContext;

  // Aliases for cleaner test code
  let sati: Sati;
  let payer: KeyPairSigner;
  let authority: KeyPairSigner;
  let agentOwner: KeyPairSigner;
  let counterparty: KeyPairSigner;
  let sasSchema: Address;
  let agentMint: Address;
  let lookupTableAddress: Address;
  let agentOwnerKeypair: TestKeypair;
  let counterpartyKeypair: TestKeypair;

  beforeAll(async () => {
    // Use shared test setup - handles SDK init, keypairs, agent/schema registration, lookup table
    ctx = await setupE2ETest();

    // Create aliases for cleaner test code
    sati = ctx.sati;
    payer = ctx.payer;
    authority = ctx.authority;
    agentOwner = ctx.agentOwner;
    counterparty = ctx.counterparty;
    agentMint = ctx.agentMint;
    lookupTableAddress = ctx.lookupTableAddress;
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    counterpartyKeypair = ctx.counterpartyKeypair;

    // Generate random SAS schema for this test suite (separate from ctx.feedbackSchema)
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Registry Tests
  // ---------------------------------------------------------------------------

  describe("Registry Operations", () => {
    test(
      "fetches registry stats",
      async () => {
        const stats = await sati.getRegistryStats();
        expect(stats).toHaveProperty("totalAgents");
        expect(stats).toHaveProperty("groupMint");
        expect(stats).toHaveProperty("authority");
      },
      TEST_TIMEOUT,
    );

    test(
      "registers an agent (mints Token-2022 NFT)",
      async () => {
        const name = `TestAgent-${Date.now()}`;
        const metadataUri = "https://example.com/metadata.json";

        const result = await sati.registerAgent({
          payer,
          owner: agentOwner.address,
          name,
          uri: metadataUri,
        });

        expect(result).toHaveProperty("mint");
        expect(result).toHaveProperty("memberNumber");
        expect(result).toHaveProperty("signature");

        agentMint = result.mint;
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Schema Configuration Tests
  // ---------------------------------------------------------------------------

  describe("Schema Configuration", () => {
    test(
      "registers schema config for Feedback",
      async () => {
        const result = await sati.registerSchemaConfig({
          payer,
          authority,
          sasSchema,
          signatureMode: 0, // DualSignature
          storageType: 0, // Compressed
          closeable: false,
        });

        expect(result).toHaveProperty("signature");
      },
      TEST_TIMEOUT,
    );

    test(
      "fetches registered schema config",
      async () => {
        const config = await sati.getSchemaConfig(sasSchema);

        expect(config).not.toBeNull();
        if (config) {
          expect(config.signatureMode).toBe(0);
          expect(config.storageType).toBe(0);
          expect(config.closeable).toBe(false);
        }
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Feedback Attestation Flow
  // ---------------------------------------------------------------------------

  describe("Feedback Attestation", () => {
    test(
      "creates feedback with real Ed25519 signatures",
      async () => {
        // Skip if agent not registered
        if (!agentMint) return;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();
        const outcome = Outcome.Positive;

        // tokenAccount = agent's MINT address (stable identity)
        // agentOwnerKeypair = NFT owner (signer) - on-chain verifies via ATA ownership
        const tokenAccount = agentMint;

        // Create real Ed25519 signatures using the helper
        // Agent OWNER signs interaction hash (blind - doesn't know outcome)
        // Counterparty signs feedback hash (includes outcome)
        // Hashes include mint address; signatures come from owner
        const signatures = createFeedbackSignatures(
          sasSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          outcome,
          tokenAccount, // Pass mint address explicitly
        );

        // Submit attestation with real signatures
        const result = await sati.createFeedback({
          payer,
          sasSchema,
          tokenAccount,
          counterparty: counterparty.address,
          taskRef,
          dataHash,
          outcome,
          tag1: "quality",
          tag2: "speed",
          agentSignature: {
            pubkey: signatures[0].pubkey,
            signature: signatures[0].sig,
          },
          counterpartySignature: {
            pubkey: signatures[1].pubkey,
            signature: signatures[1].sig,
          },
          lookupTableAddress,
        });

        expect(result).toHaveProperty("address");
        expect(result).toHaveProperty("signature");
      },
      TEST_TIMEOUT,
    );

    test(
      "rejects feedback with mismatched outcome in signature",
      async () => {
        if (!agentMint) return;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // tokenAccount = agent's MINT address (stable identity)
        const tokenAccount = agentMint;

        // Sign for Positive outcome
        const signatures = createFeedbackSignatures(
          sasSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Positive,
          tokenAccount, // Pass mint address explicitly
        );

        // But submit with Negative outcome - should fail on-chain
        await expect(
          sati.createFeedback({
            payer,
            sasSchema,
            tokenAccount,
            counterparty: counterparty.address,
            taskRef,
            dataHash,
            outcome: Outcome.Negative, // Mismatch!
            agentSignature: {
              pubkey: signatures[0].pubkey,
              signature: signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: signatures[1].pubkey,
              signature: signatures[1].sig,
            },
            lookupTableAddress,
          }),
        ).rejects.toThrow(); // Should fail signature verification
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Query Tests
  // ---------------------------------------------------------------------------

  describe("Attestation Queries", () => {
    test(
      "queries feedbacks by token account",
      async () => {
        if (!agentMint) return;

        // tokenAccount = agent's MINT address (stable identity)
        const tokenAccount = agentMint;

        // listFeedbacks takes filter object with tokenAccount
        const result = await sati.listFeedbacks({ tokenAccount });

        expect(Array.isArray(result)).toBe(true);
      },
      TEST_TIMEOUT,
    );

    test(
      "queries feedbacks by outcome filter",
      async () => {
        if (!agentMint) return;

        // tokenAccount = agent's MINT address (stable identity)
        const tokenAccount = agentMint;

        const result = await sati.listFeedbacks({
          tokenAccount,
          outcome: Outcome.Positive,
        });

        expect(Array.isArray(result)).toBe(true);
        // All returned items should have positive outcome
        for (const item of result) {
          if (item.data.outcome !== undefined) {
            expect(item.data.outcome).toBe(Outcome.Positive);
          }
        }
      },
      TEST_TIMEOUT,
    );
  });
});

// =============================================================================
// E2E: Validation Attestation Flow
// =============================================================================

describe("E2E: Validation Attestation Flow", () => {
  let agentKeypair: TestKeypair;
  let validatorKeypair: TestKeypair;
  let sasSchema: Address;

  beforeAll(async () => {
    // These tests only verify signature creation/verification - no chain submission
    agentKeypair = createTestKeypair(10);
    validatorKeypair = createTestKeypair(11);
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  test(
    "creates validation attestation with real signatures",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const response = 95; // High validation score

      // In a real test with registered agent:
      // const tokenAccount = address(...);

      // For now, use the agent keypair address as token account stand-in
      const tokenAccount = agentKeypair.address;

      // Create real Ed25519 signatures
      const signatures = createValidationSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        validatorKeypair,
        dataHash,
        response,
      );

      // Verify signatures were created correctly
      expect(signatures).toHaveLength(2);
      expect(signatures[0].pubkey).toBe(agentKeypair.address);
      expect(signatures[1].pubkey).toBe(validatorKeypair.address);
      expect(signatures[0].sig.length).toBe(64);
      expect(signatures[1].sig.length).toBe(64);

      // Verify validator signature is bound to response score
      const validationHash = computeValidationHash(sasSchema, taskRef, tokenAccount, response);

      // Validator signature should verify against validation hash
      const { verifySignature } = await import("../helpers/signatures");
      const isValid = verifySignature(validationHash, signatures[1].sig, validatorKeypair.publicKey);
      expect(isValid).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "different response scores produce different validator signatures",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      const sig50 = createValidationSignatures(sasSchema, taskRef, agentKeypair, validatorKeypair, dataHash, 50);

      const sig100 = createValidationSignatures(sasSchema, taskRef, agentKeypair, validatorKeypair, dataHash, 100);

      // Agent signatures should be same (blind to response)
      expect(sig50[0].sig).toEqual(sig100[0].sig);

      // Validator signatures should differ (includes response)
      expect(sig50[1].sig).not.toEqual(sig100[1].sig);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// E2E: ReputationScore Attestation Flow
// =============================================================================

describe("E2E: ReputationScore Attestation Flow", () => {
  let providerKeypair: TestKeypair;
  let agentKeypair: TestKeypair;
  let sasSchema: Address;

  beforeAll(async () => {
    // These tests only verify signature creation/verification - no chain submission
    providerKeypair = createTestKeypair(20);
    agentKeypair = createTestKeypair(21);
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  test(
    "creates reputation signature (SingleSigner mode)",
    async () => {
      const score = 85;

      // ReputationScore uses SingleSigner mode - only provider signs
      const signatures = createReputationSignature(sasSchema, agentKeypair.address, providerKeypair, score);

      // Only one signature (provider)
      expect(signatures).toHaveLength(1);
      expect(signatures[0].pubkey).toBe(providerKeypair.address);
      expect(signatures[0].sig.length).toBe(64);

      // Verify signature is bound to score
      const reputationHash = computeReputationHash(sasSchema, agentKeypair.address, providerKeypair.address, score);

      const { verifySignature } = await import("../helpers/signatures");
      const isValid = verifySignature(reputationHash, signatures[0].sig, providerKeypair.publicKey);
      expect(isValid).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "different scores produce different signatures",
    async () => {
      const sig50 = createReputationSignature(sasSchema, agentKeypair.address, providerKeypair, 50);

      const sig90 = createReputationSignature(sasSchema, agentKeypair.address, providerKeypair, 90);

      // Different scores should produce different signatures
      expect(sig50[0].sig).not.toEqual(sig90[0].sig);
    },
    TEST_TIMEOUT,
  );

  test(
    "signature uniqueness per (provider, agent) pair",
    async () => {
      const agent1 = createTestKeypair(30);
      const agent2 = createTestKeypair(31);
      const score = 75;

      const sig1 = createReputationSignature(sasSchema, agent1.address, providerKeypair, score);

      const sig2 = createReputationSignature(sasSchema, agent2.address, providerKeypair, score);

      // Same score but different agents should produce different signatures
      expect(sig1[0].sig).not.toEqual(sig2[0].sig);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// E2E: Error Handling
// =============================================================================

describe("E2E: Error Handling", () => {
  let agentKeypair: TestKeypair;
  let counterpartyKeypair: TestKeypair;
  let sasSchema: Address;

  beforeAll(async () => {
    // These tests only verify signature error cases - no chain submission
    agentKeypair = createTestKeypair(40);
    counterpartyKeypair = createTestKeypair(41);
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  test(
    "detects tampered signature",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const outcome = Outcome.Positive;

      // Create valid signatures
      const signatures = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        outcome,
      );

      // Tamper with the signature
      const tamperedSig = new Uint8Array(signatures[0].sig);
      tamperedSig[0] ^= 0xff; // Flip bits

      // Verification should fail
      const { verifySignature } = await import("../helpers/signatures");
      const interactionHash = computeInteractionHash(sasSchema, taskRef, agentKeypair.address, dataHash);

      const isValid = verifySignature(interactionHash, tamperedSig, agentKeypair.publicKey);
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "detects wrong signer",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const wrongKeypair = createTestKeypair(99);

      // Create signatures with wrong keypair
      const signatures = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Try to verify with wrong public key
      const { verifySignature } = await import("../helpers/signatures");
      const interactionHash = computeInteractionHash(sasSchema, taskRef, agentKeypair.address, dataHash);

      const isValid = verifySignature(
        interactionHash,
        signatures[0].sig,
        wrongKeypair.publicKey, // Wrong key!
      );
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "detects wrong message hash",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      const signatures = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Try to verify against different taskRef
      const wrongTaskRef = randomBytes32();
      const wrongHash = computeInteractionHash(
        sasSchema,
        wrongTaskRef, // Different!
        agentKeypair.address,
        dataHash,
      );

      const { verifySignature } = await import("../helpers/signatures");
      const isValid = verifySignature(wrongHash, signatures[0].sig, agentKeypair.publicKey);
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "validates signature count for DualSignature mode",
    async () => {
      // DualSignature mode requires exactly 2 signatures
      const { verifyFeedbackSignatures } = await import("../helpers/signatures");

      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // Create valid signatures
      const signatures = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Verify with only one signature should fail
      const result = verifyFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair.address,
        dataHash,
        Outcome.Positive,
        [signatures[0]], // Only one signature!
      );

      expect(result.valid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "validates swapped signatures fail",
    async () => {
      const { verifyFeedbackSignatures } = await import("../helpers/signatures");

      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      const signatures = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Swap the signatures
      const swapped = [signatures[1], signatures[0]];

      const result = verifyFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair.address,
        dataHash,
        Outcome.Positive,
        swapped,
      );

      expect(result.valid).toBe(false);
    },
    TEST_TIMEOUT,
  );
});
