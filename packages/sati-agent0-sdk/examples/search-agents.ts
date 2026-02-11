/**
 * Search Agents Example
 *
 * This example demonstrates how to:
 * 1. Search for agents by various criteria
 * 2. Filter by capabilities (MCP, A2A, active)
 * 3. Get agent summaries
 *
 * Note: SATI search supports name, hasMCP, hasA2A, active, hasEndpoints,
 * and supportedTrust filters. mcpTools and feedback-based filters are
 * available in the EVM agent0-sdk but not yet on Solana.
 */

import { RPC_URL, NETWORK } from "./_env.js";
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";
import { generateKeyPairSigner } from "@solana/kit";

async function main() {
  // Initialize SDK in read-only mode (throwaway signer, no funds needed)
  const readOnlySigner = await generateKeyPairSigner();
  const sdk = new SatiSDK({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer: readOnlySigner,
  });

  // 1. Search agents by name
  console.log("Searching agents by name...");
  const nameResults = await sdk.searchAgents({ name: "AI" });
  console.log(`Found ${nameResults.length} agents matching "AI"`);

  // 2. Search agents with MCP endpoint
  console.log("\nSearching agents with MCP endpoint...");
  const mcpResults = await sdk.searchAgents({ hasMCP: true });
  console.log(`Found ${mcpResults.length} agents with MCP`);

  // 3. Search active agents
  // Note: On SATI, mcpTools filter is not supported. Use hasMCP instead.
  console.log("\nSearching active agents...");
  const activeResults = await sdk.searchAgents({ active: true });
  console.log(`Found ${activeResults.length} active agents`);
  for (const agent of activeResults.slice(0, 5)) {
    console.log(`  - ${agent.name} (${agent.agentId})`);
  }

  // 4. Get specific agent by ID
  console.log("\nGetting specific agent...");
  if (activeResults.length > 0) {
    const agentId = activeResults[0].agentId;
    const agent = await sdk.getAgent(agentId);
    if (!agent) {
      console.log(`Agent not found: ${agentId}`);
    } else {
      console.log(`Agent: ${agent.name}`);
      console.log(`Description: ${agent.description}`);
      console.log(`MCP: ${agent.mcp ?? "None"}`);
      console.log(`A2A: ${agent.a2a ?? "None"}`);
      console.log(`Active: ${agent.active}`);
      console.log(`x402 Support: ${agent.x402support}`);
    }
  } else {
    console.log("No agents found to query individually.");
  }

  // 5. Note on pagination
  console.log("\nNote: searchAgents() returns a full list.");
  console.log("Use Array.prototype.slice() for client-side pagination.");
  const allAgents = await sdk.searchAgents();
  console.log(`Total agents: ${allAgents.length}, showing first 10: ${allAgents.slice(0, 10).length}`);
}

main().catch(console.error);
