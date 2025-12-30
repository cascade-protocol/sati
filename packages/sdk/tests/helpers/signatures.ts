/**
 * Ed25519 Signature Utilities for SATI Tests
 *
 * Provides real Ed25519 signing for attestation tests using @solana/kit's
 * Web Crypto implementation.
 *
 * ## Identity Model
 * - `tokenAccount` = agent's **MINT ADDRESS** (stable identity)
 * - `agentKeypair` = NFT **OWNER**'s keypair (the signer)
 * - signature[0].pubkey = owner address (NOT mint)
 * - On-chain verifies owner via ATA ownership
 */

import {
  type Address,
  address,
  getAddressEncoder,
  getAddressDecoder,
  generateKeyPair,
  createKeyPairFromPrivateKeyBytes,
  signBytes,
  verifySignature as kitVerifySignature,
  signatureBytes,
} from "@solana/kit";
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
  /** CryptoKeyPair for Web Crypto operations */
  keyPair: CryptoKeyPair;
  /** Raw 32-byte Ed25519 public key (for test assertions) */
  publicKey: Uint8Array;
  /** 32-byte seed for creating signers (only available for seeded keypairs) */
  seed?: Uint8Array;
  /** Base58-encoded address */
  address: Address;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Import Ed25519 public key bytes as a CryptoKey for verification.
 */
async function importPublicKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bytes, { name: "Ed25519" }, true, ["verify"]);
}

/**
 * Export public key bytes from a CryptoKey.
 */
async function exportPublicKeyBytes(key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(exported);
}

// =============================================================================
// Core Signing Functions
// =============================================================================

/**
 * Sign a message with Ed25519 using Web Crypto
 */
export async function signMessage(message: Uint8Array, keyPair: CryptoKeyPair): Promise<Uint8Array> {
  return signBytes(keyPair.privateKey, message);
}

/**
 * Verify an Ed25519 signature using Web Crypto
 */
export async function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKeyBytes: Uint8Array,
): Promise<boolean> {
  const publicKey = await importPublicKey(publicKeyBytes);
  return kitVerifySignature(publicKey, signatureBytes(signature), message);
}

/**
 * Create a test keypair using Web Crypto
 */
export async function createTestKeypair(seed?: number): Promise<TestKeypair> {
  let keyPair: CryptoKeyPair;
  let seedBytes: Uint8Array | undefined;

  if (seed !== undefined && seed < 256) {
    // Deterministic keypair for reproducible tests
    seedBytes = new Uint8Array(32);
    seedBytes[0] = seed;
    keyPair = await createKeyPairFromPrivateKeyBytes(seedBytes, true);
  } else {
    keyPair = await generateKeyPair();
  }

  // Export public key and convert to base58 address
  const publicKey = await exportPublicKeyBytes(keyPair.publicKey);
  const addressDecoder = getAddressDecoder();
  const addressStr = addressDecoder.decode(publicKey);

  return {
    keyPair,
    publicKey,
    seed: seedBytes,
    address: address(addressStr),
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
export async function createFeedbackSignatures(
  sasSchema: Address,
  taskRef: Uint8Array,
  agentKeypair: TestKeypair,
  counterpartyKeypair: TestKeypair,
  dataHash: Uint8Array,
  outcome: Outcome,
  tokenAccount?: Address,
): Promise<SignatureData[]> {
  // Use explicit tokenAccount if provided, otherwise use agent's address
  const tokenAddr = tokenAccount ?? agentKeypair.address;

  // Agent signs interaction hash (blind - doesn't know outcome)
  const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAddr, dataHash);
  const agentSig = await signMessage(interactionHash, agentKeypair.keyPair);

  // Counterparty signs feedback hash (includes outcome)
  // On-chain program verifies against raw 32-byte hash
  const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAddr, outcome);
  const counterpartySig = await signMessage(feedbackHash, counterpartyKeypair.keyPair);

  return [
    { pubkey: agentKeypair.address, sig: agentSig },
    { pubkey: counterpartyKeypair.address, sig: counterpartySig },
  ];
}

/**
 * Verify feedback signatures are valid.
 * Returns { valid: boolean, agentValid: boolean, counterpartyValid: boolean }
 */
export async function verifyFeedbackSignatures(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  dataHash: Uint8Array,
  outcome: Outcome,
  signatures: SignatureData[],
): Promise<{ valid: boolean; agentValid: boolean; counterpartyValid: boolean }> {
  if (signatures.length !== 2) {
    return { valid: false, agentValid: false, counterpartyValid: false };
  }

  const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);

  const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);

  const encoder = getAddressEncoder();

  const agentValid = await verifySignature(
    interactionHash,
    signatures[0].sig,
    new Uint8Array(encoder.encode(signatures[0].pubkey)),
  );

  const counterpartyValid = await verifySignature(
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
export async function createValidationSignatures(
  sasSchema: Address,
  taskRef: Uint8Array,
  agentKeypair: TestKeypair,
  validatorKeypair: TestKeypair,
  dataHash: Uint8Array,
  response: number,
  tokenAccount?: Address,
): Promise<SignatureData[]> {
  // Use explicit tokenAccount if provided, otherwise use agent's address
  const tokenAddr = tokenAccount ?? agentKeypair.address;

  // Agent signs interaction hash (blind)
  const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAddr, dataHash);
  const agentSig = await signMessage(interactionHash, agentKeypair.keyPair);

  // Validator signs validation hash (includes response)
  const validationHash = computeValidationHash(sasSchema, taskRef, tokenAddr, response);
  const validatorSig = await signMessage(validationHash, validatorKeypair.keyPair);

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
export async function createReputationSignature(
  sasSchema: Address,
  tokenAccount: Address,
  providerKeypair: TestKeypair,
  score: number,
): Promise<SignatureData[]> {
  const reputationHash = computeReputationHash(sasSchema, tokenAccount, providerKeypair.address, score);

  const providerSig = await signMessage(reputationHash, providerKeypair.keyPair);

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
