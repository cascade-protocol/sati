/**
 * Signer Methods Example
 *
 * This example demonstrates three ways to configure a signer for the SDK:
 * 1. Load from a Solana keypair JSON file
 * 2. Generate a new random keypair
 * 3. Read-only mode (throwaway signer, no funds needed)
 *
 * Note: Browser wallets (ERC-6963 / EIP-1193) are EVM-only and not
 * available on Solana. Use Solana wallet adapters for browser contexts.
 */

import { loadSigner, RPC_URL, NETWORK } from "../shared/_env.js";
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner } from "@solana/kit";

async function main() {
  console.log("=== SATI Agent0 SDK - Signer Configuration Methods ===\n");

  // ========================================
  // Method 1: Load from keypair JSON file
  // ========================================
  console.log("Method 1: Keypair JSON File");
  console.log("-------------------------------");

  try {
    const signer = await loadSigner();
    const sdkWithKeypair = new SatiAgent0({
      network: NETWORK,
      rpcUrl: RPC_URL,
      signer,
    });

    console.log("SDK initialized with keypair from file");
    console.log(`  Signer address: ${signer.address}`);
    console.log(`  Network: ${sdkWithKeypair.network}`);
  } catch (error) {
    console.log("  Skipped (KEYPAIR_PATH not set or file not found)");
    console.log(`  Error: ${error instanceof Error ? error.message : error}`);
  }
  console.log();

  // ========================================
  // Method 2: Generate a new random keypair
  // ========================================
  console.log("Method 2: Generate New Random Keypair");
  console.log("-------------------------------");

  const randomSigner = await generateKeyPairSigner();
  const sdkWithRandom = new SatiAgent0({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer: randomSigner,
  });

  console.log("SDK initialized with random keypair");
  console.log(`  Signer address: ${randomSigner.address}`);
  console.log(`  Network: ${sdkWithRandom.network}`);
  console.log("  Note: Fund this address before registering agents or giving feedback.");
  console.log();

  // ========================================
  // Method 3: Read-only mode (no signer)
  // ========================================
  console.log("Method 3: Read-Only Mode (No Signer)");
  console.log("----------------------------------------------");

  const readOnlySdk = new SatiAgent0({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  console.log(`SDK initialized in read-only mode (network: ${readOnlySdk.network})`);
  console.log(`  isReadOnly: ${readOnlySdk.isReadOnly}`);
  console.log("  Can search agents: yes");
  console.log("  Can read feedback: yes");
  console.log("  Can register agents: no (throws - requires signer)");
  console.log("  Can give feedback: no (throws - requires signer)");
  console.log();

  // ========================================
  // Usage example with any signer method
  // ========================================
  console.log("=== Example Usage ===");
  console.log("---------------------");

  // This works with any of the above signer methods
  const agent = sdkWithRandom.createAgent(
    "Test Agent",
    "An agent created with a random signer",
    "https://example.com/image.png",
  );

  console.log(`Agent created in memory: ${agent.name}`);
  console.log("  Ready for configuration and registration");
  console.log("  Note: Actual registration requires a funded signer");
}

main().catch(console.error);
