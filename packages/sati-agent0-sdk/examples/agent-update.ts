/**
 * Agent Update Example
 *
 * This example demonstrates how to:
 * 1. Create and register a new agent (so the signer is the owner)
 * 2. Load that agent back from chain/IPFS
 * 3. Update agent information in memory
 * 4. Re-register with updated information
 *
 * Note: On SATI, registerIPFS() on a loaded agent creates a NEW agent NFT.
 * An in-place metadata update is available in sati-sdk (updateAgentMetadata)
 * but is not yet exposed through the agent0 adapter. This example therefore
 * demonstrates the create-load-modify-register workflow.
 */

import { loadSigner, RPC_URL, PINATA_JWT, NETWORK } from "./_env.js";
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";

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

  // 1) Create + register a fresh agent (self-contained example)
  const agent = sdk.createAgent(
    "Update Example Agent",
    "An agent created by the update example script.",
    "https://example.com/agent-image.png",
  );
  await agent.setMCP("https://api.example.com/mcp", "2025-06-18");
  agent.setActive(true);

  console.log("Registering a new agent (setup for this example)...");
  const registration = await agent.registerIPFS();
  const agentId = registration.agentId;
  console.log(`Registered agentId: ${agentId}`);

  // 2) Load it back from chain/IPFS
  const loaded = await sdk.loadAgent(agentId);

  console.log(`Loaded agent: ${loaded.name}`);
  console.log(`Current description: ${loaded.description}`);

  // 3) Update agent information in memory
  loaded.updateInfo(
    "Updated AI Assistant",
    "Updated description with new skills and pricing",
  );

  // Update metadata
  loaded.setMetadata({
    version: "1.1.0",
    tags: JSON.stringify(["data_analyst", "finance", "coding"]),
    pricing: "0.015",
  });

  // Update endpoint
  await loaded.setMCP("https://api.example.com/mcp-updated", "2025-06-18");

  // 4) Re-register with updated information
  // Note: This creates a NEW agent NFT on SATI (unlike EVM where it updates in-place).
  console.log("Registering updated agent...");
  const updatedRegistration = await loaded.registerIPFS();
  console.log(`Updated agent registered with new ID: ${updatedRegistration.agentId}`);
  console.log(`Transaction signature: ${updatedRegistration.signature}`);
}

main().catch(console.error);
