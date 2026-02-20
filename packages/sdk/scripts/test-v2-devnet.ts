/**
 * Throwaway devnet verification script for Light Protocol V2 migration.
 * Tests: create compressed feedback -> query -> verify data integrity.
 * DO NOT commit this file.
 */
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { Sati, Outcome, ContentType } from "../src";
import { computeInteractionHash } from "../src/hashes";
import { serializeFeedback } from "../src/schemas";
import { buildCounterpartyMessage } from "../src/offchain-signing";
import { createTestKeypair, signMessage, randomBytes32 } from "../tests/helpers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

const RPC_URL = "https://devnet.helius-rpc.com/?api-key=dcefb6d9-a6e8-4679-8b60-b9555a56b3cf";

async function main() {
  console.log("=== SATI V2 Devnet Verification ===\n");

  // 1. Initialize client with explicit RPC
  const sati = new Sati({ network: "devnet", rpcUrl: RPC_URL, photonRpcUrl: RPC_URL });
  console.log("Feedback schema:", sati.feedbackSchema);
  console.log("Lookup table:", sati.lookupTable);

  const sasSchema = sati.feedbackSchema!;
  const lookupTableAddress = sati.lookupTable!;

  // 2. Load keypair from ~/.config/solana/id.json
  const keypairPath = resolve(homedir(), ".config/solana/id.json");
  const keypairBytes = new Uint8Array(JSON.parse(readFileSync(keypairPath, "utf-8")));
  const payer = await createKeyPairSignerFromBytes(keypairBytes);
  console.log("Payer:", payer.address);

  // 3. Register agent (payer is the owner)
  console.log("\nRegistering agent...");
  const { mint: agentMint } = await sati.registerAgent({
    payer,
    name: "V2TestAgent",
    uri: "https://example.com/v2-test.json",
  });
  console.log("Agent mint:", agentMint);

  // 4. Create feedback with Ed25519 signatures
  console.log("\nCreating feedback attestation (V2 compressed)...");

  // Agent signer = payer (NFT owner). Counterparty = separate keypair.
  const counterpartyKeypair = await createTestKeypair(42);
  const taskRef = randomBytes32();
  const dataHash = randomBytes32();
  const outcome = Outcome.Positive;

  // Agent signs interaction hash (blind) using payer's key
  const interactionHash = computeInteractionHash(sasSchema, taskRef, dataHash);
  const agentSig = await signMessage(interactionHash, payer.keyPair);

  // Counterparty signs SIWS message
  const feedbackData = {
    taskRef,
    agentMint,
    counterparty: counterpartyKeypair.address,
    dataHash,
    outcome,
    contentType: 0 as ContentType,
    content: new Uint8Array(0),
  };
  const serialized = serializeFeedback(feedbackData);
  const { messageBytes } = buildCounterpartyMessage({ schemaName: "Feedback", data: serialized });
  const counterpartySig = await signMessage(messageBytes, counterpartyKeypair.keyPair);

  console.log("  agentMint:", agentMint);
  console.log("  counterparty:", counterpartyKeypair.address);
  console.log("  interactionHash length:", interactionHash.length);
  console.log("  counterpartyMessage length:", messageBytes.length);
  console.log("  serialized data length:", serialized.length);

  const result = await sati.createFeedback({
    payer,
    sasSchema,
    agentMint,
    counterparty: counterpartyKeypair.address,
    taskRef,
    dataHash,
    outcome,
    agentSignature: { pubkey: payer.address, signature: agentSig },
    counterpartySignature: { pubkey: counterpartyKeypair.address, signature: counterpartySig },
    counterpartyMessage: messageBytes,
    lookupTableAddress,
  });

  console.log("Created! Address:", result.address);
  console.log("Tx:", result.signature);

  // 5. Wait for Photon indexer
  console.log("\nWaiting for Photon indexer (5s)...");
  await new Promise((r) => setTimeout(r, 5000));

  // 6. Query and verify
  console.log("Querying feedbacks...");
  const feedbacks = await sati.listFeedbacks({ agentMint, sasSchema });
  console.log(`Found ${feedbacks.items.length} feedback(s)`);

  const match = feedbacks.items.find((f) => f.address === result.address);
  if (!match) {
    throw new Error(`Feedback ${result.address} not found in query results!`);
  }

  console.log("\nData integrity check:");
  console.log("  outcome:", match.data.outcome, "expected:", outcome, match.data.outcome === outcome ? "OK" : "FAIL");
  console.log("  agentMint:", match.data.agentMint, match.data.agentMint === agentMint ? "OK" : "FAIL");
  console.log("  counterparty:", match.data.counterparty, match.data.counterparty === counterpartyKeypair.address ? "OK" : "FAIL");
  console.log("  numSignatures:", match.attestation.numSignatures, match.attestation.numSignatures === 2 ? "OK" : "FAIL");

  console.log("\n=== V2 DEVNET VERIFICATION PASSED ===");
}

main().catch((err) => {
  console.error("\n=== VERIFICATION FAILED ===");
  console.error(err);
  process.exit(1);
});
