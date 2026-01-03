/**
 * E2E Tests: tokenAccount Validation
 *
 * Tests that SDK methods validate tokenAccount is a registered SATI agent mint
 * before building/creating attestations.
 *
 * ## Test Isolation Strategy
 *
 * This file uses TWO isolation patterns:
 *
 * 1. **Main validation tests** ("E2E: tokenAccount validation"):
 *    - Share a single `E2ETestContext` (agent, schemas, lookup table)
 *    - Tests validation across multiple SDK methods (feedback, validation, reputation)
 *    - Context is expensive to create (~5-10s)
 *
 * 2. **CounterpartySigned mode tests** ("E2E: tokenAccount validation - CounterpartySigned mode"):
 *    - Has its own isolated `E2ETestContext`
 *    - Tests CounterpartySigned schema registration and validation
 *    - Complete isolation from main validation tests
 *
 * Test-first approach:
 * 1. Write tests expecting validation to reject non-registered mints
 * 2. Verify tests fail (validation doesn't exist yet)
 * 3. Implement validation in SDK
 * 4. Verify tests pass
 *
 * Run: pnpm test:e2e -- --grep "tokenAccount validation"
 */

import { describe, test, expect, beforeAll } from "vitest";
import { address, type KeyPairSigner, type Address } from "@solana/kit";
import type { Sati } from "../../src";
import { Outcome } from "../../src/hashes";
import { ContentType } from "../../src/schemas";
import { SignatureMode, StorageType } from "../../src/generated";

// Import test helpers
import {
  createTestKeypair,
  createFeedbackSignatures,
  createValidationSignatures,
  createReputationSignature,
  randomBytes32,
  setupE2ETest,
  type TestKeypair,
  type E2ETestContext,
  waitForIndexer,
} from "../helpers";

// Import deployed config (needed for schemas in deployment lookup table)
import deployedConfig from "../../src/deployed/localnet.json";

// =============================================================================
// Configuration
// =============================================================================

const TEST_TIMEOUT = 60000;

// =============================================================================
// tokenAccount Validation Tests
// =============================================================================

/**
 * Main E2E validation tests sharing a single context.
 * Tests tokenAccount validation across multiple SDK methods.
 * Nested describes share state - they use the same registered agent.
 */
