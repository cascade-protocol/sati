/**
 * Light Protocol / Photon RPC Smoke Tests
 *
 * Non-destructive tests that verify Light Protocol infrastructure is
 * accessible and functioning correctly on live networks.
 *
 * Usage:
 *   SOLANA_CLUSTER=devnet pnpm vitest run tests/smoke/light-protocol.smoke.ts
 *   SOLANA_CLUSTER=mainnet pnpm vitest run tests/smoke/light-protocol.smoke.ts
 *
 * Requirements:
 *   - SOLANA_CLUSTER env var (devnet or mainnet, defaults to devnet)
 *   - HELIUS_API_KEY env var for Photon RPC access
 */
import { describe, test, expect, beforeAll } from "vitest";
import { Connection, PublicKey } from "@solana/web3.js";
import { createRpc, selectStateTreeInfo, TreeType, bn, type Rpc } from "@lightprotocol/stateless.js";

// =============================================================================
// Configuration
// =============================================================================

type Cluster = "devnet" | "mainnet";

function getCluster(): Cluster {
  const cluster = process.env.SOLANA_CLUSTER?.toLowerCase();
  if (cluster === "mainnet" || cluster === "mainnet-beta") {
    return "mainnet";
  }
  return "devnet"; // default
}

function getHeliusApiKey(): string | undefined {
  return process.env.HELIUS_API_KEY;
}

function getRpcUrl(cluster: Cluster): string {
  const apiKey = getHeliusApiKey();
  if (!apiKey) {
    throw new Error("HELIUS_API_KEY environment variable required for Light Protocol smoke tests");
  }

  return cluster === "mainnet"
    ? `https://mainnet.helius-rpc.com?api-key=${apiKey}`
    : `https://devnet.helius-rpc.com?api-key=${apiKey}`;
}

// =============================================================================
// Constants
// =============================================================================

// Light Protocol V1 Address Tree (mainnet-compatible)
const V1_ADDRESS_TREE = new PublicKey("amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2");
const V1_ADDRESS_QUEUE = new PublicKey("aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F");

// Light System Program
const LIGHT_SYSTEM_PROGRAM = new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7");

// SATI Program ID
const SATI_PROGRAM_ID = new PublicKey("satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz");

// =============================================================================
// Smoke Tests
// =============================================================================

