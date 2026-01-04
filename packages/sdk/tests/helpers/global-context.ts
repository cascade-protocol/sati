/**
 * Global Context Loader for E2E Tests
 *
 * Loads the shared test context created by global-setup.ts.
 * Each test file calls loadGlobalContext() in beforeAll to get
 * access to pre-created resources without race conditions.
 */

import { readFileSync, existsSync } from "node:fs";
import { createKeyPairSignerFromPrivateKeyBytes, createSolanaRpc, type KeyPairSigner, type Address } from "@solana/kit";
import { Sati } from "../../src";
import { createTestKeypair, type TestKeypair } from "./signatures";
import { GLOBAL_CONTEXT_PATH, type SerializedGlobalContext } from "./global-setup";

const LOCALNET_PHOTON = "http://127.0.0.1:8784";

/**
 * Loaded global context with all keypairs and addresses ready to use.
 */
export interface GlobalTestContext {
  /** SATI SDK client */
  sati: Sati;

  /** Transaction fee payer (funded) */
  payer: KeyPairSigner;

  /** Registry authority (local wallet) */
  authority: KeyPairSigner;

  /** Agent owner signer */
  agentOwner: KeyPairSigner;
  /** Agent owner keypair for Ed25519 signing */
  agentOwnerKeypair: TestKeypair;
  /** Registered agent's mint address */
  agentMint: Address;

  /** Counterparty signer */
  counterparty: KeyPairSigner;
  /** Counterparty keypair for Ed25519 signing */
  counterpartyKeypair: TestKeypair;

  /** Validator keypair for Ed25519 signing */
  validatorKeypair: TestKeypair;

  /** Provider keypair for Ed25519 signing */
  providerKeypair: TestKeypair;

  /** DualSignature schema (Feedback) */
  feedbackSchema: Address;

  /** CounterpartySigned schema (FeedbackPublic) */
  feedbackPublicSchema: Address;

  /** Address lookup table */
  lookupTableAddress: Address;
}

// Cached context to avoid reloading for each test file
let cachedContext: GlobalTestContext | null = null;

/**
 * Load the global test context created by global-setup.ts.
 *
 * This function is idempotent - it caches the loaded context
 * and returns the same instance on subsequent calls within
 * the same test process.
 *
 * @throws Error if global setup hasn't run (context file doesn't exist)
 */
export async function loadGlobalContext(): Promise<GlobalTestContext> {
  // Return cached context if already loaded
  if (cachedContext) {
    return cachedContext;
  }

  // Check if global setup has run
  if (!existsSync(GLOBAL_CONTEXT_PATH)) {
    throw new Error(
      `Global test context not found at ${GLOBAL_CONTEXT_PATH}. ` +
        `Make sure globalSetup is configured in vitest.config.ts and the test validator is running.`,
    );
  }

  // Load serialized context
  const serialized: SerializedGlobalContext = JSON.parse(readFileSync(GLOBAL_CONTEXT_PATH, "utf-8"));

  // Reconstruct keypairs from seeds (number arrays -> Uint8Array)
  const payerSeed = Uint8Array.from(serialized.payerSeed);
  const authoritySeed = Uint8Array.from(serialized.authoritySeed);
  const agentOwnerSeed = Uint8Array.from(serialized.agentOwnerSeed);
  const counterpartySeed = Uint8Array.from(serialized.counterpartySeed);

  const [payer, authority, agentOwner, counterparty] = await Promise.all([
    createKeyPairSignerFromPrivateKeyBytes(payerSeed),
    createKeyPairSignerFromPrivateKeyBytes(authoritySeed),
    createKeyPairSignerFromPrivateKeyBytes(agentOwnerSeed),
    createKeyPairSignerFromPrivateKeyBytes(counterpartySeed),
  ]);

  // Reconstruct test keypairs using the same seeds
  const [agentOwnerKeypair, counterpartyKeypair, validatorKeypair, providerKeypair] = await Promise.all([
    createTestKeypair(serialized.agentOwnerKeypairSeed),
    createTestKeypair(serialized.counterpartyKeypairSeed),
    createTestKeypair(serialized.validatorKeypairSeed),
    createTestKeypair(serialized.providerKeypairSeed),
  ]);

  // Create SDK client
  const sati = new Sati({ network: "localnet", photonRpcUrl: LOCALNET_PHOTON });

  // Build and cache context
  cachedContext = {
    sati,
    payer,
    authority,
    agentOwner,
    agentOwnerKeypair,
    agentMint: serialized.agentMint as Address,
    counterparty,
    counterpartyKeypair,
    validatorKeypair,
    providerKeypair,
    feedbackSchema: serialized.feedbackSchema as Address,
    feedbackPublicSchema: serialized.feedbackPublicSchema as Address,
    lookupTableAddress: serialized.lookupTableAddress as Address,
  };

  return cachedContext;
}

/**
 * Clear the cached context.
 * Useful for testing the loader itself.
 */
export function clearContextCache(): void {
  cachedContext = null;
}

// =============================================================================
// Test Utilities
// =============================================================================

const LOCALNET_RPC = "http://127.0.0.1:8899";

/**
 * Wait for Light Protocol's Photon indexer to process recent transactions.
 *
 * Call this after on-chain operations before querying compressed accounts.
 */
export async function waitForIndexer(delayMs = 1000): Promise<void> {
  const rpc = createSolanaRpc(LOCALNET_RPC);
  await rpc.getSlot().send(); // Verify connection
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
