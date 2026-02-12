/**
 * Search Agents - sati-sdk
 *
 * Demonstrates how to:
 * 1. List all registered agents
 * 2. Filter by name, endpoint type, active status
 * 3. Include feedback stats in results
 *
 * No signer needed - read-only operations.
 *
 * Run: pnpm tsx examples/sati-sdk/search-agents.ts
 */

import { RPC_URL, NETWORK } from "../shared/_env.js";
import { Sati } from "@cascade-fyi/sati-sdk";

async function main() {
  const sati = new Sati({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  // 1. List all agents
  console.log("Listing all agents...");
  const all = await sati.searchAgents({ limit: 20 });
  console.log(`Found ${all.length} agents`);

  // 2. Filter by name
  console.log("\nSearching agents matching 'AI'...");
  const byName = await sati.searchAgents({ name: "AI" });
  console.log(`Found ${byName.length} agents matching "AI"`);

  // 3. Filter by endpoint type
  console.log("\nSearching agents with MCP endpoint...");
  const withMcp = await sati.searchAgents({ endpointTypes: ["MCP"] });
  console.log(`Found ${withMcp.length} agents with MCP`);

  // 4. Active agents only
  console.log("\nSearching active agents...");
  const active = await sati.searchAgents({ active: true });
  console.log(`Found ${active.length} active agents`);

  for (const agent of active.slice(0, 5)) {
    const endpoints = agent.registrationFile?.endpoints ?? [];
    const types = endpoints.map((e) => e.name).join(", ");
    console.log(`  - ${agent.identity.name} (${agent.identity.mint})`);
    console.log(`    Endpoints: ${types || "none"}`);
  }

  // 5. Include feedback stats (slower - extra RPC calls per agent)
  console.log("\nSearching agents with feedback stats...");
  const withStats = await sati.searchAgents({
    active: true,
    includeFeedbackStats: true,
    limit: 5,
  });
  for (const agent of withStats) {
    const stats = agent.feedbackStats;
    console.log(
      `  - ${agent.identity.name}: ` + `${stats?.count ?? 0} reviews, avg ${stats?.averageScore?.toFixed(1) ?? "N/A"}`,
    );
  }
}

main().catch(console.error);
