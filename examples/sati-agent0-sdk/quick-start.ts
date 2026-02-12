/**
 * Quick Start Example
 *
 * This example demonstrates how to:
 * 1. Initialize the SDK
 * 2. Create a new agent
 * 3. Configure endpoints and metadata
 * 4. Register the agent on-chain with IPFS
 */

import { loadSigner, RPC_URL, PINATA_JWT, NETWORK } from "../shared/_env.js";
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

async function main() {
  const signer = await loadSigner();

  if (!PINATA_JWT || PINATA_JWT.trim() === "") {
    throw new Error("PINATA_JWT is required for this example (registerIPFS uses Pinata)");
  }

  // Initialize SDK
  const sdk = new SatiAgent0({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
    pinataJwt: PINATA_JWT,
  });

  // Create a new agent
  const agent = sdk.createAgent(
    "My AI Assistant",
    "An intelligent assistant that helps with various tasks. Skills: data analysis, finance, coding. Pricing: $0.01 per request.",
    "https://example.com/agent-image.png",
  );

  // Configure MCP endpoint
  await agent.setMCP("https://api.example.com/mcp", "2025-06-18");

  // Configure A2A endpoint
  await agent.setA2A("https://api.example.com/a2a", "0.30");

  // Set trust models
  agent.setTrust(true, false);

  // Add OASF skills and domains (standardized taxonomies)
  agent.addSkill("advanced_reasoning_planning/strategic_planning");
  agent.addDomain("finance_and_business/investment_services");

  // Set custom metadata
  agent.setMetadata({
    version: "1.0.0",
    tags: JSON.stringify(["data_analyst", "finance"]),
    pricing: "0.01",
  });

  // Set active status
  agent.setActive(true);

  // Register agent on-chain with IPFS
  console.log("Registering agent...");
  const handle = await agent.registerIPFS();
  const { result } = await handle.waitMined();
  console.log(`Agent registered with ID: ${result.agentId}`);
  console.log(`Transaction signature: ${handle.hash}`);
}

main().catch(console.error);
