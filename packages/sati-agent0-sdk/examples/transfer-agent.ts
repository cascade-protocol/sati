/**
 * Agent Transfer Example
 *
 * This example demonstrates how to:
 * 1. Create and register a new agent (so the signer is the owner)
 * 2. Transfer the agent to a new owner
 * 3. Verify new owner on-chain
 *
 * Note: On Solana, transactions confirm before returning, so there is no
 * need to poll or wait for the transfer to settle (unlike EVM).
 */

import { loadSigner, RPC_URL, PINATA_JWT, NETWORK } from "./_env.js";
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner } from "@solana/kit";

async function main() {
  const signer = await loadSigner();

  if (!PINATA_JWT || PINATA_JWT.trim() === "") {
    throw new Error("PINATA_JWT is required for this example (registerIPFS uses Pinata)");
  }

  // Initialize SDK
  const sdk = new SatiSDK({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
    pinataJwt: PINATA_JWT,
  });

  // Create + register a fresh agent (self-contained example)
  const agent = sdk.createAgent(
    "Transfer Example Agent",
    "An agent created by the transfer example script.",
    "https://example.com/agent-image.png",
  );
  await agent.setMCP("https://api.example.com/mcp", "2025-06-18");
  agent.setActive(true);

  console.log("Registering a new agent (setup for transfer)...");
  const registration = await agent.registerIPFS();
  const agentId = registration.agentId;
  console.log(`Registered agentId: ${agentId}`);

  // Generate a new random keypair as the transfer destination
  const newOwnerKeypair = await generateKeyPairSigner();
  const newOwner = newOwnerKeypair.address;

  // Transfer agent
  console.log(`\nTransferring agent ${agentId} to ${newOwner}...`);
  const result = await sdk.transferAgent(agentId, newOwner);
  console.log("Transfer completed!");
  console.log(`Transaction signature: ${result.signature}`);

  // Verify new owner (Solana confirms before returning, no polling needed)
  console.log("\nVerifying new owner...");
  const ownerAddress = await sdk.getAgentOwner(agentId);
  console.log(`New owner: ${ownerAddress}`);

  const ok = ownerAddress === newOwner;
  console.log(`Transfer successful: ${ok}`);
  if (!ok) {
    throw new Error(`Transfer succeeded but owner did not update to ${newOwner}`);
  }
}

main().catch(console.error);
