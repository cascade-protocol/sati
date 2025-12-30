/**
 * Instruction Builders for SATI Tests
 *
 * Provides utilities for building Ed25519 verification instructions
 * and other transaction components needed for E2E tests.
 *
 * @solana/kit native implementation.
 */

import { type Address, type Instruction, getAddressEncoder } from "@solana/kit";
import {
  createEd25519Instruction,
  createBatchEd25519Instruction,
  type Ed25519SignatureParams,
} from "../../src/ed25519";

// =============================================================================
// Re-export SDK's Ed25519 types and functions
// =============================================================================

export { type Ed25519SignatureParams, createEd25519Instruction, createBatchEd25519Instruction };

// =============================================================================
// Ed25519 Verification Instructions (Test Helpers)
// =============================================================================

/**
 * Build Ed25519 verification instruction for a single signature.
 *
 * The SATI program verifies signatures via the Ed25519 program by
 * checking SYSVAR_INSTRUCTIONS for Ed25519 verification results.
 */
export function buildEd25519Instruction(params: Ed25519SignatureParams): Instruction {
  return createEd25519Instruction(params);
}

/**
 * Build multiple Ed25519 verification instructions.
 *
 * For DualSignature mode, two instructions are needed:
 * 1. Agent's signature on interaction hash
 * 2. Counterparty's signature on feedback/validation hash
 */
export function buildEd25519Instructions(signatures: Ed25519SignatureParams[]): Instruction[] {
  return signatures.map(buildEd25519Instruction);
}

/**
 * Build Ed25519 verification instructions for a feedback attestation.
 *
 * @param agentPubkey - Agent's public key (32 bytes)
 * @param interactionHash - Hash agent signed (blind)
 * @param agentSig - Agent's signature
 * @param counterpartyPubkey - Counterparty's public key (32 bytes)
 * @param feedbackHash - Hash counterparty signed (with outcome)
 * @param counterpartySig - Counterparty's signature
 */
export function buildFeedbackEd25519Instructions(
  agentPubkey: Uint8Array,
  interactionHash: Uint8Array,
  agentSig: Uint8Array,
  counterpartyPubkey: Uint8Array,
  feedbackHash: Uint8Array,
  counterpartySig: Uint8Array,
): Instruction[] {
  return [
    buildEd25519Instruction({
      publicKey: agentPubkey,
      message: interactionHash,
      signature: agentSig,
    }),
    buildEd25519Instruction({
      publicKey: counterpartyPubkey,
      message: feedbackHash,
      signature: counterpartySig,
    }),
  ];
}

// =============================================================================
// Address Conversion Utilities
// =============================================================================

/**
 * Convert Address (kit) to raw 32-byte public key
 */
export function addressToBytes(addr: Address): Uint8Array {
  const encoder = getAddressEncoder();
  return new Uint8Array(encoder.encode(addr));
}
