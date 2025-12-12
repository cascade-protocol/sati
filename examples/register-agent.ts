/**
 * SATI Example: Register an Agent
 *
 * Demonstrates how to register a new agent identity using the SATI SDK.
 * Creates a Token-2022 NFT with metadata and group membership.
 */

import { createSolanaRpc, generateKeyPairSigner, lamports } from "@solana/kit";
import { SATI } from "@sati/sdk";

// Configuration
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const NETWORK = (process.env.NETWORK ?? "localnet") as
  | "mainnet"
  | "devnet"
  | "localnet";

async function main() {
  console.log("SATI Agent Registration Example\n");

  // Initialize SATI client
  const sati = new SATI({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  // Create or load payer keypair
  // In production, load from file or environment
  const payer = await generateKeyPairSigner();
  console.log(`Payer: ${payer.address}`);

  // Request airdrop for testing (localnet/devnet only)
  if (NETWORK !== "mainnet") {
    console.log("Requesting airdrop...");
    const rpc = createSolanaRpc(RPC_URL);
    await rpc.requestAirdrop(payer.address, lamports(1_000_000_000n)).send();
    // Wait for confirmation
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("Airdrop confirmed\n");
  }

  // Register agent using high-level SATI API
  console.log("Registering agent...");
  const result = await sati.registerAgent({
    payer,
    name: "MyAgent",
    symbol: "SATI",
    uri: "ipfs://QmYourRegistrationFileHash",
    additionalMetadata: [
      { key: "agentWallet", value: `solana:${payer.address}` },
      { key: "a2a", value: "https://agent.example/.well-known/agent-card.json" },
    ],
    nonTransferable: false,
  });

  console.log(`\nAgent registered successfully!`);
  console.log(`Agent ID (NFT Mint): ${result.mint}`);
  console.log(`Member Number: ${result.memberNumber}`);
  console.log(`Transaction: ${result.signature}`);

  // Load the agent back to verify
  console.log("\nVerifying registration...");
  const agent = await sati.loadAgent(result.mint);

  if (agent) {
    console.log(`Name: ${agent.name}`);
    console.log(`Symbol: ${agent.symbol}`);
    console.log(`URI: ${agent.uri}`);
    console.log(`Owner: ${agent.owner}`);
    console.log(`Non-transferable: ${agent.nonTransferable}`);
    console.log(`Metadata: ${JSON.stringify(agent.additionalMetadata)}`);
  }

  // Get registry statistics
  console.log("\nRegistry Statistics:");
  const stats = await sati.getRegistryStats();
  console.log(`Total Agents: ${stats.totalAgents}`);
  console.log(`Authority: ${stats.authority}`);
  console.log(`Immutable: ${stats.isImmutable}`);
}

main().catch(console.error);
