/**
 * SATI Example: Give Feedback
 *
 * Demonstrates how to give feedback on an agent using the SATI SDK.
 * This follows the ERC-8004 feedback flow:
 * 1. Agent owner authorizes client (FeedbackAuth attestation)
 * 2. Client submits feedback (Feedback attestation)
 *
 * NOTE: Feedback methods require the SAS (Solana Attestation Service) SDK
 * which is not yet published. This example shows the intended API.
 */

import { address, generateKeyPairSigner } from "@solana/kit";
import { SATI, FEEDBACK_AUTH_SCHEMA, FEEDBACK_SCHEMA, SCHEMA_NAMES } from "@sati/sdk";

async function main() {
  console.log("SATI Feedback Example\n");

  // Initialize SATI client
  const sati = new SATI({ network: "devnet" });

  // Example addresses (in production, these would be real agent/client addresses)
  const agentMint = address("AgentMint11111111111111111111111111111111111");
  const clientPubkey = address("ClientPubkey111111111111111111111111111111111");

  // ============================================================
  // Step 1: Agent authorizes client to submit feedback
  // ============================================================
  console.log("Step 1: Authorize Feedback");
  console.log("==========================");
  console.log(`Schema: ${SCHEMA_NAMES.FEEDBACK_AUTH}`);
  console.log(`Layout: [${FEEDBACK_AUTH_SCHEMA.layout.join(", ")}]`);
  console.log();

  console.log("SATI API (requires sas-lib):");
  console.log("```typescript");
  console.log("// Agent owner authorizes client");
  console.log("const auth = await sati.authorizeFeedback({");
  console.log("  agentMint: agentMint,");
  console.log("  client: clientPubkey,");
  console.log("  maxSubmissions: 5,");
  console.log("  expiresAt: Date.now() / 1000 + 86400, // 24 hours");
  console.log("});");
  console.log("console.log(`Authorization: ${auth.attestation}`);");
  console.log("```\n");

  // ============================================================
  // Step 2: Client submits feedback
  // ============================================================
  console.log("Step 2: Submit Feedback");
  console.log("=======================");
  console.log(`Schema: ${SCHEMA_NAMES.FEEDBACK}`);
  console.log(`Layout: [${FEEDBACK_SCHEMA.layout.join(", ")}]`);
  console.log();

  console.log("SATI API (requires sas-lib):");
  console.log("```typescript");
  console.log("// Client submits feedback");
  console.log("const feedback = await sati.giveFeedback({");
  console.log("  agentMint: agentMint,");
  console.log("  score: 85,");
  console.log('  tag1: "reliable",');
  console.log('  tag2: "fast",');
  console.log('  fileUri: "ipfs://QmFeedbackDetails",');
  console.log('  paymentProof: "x402:signature123",');
  console.log("});");
  console.log("console.log(`Feedback: ${feedback.attestation}`);");
  console.log("```\n");

  // ============================================================
  // Step 3: Read feedback
  // ============================================================
  console.log("Step 3: Read Feedback");
  console.log("=====================");
  console.log("SATI API (requires sas-lib):");
  console.log("```typescript");
  console.log("const feedbackData = await sati.readFeedback(feedbackAttestation);");
  console.log("if (feedbackData) {");
  console.log("  console.log(`Score: ${feedbackData.score}`);");
  console.log("  console.log(`Tags: ${feedbackData.tag1}, ${feedbackData.tag2}`);");
  console.log("  console.log(`Revoked: ${feedbackData.revoked}`);");
  console.log("}");
  console.log("```\n");

  // ============================================================
  // Demonstrate actual API call (will throw helpful error)
  // ============================================================
  console.log("Attempting actual API call...\n");

  try {
    await sati.authorizeFeedback({
      agentMint,
      client: clientPubkey,
      maxSubmissions: 5,
    });
  } catch (error) {
    if (error instanceof Error) {
      console.log(`Expected error: ${error.message}\n`);
    }
  }

  console.log("For working attestations, see:");
  console.log("https://github.com/solana-foundation/solana-attestation-service");
}

main().catch(console.error);
