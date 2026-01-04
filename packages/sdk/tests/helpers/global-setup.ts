/**
 * Global Test Setup for E2E Tests
 *
 * This file runs ONCE before all test files, creating shared resources
 * that all E2E tests can use. This prevents race conditions when multiple
 * test files run in parallel and try to create their own agents/schemas.
 *
 * Resources created:
 * - Funded payer keypair
 * - Registered agent with Token-2022 NFT
 * - Schema configs for different signature modes
 * - Address lookup table with all PDAs
 *
 * The context is saved to a temp file and loaded by each test file.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createKeyPairSignerFromPrivateKeyBytes, createSolanaRpc, generateKeyPairSigner, lamports } from "@solana/kit";
import { Sati } from "../../src";
import { SignatureMode, StorageType } from "../../src/generated";
import { createTestKeypair } from "./signatures";
import { createSatiLookupTable } from "./lookup-table";

// Path where global context is stored between setup and tests
export const GLOBAL_CONTEXT_PATH = path.join(tmpdir(), "sati-e2e-global-context.json");

const LOCALNET_RPC = "http://127.0.0.1:8899";
const LOCALNET_PHOTON = "http://127.0.0.1:8784";

/**
 * Serializable global context structure.
 * Seeds are stored as number arrays (like Solana CLI wallet format) for JSON compatibility.
 */
export interface SerializedGlobalContext {
  // Keypair seeds (32 bytes each, stored as number arrays)
  payerSeed: number[];
  authoritySeed: number[];
  agentOwnerSeed: number[];
  counterpartySeed: number[];

  // Test keypair seeds (for Ed25519 signing via createTestKeypair)
  agentOwnerKeypairSeed: number;
  counterpartyKeypairSeed: number;
  validatorKeypairSeed: number;
  providerKeypairSeed: number;

  // Registered addresses (base58 strings)
  agentMint: string;
  feedbackSchema: string;
  feedbackPublicSchema: string;
  lookupTableAddress: string;

  // Timestamp for debugging
  createdAt: string;
}

/**
 * Wait for a transaction to be confirmed.
 */
