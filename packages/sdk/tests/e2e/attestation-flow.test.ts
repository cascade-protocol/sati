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
 * ## Test Isolation Strategy
 *
 * This file uses TWO isolation patterns:
 *
 * 1. **Flow-based tests** ("E2E: Attestation Flow"):
 *    - Share a single `E2ETestContext` (agent, schema, lookup table)
 *    - Tests sequential operations on the same agent
 *    - Context is expensive to create (~5-10s): registering agent, schema, lookup table
 *    - Nested describes test the same agent's lifecycle
 *
 * 2. **Signature-only tests** (Validation, ReputationScore, Error Handling):
 *    - Use isolated `SignatureTestContext` via `setupSignatureTest()`
 *    - No RPC calls - pure cryptographic tests
 *    - Fast to create, each describe has its own keypairs
 *    - Complete isolation between test blocks
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
import { computeInteractionHash, Outcome } from "../../src/hashes";

// Import test helpers
import {
  createFeedbackSignatures,
  createValidationSignatures,
  createReputationSignature,
  createTestKeypair,
  verifySignature,
  randomBytes32,
  loadGlobalContext,
  setupSignatureTest,
  type TestKeypair,
  type GlobalTestContext,
  type SignatureTestContext,
} from "../helpers";

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_TIMEOUT = 60000; // 60s for network operations

// =============================================================================
// E2E Tests
// =============================================================================

/**
 * Flow-based E2E tests sharing a single context.
 * Tests sequential agent lifecycle: registration → schema → attestation → query.
 * Nested describes share state intentionally - they test the same agent.
 */
