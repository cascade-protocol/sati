/**
 * Quick Start - sati-sdk
 *
 * Demonstrates how to:
 * 1. Initialize the Sati client
 * 2. Create an agent with SatiAgentBuilder
 * 3. Configure endpoints (MCP, A2A, wallet)
 * 4. Register on-chain with IPFS metadata
 *
 * Run: pnpm tsx examples/sati-sdk/quick-start.ts
 */

import { loadSigner, RPC_URL, NETWORK } from "../shared/_env.js";
import { Sati, createSatiUploader } from "@cascade-fyi/sati-sdk";

async function main() {
  const signer = await loadSigner();

  // Initialize client
  const sati = new Sati({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  // Create agent with fluent builder
  const builder = sati
    .createAgentBuilder(
      "My AI Assistant",
      "An intelligent assistant for data analysis and coding tasks.",
      "https://example.com/agent-image.png",
    )
    .setMCP("https://api.example.com/mcp", "2025-06-18", {
      tools: ["search", "analyze"],
      prompts: ["code-review"],
    })
    .setA2A("https://api.example.com/a2a", "1.0", {
      skills: ["data-analysis", "code-generation"],
    })
    .setWallet(signer.address)
    .setActive(true)
    .setX402Support(true)
    .setSupportedTrust(["reputation"]);

  // Register on-chain (hosted uploader = zero config)
  const uploader = createSatiUploader();

  console.log("Registering agent...");
  const result = await builder.register({
    payer: signer,
    uploader,
  });

  console.log(`Agent registered!`);
  console.log(`  Mint: ${result.mint}`);
  console.log(`  Member #${result.memberNumber}`);
  console.log(`  Tx: ${result.signature}`);
}

main().catch(console.error);
