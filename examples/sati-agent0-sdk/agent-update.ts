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

import { loadSigner, RPC_URL, NETWORK } from "../shared/_env.js";
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

async function main() {
  const signer = await loadSigner();

  // Initialize SDK (uses hosted uploader by default, no Pinata JWT needed)
  const sdk = new SatiAgent0({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
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
  const regHandle = await agent.registerIPFS();
  const agentId =
    agent.agentId ??
    (() => {
      throw new Error("agentId missing after registration");
    })();
  console.log(`Registered agentId: ${agentId} (tx: ${regHandle.hash})`);

  // 2) Load it back from chain/IPFS
  const loaded = await sdk.loadAgent(agentId);

  console.log(`Loaded agent: ${loaded.name}`);
  console.log(`Current description: ${loaded.description}`);

  // 3) Update agent information in memory
  loaded.updateInfo("Updated AI Assistant", "Updated description with new skills and pricing");

  // Update metadata
  loaded.setMetadata({
    version: "1.1.0",
    tags: JSON.stringify(["data_analyst", "finance", "coding"]),
    pricing: "0.015",
  });

  // Update endpoint
  await loaded.setMCP("https://api.example.com/mcp-updated", "2025-06-18");

  // 4) Re-upload updated registration file and update on-chain URI
  console.log("Updating agent on-chain...");
  const updateHandle = await loaded.updateIPFS();
  console.log(`Agent updated! Transaction: ${updateHandle.hash}`);
}

main().catch(console.error);
