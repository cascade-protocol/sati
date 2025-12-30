/**
 * Account Builders and Constants for SATI Tests
 *
 * Provides data serialization utilities for building attestation data
 * in tests, matching the on-chain layout expectations.
 *
 * @solana/kit native implementation.
 */

import { type Address, address, getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";

// =============================================================================
// Constants (matching programs/sati/src/constants.rs)
// =============================================================================

export const MAX_NAME_LENGTH = 32;
export const MAX_SYMBOL_LENGTH = 10;
export const MAX_URI_LENGTH = 200;
export const MAX_TAG_LENGTH = 32;
export const MAX_CONTENT_SIZE = 512;
export const MIN_BASE_LAYOUT_SIZE = 96; // taskRef(32) + tokenAccount(32) + counterparty(32)

// =============================================================================
// Enums (matching programs/sati/src/types.rs)
// =============================================================================

export enum Outcome {
  Negative = 0,
  Neutral = 1,
  Positive = 2,
}

export enum ContentType {
  None = 0,
  JSON = 1,
  UTF8 = 2,
  IPFS = 3,
  Arweave = 4,
}

export enum ValidationType {
  TEE = 0,
  ZKML = 1,
  Reexecution = 2,
  Consensus = 3,
}

export enum SignatureMode {
  DualSignature = 0,
  SingleSigner = 1,
}

export enum StorageType {
  Compressed = 0,
  Regular = 1,
}

export enum DataType {
  Feedback = 0,
  Validation = 1,
  ReputationScore = 2,
}

// =============================================================================
// PDA Derivation
// =============================================================================

const SATI_PROGRAM_ADDRESS: Address = address("satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz");

/**
 * Find registry config PDA
 */
export async function findRegistryConfigPda(
  programAddress: Address = SATI_PROGRAM_ADDRESS,
): Promise<readonly [Address, number]> {
  return getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode("registry")],
  });
}

/**
 * Find schema config PDA
 */
export async function findSchemaConfigPda(
  sasSchema: Address,
  programAddress: Address = SATI_PROGRAM_ADDRESS,
): Promise<readonly [Address, number]> {
  const encoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode("schema_config"), encoder.encode(sasSchema)],
  });
}

// =============================================================================
// Data Builders
// =============================================================================

export interface FeedbackDataParams {
  taskRef: Uint8Array;
  tokenAccount: Address;
  counterparty: Address;
  dataHash: Uint8Array;
  contentType: ContentType;
  outcome: Outcome;
  tag1?: string;
  tag2?: string;
  content?: Uint8Array;
}

/**
 * Build serialized Feedback attestation data.
 *
 * Layout (spec lines 300-314):
 * - 0-31: taskRef (32 bytes)
 * - 32-63: tokenAccount (32 bytes)
 * - 64-95: counterparty (32 bytes)
 * - 96-127: dataHash (32 bytes)
 * - 128: contentType (1 byte)
 * - 129: outcome (1 byte) - FIXED OFFSET for memcmp filtering
 * - 130+: tag1 (1 byte len + UTF-8)
 * - var: tag2 (1 byte len + UTF-8)
 * - var: content (4 byte len + data)
 */
export function buildFeedbackData(params: FeedbackDataParams): Uint8Array {
  const encoder = getAddressEncoder();

  // Encode tags (truncate to MAX_TAG_LENGTH)
  const tag1Str = params.tag1?.slice(0, MAX_TAG_LENGTH) ?? "";
  const tag2Str = params.tag2?.slice(0, MAX_TAG_LENGTH) ?? "";
  const tag1Bytes = new TextEncoder().encode(tag1Str);
  const tag2Bytes = new TextEncoder().encode(tag2Str);

  // Truncate content to MAX_CONTENT_SIZE
  const contentBytes = params.content?.slice(0, MAX_CONTENT_SIZE) ?? new Uint8Array(0);

  // Calculate total size
  // base(130) + tag1(1+len) + tag2(1+len) + content(4+len)
  const baseSize = 130; // 32 + 32 + 32 + 32 + 1 + 1
  const totalSize = baseSize + 1 + tag1Bytes.length + 1 + tag2Bytes.length + 4 + contentBytes.length;

  const data = new Uint8Array(totalSize);
  let offset = 0;

  // taskRef (32 bytes)
  data.set(params.taskRef, offset);
  offset += 32;

  // tokenAccount (32 bytes)
  data.set(new Uint8Array(encoder.encode(params.tokenAccount)), offset);
  offset += 32;

  // counterparty (32 bytes)
  data.set(new Uint8Array(encoder.encode(params.counterparty)), offset);
  offset += 32;

  // dataHash (32 bytes)
  data.set(params.dataHash, offset);
  offset += 32;

  // contentType (1 byte)
  data[offset] = params.contentType;
  offset += 1;

  // outcome (1 byte) - at fixed offset 129
  data[offset] = params.outcome;
  offset += 1;

  // tag1 (1 byte length + UTF-8 data)
  data[offset] = tag1Bytes.length;
  offset += 1;
  data.set(tag1Bytes, offset);
  offset += tag1Bytes.length;

  // tag2 (1 byte length + UTF-8 data)
  data[offset] = tag2Bytes.length;
  offset += 1;
  data.set(tag2Bytes, offset);
  offset += tag2Bytes.length;

  // content (4 byte little-endian length + data)
  const contentLenView = new DataView(data.buffer, offset, 4);
  contentLenView.setUint32(0, contentBytes.length, true);
  offset += 4;
  data.set(contentBytes, offset);

  return data;
}

