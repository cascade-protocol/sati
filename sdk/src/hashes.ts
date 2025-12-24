/**
 * Domain-separated hash functions for SATI attestations.
 *
 * These functions must produce identical hashes to the Rust implementations
 * in programs/sati/src/signature.rs. Uses keccak256 from @noble/hashes.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import { type Address, getAddressEncoder } from "@solana/kit";

// Domain separators - must match programs/sati/src/constants.rs
const DOMAIN_INTERACTION = new TextEncoder().encode("SATI:interaction:v1");
const DOMAIN_FEEDBACK = new TextEncoder().encode("SATI:feedback:v1");
const DOMAIN_VALIDATION = new TextEncoder().encode("SATI:validation:v1");
const DOMAIN_REPUTATION = new TextEncoder().encode("SATI:reputation:v1");

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
 * @param tokenAccount - Agent's token account address
 * @param dataHash - 32-byte hash of the request/interaction data
 * @returns 32-byte keccak256 hash
 */
export function computeInteractionHash(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  dataHash: Uint8Array
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }
  if (dataHash.length !== 32) {
    throw new Error("dataHash must be 32 bytes");
  }

  const data = new Uint8Array(
    DOMAIN_INTERACTION.length + 32 + 32 + 32 + 32 // domain + schema + taskRef + tokenAccount + dataHash
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
 * @param tokenAccount - Agent's token account address
 * @param outcome - Feedback outcome: 0=Negative, 1=Neutral, 2=Positive
 * @returns 32-byte keccak256 hash
 */
export function computeFeedbackHash(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  outcome: number
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }
  if (!Number.isInteger(outcome) || outcome < 0 || outcome > 2) {
    throw new Error("outcome must be 0, 1, or 2");
  }

  const data = new Uint8Array(
    DOMAIN_FEEDBACK.length + 32 + 32 + 32 + 1 // domain + schema + taskRef + tokenAccount + outcome
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
 * @param tokenAccount - Agent's token account address
 * @param response - Validation response score: 0-100
 * @returns 32-byte keccak256 hash
 */
export function computeValidationHash(
  sasSchema: Address,
  taskRef: Uint8Array,
  tokenAccount: Address,
  response: number
): Uint8Array {
  if (taskRef.length !== 32) {
    throw new Error("taskRef must be 32 bytes");
  }
  if (!Number.isFinite(response) || response < 0 || response > 100) {
    throw new Error("response must be 0-100");
  }

  const data = new Uint8Array(
    DOMAIN_VALIDATION.length + 32 + 32 + 32 + 1 // domain + schema + taskRef + tokenAccount + response
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
 * @param tokenAccount - Agent's token account address being scored
 * @param provider - Reputation provider's address
 * @param score - Reputation score: 0-100
 * @returns 32-byte keccak256 hash
 */
export function computeReputationHash(
  sasSchema: Address,
  tokenAccount: Address,
  provider: Address,
  score: number
): Uint8Array {
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("score must be 0-100");
  }

  const data = new Uint8Array(
    DOMAIN_REPUTATION.length + 32 + 32 + 32 + 1 // domain + schema + tokenAccount + provider + score
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
 * @param tokenAccount - Agent's token account address
 * @param counterparty - Counterparty's address
 * @returns 32-byte keccak256 nonce
 */
export function computeAttestationNonce(
  taskRef: Uint8Array,
  sasSchema: Address,
  tokenAccount: Address,
  counterparty: Address
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
 * @param tokenAccount - Agent's token account address
 * @returns 32-byte keccak256 nonce
 */
export function computeReputationNonce(
  provider: Address,
  tokenAccount: Address
): Uint8Array {
  const data = new Uint8Array(32 + 32); // provider + tokenAccount

  data.set(addressToBytes(provider), 0);
  data.set(addressToBytes(tokenAccount), 32);

  return keccak_256(data);
}

/**
 * Outcome values for Feedback attestations.
 */
export enum Outcome {
  Negative = 0,
  Neutral = 1,
  Positive = 2,
}

/**
 * Export domain separators for reference
 */
export const DOMAINS = {
  INTERACTION: DOMAIN_INTERACTION,
  FEEDBACK: DOMAIN_FEEDBACK,
  VALIDATION: DOMAIN_VALIDATION,
  REPUTATION: DOMAIN_REPUTATION,
} as const;