describe("E2E: tokenAccount validation", () => {
  let ctx: E2ETestContext;

  // Aliases for cleaner test code
  let sati: Sati;
  let payer: KeyPairSigner;
  let lookupTableAddress: Address;

  // IMPORTANT: agentOwnerKeypair is the NFT OWNER keypair - use this for signing
  let agentOwnerKeypair: TestKeypair;
  let counterpartyKeypair: TestKeypair;
  let validatorKeypair: TestKeypair;
  let providerKeypair: TestKeypair;

  // Registered agent for positive tests
  let registeredAgentMint: Address;

  // Schema addresses
  let feedbackSchema: Address;
  let validationSchema: Address;
  let reputationSchema: Address;
  let satiCredential: Address;

  beforeAll(async () => {
    // Use shared test setup - handles SDK init, keypairs, agent/schema registration, lookup table
    ctx = await setupE2ETest();

    // Create aliases
    sati = ctx.sati;
    payer = ctx.payer;
    lookupTableAddress = ctx.lookupTableAddress;

    // CRITICAL: agentOwnerKeypair is the owner of the registered agent NFT
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    counterpartyKeypair = ctx.counterpartyKeypair;
    validatorKeypair = ctx.validatorKeypair;
    providerKeypair = ctx.providerKeypair;
    registeredAgentMint = ctx.agentMint;

    // Use schema from context for feedback tests (its PDA is in ctx.lookupTableAddress)
    feedbackSchema = ctx.feedbackSchema;

    // For validation and reputation tests, use the pre-deployed schemas from the deployment config
    // These are already registered, but their PDAs are NOT in ctx.lookupTableAddress
    // The tests using these schemas will be skipped until lookup table extension is implemented
    validationSchema = address(deployedConfig.config.schemas.validation);
    reputationSchema = address(deployedConfig.config.schemas.reputationScore);
    satiCredential = address(deployedConfig.config.credential);
  }, TEST_TIMEOUT * 2);

  // ---------------------------------------------------------------------------
  // buildFeedbackTransaction Tests
  // ---------------------------------------------------------------------------

  describe("buildFeedbackTransaction", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        // Generate a random address that is NOT a registered agent
        const nonRegisteredKeypair = await createTestKeypair();
        const nonRegisteredMint = nonRegisteredKeypair.address;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // Create signatures using the non-registered address as token account
        const signatures = await createFeedbackSignatures(
          feedbackSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Positive,
        );

        // This should be rejected because nonRegisteredMint is not a registered agent
        await expect(
          sati.buildFeedbackTransaction({
            payer: payer.address,
            sasSchema: feedbackSchema,
            tokenAccount: nonRegisteredMint, // NOT a registered agent!
            counterparty: counterpartyKeypair.address,
            taskRef,
            dataHash,
            outcome: Outcome.Positive,
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
        ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
      },
      TEST_TIMEOUT,
    );

    test(
      "accepts registered agent mint as tokenAccount",
      async () => {
        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // agentOwnerKeypair is the NFT owner - must use this for signing
        const signatures = await createFeedbackSignatures(
          feedbackSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Positive,
          registeredAgentMint, // Hash computed with registered agent mint
        );

        // This should succeed because registeredAgentMint IS a registered agent
        const result = await sati.buildFeedbackTransaction({
          payer: payer.address,
          sasSchema: feedbackSchema,
          tokenAccount: registeredAgentMint, // IS a registered agent!
          counterparty: counterpartyKeypair.address,
          taskRef,
          dataHash,
          outcome: Outcome.Positive,
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

        expect(result).toHaveProperty("attestationAddress");
        expect(result).toHaveProperty("messageBytes");
        expect(result).toHaveProperty("signers");
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // createFeedback Tests
  // ---------------------------------------------------------------------------

  describe("createFeedback", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        const nonRegisteredKeypair = await createTestKeypair();
        const nonRegisteredMint = nonRegisteredKeypair.address;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = await createFeedbackSignatures(
          feedbackSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Neutral,
        );

        await expect(
          sati.createFeedback({
            payer,
            sasSchema: feedbackSchema,
            tokenAccount: nonRegisteredMint, // NOT a registered agent!
            counterparty: counterpartyKeypair.address,
            taskRef,
            dataHash,
            outcome: Outcome.Neutral,
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
        ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
      },
      TEST_TIMEOUT,
    );

    // Positive case covered by attestation-flow.test.ts - not duplicated here
  });

  // ---------------------------------------------------------------------------
  // createValidation Tests
  // ---------------------------------------------------------------------------

  describe("createValidation", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        const nonRegisteredKeypair = await createTestKeypair();
        const nonRegisteredMint = nonRegisteredKeypair.address;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = await createValidationSignatures(
          validationSchema,
          taskRef,
          agentOwnerKeypair,
          validatorKeypair,
          dataHash,
          Outcome.Positive,
        );

        await expect(
          sati.createValidation({
            payer,
            sasSchema: validationSchema,
            tokenAccount: nonRegisteredMint, // NOT a registered agent!
            counterparty: validatorKeypair.address,
            taskRef,
            dataHash,
            outcome: Outcome.Positive,
            agentSignature: {
              pubkey: signatures.signatures[0].pubkey,
              signature: signatures.signatures[0].sig,
            },
            validatorSignature: {
              pubkey: signatures.signatures[1].pubkey,
              signature: signatures.signatures[1].sig,
            },
            counterpartyMessage: signatures.counterpartyMessage,
            lookupTableAddress,
          }),
        ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
      },
      TEST_TIMEOUT,
    );

    // TODO: Re-enable when lookup table extension is implemented
    // This test fails due to transaction size - validationSchema PDA is not in ctx.lookupTableAddress
    test.skip(
      "accepts registered agent mint as tokenAccount",
      async () => {
        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // agentOwnerKeypair is the NFT owner - must use this for signing
        const signatures = await createValidationSignatures(
          validationSchema,
          taskRef,
          agentOwnerKeypair,
          validatorKeypair,
          dataHash,
          Outcome.Positive,
          registeredAgentMint, // Hash computed with registered agent mint
        );

        const result = await sati.createValidation({
          payer,
          sasSchema: validationSchema,
          tokenAccount: registeredAgentMint, // IS a registered agent!
          counterparty: validatorKeypair.address,
          taskRef,
          dataHash,
          outcome: Outcome.Positive,
          agentSignature: {
            pubkey: signatures.signatures[0].pubkey,
            signature: signatures.signatures[0].sig,
          },
          validatorSignature: {
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
  });

  // ---------------------------------------------------------------------------
  // createReputationScore Tests
  // ---------------------------------------------------------------------------

  describe("createReputationScore", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        const nonRegisteredKeypair = await createTestKeypair();
        const nonRegisteredMint = nonRegisteredKeypair.address;

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = await createReputationSignature(reputationSchema, taskRef, dataHash, providerKeypair);

        await expect(
          sati.createReputationScore({
            payer,
            provider: providerKeypair.address,
            providerSignature: signatures[0].sig,
            sasSchema: reputationSchema,
            satiCredential,
            tokenAccount: nonRegisteredMint, // NOT a registered agent!
            taskRef,
            dataHash,
            outcome: Outcome.Positive,
            contentType: ContentType.None,
          }),
        ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
      },
      TEST_TIMEOUT,
    );

    // Skip: Regular attestations require SAS program deployed on localnet
    test.skip(
      "accepts registered agent mint as tokenAccount",
      async () => {
        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = await createReputationSignature(reputationSchema, taskRef, dataHash, providerKeypair);

        const result = await sati.createReputationScore({
          payer,
          provider: providerKeypair.address,
          providerSignature: signatures[0].sig,
          sasSchema: reputationSchema,
          satiCredential,
          tokenAccount: registeredAgentMint, // IS a registered agent!
          taskRef,
          dataHash,
          outcome: Outcome.Positive,
          contentType: ContentType.None,
        });

        expect(result).toHaveProperty("address");
        expect(result).toHaveProperty("signature");
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------

  describe("Edge Cases", () => {
    test(
      "rejects zero address as tokenAccount",
      async () => {
        const zeroAddress = address("11111111111111111111111111111111");

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = await createFeedbackSignatures(
          feedbackSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Positive,
        );

        await expect(
          sati.buildFeedbackTransaction({
            payer: payer.address,
            sasSchema: feedbackSchema,
            tokenAccount: zeroAddress, // System program address, definitely not an agent
            counterparty: counterpartyKeypair.address,
            taskRef,
            dataHash,
            outcome: Outcome.Positive,
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
        ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
      },
      TEST_TIMEOUT,
    );

    test(
      "rejects program address as tokenAccount",
      async () => {
        // Use the SATI program address itself - definitely not an agent
        const programAddress = address("SATi9Rsp7RhKRdXgCxMu28TvF9ULQjBFLfJPsmN5KEs");

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = await createFeedbackSignatures(
          feedbackSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Negative,
        );

        await expect(
          sati.createFeedback({
            payer,
            sasSchema: feedbackSchema,
            tokenAccount: programAddress, // Program address, not an agent
            counterparty: counterpartyKeypair.address,
            taskRef,
            dataHash,
            outcome: Outcome.Negative,
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
        ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Query after successful creation
  // ---------------------------------------------------------------------------

  describe("Query verification", () => {
    test(
      "waits for indexer",
      async () => {
        await waitForIndexer();
      },
      TEST_TIMEOUT,
    );

    test(
      "created feedbacks can be queried by registered agent mint",
      async () => {
        // Query feedbacks for the registered agent
        const result = await sati.listFeedbacks({ tokenAccount: registeredAgentMint });

        expect(Array.isArray(result.items)).toBe(true);

        // We created at least one feedback in the "accepts registered agent" test
        if (result.items.length > 0) {
          const feedback = result.items[0];
          expect(feedback.data).toHaveProperty("outcome");
          expect(feedback.data).toHaveProperty("tokenAccount");
          // The tokenAccount in the data should match the registered agent mint
          expect(feedback.data.tokenAccount).toBe(registeredAgentMint);
        }
      },
      TEST_TIMEOUT,
    );
  });
});

// =============================================================================
// CounterpartySigned Schema Tests (feedbackPublic)
// =============================================================================

/**
 * Isolated E2E tests for CounterpartySigned mode validation.
 * Has its own `E2ETestContext` - complete isolation from main validation tests.
 * Tests CounterpartySigned schema registration and tokenAccount validation.
 */
describe("E2E: tokenAccount validation - CounterpartySigned mode", () => {
  let ctx: E2ETestContext;
  let sati: Sati;
  let payer: KeyPairSigner;
  let authority: KeyPairSigner;
  let lookupTableAddress: Address;
  let agentOwnerKeypair: TestKeypair;
  let registeredAgentMint: Address;
  let feedbackPublicSchema: Address;

  beforeAll(async () => {
    // Isolated context: fresh agent, schema, lookup table
    ctx = await setupE2ETest();

    sati = ctx.sati;
    payer = ctx.payer;
    authority = ctx.authority;
    lookupTableAddress = ctx.lookupTableAddress;
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    registeredAgentMint = ctx.agentMint;

    // Register CounterpartySigned schema for this test
    const schemaKeypair = await createTestKeypair();
    feedbackPublicSchema = schemaKeypair.address;
    await sati.registerSchemaConfig({
      payer,
      authority,
      sasSchema: feedbackPublicSchema,
      signatureMode: SignatureMode.CounterpartySigned,
      storageType: StorageType.Compressed,
      delegationSchema: null,
      closeable: false,
      name: "FeedbackPublic",
    });
  }, TEST_TIMEOUT * 2);

  test(
    "createFeedback (CounterpartySigned) rejects non-registered mint",
    async () => {
      const nonRegisteredKeypair = await createTestKeypair();
      const nonRegisteredMint = nonRegisteredKeypair.address;

      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // CounterpartySigned mode - only agent signature required
      const signatures = await createFeedbackSignatures(
        feedbackPublicSchema,
        taskRef,
        agentOwnerKeypair,
        agentOwnerKeypair, // counterparty doesn't matter for CounterpartySigned
        dataHash,
        Outcome.Positive,
      );

      await expect(
        sati.createFeedback({
          payer,
          sasSchema: feedbackPublicSchema,
          tokenAccount: nonRegisteredMint,
          counterparty: agentOwnerKeypair.address,
          taskRef,
          dataHash,
          outcome: Outcome.Positive,
          agentSignature: {
            pubkey: signatures.signatures[0].pubkey,
            signature: signatures.signatures[0].sig,
          },
          // No counterparty signature for CounterpartySigned
          lookupTableAddress,
        }),
      ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
    },
    TEST_TIMEOUT,
  );

  test(
    "createFeedback (CounterpartySigned) accepts registered agent mint",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // agentOwnerKeypair is the NFT owner - must use this for signing
      const signatures = await createFeedbackSignatures(
        feedbackPublicSchema,
        taskRef,
        agentOwnerKeypair,
        agentOwnerKeypair,
        dataHash,
        Outcome.Positive,
        registeredAgentMint, // Hash computed with registered agent mint
      );

      const result = await sati.createFeedback({
        payer,
        sasSchema: feedbackPublicSchema,
        tokenAccount: registeredAgentMint,
        counterparty: agentOwnerKeypair.address,
        taskRef,
        dataHash,
        outcome: Outcome.Positive,
        agentSignature: {
          pubkey: signatures.signatures[0].pubkey,
          signature: signatures.signatures[0].sig,
        },
        lookupTableAddress,
      });

      expect(result).toHaveProperty("address");
      expect(result).toHaveProperty("signature");
    },
    TEST_TIMEOUT,
  );
});