describe("light-protocol: smoke tests", () => {
  const cluster = getCluster();
  let rpc: Rpc;
  let connection: Connection;

  beforeAll(() => {
    console.log(`\n  Running Light Protocol smoke tests on ${cluster.toUpperCase()}\n`);

    const rpcUrl = getRpcUrl(cluster);
    rpc = createRpc(rpcUrl);
    connection = new Connection(rpcUrl, "confirmed");

    console.log(`  RPC URL: ${rpcUrl.replace(/api-key=.*/, "api-key=***")}`);
  });

  // ---------------------------------------------------------------------------
  // Photon RPC Connectivity
  // ---------------------------------------------------------------------------

  describe("photon rpc connectivity", () => {
    test("getSlot returns current slot", async () => {
      const slot = await rpc.getSlot();

      expect(slot).toBeGreaterThan(0);
      console.log(`    Current slot: ${slot}`);
    });

    test("getVersion returns valid version", async () => {
      // Standard Solana version check
      const version = await connection.getVersion();

      expect(version).toBeDefined();
      expect(version["solana-core"]).toBeDefined();
      console.log(`    Version: ${version["solana-core"]}`);
    });
  });

  // ---------------------------------------------------------------------------
  // State Tree Accessibility
  // ---------------------------------------------------------------------------

  describe("state tree accessibility", () => {
    test("getStateTreeInfos returns V1 trees", async () => {
      const treeInfos = await rpc.getStateTreeInfos();

      expect(treeInfos).toBeDefined();
      expect(treeInfos.length).toBeGreaterThan(0);

      console.log(`    Available state trees: ${treeInfos.length}`);
    });

    test("can select V1 state tree", async () => {
      const treeInfos = await rpc.getStateTreeInfos();
      const v1Tree = selectStateTreeInfo(treeInfos, TreeType.StateV1);

      expect(v1Tree).toBeDefined();
      expect(v1Tree.tree).toBeDefined();
      expect(v1Tree.queue).toBeDefined();

      console.log(`    V1 State Tree: ${v1Tree.tree.toBase58()}`);
      console.log(`    V1 State Queue: ${v1Tree.queue.toBase58()}`);
    });

    test("V1 state tree account exists on-chain", async () => {
      const treeInfos = await rpc.getStateTreeInfos();
      const v1Tree = selectStateTreeInfo(treeInfos, TreeType.StateV1);

      const accountInfo = await connection.getAccountInfo(v1Tree.tree);

      expect(accountInfo).not.toBeNull();
      expect(accountInfo?.executable).toBe(false);

      console.log(`    Tree account size: ${accountInfo?.data.length} bytes`);
    });
  });

  // ---------------------------------------------------------------------------
  // V1 Address Tree Accessibility
  // ---------------------------------------------------------------------------

  describe("address tree accessibility", () => {
    test("V1 address tree account exists", async () => {
      const accountInfo = await connection.getAccountInfo(V1_ADDRESS_TREE);

      expect(accountInfo).not.toBeNull();
      expect(accountInfo?.executable).toBe(false);

      console.log(`    V1 Address Tree: ${V1_ADDRESS_TREE.toBase58()}`);
      console.log(`    Account size: ${accountInfo?.data.length} bytes`);
    });

    test("V1 address queue account exists", async () => {
      const accountInfo = await connection.getAccountInfo(V1_ADDRESS_QUEUE);

      expect(accountInfo).not.toBeNull();

      console.log(`    V1 Address Queue: ${V1_ADDRESS_QUEUE.toBase58()}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Light System Program
  // ---------------------------------------------------------------------------

  describe("light system program", () => {
    test("light system program is deployed", async () => {
      const accountInfo = await connection.getAccountInfo(LIGHT_SYSTEM_PROGRAM);

      expect(accountInfo).not.toBeNull();
      expect(accountInfo?.executable).toBe(true);

      console.log(`    Light System Program: ${LIGHT_SYSTEM_PROGRAM.toBase58()}`);
    });
  });

  // ---------------------------------------------------------------------------
  // SATI Program Integration
  // ---------------------------------------------------------------------------

  describe("sati program integration", () => {
    test("SATI program is deployed", async () => {
      const accountInfo = await connection.getAccountInfo(SATI_PROGRAM_ID);

      expect(accountInfo).not.toBeNull();
      expect(accountInfo?.executable).toBe(true);

      console.log(`    SATI Program: ${SATI_PROGRAM_ID.toBase58()}`);
    });

    test("can query compressed accounts by owner (empty result ok)", async () => {
      // This tests that the Photon RPC accepts queries for our program
      // Empty results are expected if no attestations exist yet
      const result = await rpc.getCompressedAccountsByOwner(SATI_PROGRAM_ID, {
        limit: bn(1),
      });

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);

      console.log(`    SATI compressed accounts found: ${result.items.length}`);
    });
  });

  // ---------------------------------------------------------------------------
  // Validity Proof Infrastructure
  // ---------------------------------------------------------------------------

  describe("validity proof infrastructure", () => {
    test("can request validity proof for non-existent address", async () => {
      // Generate a random address that doesn't exist
      const randomAddress = PublicKey.unique();

      // Request validity proof (proves address doesn't exist)
      const proofResult = await rpc.getValidityProofV0(
        [], // No existing hashes
        [
          {
            address: bn(randomAddress.toBytes()),
            tree: V1_ADDRESS_TREE,
            queue: V1_ADDRESS_QUEUE,
          },
        ],
      );

      expect(proofResult).toBeDefined();
      expect(proofResult.compressedProof).toBeDefined();
      expect(proofResult.rootIndices).toBeDefined();

      console.log(`    Validity proof obtained for random address`);
      console.log(`    Proof size: ${JSON.stringify(proofResult.compressedProof).length} chars`);
    });
  });
});
