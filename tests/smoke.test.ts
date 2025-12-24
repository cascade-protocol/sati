// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js PDA derivation

/**
 * SATI Registry Smoke Tests
 *
 * Non-destructive tests that run against devnet or mainnet to verify
 * core functionality works correctly on live networks.
 *
 * Usage:
 *   SOLANA_CLUSTER=devnet pnpm vitest run tests/smoke.test.ts
 *   SOLANA_CLUSTER=mainnet pnpm vitest run tests/smoke.test.ts
 *
 * Requirements:
 *   - SOLANA_CLUSTER env var (devnet or mainnet, defaults to devnet)
 *   - Wallet with SOL at ~/.config/solana/id.json (or ANCHOR_WALLET)
 *   - Registry must be initialized on target network
 */
import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Connection, clusterApiUrl } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getAccount,
  getMint,
  getTokenMetadata,
} from "@solana/spl-token";
import { describe, test, expect, beforeAll } from "vitest";
import type { SatiRegistry } from "../target/types/sati_registry";

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

function getConnection(cluster: Cluster): Connection {
  const url =
    cluster === "mainnet"
      ? clusterApiUrl("mainnet-beta")
      : clusterApiUrl("devnet");
  return new Connection(url, "confirmed");
}

function getProgram(
  connection: Connection,
  wallet: anchor.Wallet,
): Program<SatiRegistry> {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return anchor.workspace.SatiRegistry as Program<SatiRegistry>;
}

// =============================================================================
// Constants
// =============================================================================

const PROGRAM_ID = new PublicKey("satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz");

// Test agent metadata - using timestamp to ensure uniqueness
const TEST_AGENT_PREFIX = "SmokeTest";

// =============================================================================
// Smoke Tests
// =============================================================================

