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
 * These tests require a running light test-validator or devnet.
 *
 * Run: pnpm test:e2e -- --grep "Feedback Lifecycle"
 */

import { describe, test, expect, beforeAll } from "vitest";
import type { KeyPairSigner, Address } from "@solana/kit";
import type { Sati } from "../../src";
import { computeInteractionHash, computeFeedbackHash, computeAttestationNonce, Outcome } from "../../src/hashes";
import { DataType, ContentType, SignatureMode, StorageType } from "../../src/schemas";
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
  type TestKeypair,
  type SignatureData,
  type E2ETestContext,
  waitForIndexer,
} from "../helpers";

// =============================================================================
// Configuration
// =============================================================================

const TEST_TIMEOUT = 60000;

// =============================================================================
// Full Feedback Lifecycle Tests
// =============================================================================

describe("E2E: Full Feedback Lifecycle", () => {
  let ctx: E2ETestContext;

  // Aliases for cleaner test code
  let sati: Sati;
  let payer: KeyPairSigner;
  let authority: KeyPairSigner;
  let agentOwner: KeyPairSigner;
  let counterpartySigner: KeyPairSigner;
  let agentOwnerKeypair: TestKeypair;
  let counterpartyKeypair: TestKeypair;
  let sasSchema: Address;
  let agentMint: Address;
  let tokenAccount: Address;
  let _createdFeedbackAddress: Address;
  let lookupTableAddress: Address;

  beforeAll(async () => {
    // Use shared test setup - handles SDK init, keypairs, agent/schema registration, lookup table
    ctx = await setupE2ETest();

    // Create aliases for cleaner test code
    sati = ctx.sati;
    payer = ctx.payer;
    authority = ctx.authority;
    agentOwner = ctx.agentOwner;
    counterpartySigner = ctx.counterparty;
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    counterpartyKeypair = ctx.counterpartyKeypair;
    lookupTableAddress = ctx.lookupTableAddress;

    // Generate SAS schema address for this test suite (separate from ctx.feedbackSchema)
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Step 1: Register Agent
  // ---------------------------------------------------------------------------

  describe("Step 1: Agent Registration", () => {
    test(
      "registers agent with Token-2022 NFT",
      async () => {
        const name = `LifecycleAgent-${Date.now()}`;
        const metadataUri = "https://example.com/lifecycle-agent.json";

        const result = await sati.registerAgent({
          payer,
          owner: agentOwner.address,
          name,
          uri: metadataUri,
        });

        expect(result).toHaveProperty("mint");
        expect(result).toHaveProperty("memberNumber");
        expect(result).toHaveProperty("signature");
        expect(result.memberNumber).toBeGreaterThan(0n);

        agentMint = result.mint;

        // Verify agent was created by loading it back
        const agent = await sati.loadAgent(agentMint);
        expect(agent).not.toBeNull();
        expect(agent?.name).toBe(name);
        // symbol field was removed from AgentIdentity (vestigial from fungible tokens)
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
        const result = await sati.registerSchemaConfig({
          payer,
          authority,
          sasSchema,
          signatureMode: SignatureMode.DualSignature,
          storageType: StorageType.Compressed,
          closeable: false,
        });

        expect(result).toHaveProperty("signature");

        // Verify schema config
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
    test(
      "creates feedback with real Ed25519 signatures",
      async () => {
        if (!tokenAccount) return;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();
        const outcome = Outcome.Positive;
        const tag1 = "quality";
        const tag2 = "responsive";

        // Create real signatures
        // tokenAccount = agent's MINT address (identity)
        // agentOwnerKeypair = NFT owner (signer)
        const signatures = createFeedbackSignatures(
          sasSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          outcome,
          tokenAccount, // Pass mint address explicitly
        );

        // Verify signatures before submitting
        const verifyResult = verifyFeedbackSignatures(
          sasSchema,
          taskRef,
          tokenAccount, // Use mint address
          dataHash,
          outcome,
          signatures,
        );
        expect(verifyResult.valid).toBe(true);

        // Submit to chain
        const result = await sati.createFeedback({
          payer,
          sasSchema,
          tokenAccount,
          counterparty: counterpartySigner.address,
          taskRef,
          dataHash,
          outcome,
          contentType: ContentType.None,
          tag1,
          tag2,
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

        _createdFeedbackAddress = result.address;
      },
      TEST_TIMEOUT,
    );

    test(
      "rejects feedback with self-attestation",
      async () => {
        if (!tokenAccount) return;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // Agent owner signs both roles (self-attestation)
        // Use tokenAccount (mint) for hash computation
        const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);
        const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, Outcome.Positive);

        const agentSig = signMessage(interactionHash, agentOwnerKeypair.secretKey);
        // Agent owner signs as counterparty too!
        const selfSig = signMessage(feedbackHash, agentOwnerKeypair.secretKey);

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
              pubkey: agentOwnerKeypair.address,
              signature: agentSig,
            },
            counterpartySignature: {
              pubkey: agentOwnerKeypair.address, // Same as agent owner!
              signature: selfSig,
            },
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

        expect(Array.isArray(result)).toBe(true);

        // Should have at least one feedback (the one we created)
        if (result.length > 0) {
          const feedback = result[0];
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

        expect(Array.isArray(result)).toBe(true);

        // All returned items should have Positive outcome
        for (const item of result) {
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

        expect(Array.isArray(result)).toBe(true);

        // All returned items should belong to our schema
        for (const item of result) {
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

        if (result.length > 0) {
          const feedback = result[0];

          // Verify structure
          expect(feedback).toHaveProperty("address");
          expect(feedback).toHaveProperty("attestation");
          expect(feedback).toHaveProperty("data");

          // Verify attestation structure
          expect(feedback.attestation.dataType).toBe(DataType.Feedback);
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

describe("E2E: Multiple Feedbacks Flow", () => {
  let agentKeypair: TestKeypair;
  let sasSchema: Address;

  beforeAll(async () => {
    // These tests only verify signature creation - no chain submission
    agentKeypair = createTestKeypair(200);
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  test(
    "creates multiple feedbacks with different outcomes",
    async () => {
      const _tokenAccount = agentKeypair.address;

      // Create feedbacks with different outcomes
      const outcomes = [Outcome.Positive, Outcome.Neutral, Outcome.Negative];
      const createdFeedbacks: SignatureData[][] = [];

      for (const outcome of outcomes) {
        const counterpartyKp = createTestKeypair(300 + outcome);
        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = createFeedbackSignatures(
          sasSchema,
          taskRef,
          agentKeypair,
          counterpartyKp,
          dataHash,
          outcome,
        );

        createdFeedbacks.push(signatures);

        // Verify each signature set is valid
        const result = verifyFeedbackSignatures(
          sasSchema,
          taskRef,
          agentKeypair.address,
          dataHash,
          outcome,
          signatures,
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
      const taskRef = randomBytes32();
      const counterparty1 = createTestKeypair(400);
      const counterparty2 = createTestKeypair(401);

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
      const taskRef = randomBytes32();
      const counterparty = createTestKeypair(500);

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

describe("E2E: Feedback Signature Edge Cases", () => {
  let agentKeypair: TestKeypair;
  let counterpartyKeypair: TestKeypair;
  let sasSchema: Address;

  beforeAll(async () => {
    // These tests only verify signature behavior - no chain submission
    agentKeypair = createTestKeypair(600);
    counterpartyKeypair = createTestKeypair(601);
    sasSchema = createTestKeypair().address;
  }, TEST_TIMEOUT);

  test(
    "agent signature is blind to outcome",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // Create signatures for Positive and Negative outcomes
      const sigPositive = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      const sigNegative = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Negative,
      );

      // Agent signatures should be IDENTICAL (blind to outcome)
      expect(sigPositive[0].sig).toEqual(sigNegative[0].sig);

      // Counterparty signatures should DIFFER (includes outcome)
      expect(sigPositive[1].sig).not.toEqual(sigNegative[1].sig);
    },
    TEST_TIMEOUT,
  );

  test(
    "same dataHash with different taskRef produces different agent signatures",
    async () => {
      const taskRef1 = randomBytes32();
      const taskRef2 = randomBytes32();
      const dataHash = randomBytes32();

      const sig1 = createFeedbackSignatures(
        sasSchema,
        taskRef1,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      const sig2 = createFeedbackSignatures(
        sasSchema,
        taskRef2,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Different taskRef = different agent signature (even with same dataHash)
      expect(sig1[0].sig).not.toEqual(sig2[0].sig);
    },
    TEST_TIMEOUT,
  );

  test(
    "counterparty cannot forge agent signature",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // Counterparty tries to sign as agent
      const interactionHash = computeInteractionHash(sasSchema, taskRef, agentKeypair.address, dataHash);

      const forgedSig = signMessage(interactionHash, counterpartyKeypair.secretKey);

      // Forged signature should fail verification against agent's public key
      const isValid = verifySignature(interactionHash, forgedSig, agentKeypair.publicKey);
      expect(isValid).toBe(false);
    },
    TEST_TIMEOUT,
  );

  test(
    "signatures for wrong tokenAccount fail verification",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();
      const wrongAgent = createTestKeypair(700);

      // Create signatures for correct agent
      const signatures = createFeedbackSignatures(
        sasSchema,
        taskRef,
        agentKeypair,
        counterpartyKeypair,
        dataHash,
        Outcome.Positive,
      );

      // Try to verify with wrong tokenAccount
      const result = verifyFeedbackSignatures(
        sasSchema,
        taskRef,
        wrongAgent.address, // Wrong agent!
        dataHash,
        Outcome.Positive,
        signatures,
      );

      expect(result.valid).toBe(false);
    },
    TEST_TIMEOUT,
  );
});

// =============================================================================
// Offset Verification Tests (for Photon memcmp)
// =============================================================================

describe("E2E: Compressed Attestation Offset Verification", () => {
  // No beforeAll needed - these are pure computation tests that don't require RPC

  test(
    "verifies COMPRESSED_OFFSETS are correctly defined",
    async () => {
      // These offsets are critical for Photon memcmp filters
      // Note: Light Protocol returns discriminator as a separate field in the
      // response, NOT prefixed to the data bytes. Data bytes start directly:
      // [0-31]   sas_schema (32 bytes)
      // [32-63]  token_account (32 bytes)
      // [64]     data_type (1 byte)
      // [65-68]  data length (4 bytes)
      // [69+]    data (variable)

      expect(COMPRESSED_OFFSETS.SAS_SCHEMA).toBe(0);
      expect(COMPRESSED_OFFSETS.TOKEN_ACCOUNT).toBe(32);
      expect(COMPRESSED_OFFSETS.DATA_TYPE).toBe(64);

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