async function waitForConfirmation(
  rpc: ReturnType<typeof createSolanaRpc>,
  signature: string,
  maxAttempts = 30,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await rpc
      .getSignatureStatuses([signature as Parameters<typeof rpc.getSignatureStatuses>[0][0]])
      .send();
    if (status.value[0]?.confirmationStatus === "confirmed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Transaction ${signature} confirmation timed out after ${maxAttempts} attempts`);
}

/**
 * Global setup function - runs once before all tests.
 * Creates all shared resources and saves them to a temp file.
 */
export async function setup(): Promise<void> {
  console.log("\n🚀 Global E2E Setup: Creating shared test resources...\n");

  const rpc = createSolanaRpc(LOCALNET_RPC);
  const sati = new Sati({ network: "localnet", photonRpcUrl: LOCALNET_PHOTON });

  // Load authority from local wallet (same format as test-setup.ts)
  const walletPath = path.join(homedir(), ".config/solana/id.json");
  const walletSecret: number[] = JSON.parse(readFileSync(walletPath, "utf-8"));
  const authoritySeed = Uint8Array.from(walletSecret).slice(0, 32);
  const authority = await createKeyPairSignerFromPrivateKeyBytes(authoritySeed);

  // Create deterministic payer with a unique seed based on timestamp
  // Use a high seed number to avoid collision with other test keypairs
  const PAYER_SEED = 9999;
  const payerSeed = new Uint8Array(32);
  payerSeed[0] = PAYER_SEED & 0xff;
  payerSeed[1] = (PAYER_SEED >> 8) & 0xff;
  const payer = await createKeyPairSignerFromPrivateKeyBytes(payerSeed);

  console.log("  📝 Funding payer account...");
  const airdropSig = await rpc.requestAirdrop(payer.address, lamports(10_000_000_000n)).send();
  await waitForConfirmation(rpc, airdropSig);

  // Create deterministic test keypairs (use fixed seeds for reproducibility)
  // NOTE: Seeds must be < 256 for createTestKeypair to store the seed
  const AGENT_OWNER_SEED = 101;
  const COUNTERPARTY_SEED = 102;
  const VALIDATOR_SEED = 103;
  const PROVIDER_SEED = 104;

  const agentOwnerKeypair = await createTestKeypair(AGENT_OWNER_SEED);
  const counterpartyKeypair = await createTestKeypair(COUNTERPARTY_SEED);

  // Create signer from agent owner keypair
  if (!agentOwnerKeypair.seed) {
    throw new Error("agentOwnerKeypair must have a seed");
  }
  const agentOwner = await createKeyPairSignerFromPrivateKeyBytes(agentOwnerKeypair.seed);

  // Validate counterparty keypair has a seed (needed for serialization)
  if (!counterpartyKeypair.seed) {
    throw new Error("counterpartyKeypair must have a seed");
  }

  // Register agent
  console.log("  🤖 Registering shared agent...");
  const agentName = `GlobalTestAgent-${Date.now()}`;
  const agentResult = await sati.registerAgent({
    payer,
    owner: agentOwner.address,
    name: agentName,
    uri: "https://example.com/global-test-agent.json",
  });
  const agentMint = agentResult.mint;
  console.log(`     Agent mint: ${agentMint}`);

  // Register DualSignature schema (for most tests)
  console.log("  📋 Registering DualSignature schema (Feedback)...");
  const feedbackSchemaSigner = await generateKeyPairSigner();
  const feedbackSchema = feedbackSchemaSigner.address;
  await sati.registerSchemaConfig({
    payer,
    authority,
    sasSchema: feedbackSchema,
    signatureMode: SignatureMode.DualSignature,
    storageType: StorageType.Compressed,
    closeable: true,
    name: "Feedback",
  });
  console.log(`     Schema: ${feedbackSchema}`);

  // Register CounterpartySigned schema (for token-account-validation tests)
  console.log("  📋 Registering CounterpartySigned schema (FeedbackPublic)...");
  const feedbackPublicSchemaSigner = await generateKeyPairSigner();
  const feedbackPublicSchema = feedbackPublicSchemaSigner.address;
  await sati.registerSchemaConfig({
    payer,
    authority,
    sasSchema: feedbackPublicSchema,
    signatureMode: SignatureMode.CounterpartySigned,
    storageType: StorageType.Compressed,
    closeable: true,
    name: "FeedbackPublic",
  });
  console.log(`     Schema: ${feedbackPublicSchema}`);

  // Create lookup table with all schemas and agent ATA
  console.log("  🔗 Creating address lookup table...");
  const { address: lookupTableAddress } = await createSatiLookupTable(
    sati,
    payer,
    [feedbackSchema, feedbackPublicSchema],
    [{ mint: agentMint, owner: agentOwner.address }],
  );
  console.log(`     Lookup table: ${lookupTableAddress}`);

  // Serialize context to JSON file (using number arrays like Solana CLI wallet format)
  const serializedContext: SerializedGlobalContext = {
    payerSeed: Array.from(payerSeed),
    authoritySeed: Array.from(authoritySeed),
    agentOwnerSeed: Array.from(agentOwnerKeypair.seed),
    counterpartySeed: Array.from(counterpartyKeypair.seed),
    agentOwnerKeypairSeed: AGENT_OWNER_SEED,
    counterpartyKeypairSeed: COUNTERPARTY_SEED,
    validatorKeypairSeed: VALIDATOR_SEED,
    providerKeypairSeed: PROVIDER_SEED,
    agentMint,
    feedbackSchema,
    feedbackPublicSchema,
    lookupTableAddress,
    createdAt: new Date().toISOString(),
  };

  writeFileSync(GLOBAL_CONTEXT_PATH, JSON.stringify(serializedContext, null, 2));
  console.log(`\n✅ Global setup complete. Context saved to: ${GLOBAL_CONTEXT_PATH}\n`);
}

/**
 * Global teardown function - runs once after all tests.
 * Currently does nothing but could clean up resources if needed.
 */
export async function teardown(): Promise<void> {
  console.log("\n🧹 Global E2E Teardown complete.\n");
}
