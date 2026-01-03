/**
 * Account Builders and Constants for SATI Tests
 *
 * Provides data serialization utilities for building attestation data
 * in tests, matching the on-chain layout expectations.
 *
 * IMPORTANT: All constants and enums are imported from the SDK source
 * to avoid duplication and ensure consistency with the on-chain program.
 *
 * @solana/kit native implementation.
 */

import { type Address, getAddressEncoder } from "@solana/kit";

// =============================================================================
// Re-export constants and enums from SDK (single source of truth)
// =============================================================================

export {
  // Layout constants
  MAX_CONTENT_SIZE,
  MIN_BASE_LAYOUT_SIZE,
  CURRENT_LAYOUT_VERSION,
  OFFSETS,
  // Enums
  Outcome,
  ContentType,
  ValidationType,
  DataType,
} from "../../src/schemas";

// SignatureMode and StorageType from generated (source of truth)
export { SignatureMode, StorageType } from "../../src/generated";

// Re-export PDA derivation from SDK helpers
export { findRegistryConfigPda, findSchemaConfigPda, findAgentIndexPda } from "../../src/helpers";

// Additional test-specific constants
export const MAX_NAME_LENGTH = 32;
export const MAX_SYMBOL_LENGTH = 10;
export const MAX_URI_LENGTH = 200;
export const MAX_TAG_LENGTH = 32;

// Import for internal use
import { CURRENT_LAYOUT_VERSION, OFFSETS, MAX_CONTENT_SIZE, type Outcome, type ContentType } from "../../src/schemas";

// =============================================================================
// Validation Utilities
// =============================================================================

/**
 * Validate outcome is in valid range (0-2)
 */
export function isValidOutcome(outcome: number): boolean {
  return outcome >= 0 && outcome <= 2;
}

/**
 * Validate response/score is in valid range (0-100)
 */
export function isValidScore(score: number): boolean {
  return score >= 0 && score <= 100;
}

/**
 * Validate content type is in valid range (0-5)
 */
export function isValidContentType(contentType: number): boolean {
  return contentType >= 0 && contentType <= 5;
}

/**
 * Validate validation type is in valid range (0-3)
 */
export function isValidValidationType(validationType: number): boolean {
  return validationType >= 0 && validationType <= 3;
}

// =============================================================================
// Data Builders (Universal Base Layout v1)
// =============================================================================

export interface FeedbackDataParams {
  taskRef: Uint8Array;
  tokenAccount: Address;
  counterparty: Address;
  outcome: Outcome;
  dataHash: Uint8Array;
  contentType: ContentType;
  content?: Uint8Array;
}

/**
 * Build serialized Feedback attestation data using Universal Base Layout v1.
 *
 * Layout (131 bytes base + variable content):
 *   - 0: layout_version (1 byte) = 1
 *   - 1-32: taskRef (32 bytes)
 *   - 33-64: tokenAccount (32 bytes)
 *   - 65-96: counterparty (32 bytes)
 *   - 97: outcome (1 byte)
 *   - 98-129: dataHash (32 bytes)
 *   - 130: contentType (1 byte)
 *   - 131+: content (variable, up to 512 bytes)
 */
export function buildFeedbackData(params: FeedbackDataParams): Uint8Array {
  const encoder = getAddressEncoder();

  // Truncate content to MAX_CONTENT_SIZE
  const contentBytes = params.content?.slice(0, MAX_CONTENT_SIZE) ?? new Uint8Array(0);

  // Total size: 131 (base) + content length
  const totalSize = 131 + contentBytes.length;
  const data = new Uint8Array(totalSize);

  // layout_version (1 byte) at offset 0
  data[OFFSETS.LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;

  // taskRef (32 bytes) at offset 1
  data.set(params.taskRef, OFFSETS.TASK_REF);

  // tokenAccount (32 bytes) at offset 33
  data.set(new Uint8Array(encoder.encode(params.tokenAccount)), OFFSETS.TOKEN_ACCOUNT);

  // counterparty (32 bytes) at offset 65
  data.set(new Uint8Array(encoder.encode(params.counterparty)), OFFSETS.COUNTERPARTY);

  // outcome (1 byte) at offset 97
  data[OFFSETS.OUTCOME] = params.outcome;

  // dataHash (32 bytes) at offset 98
  data.set(params.dataHash, OFFSETS.DATA_HASH);

  // contentType (1 byte) at offset 130
  data[OFFSETS.CONTENT_TYPE] = params.contentType;

  // content (variable) at offset 131
  if (contentBytes.length > 0) {
    data.set(contentBytes, OFFSETS.CONTENT);
  }

  return data;
}

export interface ValidationDataParams {
  taskRef: Uint8Array;
  tokenAccount: Address;
  counterparty: Address;
  outcome: Outcome;
  dataHash: Uint8Array;
  contentType: ContentType;
  content?: Uint8Array;
}

/**
 * Build serialized Validation attestation data using Universal Base Layout v1.
 *
 * Note: ValidationV1 uses the same universal layout as FeedbackV1.
 * The validationType is encoded in JSON content, not as a separate field.
 */
export function buildValidationData(params: ValidationDataParams): Uint8Array {
  // Validation uses the same universal layout as Feedback
  return buildFeedbackData(params);
}

export interface ReputationScoreDataParams {
  taskRef: Uint8Array;
  tokenAccount: Address;
  counterparty: Address;
  outcome: Outcome;
  dataHash: Uint8Array;
  contentType: ContentType;
  content?: Uint8Array;
}

/**
 * Build serialized ReputationScore attestation data using Universal Base Layout v1.
 *
 * Note: ReputationScoreV1 uses the same universal layout.
 * The score is encoded in JSON content or derived from outcome.
 */
export function buildReputationScoreData(params: ReputationScoreDataParams): Uint8Array {
  // ReputationScore uses the same universal layout
  return buildFeedbackData(params);
}
