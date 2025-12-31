/**
 * Domain-separated hash functions for SATI attestations.
 *
 * These functions must produce identical hashes to the Rust implementations
 * in programs/sati/src/signature.rs. Uses keccak256 from @noble/hashes.
 *
 * ## Identity Model
 * - `tokenAccount` = agent's **MINT ADDRESS** (stable identity)
 * - The agent NFT **OWNER** signs (verified via ATA ownership on-chain)
 * - Hashes include the mint address; signatures come from the owner
 * - Naming is for SAS wire format compatibility (NOT an Associated Token Account)
 */

import { keccak_256 } from "@noble/hashes/sha3.js";
import { type Address, getAddressEncoder } from "@solana/kit";

// Domain separators - must match programs/sati/src/constants.rs
const DOMAIN_INTERACTION = new TextEncoder().encode("SATI:interaction:v1");
const DOMAIN_FEEDBACK = new TextEncoder().encode("SATI:feedback:v1");
const DOMAIN_VALIDATION = new TextEncoder().encode("SATI:validation:v1");
const DOMAIN_REPUTATION = new TextEncoder().encode("SATI:reputation:v1");
const DOMAIN_EVM_LINK = new TextEncoder().encode("SATI:evm_link:v1");

/**
 * Helper to convert Address to 32-byte Uint8Array
 */
function addressToBytes(address: Address): Uint8Array {
  const encoder = getAddressEncoder();
  // Convert ReadonlyUint8Array to mutable Uint8Array
  return new Uint8Array(encoder.encode(address));
}

/**
 * Compute the interaction hash that the agent signs (blind to outcome).
 * Domain: SATI:interaction:v1
 *
 * @param sasSchema - SAS schema address
 * @param taskRef - 32-byte task reference (e.g., CAIP-220 tx hash)
 * @param tokenAccount - Agent's mint address (named for SAS compatibility)
 * @param dataHash - 32-byte hash of the request/interaction data
 * @returns 32-byte keccak256 hash
 */
export function computeInteractionHash(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  dataHash: Uint8Array,
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }
  if (dataHash.length !== 32) {
    throw new Error("dataHash must be 32 bytes");
  }

  const data = new Uint8Array(
    DOMAIN_INTERACTION.length + 32 + 32 + 32 + 32, // domain + schema + taskRef + tokenAccount + dataHash
  );

  let offset = 0;
  data.set(DOMAIN_INTERACTION, offset);
  offset += DOMAIN_INTERACTION.length;
  data.set(addressToBytes(sasSchema), offset);
  offset += 32;
  data.set(taskRef, offset);
  offset += 32;
  data.set(addressToBytes(tokenAccount), offset);
  offset += 32;
  data.set(dataHash, offset);

  return keccak_256(data);
}

/**
 * Compute the feedback hash that the counterparty signs (with outcome).
 * Domain: SATI:feedback:v1
 *
 * @param sasSchema - SAS schema address
 * @param taskRef - 32-byte task reference
 * @param tokenAccount - Agent's mint address (named for SAS compatibility)
 * @param outcome - Feedback outcome: 0=Negative, 1=Neutral, 2=Positive
 * @returns 32-byte keccak256 hash
 */
export function computeFeedbackHash(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  outcome: number,
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }
  if (!Number.isInteger(outcome) || outcome < 0 || outcome > 2) {
    throw new Error("outcome must be 0, 1, or 2");
  }

  const data = new Uint8Array(
    DOMAIN_FEEDBACK.length + 32 + 32 + 32 + 1, // domain + schema + taskRef + tokenAccount + outcome
  );

  let offset = 0;
  data.set(DOMAIN_FEEDBACK, offset);
  offset += DOMAIN_FEEDBACK.length;
  data.set(addressToBytes(sasSchema), offset);
  offset += 32;
  data.set(taskRef, offset);
  offset += 32;
  data.set(addressToBytes(tokenAccount), offset);
  offset += 32;
  data[offset] = outcome;

  return keccak_256(data);
}

/**
 * Compute the validation hash that the counterparty signs (with response score).
 * Domain: SATI:validation:v1
 *
 * @param sasSchema - SAS schema address
 * @param taskRef - 32-byte task reference
 * @param tokenAccount - Agent's mint address (named for SAS compatibility)
 * @param response - Validation response score: 0-100
 * @returns 32-byte keccak256 hash
 */