describe("sati-registry: smoke tests", () => {
  const cluster = getCluster();
  let connection: Connection;
  let wallet: anchor.Wallet;
  let program: Program<SatiRegistry>;
  let registryConfig: PublicKey;
  let groupMint: PublicKey;

  beforeAll(async () => {
    console.log(`\n  Running smoke tests on ${cluster.toUpperCase()}\n`);

    connection = getConnection(cluster);

    // Load wallet from default location or ANCHOR_WALLET
    const walletPath =
      process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;
    const keypairData = await import("node:fs").then((fs) =>
      JSON.parse(fs.readFileSync(walletPath, "utf-8")),
    );
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    wallet = new anchor.Wallet(keypair);

    program = getProgram(connection, wallet);

    // Derive PDAs
    [registryConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("registry")],
      PROGRAM_ID,
    );

    console.log(`  Wallet: ${wallet.publicKey.toBase58()}`);
    console.log(`  Registry Config: ${registryConfig.toBase58()}`);
  });

  // ---------------------------------------------------------------------------
  // Registry State Tests
  // ---------------------------------------------------------------------------

  describe("registry state", () => {
    test("registry config exists and is initialized", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);

      expect(config).toBeDefined();
      expect(config.groupMint).toBeDefined();
      expect(config.authority).toBeDefined();
      expect(config.totalAgents).toBeDefined();
      expect(config.bump).toBeDefined();

      // Store for other tests
      groupMint = config.groupMint;

      console.log(`    Group Mint: ${config.groupMint.toBase58()}`);
      console.log(`    Authority: ${config.authority.toBase58()}`);
      console.log(`    Total Agents: ${config.totalAgents.toString()}`);
    });

    test("group mint is valid Token-2022 mint", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      const mintInfo = await getMint(
        connection,
        config.groupMint,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );

      expect(mintInfo).toBeDefined();
      expect(mintInfo.decimals).toBe(0);
      // Group mint authority should be the registry PDA
      expect(mintInfo.mintAuthority?.toBase58()).toBe(
        registryConfig.toBase58(),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Agent Registration Tests
  // ---------------------------------------------------------------------------

  describe("agent registration", () => {
    test("registers a new agent successfully", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      const countBefore = config.totalAgents.toNumber();
      groupMint = config.groupMint;

      // Generate unique agent details
      const timestamp = Date.now();
      const agentName = `${TEST_AGENT_PREFIX}${timestamp}`;
      const agentSymbol = "SMOKE";
      const agentUri = `https://example.com/smoke-test-${timestamp}.json`;

      // Generate new mint keypair
      const agentMint = Keypair.generate();
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      console.log(`    Registering agent: ${agentName}`);
      console.log(`    Agent Mint: ${agentMint.publicKey.toBase58()}`);

      // Register agent
      const tx = await program.methods
        .registerAgent(
          agentName,
          agentSymbol,
          agentUri,
          [{ key: "test", value: "smoke" }], // minimal metadata
          false, // transferable
        )
        .accounts({
          payer: wallet.publicKey,
          owner: wallet.publicKey,
          groupMint: groupMint,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc();

      console.log(`    Transaction: ${tx}`);

      // Wait for confirmation
      await connection.confirmTransaction(tx, "confirmed");

      // Verify counter incremented
      const configAfter =
        await program.account.registryConfig.fetch(registryConfig);
      expect(configAfter.totalAgents.toNumber()).toBe(countBefore + 1);

      // Verify NFT minted to owner
      const tokenAccount = await getAccount(
        connection,
        agentTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(tokenAccount.amount.toString()).toBe("1");
      expect(tokenAccount.owner.toBase58()).toBe(wallet.publicKey.toBase58());

      // Verify mint properties
      const mintInfo = await getMint(
        connection,
        agentMint.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(mintInfo.supply.toString()).toBe("1");
      expect(mintInfo.decimals).toBe(0);
      expect(mintInfo.mintAuthority).toBeNull(); // renounced

      // Verify metadata
      const metadata = await getTokenMetadata(connection, agentMint.publicKey);
      expect(metadata?.name).toBe(agentName);
      expect(metadata?.symbol).toBe(agentSymbol);
      expect(metadata?.uri).toBe(agentUri);

      // Verify additional metadata
      const additionalMap = new Map(metadata?.additionalMetadata || []);
      expect(additionalMap.get("test")).toBe("smoke");

      console.log(
        `    Agent #${configAfter.totalAgents} registered successfully`,
      );
    });

    test("registers non-transferable (soulbound) agent", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      groupMint = config.groupMint;

      const timestamp = Date.now();
      const agentMint = Keypair.generate();
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      console.log(`    Registering soulbound agent...`);

      const tx = await program.methods
        .registerAgent(
          `Soulbound${timestamp}`,
          "SOUL",
          `https://example.com/soul-${timestamp}.json`,
          null,
          true, // non-transferable
        )
        .accounts({
          payer: wallet.publicKey,
          owner: wallet.publicKey,
          groupMint: groupMint,
          agentMint: agentMint.publicKey,
          agentTokenAccount,
        })
        .signers([agentMint])
        .rpc();

      await connection.confirmTransaction(tx, "confirmed");

      // Verify NFT was minted
      const tokenAccount = await getAccount(
        connection,
        agentTokenAccount,
        undefined,
        TOKEN_2022_PROGRAM_ID,
      );
      expect(tokenAccount.amount.toString()).toBe("1");

      console.log(
        `    Soulbound agent registered: ${agentMint.publicKey.toBase58()}`,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Validation Error Tests (no state changes on failure)
  // ---------------------------------------------------------------------------

  describe("validation errors", () => {
    test("rejects name > 32 bytes", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      groupMint = config.groupMint;

      const agentMint = Keypair.generate();
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const longName = "A".repeat(33);

      await expect(
        program.methods
          .registerAgent(longName, "TEST", "https://example.com", null, false)
          .accounts({
            payer: wallet.publicKey,
            owner: wallet.publicKey,
            groupMint: groupMint,
            agentMint: agentMint.publicKey,
            agentTokenAccount,
          })
          .signers([agentMint])
          .rpc(),
      ).rejects.toThrow(/NameTooLong|Name too long/);
    });

    test("rejects symbol > 10 bytes", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      groupMint = config.groupMint;

      const agentMint = Keypair.generate();
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const longSymbol = "S".repeat(11);

      await expect(
        program.methods
          .registerAgent(
            "TestAgent",
            longSymbol,
            "https://example.com",
            null,
            false,
          )
          .accounts({
            payer: wallet.publicKey,
            owner: wallet.publicKey,
            groupMint: groupMint,
            agentMint: agentMint.publicKey,
            agentTokenAccount,
          })
          .signers([agentMint])
          .rpc(),
      ).rejects.toThrow(/SymbolTooLong|Symbol too long/);
    });

    test("rejects URI > 200 bytes", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      groupMint = config.groupMint;

      const agentMint = Keypair.generate();
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const longUri = `https://example.com/${"a".repeat(200)}`;

      await expect(
        program.methods
          .registerAgent("TestAgent", "TEST", longUri, null, false)
          .accounts({
            payer: wallet.publicKey,
            owner: wallet.publicKey,
            groupMint: groupMint,
            agentMint: agentMint.publicKey,
            agentTokenAccount,
          })
          .signers([agentMint])
          .rpc(),
      ).rejects.toThrow(/UriTooLong|URI too long/);
    });

    test("rejects > 10 metadata entries", async () => {
      const config = await program.account.registryConfig.fetch(registryConfig);
      groupMint = config.groupMint;

      const agentMint = Keypair.generate();
      const agentTokenAccount = getAssociatedTokenAddressSync(
        agentMint.publicKey,
        wallet.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const tooManyEntries = Array.from({ length: 11 }, (_, i) => ({
        key: `key${i}`,
        value: `value${i}`,
      }));

      await expect(
        program.methods
          .registerAgent(
            "TestAgent",
            "TEST",
            "https://example.com",
            tooManyEntries,
            false,
          )
          .accounts({
            payer: wallet.publicKey,
            owner: wallet.publicKey,
            groupMint: groupMint,
            agentMint: agentMint.publicKey,
            agentTokenAccount,
          })
          .signers([agentMint])
          .rpc(),
      ).rejects.toThrow(/TooManyMetadataEntries|Too many metadata/);
    });
  });
});
