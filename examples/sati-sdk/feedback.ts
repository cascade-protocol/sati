/**
 * Feedback - sati-sdk
 *
 * Demonstrates how to:
 * 1. Give feedback to an agent (on-chain compressed attestation)
 * 2. Search feedback by agent, tag, value range
 * 3. Get reputation summary (aggregate value)
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet
 * - AGENT_MINT: existing agent mint address (base58)
 *
 * Run: pnpm tsx examples/sati-sdk/feedback.ts
 */

import { loadSigner, RPC_URL, AGENT_MINT, NETWORK } from "../shared/_env.js";
import { Sati } from "@cascade-fyi/sati-sdk";
import { address } from "@solana/kit";

async function main() {
  const signer = await loadSigner();

  if (!AGENT_MINT) {
    throw new Error("AGENT_MINT is required. Run quick-start.ts first to register an agent.");
  }

  const sati = new Sati({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  const agentMint = address(AGENT_MINT);

  // 1. Give feedback
  console.log("Submitting feedback...");
  const result = await sati.giveFeedback({
    payer: signer,
    agentMint,
    value: 85,
    valueDecimals: 0,
    tag1: "quality",
    tag2: "latency",
    message: "Fast and accurate responses.",
  });
  console.log(`Feedback submitted!`);
  console.log(`  Tx: ${result.signature}`);
  console.log(`  Attestation: ${result.attestationAddress}`);

  // 2. Search feedback
  console.log("\nSearching feedback for this agent...");
  const feedbacks = await sati.searchFeedback({ agentMint });
  console.log(`Found ${feedbacks.length} feedback entries`);

  for (const fb of feedbacks.slice(0, 5)) {
    console.log(
      `  - value=${fb.value ?? "N/A"} tag1=${fb.tag1 ?? ""} tag2=${fb.tag2 ?? ""} ` +
        `from=${fb.counterparty.slice(0, 8)}...`,
    );
  }

  // 3. Search with tag filter
  console.log('\nSearching feedback with tag1 "quality"...');
  const quality = await sati.searchFeedback({
    agentMint,
    tag1: "quality",
  });
  console.log(`Found ${quality.length} entries with tag1 "quality"`);

  // 4. Get reputation summary
  console.log("\nGetting reputation summary...");
  const summary = await sati.getReputationSummary(agentMint);
  console.log(`Reputation: ${summary.averageValue.toFixed(1)} from ${summary.count} reviews`);
}

main().catch(console.error);