export function computeValidationHash(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  response: number,
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }
  if (!Number.isInteger(response) || response < 0 || response > 100) {
    throw new Error("response must be an integer 0-100");
  }

  const data = new Uint8Array(
    DOMAIN_VALIDATION.length + 32 + 32 + 32 + 1, // domain + schema + taskRef + tokenAccount + response
  );

  let offset = 0;
  data.set(DOMAIN_VALIDATION, offset);
  offset += DOMAIN_VALIDATION.length;
  data.set(addressToBytes(sasSchema), offset);
  offset += 32;
  data.set(taskRef, offset);
  offset += 32;
  data.set(addressToBytes(tokenAccount), offset);
  offset += 32;
  data[offset] = response;

  return keccak_256(data);
}

/**
 * Compute the reputation hash that the provider signs.
 * Domain: SATI:reputation:v1
 *
 * @param sasSchema - SAS schema address
 * @param tokenAccount - Agent's mint address being scored (named for SAS compatibility)
 * @param provider - Reputation provider's address
 * @param score - Reputation score: 0-100
 * @returns 32-byte keccak256 hash
 */
export function computeReputationHash(
  sasSchema: Address,
  tokenAccount: Address,
  provider: Address,
  score: number,
): Uint8Array {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error("score must be an integer 0-100");
  }

  const data = new Uint8Array(
    DOMAIN_REPUTATION.length + 32 + 32 + 32 + 1, // domain + schema + tokenAccount + provider + score
  );

  let offset = 0;
  data.set(DOMAIN_REPUTATION, offset);
  offset += DOMAIN_REPUTATION.length;
  data.set(addressToBytes(sasSchema), offset);
  offset += 32;
  data.set(addressToBytes(tokenAccount), offset);
  offset += 32;
  data.set(addressToBytes(provider), offset);
  offset += 32;
  data[offset] = score;

  return keccak_256(data);
}

/**
 * Compute the deterministic nonce for compressed attestation address derivation.
 * Includes counterparty to ensure unique addresses per (task, agent, counterparty) tuple.
 *
 * @param taskRef - 32-byte task reference
 * @param sasSchema - SAS schema address
 * @param tokenAccount - Agent's mint address (named for SAS compatibility)
 * @param counterparty - Counterparty's address
 * @returns 32-byte keccak256 nonce
 */
export function computeAttestationNonce(
  taskRef: Uint8Array,
  sasSchema: Address,
  tokenAccount: Address,
  counterparty: Address,
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }

  const data = new Uint8Array(32 + 32 + 32 + 32); // taskRef + schema + tokenAccount + counterparty

  let offset = 0;
  data.set(taskRef, offset);
  offset += 32;
  data.set(addressToBytes(sasSchema), offset);
  offset += 32;
  data.set(addressToBytes(tokenAccount), offset);
  offset += 32;
  data.set(addressToBytes(counterparty), offset);

  return keccak_256(data);
}

/**
 * Compute the deterministic nonce for regular (SAS) ReputationScore attestation.
 * One ReputationScore per (provider, agent) pair.
 *
 * @param provider - Reputation provider's address
 * @param tokenAccount - Agent's mint address (named for SAS compatibility)
 * @returns 32-byte keccak256 nonce
 */
export function computeReputationNonce(provider: Address, tokenAccount: Address): Uint8Array {
  const data = new Uint8Array(32 + 32); // provider + tokenAccount

  data.set(addressToBytes(provider), 0);
  data.set(addressToBytes(tokenAccount), 32);

  return keccak_256(data);
}

/**
 * Compute the hash for EVM address linking.
 * Domain: SATI:evm_link:v1
 *
 * @param agentMint - Agent's mint address
 * @param evmAddress - 20-byte EVM address (without 0x prefix)
 * @param chainId - CAIP-2 chain identifier (e.g., "eip155:1")
 * @returns 32-byte keccak256 hash
 */
