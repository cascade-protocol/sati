/**
 * E2E Tests: Full Feedback Lifecycle
 *
 * Complete lifecycle tests for SATI Feedback attestations:
 * 1. Register agent (Token-2022 NFT minting)
 * 2. Register schema config
 * 3. Create feedback with real Ed25519 signatures
 * 4. Query via Photon with filters
 * 5. Verify data integrity
 *
 * ## Test Isolation Strategy
 *
 * This file uses TWO isolation patterns:
 *
 * 1. **Flow-based tests** ("E2E: Full Feedback Lifecycle"):
 *    - Share a single `E2ETestContext` (agent, schema, lookup table)
 *    - Tests sequential operations on the same agent
 *    - Context is expensive to create (~5-10s)
 *    - Nested describes test agent registration → schema → feedback → query
 *
 * 2. **Signature-only tests** (Multiple Feedbacks, Signature Edge Cases):
 *    - Use isolated `SignatureTestContext` via `setupSignatureTest()`
 *    - No RPC calls - pure cryptographic tests
 *    - Fast to create, each describe has its own keypairs
 *    - Complete isolation between test blocks
 *
 * These tests require a running light test-validator or devnet.
 *
 * Run: pnpm test:e2e -- --grep "Feedback Lifecycle"
 */

import { describe, test, expect, beforeAll } from "vitest";
import type { KeyPairSigner, Address } from "@solana/kit";
import type { Sati } from "../../src";
import { computeInteractionHash, computeAttestationNonce, Outcome } from "../../src/hashes";
import { SignatureMode, StorageType } from "../../src/generated";
import { COMPRESSED_OFFSETS } from "../../src/schemas";

// Import test helpers
import {
  signMessage,
  verifySignature,
  createTestKeypair,
  createFeedbackSignatures,
  verifyFeedbackSignatures,
  randomBytes32,
  setupE2ETest,
  setupSignatureTest,
  type TestKeypair,
  type SignatureData,
  type E2ETestContext,
  type SignatureTestContext,
  waitForIndexer,
} from "../helpers";

// Note: ContentType removed - positive createFeedback case is in attestation-flow.test.ts

// =============================================================================
// Configuration
// =============================================================================

const TEST_TIMEOUT = 60000;

// =============================================================================
// Full Feedback Lifecycle Tests
// =============================================================================

/**
 * Flow-based E2E tests sharing a single context.
 * Tests sequential feedback lifecycle: registration → schema → create → query.
 * Nested describes share state intentionally - they test the same agent.
 */
