/**
 * Test Setup Utilities
 *
 * Provides lightweight test context for signature-only tests.
 */

import type { Address } from "@solana/kit";
import { createTestKeypair, type TestKeypair } from "./signatures";

// =============================================================================
// Types
// =============================================================================

/**
 * Lightweight test context for signature-only tests (no RPC required).
 * Use this for unit tests that only verify signature creation/verification.
 */
export interface SignatureTestContext {
  /** Agent keypair for signing */
  agentKeypair: TestKeypair;
  /** Counterparty keypair for dual signatures */
  counterpartyKeypair: TestKeypair;
  /** Validator keypair for validation attestations */
  validatorKeypair: TestKeypair;
  /** Provider keypair for reputation attestations */
  providerKeypair: TestKeypair;
  /** SAS schema address */
  sasSchema: Address;
}

// =============================================================================
// Setup Function
// =============================================================================

/**
 * Set up a lightweight test context for signature-only tests.
 *
 * Creates keypairs for signature testing without any RPC operations.
 * Use this for unit tests that don't need on-chain submission.
 *
 * @param baseSeed - Optional base seed for deterministic keypair generation
 */
export async function setupSignatureTest(baseSeed = 100): Promise<SignatureTestContext> {
  const [agentKeypair, counterpartyKeypair, validatorKeypair, providerKeypair, schemaKeypair] = await Promise.all([
    createTestKeypair(baseSeed),
    createTestKeypair(baseSeed + 1),
    createTestKeypair(baseSeed + 2),
    createTestKeypair(baseSeed + 3),
    createTestKeypair(baseSeed + 4),
  ]);

  return {
    agentKeypair,
    counterpartyKeypair,
    validatorKeypair,
    providerKeypair,
    sasSchema: schemaKeypair.address,
  };
}
