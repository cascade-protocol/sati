/**
 * Test RPC Utilities for SATI Tests
 *
 * Provides RPC client setup for integration and E2E tests
 * with Light Protocol and Photon indexer.
 */

import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

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

// =============================================================================
// Connection Utilities
// =============================================================================

/**
 * Get a Solana connection for tests
 */
export function getConnection(rpcUrl?: string): Connection {
  return new Connection(rpcUrl || DEFAULT_CONFIG.rpcUrl, "confirmed");
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
  connection: Connection,
  lamports: number = LAMPORTS_PER_SOL,
): Promise<Keypair> {
  const keypair = Keypair.generate();

  const sig = await connection.requestAirdrop(keypair.publicKey, lamports);
  await connection.confirmTransaction(sig, "confirmed");

  return keypair;
}

/**
 * Generate deterministic test keypair for reproducible tests
 */
export function getTestKeypair(seed: number): Keypair {
  if (seed < 0 || seed > 255) {
    throw new Error("Seed must be 0-255");
  }
  const seedBytes = new Uint8Array(32);
  seedBytes[0] = seed;
  return Keypair.fromSeed(seedBytes);
}

/**
 * Create a KeyPairSigner from a Keypair (for @solana/kit compatibility)
 */
export async function keypairToSigner(
  keypair: Keypair,
): Promise<KeyPairSigner> {
  return createKeyPairSignerFromBytes(keypair.secretKey);
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
export async function waitForIndexer(
  connection: Connection,
  delayMs: number = 1000,
): Promise<void> {
  // Get current slot
  const _slot = await connection.getSlot();

  // Wait for indexer to catch up
  await sleep(delayMs);

  // Optionally poll until slot is processed (for stricter tests)
  // This is a simplified version - full implementation would
  // query Photon's indexer height
}

/**
 * Retry a function until it succeeds or max attempts reached
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 5,
  delayMs: number = 500,
): Promise<T> {
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

export { DEFAULT_CONFIG };
