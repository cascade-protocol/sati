/**
 * Feedback Usage Example
 *
 * This example demonstrates how to:
 * 1. Give feedback on-chain
 * 2. Search for feedback
 * 3. Get reputation summary
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet
 * - AGENT_ID: existing agent ID in CAIP-2 format (solana:<chainRef>:<mint>)
 */

import { loadSigner, RPC_URL, AGENT_ID, NETWORK } from "../shared/_env.js";
import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";

async function main() {
  const signer = await loadSigner();

  if (!AGENT_ID || AGENT_ID.trim() === "") {
    throw new Error("AGENT_ID is required for this example. Run quick-start.ts first to get one.");
  }

  // Initialize SDK (no pinataJwt needed for on-chain feedback)
  const sdk = new SatiAgent0({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
  });

  // 1. Give feedback on-chain
  // Note: content (value + tags) must fit within ~100 bytes for CounterpartySigned mode.
  // Use IPFS/Arweave content type for larger payloads.
  console.log("Submitting feedback...");
  const handle = await sdk.giveFeedback(
    AGENT_ID,
    85, // value (score)
    "quality", // tag1
    "latency", // tag2
  );
  const { result: feedback } = await handle.waitMined();
  console.log(`Transaction signature: ${handle.hash}`);
  console.log(`Value: ${feedback.value}, Tags: ${feedback.tags}`);

  // 2. Search for feedback
  // Note: On SATI, compressed accounts are queryable immediately (no subgraph polling).
  console.log("\nSearching for feedback...");
  const results = await sdk.searchFeedback({ agentId: AGENT_ID, tags: ["quality"] }, { minValue: 70, maxValue: 100 });
  console.log(`Found ${results.length} feedback entries with tag "quality"`);

  // 3. Get reputation summary
  console.log("\nGetting reputation summary...");
  const summary = await sdk.getReputationSummary(AGENT_ID, "quality");
  console.log(`Reputation: ${summary.averageValue} from ${summary.count} reviews`);
}

main().catch(console.error);