export interface ValidationDataParams {
  taskRef: Uint8Array;
  tokenAccount: Address;
  counterparty: Address;
  dataHash: Uint8Array;
  contentType: ContentType;
  validationType: ValidationType;
  response: number; // 0-100
  content?: Uint8Array;
}

/**
 * Build serialized Validation attestation data.
 *
 * Layout (spec lines 320-335):
 * - 0-31: taskRef (32 bytes)
 * - 32-63: tokenAccount (32 bytes)
 * - 64-95: counterparty (32 bytes)
 * - 96-127: dataHash (32 bytes)
 * - 128: contentType (1 byte)
 * - 129: validationType (1 byte)
 * - 130: response (1 byte) - FIXED OFFSET for memcmp filtering
 * - 131+: content (4 byte len + data)
 */
export function buildValidationData(params: ValidationDataParams): Uint8Array {
  const encoder = getAddressEncoder();

  // Truncate content to MAX_CONTENT_SIZE
  const contentBytes = params.content?.slice(0, MAX_CONTENT_SIZE) ?? new Uint8Array(0);

  // base(131) + content(4+len)
  const baseSize = 131; // 32 + 32 + 32 + 32 + 1 + 1 + 1
  const totalSize = baseSize + 4 + contentBytes.length;

  const data = new Uint8Array(totalSize);
  let offset = 0;

  // taskRef (32 bytes)
  data.set(params.taskRef, offset);
  offset += 32;

  // tokenAccount (32 bytes)
  data.set(new Uint8Array(encoder.encode(params.tokenAccount)), offset);
  offset += 32;

  // counterparty (32 bytes)
  data.set(new Uint8Array(encoder.encode(params.counterparty)), offset);
  offset += 32;

  // dataHash (32 bytes)
  data.set(params.dataHash, offset);
  offset += 32;

  // contentType (1 byte)
  data[offset] = params.contentType;
  offset += 1;

  // validationType (1 byte)
  data[offset] = params.validationType;
  offset += 1;

  // response (1 byte) - at fixed offset 130
  data[offset] = params.response;
  offset += 1;

  // content (4 byte little-endian length + data)
  const contentLenView = new DataView(data.buffer, offset, 4);
  contentLenView.setUint32(0, contentBytes.length, true);
  offset += 4;
  data.set(contentBytes, offset);

  return data;
}

export interface ReputationScoreDataParams {
  taskRef: Uint8Array; // Usually keccak256(provider, tokenAccount)
  tokenAccount: Address;
  counterparty: Address; // Provider
  score: number; // 0-100
  contentType: ContentType;
  content?: Uint8Array;
}

/**
 * Build serialized ReputationScore attestation data.
 *
 * Layout (spec lines 339-352):
 * - 0-31: taskRef (32 bytes)
 * - 32-63: tokenAccount (32 bytes)
 * - 64-95: counterparty/provider (32 bytes)
 * - 96: score (1 byte)
 * - 97: contentType (1 byte)
 * - 98+: content (4 byte len + data)
 */
export function buildReputationScoreData(params: ReputationScoreDataParams): Uint8Array {
  const encoder = getAddressEncoder();

  // Truncate content to MAX_CONTENT_SIZE
  const contentBytes = params.content?.slice(0, MAX_CONTENT_SIZE) ?? new Uint8Array(0);

  // base(98) + content(4+len)
  const baseSize = 98; // 32 + 32 + 32 + 1 + 1
  const totalSize = baseSize + 4 + contentBytes.length;

  const data = new Uint8Array(totalSize);
  let offset = 0;

  // taskRef (32 bytes)
  data.set(params.taskRef, offset);
  offset += 32;

  // tokenAccount (32 bytes)
  data.set(new Uint8Array(encoder.encode(params.tokenAccount)), offset);
  offset += 32;

  // counterparty/provider (32 bytes)
  data.set(new Uint8Array(encoder.encode(params.counterparty)), offset);
  offset += 32;

  // score (1 byte)
  data[offset] = params.score;
  offset += 1;

  // contentType (1 byte)
  data[offset] = params.contentType;
  offset += 1;

  // content (4 byte little-endian length + data)
  const contentLenView = new DataView(data.buffer, offset, 4);
  contentLenView.setUint32(0, contentBytes.length, true);
  offset += 4;
  data.set(contentBytes, offset);

  return data;
}

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
 * Validate content type is in valid range (0-4)
 */
export function isValidContentType(contentType: number): boolean {
  return contentType >= 0 && contentType <= 4;
}

/**
 * Validate validation type is in valid range (0-3)
 */
export function isValidValidationType(validationType: number): boolean {
  return validationType >= 0 && validationType <= 3;
}