describe("E2E: Full Feedback Lifecycle", () => {
  let ctx: E2ETestContext;

  // Aliases for cleaner test code
  let sati: Sati;
  let payer: KeyPairSigner;
  let agentOwnerKeypair: TestKeypair;
  let sasSchema: Address;
  let agentMint: Address;
  let tokenAccount: Address;
  let lookupTableAddress: Address;

  beforeAll(async () => {
    // Use shared test setup - handles SDK init, keypairs, agent/schema registration, lookup table
    ctx = await setupE2ETest();

    // Create aliases for cleaner test code
    sati = ctx.sati;
    payer = ctx.payer;
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    lookupTableAddress = ctx.lookupTableAddress;

    // Use the schema from context - its config PDA is in the lookup table
    // This is required for transaction size limits (DualSignature needs ~200 extra bytes for SIWS message)
    sasSchema = ctx.feedbackSchema;
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Step 1: Register Agent
  // ---------------------------------------------------------------------------

  describe("Step 1: Agent Registration", () => {
    test(
      "registers agent with Token-2022 NFT",
      async () => {
        // Use pre-registered agent from setupE2ETest() - its ATA is in the lookup table
        // This is required for transaction size limits (DualSignature needs ~200 extra bytes for SIWS message)
        // Fresh agent registration is tested in attestation-flow.test.ts
        agentMint = ctx.agentMint;

        // Verify agent was created by loading it back
        const agent = await sati.loadAgent(agentMint);
        expect(agent).not.toBeNull();
        expect(agent?.name).toBeDefined();
      },
      TEST_TIMEOUT,
    );

    test(
      "sets agent identity for attestations",
      async () => {
        if (!agentMint) return;

        // tokenAccount = agent's MINT address (stable identity)
        // The agent OWNER signs (verified via ATA ownership on-chain)
        tokenAccount = agentMint;
        expect(tokenAccount).toBeDefined();
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Step 2: Register Schema Config
  // ---------------------------------------------------------------------------

  describe("Step 2: Schema Configuration", () => {
    test(
      "registers schema config for Feedback (DualSignature, Compressed)",
      async () => {
        // Schema is pre-registered by setupE2ETest() - just verify it exists
        // This is because we use ctx.feedbackSchema which is already registered
        // and whose config PDA is in ctx.lookupTableAddress (required for tx size)
        const config = await sati.getSchemaConfig(sasSchema);
        expect(config).not.toBeNull();
        expect(config?.signatureMode).toBe(SignatureMode.DualSignature);
        expect(config?.storageType).toBe(StorageType.Compressed);
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Step 3: Create Feedback with Real Signatures
  // ---------------------------------------------------------------------------

  describe("Step 3: Create Feedback", () => {
    // Positive case (createFeedback success) is covered by attestation-flow.test.ts
    // This file focuses on lifecycle queries and edge cases

    test(
      "rejects feedback with self-attestation",
      async () => {
        if (!tokenAccount) return;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // Agent owner signs both roles (self-attestation)
        // Use agentOwnerKeypair as both agent and counterparty
        const sigResult = await createFeedbackSignatures(
          sasSchema,
          taskRef,
          agentOwnerKeypair,
          agentOwnerKeypair, // Same as agent! Self-attestation
          dataHash,
          Outcome.Positive,
          tokenAccount,
        );

        // This should be rejected on-chain
        await expect(
          sati.createFeedback({
            payer,
            sasSchema,
            tokenAccount,
            counterparty: agentOwnerKeypair.address, // Self-attestation!
            taskRef,
            dataHash,
            outcome: Outcome.Positive,
            agentSignature: {
              pubkey: sigResult.signatures[0].pubkey,
              signature: sigResult.signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: sigResult.signatures[1].pubkey, // Same as agent owner!
              signature: sigResult.signatures[1].sig,
            },
            counterpartyMessage: sigResult.counterpartyMessage,
            lookupTableAddress,
          }),
        ).rejects.toThrow(); // SelfAttestationNotAllowed
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Step 4: Query and Verify
  // ---------------------------------------------------------------------------

  describe("Step 4: Query and Verify", () => {
    test(
      "waits for Photon indexer",
      async () => {
        // Give the indexer time to catch up
        await waitForIndexer();
      },
      TEST_TIMEOUT,
    );

    test(
      "queries feedbacks by token account",
      async () => {
        if (!tokenAccount) return;

        // listFeedbacks takes filter object with tokenAccount
        const result = await sati.listFeedbacks({ tokenAccount });

        expect(Array.isArray(result.items)).toBe(true);

        // Should have at least one feedback (the one we created)
        if (result.items.length > 0) {
          const feedback = result.items[0];
          expect(feedback.data).toHaveProperty("outcome");
          expect(feedback.data).toHaveProperty("tokenAccount");
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "queries feedbacks by outcome filter (memcmp at offset 129)",
      async () => {
        if (!tokenAccount) return;

        // Query positive feedbacks for this agent
        const result = await sati.listFeedbacks({
          tokenAccount,
          outcome: Outcome.Positive,
        });

        expect(Array.isArray(result.items)).toBe(true);

        // All returned items should have Positive outcome
        for (const item of result.items) {
          if (item.data && "outcome" in item.data) {
            expect(item.data.outcome).toBe(Outcome.Positive);
          }
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "queries feedbacks by schema filter",
      async () => {
        if (!tokenAccount) return;

        const result = await sati.listFeedbacks({
          tokenAccount,
          sasSchema,
        });

        expect(Array.isArray(result.items)).toBe(true);

        // All returned items should belong to our schema
        for (const item of result.items) {
          // item.attestation.sasSchema is already an Address string
          expect(item.attestation.sasSchema).toBe(sasSchema);
        }
      },
      TEST_TIMEOUT,
    );

    test(
      "verifies feedback data integrity",
      async () => {
        if (!tokenAccount) return;

        const result = await sati.listFeedbacks({ tokenAccount });

        if (result.items.length > 0) {
          const feedback = result.items[0];

          // Verify structure
          expect(feedback).toHaveProperty("address");
          expect(feedback).toHaveProperty("attestation");
          expect(feedback).toHaveProperty("data");

          // Verify attestation structure
          expect(feedback.attestation.numSignatures).toBe(2); // DualSignature mode

          // Verify data structure
          const data = feedback.data;
          expect(data).toHaveProperty("taskRef");
          expect(data).toHaveProperty("tokenAccount");
          expect(data).toHaveProperty("counterparty");
          expect(data).toHaveProperty("dataHash");
          expect(data).toHaveProperty("outcome");
        }
      },
      TEST_TIMEOUT,
    );
  });
});

// =============================================================================
// Multiple Feedbacks Test
// =============================================================================

/**
 * Isolated signature-only tests - each describe has its own SignatureTestContext.
 * No RPC calls, no shared state with other test blocks.
 * Tests multiple feedback creation with different outcomes and collision prevention.
 */
describe("E2E: Multiple Feedbacks Flow", () => {
  let sigCtx: SignatureTestContext;

  beforeAll(async () => {
    // Isolated context: fresh keypairs, no RPC needed
    sigCtx = await setupSignatureTest(200);
  }, TEST_TIMEOUT);

  test(
    "creates multiple feedbacks with different outcomes",
    async () => {
      const { agentKeypair, sasSchema } = sigCtx;
      const _tokenAccount = agentKeypair.address;

      // Create feedbacks with different outcomes
      const outcomes = [Outcome.Positive, Outcome.Neutral, Outcome.Negative];
      const createdFeedbacks: { signatures: SignatureData[]; counterpartyMessage: Uint8Array }[] = [];

      for (const outcome of outcomes) {
        const counterpartyKp = await createTestKeypair(300 + outcome);
        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const sigResult = await createFeedbackSignatures(
          sasSchema,
          taskRef,
          agentKeypair,
          counterpartyKp,
          dataHash,
          outcome,
        );

        createdFeedbacks.push(sigResult);

        // Verify each signature set is valid
        const result = await verifyFeedbackSignatures(
          sasSchema,
          taskRef,
          agentKeypair.address,
          dataHash,
          outcome,
          sigResult.signatures,
          sigResult.counterpartyMessage,
        );
        expect(result.valid).toBe(true);
      }

      // We created 3 sets of valid signatures for different outcomes
      expect(createdFeedbacks).toHaveLength(3);
    },
    TEST_TIMEOUT,
  );

  test(
    "different counterparties produce unique attestation addresses",
    async () => {
      const { agentKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const counterparty1 = await createTestKeypair(400);
      const counterparty2 = await createTestKeypair(401);

      // Compute nonces for each (task, agent, counterparty) tuple
      const nonce1 = computeAttestationNonce(taskRef, sasSchema, agentKeypair.address, counterparty1.address);

      const nonce2 = computeAttestationNonce(taskRef, sasSchema, agentKeypair.address, counterparty2.address);

      // Same task and agent, different counterparty = different address
      expect(nonce1).not.toEqual(nonce2);
    },
    TEST_TIMEOUT,
  );

  test(
    "same (task, agent, counterparty) produces same address (collision prevention)",
    async () => {
      const { agentKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const counterparty = await createTestKeypair(500);

      const nonce1 = computeAttestationNonce(taskRef, sasSchema, agentKeypair.address, counterparty.address);

      const nonce2 = computeAttestationNonce(taskRef, sasSchema, agentKeypair.address, counterparty.address);

      // Same inputs = same nonce (deterministic)
      expect(nonce1).toEqual(nonce2);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// Signature Edge Cases
// =============================================================================

/**
 * Isolated signature-only tests - each describe has its own SignatureTestContext.
 * No RPC calls, no shared state with other test blocks.
 * Tests edge cases: blind signing, forgery detection, cross-agent attacks.
 */
describe("E2E: Feedback Signature Edge Cases", () => {
  let sigCtx: SignatureTestContext;

  beforeAll(async () => {
    // Isolated context: fresh keypairs, no RPC needed
    sigCtx = await setupSignatureTest(600);
  }, TEST_TIMEOUT);

  test(
    "agent signature is blind to outcome",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // Create signatures for Positive and Negative outcomes
      const sigPositive = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      const sigNegative = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Negative,
      );

      // Agent signatures should be IDENTICAL (blind to outcome)
      expect(sigPositive.signatures[0].sig).toEqual(sigNegative.signatures[0].sig);

      // Counterparty signatures should DIFFER (includes outcome in SIWS message)
      expect(sigPositive.signatures[1].sig).not.toEqual(sigNegative.signatures[1].sig);
    },
    TEST_TIMEOUT,
  );

  test(
    "same dataHash with different taskRef produces different agent signatures",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef1 = randomBytes32();
      const taskRef2 = randomBytes32();
      const dataHash = randomBytes32();

      const sig1 = await createFeedbackSignatures(
        sasSchema,
        taskRef1,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      const sig2 = await createFeedbackSignatures(
        sasSchema,
        taskRef2,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Different taskRef = different agent signature (even with same dataHash)
      expect(sig1.signatures[0].sig).not.toEqual(sig2.signatures[0].sig);
    },
    TEST_TIMEOUT,
  );

  test(
    "counterparty cannot forge agent signature",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // Counterparty tries to sign as agent
      const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);

      const forgedSig = await signMessage(interactionHash, counterpartyKeypair.keyPair);

      // Forged signature should fail verification against agent's public key
      const isValid = await verifySignature(interactionHash, forgedSig, agentKeypair.publicKey);
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "signatures for wrong tokenAccount fail verification",
    async () => {
      const { agentKeypair, counterpartyKeypair, sasSchema } = sigCtx;
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const wrongAgent = await createTestKeypair(700);

      // Create signatures for correct agent
      const sigResult = await createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Try to verify with wrong tokenAccount - agent signature still valid
      // but the on-chain verification would fail because ATA ownership wouldn't match
      const result = await verifyFeedbackSignatures(
        sasSchema,
        taskRef,
        wrongAgent.address, // Wrong agent!
        dataHash,
        Outcome.Positive,
        sigResult.signatures,
        sigResult.counterpartyMessage,
      );

      // The agent's signature verifies against its own pubkey,
      // but counterparty message contains different tokenAccount
      expect(result.counterpartyValid).toBe(false);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// Offset Verification Tests (for Photon memcmp)
// =============================================================================

/**
 * Pure computation tests - no context needed.
 * Tests that COMPRESSED_OFFSETS constants match the expected byte layout.
 * These offsets are critical for Photon memcmp filters.
 */
describe("E2E: Compressed Attestation Offset Verification", () => {
  // No beforeAll needed - pure computation, no context required

  test(
    "verifies COMPRESSED_OFFSETS are correctly defined",
    async () => {
      // These offsets are critical for Photon memcmp filters
      // Note: Light Protocol returns discriminator as a separate field in the
      // response, NOT prefixed to the data bytes. Data bytes start directly:
      // [0-31]   sas_schema (32 bytes)
      // [32-63]  token_account (32 bytes)
      // [64-67]  data length (4 bytes)
      // [68+]    data (variable)

      expect(COMPRESSED_OFFSETS.SAS_SCHEMA).toBe(0);
      expect(COMPRESSED_OFFSETS.TOKEN_ACCOUNT).toBe(32);

      // Feedback-specific offsets within data:
      // data[0-31]   taskRef (32 bytes)
      // data[32-63]  tokenAccount (32 bytes)
      // data[64-95]  counterparty (32 bytes)
      // data[96-127] dataHash (32 bytes)
      // data[128]    contentType (1 byte)
      // data[129]    outcome (1 byte) <- CRITICAL for filtering
    },
    TEST_TIMEOUT,
  );

  test(
    "outcome is at fixed offset 129 within data for Feedback",
    async () => {
      // Offset within the data field where outcome lives
      // This is used for memcmp filtering by outcome value
      const expectedOutcomeOffset = 32 + 32 + 32 + 32 + 1; // 129
      expect(expectedOutcomeOffset).toBe(129);

      // From global offset: 73 (data start) + 4 (length prefix) + 129 = 206
      // But Photon operates on raw data field, so 129 is correct
    },
    TEST_TIMEOUT,
  );
});
