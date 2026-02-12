/**
 * Agent Builder - sati-sdk
 *
 * Demonstrates the full SatiAgentBuilder fluent API:
 * - All endpoint types (MCP, A2A, wallet, custom)
 * - Trust mechanisms
 * - Active/x402 flags
 * - Updating an existing agent
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet
 *
 * Run: pnpm tsx examples/sati-sdk/agent-builder.ts
 */

import { loadSigner, RPC_URL, PINATA_JWT, NETWORK } from "../shared/_env.js";
import { Sati, createPinataUploader, createSatiUploader } from "@cascade-fyi/sati-sdk";

async function main() {
  const signer = await loadSigner();

  const sati = new Sati({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  const uploader = PINATA_JWT ? createPinataUploader(PINATA_JWT) : createSatiUploader();

  // Build a fully-configured agent
  const builder = sati.createAgentBuilder(
    "Trading Bot",
    "AI-powered trading assistant with real-time market analysis.",
    "https://example.com/trading-bot.png",
  );

  builder
    // Protocol endpoints
    .setMCP("https://api.tradingbot.com/mcp", "2025-06-18", {
      tools: ["market-scan", "portfolio-analyze", "trade-execute"],
      prompts: ["market-analysis", "risk-assessment"],
      resources: ["market-data"],
    })
    .setA2A("https://api.tradingbot.com/.well-known/agent-card.json", "1.0", {
      skills: ["market-analysis", "portfolio-management", "trade-execution"],
    })
    .setWallet(signer.address)
    // Custom endpoint
    .setEndpoint({ name: "web", endpoint: "https://tradingbot.com" })
    // Trust and flags
    .setSupportedTrust(["reputation", "crypto-economic"])
    .setActive(true)
    .setX402Support(true)
    .setExternalUrl("https://tradingbot.com");

  // Inspect state before registration
  const params = builder.params;
  console.log("Agent configuration:");
  console.log(`  Name: ${params.name}`);
  console.log(`  Services: ${params.services?.length ?? 0}`);
  for (const ep of params.services ?? []) {
    console.log(`    - ${ep.name}: ${ep.endpoint}`);
  }
  console.log(`  Trust: ${params.supportedTrust?.join(", ")}`);
  console.log(`  Active: ${params.active}, x402: ${params.x402Support}`);

  // Register on-chain
  console.log("\nRegistering...");
  const result = await builder.register({ payer: signer, uploader });
  console.log(`Registered! Mint: ${result.mint}`);

  // Update the agent (change description, add endpoint)
  console.log("\nUpdating agent...");
  builder.updateInfo({ description: "Updated: now with DeFi protocol integration." });
  builder.setEndpoint({ name: "DID", endpoint: "did:web:tradingbot.com" });

  const updateResult = await builder.update({
    payer: signer,
    owner: signer,
    uploader,
  });
  console.log(`Updated! Tx: ${updateResult.signature}`);

  // Remove an endpoint
  builder.removeEndpoint("web");
  console.log(`\nServices after removal: ${builder.params.services?.length ?? 0}`);
}

main().catch(console.error);
