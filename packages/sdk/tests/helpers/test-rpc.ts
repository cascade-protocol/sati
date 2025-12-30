/**
 * Test RPC Utilities for SATI Tests
 *
 * Provides RPC client setup for integration and E2E tests
 * with Light Protocol and Photon indexer.
 *
 * @solana/kit native implementation.
 */

import {
  createSolanaRpc,
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  type KeyPairSigner,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";

// =============================================================================
// Configuration
// =============================================================================

export interface TestRpcConfig {
  rpcUrl: string;
  photonUrl: string;
  proverUrl: string;
}

const DEFAULT_CONFIG: TestRpcConfig = {
  rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8899",
  photonUrl: process.env.PHOTON_URL || "http://127.0.0.1:8784",
  proverUrl: process.env.PROVER_URL || "http://127.0.0.1:3001",
};

const LAMPORTS_PER_SOL = 1_000_000_000n;

// =============================================================================
// RPC Utilities
// =============================================================================

/**
 * Get a Solana RPC client for tests
 */
export function getRpc(rpcUrl?: string): Rpc<SolanaRpcApi> {
  return createSolanaRpc(rpcUrl || DEFAULT_CONFIG.rpcUrl);
}

/**
 * Check if test validator is running and healthy
 */
export async function isTestValidatorReady(rpcUrl?: string): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl || DEFAULT_CONFIG.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// Account Utilities
// =============================================================================

/**
 * Create a new keypair with airdropped lamports
 */
export async function newAccountWithLamports(
  rpc: Rpc<SolanaRpcApi>,
  lamports: bigint = LAMPORTS_PER_SOL,
): Promise<KeyPairSigner> {
  const signer = await generateKeyPairSigner();

  const sig = await rpc.requestAirdrop(signer.address, lamports).send();
  await waitForConfirmation(rpc, sig);

  return signer;
}

/**
 * Generate deterministic test keypair for reproducible tests
 */
export async function getTestKeypair(seed: number): Promise<KeyPairSigner> {
  if (seed < 0 || seed > 255) {
    throw new Error("Seed must be 0-255");
  }
  const seedBytes = new Uint8Array(64);
  seedBytes[0] = seed;
  // Ed25519 requires 64 bytes for secret key (32 seed + 32 derived public key)
  // For deterministic generation, we need to use crypto
  // createKeyPairSignerFromBytes expects a 64-byte secret key
  // Let's use a hash to generate the full key deterministically
  const hashBuffer = await crypto.subtle.digest("SHA-512", seedBytes.slice(0, 32));
  return createKeyPairSignerFromBytes(new Uint8Array(hashBuffer));
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for indexer to process recent transactions.
 *
 * For Light Protocol Photon indexer, this ensures compressed
 * accounts are queryable after creation.
 */
export async function waitForIndexer(rpc?: Rpc<SolanaRpcApi>, delayMs: number = 1000): Promise<void> {
  // Use provided RPC or create default for localnet
  const rpcClient = rpc ?? createSolanaRpc("http://127.0.0.1:8899");

  // Get current slot to verify connection
  const _slot = await rpcClient.getSlot().send();

  // Wait for indexer to catch up
  await sleep(delayMs);

  // Optionally poll until slot is processed (for stricter tests)
  // This is a simplified version - full implementation would
  // query Photon's indexer height
}

/**
 * Wait for a transaction to be confirmed
 */
async function waitForConfirmation(
  rpc: Rpc<SolanaRpcApi>,
  signature: string,
  maxAttempts = 30,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await rpc
      .getSignatureStatuses([signature as Parameters<SolanaRpcApi["getSignatureStatuses"]>[0][0]])
      .send();
    if (status.value[0]?.confirmationStatus === "confirmed") {
      return;
    }
    await sleep(delayMs);
  }
  throw new Error(`Transaction ${signature} confirmation timed out after ${maxAttempts} attempts`);
}

/**
 * Retry a function until it succeeds or max attempts reached
 */
export async function retry<T>(fn: () => Promise<T>, maxAttempts: number = 5, delayMs: number = 500): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

// =============================================================================
// Exports
// =============================================================================

export { DEFAULT_CONFIG, LAMPORTS_PER_SOL };
