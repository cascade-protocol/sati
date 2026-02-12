/**
 * Feedback Usage Example
 *
 * This example demonstrates how to:
 * 1. Prepare a feedback file (off-chain payload)
 * 2. Give feedback on-chain
 * 3. Search for feedback
 * 4. Attempt appendResponse (not supported on SATI - expected error)
 * 5. Get reputation summary
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet
 * - AGENT_ID: existing agent ID in CAIP-2 format (solana:<chainRef>:<mint>)
 */

import { loadSigner, RPC_URL, AGENT_ID, NETWORK } from "./_env.js";
import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";

async function main() {
  const signer = await loadSigner();

  if (!AGENT_ID || AGENT_ID.trim() === "") {
    throw new Error("AGENT_ID is required for this example. Run quick-start.ts first to get one.");
  }

  // Initialize SDK (no pinataJwt needed for on-chain feedback)
  const sdk = new SatiSDK({
    network: NETWORK,
    rpcUrl: RPC_URL,
    signer,
  });

  // 1. Prepare an off-chain feedback file (optional rich metadata)
  // On SATI, text is stored in the on-chain content JSON field.
  const feedbackFile = sdk.prepareFeedbackFile({
    text: "Excellent data analysis capabilities with fast response times.",
  });

  // 2. Give feedback on-chain
  console.log("Submitting feedback...");
  const handle = await sdk.giveFeedback(
    AGENT_ID,
    85,                                    // value (score)
    "data_analyst",                        // tag1
    "finance",                             // tag2
    "https://api.example.com/feedback",    // endpoint
    feedbackFile,                          // off-chain feedback payload
  );
  const { result: feedback } = await handle.waitMined();
  console.log(`Transaction signature: ${handle.hash}`);
  console.log(`Value: ${feedback.value}, Tags: ${feedback.tags}`);

  // 3. Search for feedback
  // Note: On SATI, compressed accounts are queryable immediately (no subgraph polling).
  console.log("\nSearching for feedback...");
  const results = await sdk.searchFeedback(
    { agentId: AGENT_ID, tags: ["data_analyst"] },
    { minValue: 70, maxValue: 100 },
  );
  console.log(`Found ${results.length} feedback entries with tag "data_analyst"`);

  // 4. Attempt appendResponse (expected to fail on SATI)
  if (results.length > 0) {
    console.log("\nAttempting appendResponse (expected to fail on SATI)...");
    try {
      await sdk.appendResponse(AGENT_ID, signer.address, 0, {
        uri: "ipfs://QmExampleResponse" as any,
        hash: "0x" + "00".repeat(32),
      });
    } catch (error) {
      console.log(`Expected error: ${error instanceof Error ? error.message : error}`);
    }
  }

  // 5. Get reputation summary
  console.log("\nGetting reputation summary...");
  const summary = await sdk.getReputationSummary(AGENT_ID, "data_analyst");
  console.log(`Reputation: ${summary.averageValue} from ${summary.count} reviews`);
}

main().catch(console.error);