export function computeEvmLinkHash(agentMint: Address, evmAddress: Uint8Array, chainId: string): Uint8Array {
  if (evmAddress.length !== 20) {
    throw new Error("evmAddress must be 20 bytes");
  }

  const chainIdBytes = new TextEncoder().encode(chainId);
  const data = new Uint8Array(DOMAIN_EVM_LINK.length + 32 + 20 + chainIdBytes.length);

  let offset = 0;
  data.set(DOMAIN_EVM_LINK, offset);
  offset += DOMAIN_EVM_LINK.length;
  data.set(addressToBytes(agentMint), offset);
  offset += 32;
  data.set(evmAddress, offset);
  offset += 20;
  data.set(chainIdBytes, offset);

  return keccak_256(data);
}

// =============================================================================
// Data Hash Helpers
// =============================================================================
// These helpers compute the `data_hash` field for attestations - the agent's
// cryptographic commitment to the interaction content.

/**
 * Compute data_hash from raw request and response content.
 *
 * This is the agent's blind commitment to the interaction.
 * Use this when you have the full request/response content available.
 *
 * @param request - Raw request content (e.g., JSON body, prompt text)
 * @param response - Raw response content (e.g., API response, completion)
 * @returns 32-byte keccak256 hash
 *
 * @example
 * ```typescript
 * const request = new TextEncoder().encode(JSON.stringify({ prompt: "Hello" }));
 * const response = new TextEncoder().encode(JSON.stringify({ text: "Hi there!" }));
 * const dataHash = computeDataHash(request, response);
 * ```
 */
export function computeDataHash(request: Uint8Array, response: Uint8Array): Uint8Array {
  const data = new Uint8Array(request.length + response.length);
  data.set(request, 0);
  data.set(response, request.length);
  return keccak_256(data);
}

/**
 * Compute data_hash from pre-computed request and response hashes.
 *
 * Use this for large content or streaming scenarios where you want to
 * hash incrementally rather than buffering the entire content.
 *
 * @param requestHash - 32-byte hash of request content
 * @param responseHash - 32-byte hash of response content
 * @returns 32-byte keccak256 hash
 *
 * @example
 * ```typescript
 * // For large content, hash each part separately
 * const requestHash = keccak_256(largeRequestBuffer);
 * const responseHash = keccak_256(largeResponseBuffer);
 * const dataHash = computeDataHashFromHashes(requestHash, responseHash);
 * ```
 */
export function computeDataHashFromHashes(requestHash: Uint8Array, responseHash: Uint8Array): Uint8Array {
  if (requestHash.length !== 32) {
    throw new Error("requestHash must be 32 bytes");
  }
  if (responseHash.length !== 32) {
    throw new Error("responseHash must be 32 bytes");
  }

  const data = new Uint8Array(64);
  data.set(requestHash, 0);
  data.set(responseHash, 32);
  return keccak_256(data);
}

/**
 * Compute data_hash from string request and response.
 *
 * Convenience wrapper for the common case of string content.
 *
 * @param request - Request string (will be UTF-8 encoded)
 * @param response - Response string (will be UTF-8 encoded)
 * @returns 32-byte keccak256 hash
 *
 * @example
 * ```typescript
 * const dataHash = computeDataHashFromStrings(
 *   '{"prompt": "What is 2+2?"}',
 *   '{"answer": "4"}'
 * );
 * ```
 */
export function computeDataHashFromStrings(request: string, response: string): Uint8Array {
  const encoder = new TextEncoder();
  return computeDataHash(encoder.encode(request), encoder.encode(response));
}

/**
 * Create a zero-filled data_hash for SingleSigner schemas.
 *
 * SingleSigner schemas (like ReputationScore) don't use blind commitments,
 * so data_hash should be zeros.
 *
 * @returns 32-byte zero-filled Uint8Array
 */
export function zeroDataHash(): Uint8Array {
  return new Uint8Array(32);
}

// Re-export Outcome from schemas (single source of truth)
export { Outcome } from "./schemas";

/**
 * Export domain separators for reference
 */
export const DOMAINS = {
  INTERACTION: DOMAIN_INTERACTION,
  FEEDBACK: DOMAIN_FEEDBACK,
  VALIDATION: DOMAIN_VALIDATION,
  REPUTATION: DOMAIN_REPUTATION,
  EVM_LINK: DOMAIN_EVM_LINK,
} as const;