describe("E2E: Attestation Flow", () => {
  let ctx: GlobalTestContext;

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
    // Use global shared context - created once by globalSetup before all tests
    ctx = await loadGlobalContext();

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

    // Use the schema from global context - its schemaConfigPda is already in the lookup table
    // This is CRITICAL for transaction size (saves 32 bytes vs random schema)
    sasSchema = ctx.feedbackSchema;
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

        // NOTE: We don't update agentMint here because ctx.agentMint's ATA
        // is already in the lookup table (CRITICAL for transaction size).
        // This test just verifies agent registration works.
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Schema Configuration Tests
  // ---------------------------------------------------------------------------

  describe("Schema Configuration", () => {
    let testSchema: Address;

    test(
      "registers schema config for Feedback",
      async () => {
        // Use a random schema for this test (different from sasSchema used for attestations)
        // Random ensures no collisions between test runs
        const { generateKeyPairSigner } = await import("@solana/kit");
        const testSchemaKeypair = await generateKeyPairSigner();
        testSchema = testSchemaKeypair.address;

        const result = await sati.registerSchemaConfig({
          payer,
          authority,
          sasSchema: testSchema,
          signatureMode: 0, // DualSignature
          storageType: 0, // Compressed
          closeable: false,
          name: "TestFeedback",
        });

        expect(result).toHaveProperty("signature");
      },
      TEST_TIMEOUT,
    );

    test(
      "fetches registered schema config",
      async () => {
        const config = await sati.getSchemaConfig(testSchema);

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
        const signatures = await createFeedbackSignatures(
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
          agentSignature: {
            pubkey: signatures.signatures[0].pubkey,
            signature: signatures.signatures[0].sig,
          },
          counterpartySignature: {
            pubkey: signatures.signatures[1].pubkey,
            signature: signatures.signatures[1].sig,
          },
          counterpartyMessage: signatures.counterpartyMessage,
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
        const signatures = await createFeedbackSignatures(
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
              pubkey: signatures.signatures[0].pubkey,
              signature: signatures.signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: signatures.signatures[1].pubkey,
              signature: signatures.signatures[1].sig,
            },
            counterpartyMessage: signatures.counterpartyMessage,
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

        expect(Array.isArray(result.items)).toBe(true);
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

        expect(Array.isArray(result.items)).toBe(true);
        // All returned items should have positive outcome
        for (const item of result.items) {
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

/**
 * Isolated signature-only tests - each describe has its own SignatureTestContext.
 * No RPC calls, no shared state with other test blocks.
 * Tests validation attestation signature creation and verification.
 */
describe("E2E: Validation Attestation Flow", () => {
  let sigCtx: SignatureTestContext;

  beforeAll(async () => {
    // Isolated context: fresh keypairs, no RPC needed
    sigCtx = await setupSignatureTest(10);
  }, TEST_TIMEOUT);

  test(
    "creates validation attestation with real signatures",
    async () => {
      const { agentKeypair, validatorKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const outcome = Outcome.Positive; // Validation passed

      // Create real Ed25519 signatures
      const result = await createValidationSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        validatorKeypair,
        dataHash,
        outcome,
      );

      // Verify signatures were created correctly
      expect(result.signatures).toHaveLength(2);
      expect(result.signatures[0].pubkey).toBe(agentKeypair.address);
      expect(result.signatures[1].pubkey).toBe(validatorKeypair.address);
      expect(result.signatures[0].sig.length).toBe(64);
      expect(result.signatures[1].sig.length).toBe(64);

      // Verify agent signature is bound to interaction hash
      const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

      // Agent signature should verify against interaction hash
      const isValid = await verifySignature(interactionHash, result.signatures[0].sig, agentKeypair.publicKey);
      expect(isValid).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "different outcomes produce different validator signatures",
    async () => {
      const { agentKeypair, validatorKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      const sigPositive = await createValidationSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        validatorKeypair,
        dataHash,
        Outcome.Positive,
      );

      const sigNegative = await createValidationSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        validatorKeypair,
        dataHash,
        Outcome.Negative,
      );

      // Agent signatures should be same (blind to outcome)
      expect(sigPositive.signatures[0].sig).toEqual(sigNegative.signatures[0].sig);

      // Validator signatures should differ (signs SIWS message with outcome)
      expect(sigPositive.signatures[1].sig).not.toEqual(sigNegative.signatures[1].sig);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// E2E: ReputationScore Attestation Flow
// =============================================================================

/**
 * Isolated signature-only tests - each describe has its own SignatureTestContext.
 * No RPC calls, no shared state with other test blocks.
 * Tests SingleSigner mode reputation attestation signatures.
 */
describe("E2E: ReputationScore Attestation Flow", () => {
  let sigCtx: SignatureTestContext;

  beforeAll(async () => {
    // Isolated context: fresh keypairs, no RPC needed
    sigCtx = await setupSignatureTest(20);
  }, TEST_TIMEOUT);

  test(
    "creates reputation signature (SingleSigner mode)",
    async () => {
      const { providerKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // ReputationScore uses SingleSigner mode - only provider signs
      const signatures = await createReputationSignature(sasSchema, taskRef, dataHash, providerKeypair);

      // Only one signature (provider)
      expect(signatures).toHaveLength(1);
      expect(signatures[0].pubkey).toBe(providerKeypair.address);
      expect(signatures[0].sig.length).toBe(64);

      // Verify signature is bound to interaction hash
      const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

      const isValid = await verifySignature(interactionHash, signatures[0].sig, providerKeypair.publicKey);
      expect(isValid).toBe(true);
    },
    TEST_TIMEOUT,
  );

  test(
    "different dataHash produce different signatures",
    async () => {
      const { providerKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash1 = randomBytes32();
      const dataHash2 = randomBytes32();

      const sig1 = await createReputationSignature(sasSchema, taskRef, dataHash1, providerKeypair);
      const sig2 = await createReputationSignature(sasSchema, taskRef, dataHash2, providerKeypair);

      // Different dataHash should produce different signatures
      expect(sig1[0].sig).not.toEqual(sig2[0].sig);
    },
    TEST_TIMEOUT,
  );

  test(
    "signature uniqueness per taskRef",
    async () => {
      const { providerKeypair, sasSchema } = sigCtx;
      const taskRef1 = randomBytes32();
      const taskRef2 = randomBytes32();
      const dataHash = randomBytes32();

      const sig1 = await createReputationSignature(sasSchema, taskRef1, dataHash, providerKeypair);
      const sig2 = await createReputationSignature(sasSchema, taskRef2, dataHash, providerKeypair);

      // Same dataHash but different taskRef should produce different signatures
      expect(sig1[0].sig).not.toEqual(sig2[0].sig);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// E2E: Error Handling
// =============================================================================

/**
 * Isolated signature-only tests - each describe has its own SignatureTestContext.
 * No RPC calls, no shared state with other test blocks.
 * Tests signature error detection: tampering, wrong signer, wrong hash.
 */
describe("E2E: Error Handling", () => {
  let sigCtx: SignatureTestContext;

  beforeAll(async () => {
    // Isolated context: fresh keypairs, no RPC needed
    sigCtx = await setupSignatureTest(40);
  }, TEST_TIMEOUT);

  test(
    "detects tampered signature",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const outcome = Outcome.Positive;

      // Create valid signatures
      const result = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        outcome,
      );

      // Tamper with the signature
      const tamperedSig = new Uint8Array(result.signatures[0].sig);
      tamperedSig[0] ^= 0xff; // Flip bits

      // Verification should fail
      const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

      const isValid = await verifySignature(interactionHash, tamperedSig, agentKeypair.publicKey);
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "detects wrong signer",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const wrongKeypair = await createTestKeypair(99);

      // Create signatures with correct keypairs
      const result = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Try to verify with wrong public key
      const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

      const isValid = await verifySignature(
        interactionHash,
        result.signatures[0].sig,
        wrongKeypair.publicKey, // Wrong key!
      );
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "detects wrong message hash",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      const result = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Try to verify against different taskRef
      const wrongTaskRef = randomBytes32();
      const wrongHash = computeInteractionHash(sasSchema, wrongTaskRef, dataHash);

      const isValid = await verifySignature(wrongHash, result.signatures[0].sig, agentKeypair.publicKey);
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "validates signature count for DualSignature mode",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const { verifyFeedbackSignatures } = await import("../helpers/signatures");

      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // Create valid signatures
      const result = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Verify with only one signature should fail
      const verifyResult = await verifyFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair.address,
        dataHash,
        Outcome.Positive,
        [result.signatures[0]], // Only one signature!
        result.counterpartyMessage,
      );

      expect(verifyResult.valid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "validates swapped signatures fail",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const { verifyFeedbackSignatures } = await import("../helpers/signatures");

      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      const result = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Swap the signatures
      const swapped = [result.signatures[1], result.signatures[0]];

      const verifyResult = await verifyFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair.address,
        dataHash,
        Outcome.Positive,
        swapped,
        result.counterpartyMessage,
      );

      expect(verifyResult.valid).toBe(false);
    },
    TEST_TIMEOUT,
  );
});
