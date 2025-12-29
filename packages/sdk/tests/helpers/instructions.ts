/**
 * Instruction Builders for SATI Tests
 *
 * Provides utilities for building Ed25519 verification instructions
 * and other transaction components needed for E2E tests.
 */

import { PublicKey, type TransactionInstruction, Ed25519Program } from "@solana/web3.js";
import { type Address, getAddressEncoder } from "@solana/kit";

// =============================================================================
// Types
// =============================================================================

export interface Ed25519SignatureParams {
  publicKey: PublicKey;
  message: Uint8Array;
  signature: Uint8Array;
}

// =============================================================================
// Ed25519 Verification Instructions
// =============================================================================

/**
 * Build Ed25519 verification instruction for a single signature.
 *
 * The SATI program verifies signatures via the Ed25519 program by
 * checking SYSVAR_INSTRUCTIONS for Ed25519 verification results.
 */
export function buildEd25519Instruction(params: Ed25519SignatureParams): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: params.publicKey.toBytes(),
    message: params.message,
    signature: params.signature,
  });
}

/**
 * Build multiple Ed25519 verification instructions.
 *
 * For DualSignature mode, two instructions are needed:
 * 1. Agent's signature on interaction hash
 * 2. Counterparty's signature on feedback/validation hash
 */
export function buildEd25519Instructions(signatures: Ed25519SignatureParams[]): TransactionInstruction[] {
  return signatures.map(buildEd25519Instruction);
}

/**
 * Build Ed25519 verification instructions for a feedback attestation.
 *
 * @param agentPubkey - Agent's public key
 * @param interactionHash - Hash agent signed (blind)
 * @param agentSig - Agent's signature
 * @param counterpartyPubkey - Counterparty's public key
 * @param feedbackHash - Hash counterparty signed (with outcome)
 * @param counterpartySig - Counterparty's signature
 */
export function buildFeedbackEd25519Instructions(
  agentPubkey: PublicKey,
  interactionHash: Uint8Array,
  agentSig: Uint8Array,
  counterpartyPubkey: PublicKey,
  feedbackHash: Uint8Array,
  counterpartySig: Uint8Array,
): TransactionInstruction[] {
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
 * Convert Address (kit) to PublicKey (web3.js)
 */
export function addressToPublicKey(addr: Address): PublicKey {
  const encoder = getAddressEncoder();
  return new PublicKey(encoder.encode(addr));
}

/**
 * Convert PublicKey (web3.js) to Address (kit)
 */
export function publicKeyToAddress(pubkey: PublicKey): Address {
  // Import inline to avoid circular dependency
  const { address } = require("@solana/kit");
  return address(pubkey.toBase58());
}
