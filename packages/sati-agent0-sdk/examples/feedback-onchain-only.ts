/**
 * On-chain Only Feedback Example
 *
 * This example demonstrates how to submit feedback that is stored on-chain
 * (as a compressed SAS attestation on Solana):
 * - value (score)
 * - tag1, tag2
 * - endpoint (optional)
 *
 * No off-chain feedback file is created/uploaded.
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet (pays for transaction)
 * - AGENT_ID: existing agent ID in CAIP-2 format (solana:<chainRef>:<mint>)
 *   Run quick-start.ts first to get an agent ID.
 */

import { loadSigner, RPC_URL, AGENT_ID, NETWORK } from "./_env.js";
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";

async function main() {
  const signer = await loadSigner();

  if (!AGENT_ID || AGENT_ID.trim() === "") {
    throw new Error("AGENT_ID is required for this example. Run quick-start.ts first to get one.");
  }

  const sdk = new SatiSDK({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
  });

  console.log("Submitting on-chain only feedback...");
  const handle = await sdk.giveFeedback(
    AGENT_ID,
    92,           // value (score)
    "quality",    // tag1
    "latency",    // tag2
    "https://api.example.com/feedback", // optional endpoint
  );
  const { result: feedback } = await handle.waitMined();
  console.log(`Transaction signature: ${handle.hash}`);

  console.log("Submitted feedback:", {
    value: feedback.value,
    tags: feedback.tags,
    endpoint: feedback.endpoint,
  });

  // Verify via searchFeedback (compressed accounts are queryable immediately)
  console.log("\nVerifying via searchFeedback...");
  const results = await sdk.searchFeedback({
    agentId: AGENT_ID,
    reviewers: [signer.address],
  });
  console.log(`Found ${results.length} feedback entries from this reviewer`);
  if (results.length > 0) {
    const last = results[results.length - 1];
    console.log("Latest feedback:", {
      value: last.value,
      tags: last.tags,
      endpoint: last.endpoint,
    });
  }
}

main().catch(console.error);
