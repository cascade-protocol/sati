/**
 * E2E Tests for SATI Agent Management
 *
 * Tests agent ownership and metadata operations:
 * - Transfer agent to new owner
 * - Transfer agent with authority update
 * - Update agent metadata
 * - Error cases for unauthorized operations
 *
 * ## Test Isolation Strategy
 *
 * This file uses a HYBRID isolation pattern:
 *
 * 1. **Query tests** ("Agent Queries"):
 *    - Share the main `E2ETestContext` agent
 *    - Read-only operations, no state modification
 *
 * 2. **Transfer/Update tests** ("Agent Transfer", "Agent Transfer with Authority", "Agent Metadata Updates"):
 *    - Each describe creates a FRESH agent in beforeAll
 *    - Complete isolation from other describe blocks
 *    - Tests can run in any order without affecting each other
 *    - Fresh agents prevent test pollution from transfers/updates
 *
 * Prerequisites:
 * - light test-validator (or devnet with HELIUS_API_KEY)
 * - SATI program deployed
 *
 * Run: pnpm test:e2e
 */

import { describe, test, expect, beforeAll } from "vitest";
import {
  generateKeyPairSigner,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token-2022";
import type { Sati } from "../../src";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../../src/helpers";

// Helper to create ATA for a new owner
async function createDestinationAta(payer: KeyPairSigner, owner: Address, mint: Address): Promise<void> {
  const rpc = createSolanaRpc("http://127.0.0.1:8899");
  const rpcSubscriptions = createSolanaRpcSubscriptions("ws://127.0.0.1:8900");

  const createAtaIx = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer,
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const createAtaTx = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(payer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstruction(createAtaIx, msg),
  );
  const signedCreateAtaTx = await signTransactionMessageWithSigners(createAtaTx);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Type assertion for transaction with blockhash lifetime
  type SignedBlockhashTransaction = typeof signedCreateAtaTx & {
    lifetimeConstraint: { lastValidBlockHeight: bigint; blockhash: string };
  };

  await sendAndConfirm(signedCreateAtaTx as SignedBlockhashTransaction, { commitment: "confirmed" });
}

import { setupE2ETest, type E2ETestContext } from "../helpers";

// =============================================================================
// Test Configuration
// =============================================================================

const TEST_TIMEOUT = 60000; // 60s for network operations

// =============================================================================
// E2E Tests: Agent Management
// =============================================================================

/**
 * Agent management E2E tests with hybrid isolation.
 * Main context provides shared agent for queries.
 * Nested describes create fresh agents for state-modifying operations.
 */
describe("E2E: Agent Management", () => {
  let ctx: E2ETestContext;

  // Aliases for cleaner test code
  let sati: Sati;
  let payer: KeyPairSigner;
  let agentOwner: KeyPairSigner;
  let agentMint: Address;

  beforeAll(async () => {
    ctx = await setupE2ETest();

    sati = ctx.sati;
    payer = ctx.payer;
    agentOwner = ctx.agentOwner;
    agentMint = ctx.agentMint;
  }, TEST_TIMEOUT);

  // ---------------------------------------------------------------------------
  // Query Tests
  // ---------------------------------------------------------------------------

  describe("Agent Queries", () => {
    test(
      "getAgentOwner returns correct owner",
      async () => {
        const owner = await sati.getAgentOwner(agentMint);
        expect(owner).toBe(agentOwner.address);
      },
      TEST_TIMEOUT,
    );

    test(
      "loadAgent returns agent details",
      async () => {
        const agent = await sati.loadAgent(agentMint);
        expect(agent).toBeDefined();
        expect(agent?.mint).toBe(agentMint);
        expect(agent?.owner).toBe(agentOwner.address);
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Transfer Tests
  // ---------------------------------------------------------------------------

  /**
   * Isolated transfer tests - creates a FRESH agent in beforeAll.
   * No state shared with other test blocks.
   */
  describe("Agent Transfer", () => {
    let transferredMint: Address;
    let originalOwner: KeyPairSigner;
    let newOwner: KeyPairSigner;

    beforeAll(async () => {
      // Isolated context: fresh agent registered for these tests only
      originalOwner = await generateKeyPairSigner();
      newOwner = await generateKeyPairSigner();

      // Create RPC for airdrop
      const rpc = createSolanaRpc("http://127.0.0.1:8899");

      // Fund original owner
      await rpc.requestAirdrop(originalOwner.address, lamports(100_000_000n)).send();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Register a new agent for this owner
      const result = await sati.registerAgent({
        payer,
        owner: originalOwner.address,
        name: "TransferTest Agent",
        uri: "https://test.example.com/transfer-agent.json",
      });

      transferredMint = result.mint;
    }, TEST_TIMEOUT * 2);

    test(
      "transfers agent to new owner",
      async () => {
        // Verify original owner
        const ownerBefore = await sati.getAgentOwner(transferredMint);
        expect(ownerBefore).toBe(originalOwner.address);

        // Create destination ATA for new owner first
        await createDestinationAta(payer, newOwner.address, transferredMint);

        // Transfer to new owner
        const { signature } = await sati.transferAgent({
          payer,
          owner: originalOwner,
          mint: transferredMint,
          newOwner: newOwner.address,
        });

        expect(signature).toBeDefined();
        expect(typeof signature).toBe("string");

        // Verify new owner
        const ownerAfter = await sati.getAgentOwner(transferredMint);
        expect(ownerAfter).toBe(newOwner.address);
      },
      TEST_TIMEOUT,
    );

    test(
      "transfer fails with wrong authority",
      async () => {
        // Try to transfer using original owner (who no longer owns it)
        await expect(
          sati.transferAgent({
            payer,
            owner: originalOwner, // Wrong - no longer owns
            mint: transferredMint,
            newOwner: originalOwner.address,
          }),
        ).rejects.toThrow();
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Transfer with Authority Tests
  // ---------------------------------------------------------------------------

  /**
   * Isolated transfer-with-authority tests - creates a FRESH agent in beforeAll.
   * No state shared with other test blocks.
   */
  describe("Agent Transfer with Authority", () => {
    let transferredMint: Address;
    let originalOwner: KeyPairSigner;
    let newOwner: KeyPairSigner;

    beforeAll(async () => {
      // Isolated context: fresh agent registered for these tests only
      originalOwner = await generateKeyPairSigner();
      newOwner = await generateKeyPairSigner();

      // Create RPC for airdrop
      const rpc = createSolanaRpc("http://127.0.0.1:8899");

      // Fund original owner
      await rpc.requestAirdrop(originalOwner.address, lamports(100_000_000n)).send();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Register agent
      const result = await sati.registerAgent({
        payer,
        owner: originalOwner.address,
        name: "AuthorityTransfer Agent",
        uri: "https://test.example.com/authority-agent.json",
      });

      transferredMint = result.mint;
    }, TEST_TIMEOUT * 2);

    test(
      "transfers agent with metadata authority",
      async () => {
        // Verify original owner
        const ownerBefore = await sati.getAgentOwner(transferredMint);
        expect(ownerBefore).toBe(originalOwner.address);

        // Create destination ATA for new owner first
        await createDestinationAta(payer, newOwner.address, transferredMint);

        // Transfer with authority
        const { signature } = await sati.transferAgentWithAuthority({
          payer,
          owner: originalOwner,
          mint: transferredMint,
          newOwner: newOwner.address,
        });

        expect(signature).toBeDefined();

        // Verify new owner
        const ownerAfter = await sati.getAgentOwner(transferredMint);
        expect(ownerAfter).toBe(newOwner.address);

        // Note: Verifying update authority would require reading metadata
        // which is not directly exposed in the current SDK
      },
      TEST_TIMEOUT,
    );
  });

  // ---------------------------------------------------------------------------
  // Metadata Update Tests
  // ---------------------------------------------------------------------------

  /**
   * Isolated metadata update tests - creates a FRESH agent in beforeAll.
   * No state shared with other test blocks.
   */
  describe("Agent Metadata Updates", () => {
    let metadataMint: Address;
    let metadataOwner: KeyPairSigner;

    beforeAll(async () => {
      // Isolated context: fresh agent registered for these tests only
      metadataOwner = await generateKeyPairSigner();

      // Create RPC for airdrop
      const rpc = createSolanaRpc("http://127.0.0.1:8899");

      await rpc.requestAirdrop(metadataOwner.address, lamports(100_000_000n)).send();
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const result = await sati.registerAgent({
        payer,
        owner: metadataOwner.address,
        name: "MetadataTest Agent",
        uri: "https://test.example.com/metadata-agent.json",
      });

      metadataMint = result.mint;
    }, TEST_TIMEOUT * 2);

    test(
      "updates agent name",
      async () => {
        const newName = "Updated Agent Name";

        const { signature } = await sati.updateAgentMetadata({
          payer,
          owner: metadataOwner,
          mint: metadataMint,
          updates: { name: newName },
        });

        expect(signature).toBeDefined();

        // Verify update
        const agent = await sati.loadAgent(metadataMint);
        expect(agent?.name).toBe(newName);
      },
      TEST_TIMEOUT,
    );

    test(
      "updates agent URI",
      async () => {
        const newUri = "https://test.example.com/updated-metadata.json";

        const { signature } = await sati.updateAgentMetadata({
          payer,
          owner: metadataOwner,
          mint: metadataMint,
          updates: { uri: newUri },
        });

        expect(signature).toBeDefined();

        const agent = await sati.loadAgent(metadataMint);
        expect(agent?.uri).toBe(newUri);
      },
      TEST_TIMEOUT,
    );

    test(
      "updates additional metadata",
      async () => {
        const { signature } = await sati.updateAgentMetadata({
          payer,
          owner: metadataOwner,
          mint: metadataMint,
          updates: {
            additionalMetadata: [
              ["version", "2"],
              ["description", "Test agent"],
            ],
          },
        });

        expect(signature).toBeDefined();

        const agent = await sati.loadAgent(metadataMint);
        expect(agent?.additionalMetadata.version).toBe("2");
        expect(agent?.additionalMetadata.description).toBe("Test agent");
      },
      TEST_TIMEOUT,
    );

    test(
      "update fails with wrong authority",
      async () => {
        const wrongAuthority = await generateKeyPairSigner();

        await expect(
          sati.updateAgentMetadata({
            payer,
            owner: wrongAuthority,
            mint: metadataMint,
            updates: { name: "Should Not Work" },
          }),
        ).rejects.toThrow();
      },
      TEST_TIMEOUT,
    );
  });
});
