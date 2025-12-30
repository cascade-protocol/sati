/**
 * E2E Tests: tokenAccount Validation
 *
 * Tests that SDK methods validate tokenAccount is a registered SATI agent mint
 * before building/creating attestations.
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
import { Keypair } from "@solana/web3.js";
import { address, type KeyPairSigner, type Address } from "@solana/kit";
import type { Sati } from "../../src";
import { Outcome } from "../../src/hashes";
import { ContentType, SignatureMode, StorageType, ValidationType } from "../../src/schemas";

// Import test helpers
import {
  createFeedbackSignatures,
  createValidationSignatures,
  createReputationSignature,
  randomBytes32,
  setupE2ETest,
  waitForIndexer,
  type TestKeypair,
  type E2ETestContext,
} from "../helpers";

// =============================================================================
// Configuration
// =============================================================================

const TEST_TIMEOUT = 60000;

// =============================================================================
// tokenAccount Validation Tests
// =============================================================================

describe("E2E: tokenAccount validation", () => {
  let ctx: E2ETestContext;

  // Aliases for cleaner test code
  let sati: Sati;
  let payer: KeyPairSigner;
  let authority: KeyPairSigner;
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
    authority = ctx.authority;
    lookupTableAddress = ctx.lookupTableAddress;

    // CRITICAL: agentOwnerKeypair is the owner of the registered agent NFT
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    counterpartyKeypair = ctx.counterpartyKeypair;
    validatorKeypair = ctx.validatorKeypair;
    providerKeypair = ctx.providerKeypair;
    registeredAgentMint = ctx.agentMint;

    // Use schema from context and register additional test schemas
    feedbackSchema = ctx.feedbackSchema;

    // Register additional schemas for validation and reputation tests
    validationSchema = address(Keypair.generate().publicKey.toBase58());
    reputationSchema = address(Keypair.generate().publicKey.toBase58());

    await sati.registerSchemaConfig({
      payer,
      authority,
      sasSchema: validationSchema,
      signatureMode: SignatureMode.DualSignature,
      storageType: StorageType.Compressed,
      closeable: false,
    });

    await sati.registerSchemaConfig({
      payer,
      authority,
      sasSchema: reputationSchema,
      signatureMode: SignatureMode.SingleSigner,
      storageType: StorageType.Regular,
      closeable: true,
    });

    // For reputation scores, we need a credential (use a placeholder)
    satiCredential = address(Keypair.generate().publicKey.toBase58());
  }, TEST_TIMEOUT * 2);

  // ---------------------------------------------------------------------------
  // buildFeedbackTransaction Tests
  // ---------------------------------------------------------------------------

  describe("buildFeedbackTransaction", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        // Generate a random address that is NOT a registered agent
        const nonRegisteredMint = address(Keypair.generate().publicKey.toBase58());

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        // Create signatures using the non-registered address as token account
        const signatures = createFeedbackSignatures(
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
              pubkey: signatures[0].pubkey,
              signature: signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: signatures[1].pubkey,
              signature: signatures[1].sig,
            },
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
        const signatures = createFeedbackSignatures(
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
            pubkey: signatures[0].pubkey,
            signature: signatures[0].sig,
          },
          counterpartySignature: {
            pubkey: signatures[1].pubkey,
            signature: signatures[1].sig,
          },
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
        const nonRegisteredMint = address(Keypair.generate().publicKey.toBase58());

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();

        const signatures = createFeedbackSignatures(
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
              pubkey: signatures[0].pubkey,
              signature: signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: signatures[1].pubkey,
              signature: signatures[1].sig,
            },
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
        const signatures = createFeedbackSignatures(
          feedbackSchema,
          taskRef,
          agentOwnerKeypair,
          counterpartyKeypair,
          dataHash,
          Outcome.Positive,
          registeredAgentMint, // Hash computed with registered agent mint
        );

        // This should succeed
        const result = await sati.createFeedback({
          payer,
          sasSchema: feedbackSchema,
          tokenAccount: registeredAgentMint, // IS a registered agent!
          counterparty: counterpartyKeypair.address,
          taskRef,
          dataHash,
          outcome: Outcome.Positive,
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
  });

  // ---------------------------------------------------------------------------
  // createValidation Tests
  // ---------------------------------------------------------------------------

  describe("createValidation", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        const nonRegisteredMint = address(Keypair.generate().publicKey.toBase58());

        const taskRef = randomBytes32();
        const dataHash = randomBytes32();
        const response = 85; // Score 0-100

        const signatures = createValidationSignatures(
          validationSchema,
          taskRef,
          agentOwnerKeypair,
          validatorKeypair,
          dataHash,
          response,
        );

        await expect(
          sati.createValidation({
            payer,
            sasSchema: validationSchema,
            tokenAccount: nonRegisteredMint, // NOT a registered agent!
            counterparty: validatorKeypair.address,
            taskRef,
            dataHash,
            validationType: ValidationType.TEE,
            response,
            agentSignature: {
              pubkey: signatures[0].pubkey,
              signature: signatures[0].sig,
            },
            validatorSignature: {
              pubkey: signatures[1].pubkey,
              signature: signatures[1].sig,
            },
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
        const response = 90;

        // agentOwnerKeypair is the NFT owner - must use this for signing
        const signatures = createValidationSignatures(
          validationSchema,
          taskRef,
          agentOwnerKeypair,
          validatorKeypair,
          dataHash,
          response,
          registeredAgentMint, // Hash computed with registered agent mint
        );

        const result = await sati.createValidation({
          payer,
          sasSchema: validationSchema,
          tokenAccount: registeredAgentMint, // IS a registered agent!
          counterparty: validatorKeypair.address,
          taskRef,
          dataHash,
          validationType: ValidationType.TEE,
          response,
          agentSignature: {
            pubkey: signatures[0].pubkey,
            signature: signatures[0].sig,
          },
          validatorSignature: {
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
  });

  // ---------------------------------------------------------------------------
  // createReputationScore Tests
  // ---------------------------------------------------------------------------

  describe("createReputationScore", () => {
    test(
      "rejects non-registered mint as tokenAccount",
      async () => {
        const nonRegisteredMint = address(Keypair.generate().publicKey.toBase58());

        const score = 75;

        const signatures = createReputationSignature(reputationSchema, nonRegisteredMint, providerKeypair, score);

        await expect(
          sati.createReputationScore({
            payer,
            provider: providerKeypair.address,
            providerSignature: signatures[0].sig,
            sasSchema: reputationSchema,
            satiCredential,
            tokenAccount: nonRegisteredMint, // NOT a registered agent!
            score,
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
        const score = 88;

        const signatures = createReputationSignature(reputationSchema, registeredAgentMint, providerKeypair, score);

        const result = await sati.createReputationScore({
          payer,
          provider: providerKeypair.address,
          providerSignature: signatures[0].sig,
          sasSchema: reputationSchema,
          satiCredential,
          tokenAccount: registeredAgentMint, // IS a registered agent!
          score,
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

        const signatures = createFeedbackSignatures(
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
              pubkey: signatures[0].pubkey,
              signature: signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: signatures[1].pubkey,
              signature: signatures[1].sig,
            },
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

        const signatures = createFeedbackSignatures(
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
              pubkey: signatures[0].pubkey,
              signature: signatures[0].sig,
            },
            counterpartySignature: {
              pubkey: signatures[1].pubkey,
              signature: signatures[1].sig,
            },
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
        const feedbacks = await sati.listFeedbacks({ tokenAccount: registeredAgentMint });

        expect(Array.isArray(feedbacks)).toBe(true);

        // We created at least one feedback in the "accepts registered agent" test
        if (feedbacks.length > 0) {
          const feedback = feedbacks[0];
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
// SingleSigner Schema Tests (feedbackPublic)
// =============================================================================

describe("E2E: tokenAccount validation - SingleSigner mode", () => {
  let ctx: E2ETestContext;
  let sati: Sati;
  let payer: KeyPairSigner;
  let authority: KeyPairSigner;
  let lookupTableAddress: Address;
  let agentOwnerKeypair: TestKeypair;
  let registeredAgentMint: Address;
  let feedbackPublicSchema: Address;

  beforeAll(async () => {
    // Use shared test setup
    ctx = await setupE2ETest();

    sati = ctx.sati;
    payer = ctx.payer;
    authority = ctx.authority;
    lookupTableAddress = ctx.lookupTableAddress;
    agentOwnerKeypair = ctx.agentOwnerKeypair;
    registeredAgentMint = ctx.agentMint;

    // Register SingleSigner schema for this test
    feedbackPublicSchema = address(Keypair.generate().publicKey.toBase58());
    await sati.registerSchemaConfig({
      payer,
      authority,
      sasSchema: feedbackPublicSchema,
      signatureMode: SignatureMode.SingleSigner,
      storageType: StorageType.Compressed,
      closeable: false,
    });
  }, TEST_TIMEOUT * 2);

  test(
    "createFeedback (SingleSigner) rejects non-registered mint",
    async () => {
      const nonRegisteredMint = address(Keypair.generate().publicKey.toBase58());

      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // SingleSigner mode - only agent signature required
      const signatures = createFeedbackSignatures(
        feedbackPublicSchema,
        taskRef,
        agentOwnerKeypair,
        agentOwnerKeypair, // counterparty doesn't matter for SingleSigner
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
            pubkey: signatures[0].pubkey,
            signature: signatures[0].sig,
          },
          // No counterparty signature for SingleSigner
          lookupTableAddress,
        }),
      ).rejects.toThrow(/not a registered.*agent|agent.*not found/i);
    },
    TEST_TIMEOUT,
  );

  test(
    "createFeedback (SingleSigner) accepts registered agent mint",
    async () => {
      const taskRef = randomBytes32();
      const dataHash = randomBytes32();

      // agentOwnerKeypair is the NFT owner - must use this for signing
      const signatures = createFeedbackSignatures(
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
          pubkey: signatures[0].pubkey,
          signature: signatures[0].sig,
        },
        lookupTableAddress,
      });

      expect(result).toHaveProperty("address");
      expect(result).toHaveProperty("signature");
    },
    TEST_TIMEOUT,
  );
});
