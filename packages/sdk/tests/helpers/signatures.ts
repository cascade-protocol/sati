/**
 * Ed25519 Signature Utilities for SATI Tests
 *
 * Provides real Ed25519 signing for attestation tests, replacing
 * the placeholder randomBytes(64) used in E2E test stubs.
 *
 * ## Identity Model
 * - `tokenAccount` = agent's **MINT ADDRESS** (stable identity)
 * - `agentKeypair` = NFT **OWNER**'s keypair (the signer)
 * - signature[0].pubkey = owner address (NOT mint)
 * - On-chain verifies owner via ATA ownership
 */

import nacl from "tweetnacl";
import { type Address, address, getAddressEncoder } from "@solana/kit";
import { Keypair, type PublicKey } from "@solana/web3.js";
import {
  computeInteractionHash,
  computeFeedbackHash,
  computeValidationHash,
  computeReputationHash,
  type Outcome,
} from "../../src/hashes";

// =============================================================================
// Types
// =============================================================================

export interface SignatureData {
  pubkey: Address;
  sig: Uint8Array;
}

export interface TestKeypair {
  publicKey: PublicKey;
  secretKey: Uint8Array;
  address: Address;
}

// =============================================================================
// Core Signing Functions
// =============================================================================

/**
 * Sign a message with Ed25519 using tweetnacl
 */
export function signMessage(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

/**
 * Verify an Ed25519 signature
 */
export function verifySignature(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  return nacl.sign.detached.verify(message, signature, publicKey);
}

/**
 * Create a test keypair with both web3.js and kit-compatible fields
 */
export function createTestKeypair(seed?: number): TestKeypair {
  let keypair: Keypair;

  if (seed !== undefined && seed < 256) {
    // Deterministic keypair for reproducible tests
    const seedBytes = new Uint8Array(32);
    seedBytes[0] = seed;
    keypair = Keypair.fromSeed(seedBytes);
  } else {
    keypair = Keypair.generate();
  }

  return {
    publicKey: keypair.publicKey,
    secretKey: keypair.secretKey,
    address: address(keypair.publicKey.toBase58()),
  };
}

// =============================================================================
// Feedback Signature Helpers
// =============================================================================

/**
 * Create dual signatures for a Feedback attestation.
 *
 * Agent signs the interaction hash (blind to outcome).
 * Counterparty signs the feedback hash (with outcome).
 *
 * @param tokenAccount - Agent's mint address to include in hash (defaults to agentKeypair.address)
 */
export function createFeedbackSignatures(
  sasSchema: Address,
  taskRef: Uint8Array,
  agentKeypair: TestKeypair,
  counterpartyKeypair: TestKeypair,
  dataHash: Uint8Array,
  outcome: Outcome,
  tokenAccount?: Address,
): SignatureData[] {
  // Use explicit tokenAccount if provided, otherwise use agent's address
  const tokenAddr = tokenAccount ?? agentKeypair.address;

  // Agent signs interaction hash (blind - doesn't know outcome)
  const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAddr, dataHash);
  const agentSig = signMessage(interactionHash, agentKeypair.secretKey);

  // Counterparty signs feedback hash (includes outcome)
  // On-chain program verifies against raw 32-byte hash
  const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAddr, outcome);
  const counterpartySig = signMessage(feedbackHash, counterpartyKeypair.secretKey);

  return [
    { pubkey: agentKeypair.address, sig: agentSig },
    { pubkey: counterpartyKeypair.address, sig: counterpartySig },
  ];
}

/**
 * Verify feedback signatures are valid.
 * Returns { valid: boolean, agentValid: boolean, counterpartyValid: boolean }
 */
export function verifyFeedbackSignatures(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  dataHash: Uint8Array,
  outcome: Outcome,
  signatures: SignatureData[],
): { valid: boolean; agentValid: boolean; counterpartyValid: boolean } {
  if (signatures.length !== 2) {
    return { valid: false, agentValid: false, counterpartyValid: false };
  }

  const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);

  const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);

  const encoder = getAddressEncoder();

  const agentValid = verifySignature(
    interactionHash,
    signatures[0].sig,
    new Uint8Array(encoder.encode(signatures[0].pubkey)),
  );

  const counterpartyValid = verifySignature(
    feedbackHash,
    signatures[1].sig,
    new Uint8Array(encoder.encode(signatures[1].pubkey)),
  );

  return {
    valid: agentValid && counterpartyValid,
    agentValid,
    counterpartyValid,
  };
}

// =============================================================================
// Validation Signature Helpers
// =============================================================================

/**
 * Create dual signatures for a Validation attestation.
 *
 * Agent signs the interaction hash (blind to response).
 * Validator signs the validation hash (with response score).
 *
 * @param tokenAccount - Agent's mint address to include in hash (defaults to agentKeypair.address)
 */
export function createValidationSignatures(
  sasSchema: Address,
  taskRef: Uint8Array,
  agentKeypair: TestKeypair,
  validatorKeypair: TestKeypair,
  dataHash: Uint8Array,
  response: number,
  tokenAccount?: Address,
): SignatureData[] {
  // Use explicit tokenAccount if provided, otherwise use agent's address
  const tokenAddr = tokenAccount ?? agentKeypair.address;

  // Agent signs interaction hash (blind)
  const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAddr, dataHash);
  const agentSig = signMessage(interactionHash, agentKeypair.secretKey);

  // Validator signs validation hash (includes response)
  const validationHash = computeValidationHash(sasSchema, taskRef, tokenAddr, response);
  const validatorSig = signMessage(validationHash, validatorKeypair.secretKey);

  return [
    { pubkey: agentKeypair.address, sig: agentSig },
    { pubkey: validatorKeypair.address, sig: validatorSig },
  ];
}

// =============================================================================
// ReputationScore Signature Helper
// =============================================================================

/**
 * Create single signature for a ReputationScore attestation.
 *
 * Only the provider signs (SingleSigner mode).
 */
export function createReputationSignature(
  sasSchema: Address,
  tokenAccount: Address,
  providerKeypair: TestKeypair,
  score: number,
): SignatureData[] {
  const reputationHash = computeReputationHash(sasSchema, tokenAccount, providerKeypair.address, score);

  const providerSig = signMessage(reputationHash, providerKeypair.secretKey);

  return [{ pubkey: providerKeypair.address, sig: providerSig }];
}

// =============================================================================
// Test Utilities
// =============================================================================

/**
 * Generate random 32-byte array for taskRef or dataHash
 */
export function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate random bytes of specified length
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}
