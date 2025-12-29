/**
 * SATI Schema Definitions
 *
 * Data layouts for SATI attestations with fixed offsets for memcmp filtering.
 * These schemas must match the on-chain program's expectations.
 */

import { getAddressEncoder, getAddressDecoder, type Address } from "@solana/kit";

// ============================================================================
// Constants
// ============================================================================

/** Maximum content size in bytes */
export const MAX_CONTENT_SIZE = 512;

/** Maximum tag length in characters */
export const MAX_TAG_LENGTH = 32;

/** Minimum base layout size (task_ref + token_account + counterparty) */
export const MIN_BASE_LAYOUT_SIZE = 96;

/**
 * SAS attestation header size in bytes.
 *
 * Layout: discriminator(1) + nonce(32) + credential(32) + schema(32) + data_len(4)
 * Total: 101 bytes
 *
 * Must match programs/sati/src/constants.rs SAS_HEADER_SIZE
 */
export const SAS_HEADER_SIZE = 101;

// ============================================================================
// Enums
// ============================================================================

/**
 * Data type discriminator for attestations
 */
export enum DataType {
  /** Feedback attestation (compressed storage) */
  Feedback = 0,
  /** Validation attestation (compressed storage) */
  Validation = 1,
  /** ReputationScore attestation (regular storage) */
  ReputationScore = 2,
}

/**
 * Feedback outcome values (ERC-8004 compatible)
 *
 * For ERC-8004 score mapping:
 * - Negative(0) → 0
 * - Neutral(1) → 50
 * - Positive(2) → 100
 */
export enum Outcome {
  /** Negative feedback (score 0) */
  Negative = 0,
  /** Neutral feedback (score 50) */
  Neutral = 1,
  /** Positive feedback (score 100) */
  Positive = 2,
}

/**
 * Content type determines how to interpret the variable-length content field
 */
export enum ContentType {
  /** Empty content - just use outcome/tags */
  None = 0,
  /** Inline JSON object */
  JSON = 1,
  /** Plain UTF-8 text */
  UTF8 = 2,
  /** IPFS CIDv1 (~36 bytes) */
  IPFS = 3,
  /** Arweave transaction ID (32 bytes) */
  Arweave = 4,
}

/**
 * Validation method types
 */
export enum ValidationType {
  /** Trusted Execution Environment */
  TEE = 0,
  /** Zero-knowledge Machine Learning */
  ZKML = 1,
  /** Re-execution verification */
  Reexecution = 2,
  /** Consensus-based validation */
  Consensus = 3,
}

/**
 * Signature mode for schema configuration
 */
export enum SignatureMode {
  /** Two signatures: agent + counterparty (blind feedback model) */
  DualSignature = 0,
  /** Single signature: provider signs (ReputationScore) */
  SingleSigner = 1,
}

/**
 * Storage type for attestations
 */
export enum StorageType {
  /** Light Protocol compressed accounts */
  Compressed = 0,
  /** Regular SAS accounts */
  Regular = 1,
}

// ============================================================================
// Base Layout
// ============================================================================

/**
 * Base data layout (first 96 bytes)
 *
 * All schemas MUST start with this layout. Program parses this for signature
 * binding; full schema is parsed by indexers.
 */
export interface BaseLayout {
  /** CAIP-220 tx hash or arbitrary task ID (32 bytes) */
  taskRef: Uint8Array;
  /** Agent's token account address (32 bytes) */
  tokenAccount: Address;
  /** Counterparty address (32 bytes) */
  counterparty: Address;
}

/**
 * Fixed offsets in base layout
 */
export const BASE_OFFSETS = {
  TASK_REF: 0,
  TOKEN_ACCOUNT: 32,
  COUNTERPARTY: 64,
} as const;

// ============================================================================
// Feedback Schema (data_type = 0)
// ============================================================================

/**
 * Feedback schema layout
 *
 * Fixed offsets for memcmp filtering:
 * - outcome: offset 129
 *
 * Variable-length fields: tag1, tag2, content
 */
export interface FeedbackData {
  /** CAIP-220 tx hash or arbitrary task ID (32 bytes) */
  taskRef: Uint8Array;
  /** Agent's token account */
  tokenAccount: Address;
  /** Client (feedback giver) */
  counterparty: Address;
  /** Hash of request/interaction data for agent's blind signature (32 bytes) */
  dataHash: Uint8Array;
  /** Content format (see ContentType) */
  contentType: ContentType;
  /** Feedback outcome: Negative, Neutral, Positive */
  outcome: Outcome;
  /** Primary category tag (max 32 chars) */
  tag1: string;
  /** Secondary category tag (max 32 chars) */
  tag2: string;
  /** Variable-length content based on contentType */
  content: Uint8Array;
}

/**
 * Fixed offsets in Feedback schema
 */
export const FEEDBACK_OFFSETS = {
  ...BASE_OFFSETS,
  DATA_HASH: 96,
  CONTENT_TYPE: 128,
  /** Fixed offset for Photon memcmp filtering */
  OUTCOME: 129,
  /** Variable: starts at 130, length-prefixed string */
  TAG1_LEN: 130,
} as const;

/**
 * Serialize Feedback data to bytes
 */
export function serializeFeedback(data: FeedbackData): Uint8Array {
  const tag1Bytes = new TextEncoder().encode(data.tag1.slice(0, MAX_TAG_LENGTH));
  const tag2Bytes = new TextEncoder().encode(data.tag2.slice(0, MAX_TAG_LENGTH));
  const contentBytes = data.content.slice(0, MAX_CONTENT_SIZE);

  // Calculate total size: base(96) + dataHash(32) + contentType(1) + outcome(1) +
  // tag1_len(1) + tag1 + tag2_len(1) + tag2 + content_len(4) + content
  const totalSize = 96 + 32 + 1 + 1 + 1 + tag1Bytes.length + 1 + tag2Bytes.length + 4 + contentBytes.length;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // taskRef (32 bytes)
  buffer.set(data.taskRef, offset);
  offset += 32;

  // tokenAccount (32 bytes) - need to decode from Address
  const tokenAccountBytes = addressToBytes(data.tokenAccount);
  buffer.set(tokenAccountBytes, offset);
  offset += 32;

  // counterparty (32 bytes)
  const counterpartyBytes = addressToBytes(data.counterparty);
  buffer.set(counterpartyBytes, offset);
  offset += 32;

  // dataHash (32 bytes)
  buffer.set(data.dataHash, offset);
  offset += 32;

  // contentType (1 byte)
  buffer[offset++] = data.contentType;

  // outcome (1 byte)
  buffer[offset++] = data.outcome;

  // tag1 (length-prefixed string)
  buffer[offset++] = tag1Bytes.length;
  buffer.set(tag1Bytes, offset);
  offset += tag1Bytes.length;

  // tag2 (length-prefixed string)
  buffer[offset++] = tag2Bytes.length;
  buffer.set(tag2Bytes, offset);
  offset += tag2Bytes.length;

  // content (4-byte length prefix + data)
  view.setUint32(offset, contentBytes.length, true);
  offset += 4;
  buffer.set(contentBytes, offset);

  return buffer;
}

/**
 * Deserialize Feedback data from bytes
 */
export function deserializeFeedback(bytes: Uint8Array): FeedbackData {
  if (bytes.length < 132) {
    throw new Error("Feedback data too small (minimum 132 bytes)");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let offset = 0;

  // taskRef (32 bytes)
  const taskRef = bytes.slice(offset, offset + 32);
  offset += 32;

  // tokenAccount (32 bytes)
  const tokenAccount = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // counterparty (32 bytes)
  const counterparty = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // dataHash (32 bytes)
  const dataHash = bytes.slice(offset, offset + 32);
  offset += 32;

  // contentType (1 byte)
  const contentType = bytes[offset++] as ContentType;

  // outcome (1 byte)
  const outcome = bytes[offset++] as Outcome;

  // tag1 (length-prefixed string)
  const tag1Len = bytes[offset++];
  const tag1 = new TextDecoder().decode(bytes.slice(offset, offset + tag1Len));
  offset += tag1Len;

  // tag2 (length-prefixed string)
  const tag2Len = bytes[offset++];
  const tag2 = new TextDecoder().decode(bytes.slice(offset, offset + tag2Len));
  offset += tag2Len;

  // content (4-byte length prefix + data)
  const contentLen = view.getUint32(offset, true);
  offset += 4;
  const content = bytes.slice(offset, offset + contentLen);

  return {
    taskRef,
    tokenAccount,
    counterparty,
    dataHash,
    contentType,
    outcome,
    tag1,
    tag2,
    content,
  };
}

// ============================================================================
// Validation Schema (data_type = 1)
// ============================================================================

/**
 * Validation schema layout
 *
 * Fixed offsets for memcmp filtering:
 * - response: offset 130
 *
 * Variable-length field: content
 */
export interface ValidationData {
  /** Task reference (32 bytes) */
  taskRef: Uint8Array;
  /** Agent's token account */
  tokenAccount: Address;
  /** Validator address */
  counterparty: Address;
  /** Hash of work being validated for agent's blind signature (32 bytes) */
  dataHash: Uint8Array;
  /** Content format (see ContentType) */
  contentType: ContentType;
  /** Validation method (see ValidationType) */
  validationType: ValidationType;
  /** Validation confidence score: 0-100 */
  response: number;
  /** Variable-length content (validation report/evidence) */
  content: Uint8Array;
}

/**
 * Fixed offsets in Validation schema
 */
export const VALIDATION_OFFSETS = {
  ...BASE_OFFSETS,
  DATA_HASH: 96,
  CONTENT_TYPE: 128,
  VALIDATION_TYPE: 129,
  /** Fixed offset for Photon memcmp filtering */
  RESPONSE: 130,
  CONTENT_LEN: 131,
} as const;

/**
 * Serialize Validation data to bytes
 */
export function serializeValidation(data: ValidationData): Uint8Array {
  if (data.response > 100) {
    throw new Error("Response score must be 0-100");
  }

  const contentBytes = data.content.slice(0, MAX_CONTENT_SIZE);

  // Calculate total size: base(96) + dataHash(32) + contentType(1) + validationType(1) +
  // response(1) + content_len(4) + content
  const totalSize = 96 + 32 + 1 + 1 + 1 + 4 + contentBytes.length;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // taskRef (32 bytes)
  buffer.set(data.taskRef, offset);
  offset += 32;

  // tokenAccount (32 bytes)
  buffer.set(addressToBytes(data.tokenAccount), offset);
  offset += 32;

  // counterparty (32 bytes)
  buffer.set(addressToBytes(data.counterparty), offset);
  offset += 32;

  // dataHash (32 bytes)
  buffer.set(data.dataHash, offset);
  offset += 32;

  // contentType (1 byte)
  buffer[offset++] = data.contentType;

  // validationType (1 byte)
  buffer[offset++] = data.validationType;

  // response (1 byte)
  buffer[offset++] = data.response;

  // content (4-byte length prefix + data)
  view.setUint32(offset, contentBytes.length, true);
  offset += 4;
  buffer.set(contentBytes, offset);

  return buffer;
}

/**
 * Deserialize Validation data from bytes
 */
export function deserializeValidation(bytes: Uint8Array): ValidationData {
  if (bytes.length < 135) {
    throw new Error("Validation data too small (minimum 135 bytes)");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let offset = 0;

  // taskRef (32 bytes)
  const taskRef = bytes.slice(offset, offset + 32);
  offset += 32;

  // tokenAccount (32 bytes)
  const tokenAccount = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // counterparty (32 bytes)
  const counterparty = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // dataHash (32 bytes)
  const dataHash = bytes.slice(offset, offset + 32);
  offset += 32;

  // contentType (1 byte)
  const contentType = bytes[offset++] as ContentType;

  // validationType (1 byte)
  const validationType = bytes[offset++] as ValidationType;

  // response (1 byte)
  const response = bytes[offset++];

  // content (4-byte length prefix + data)
  const contentLen = view.getUint32(offset, true);
  offset += 4;
  const content = bytes.slice(offset, offset + contentLen);

  return {
    taskRef,
    tokenAccount,
    counterparty,
    dataHash,
    contentType,
    validationType,
    response,
    content,
  };
}

// ============================================================================
// ReputationScore Schema (data_type = 2)
// ============================================================================

/**
 * ReputationScore schema layout (regular SAS storage)
 *
 * Provider-computed scores with direct on-chain queryability.
 * One ReputationScore per (provider, agent) pair - updates replace previous.
 *
 * Note: task_ref is deterministic: keccak256(counterparty, token_account)
 */
export interface ReputationScoreData {
  /** Deterministic: keccak256(counterparty, token_account) (32 bytes) */
  taskRef: Uint8Array;
  /** Agent being scored */
  tokenAccount: Address;
  /** Reputation provider */
  counterparty: Address;
  /** Normalized reputation score: 0-100 */
  score: number;
  /** Content format (see ContentType) */
  contentType: ContentType;
  /** Variable-length content (methodology/details) */
  content: Uint8Array;
}

/**
 * Fixed offsets in ReputationScore schema
 */
export const REPUTATION_SCORE_OFFSETS = {
  ...BASE_OFFSETS,
  SCORE: 96,
  CONTENT_TYPE: 97,
  CONTENT_LEN: 98,
} as const;

/**
 * Serialize ReputationScore data to bytes
 */
export function serializeReputationScore(data: ReputationScoreData): Uint8Array {
  if (data.score > 100) {
    throw new Error("Score must be 0-100");
  }

  const contentBytes = data.content.slice(0, MAX_CONTENT_SIZE);

  // Calculate total size: taskRef(32) + tokenAccount(32) + counterparty(32) +
  // score(1) + contentType(1) + content_len(4) + content
  const totalSize = 32 + 32 + 32 + 1 + 1 + 4 + contentBytes.length;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // taskRef (32 bytes)
  buffer.set(data.taskRef, offset);
  offset += 32;

  // tokenAccount (32 bytes)
  buffer.set(addressToBytes(data.tokenAccount), offset);
  offset += 32;

  // counterparty (32 bytes)
  buffer.set(addressToBytes(data.counterparty), offset);
  offset += 32;

  // score (1 byte)
  buffer[offset++] = data.score;

  // contentType (1 byte)
  buffer[offset++] = data.contentType;

  // content (4-byte length prefix + data)
  view.setUint32(offset, contentBytes.length, true);
  offset += 4;
  buffer.set(contentBytes, offset);

  return buffer;
}

/**
 * Deserialize ReputationScore data from bytes
 */
export function deserializeReputationScore(bytes: Uint8Array): ReputationScoreData {
  if (bytes.length < 102) {
    throw new Error("ReputationScore data too small (minimum 102 bytes)");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset);
  let offset = 0;

  // taskRef (32 bytes)
  const taskRef = bytes.slice(offset, offset + 32);
  offset += 32;

  // tokenAccount (32 bytes)
  const tokenAccount = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // counterparty (32 bytes)
  const counterparty = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // score (1 byte)
  const score = bytes[offset++];

  // contentType (1 byte)
  const contentType = bytes[offset++] as ContentType;

  // content (4-byte length prefix + data)
  const contentLen = view.getUint32(offset, true);
  offset += 4;
  const content = bytes.slice(offset, offset + contentLen);

  return {
    taskRef,
    tokenAccount,
    counterparty,
    score,
    contentType,
    content,
  };
}

// ============================================================================
// Compressed Attestation Structure
// ============================================================================

/**
 * CompressedAttestation structure (Light Protocol storage)
 *
 * This represents the full compressed account structure with Light Protocol fields.
 */
export interface CompressedAttestation {
  /** SAS schema address (32 bytes) - memcmp filter at offset 8 */
  sasSchema: Uint8Array;
  /** Agent's token account (32 bytes) - memcmp filter at offset 40 */
  tokenAccount: Uint8Array;
  /** Data type discriminator: 0=Feedback, 1=Validation */
  dataType: DataType;
  /** Schema-conformant data bytes */
  data: Uint8Array;
  /** Number of signatures stored (1 or 2) */
  numSignatures: number;
  /** First signature (agent for DualSignature) */
  signature1: Uint8Array;
  /** Second signature (counterparty for DualSignature, zeroed for SingleSigner) */
  signature2: Uint8Array;
}

/**
 * Fixed offsets in CompressedAttestation data for memcmp filters.
 *
 * Note: Light Protocol returns the discriminator as a separate field in the
 * response, NOT prefixed to the data bytes. The data bytes start directly
 * with the attestation fields:
 *   - bytes 0-31:  sasSchema (Pubkey)
 *   - bytes 32-63: tokenAccount (Pubkey)
 *   - byte 64:     dataType (u8)
 *   - bytes 65+:   schemaData (Vec<u8>)
 */
export const COMPRESSED_OFFSETS = {
  /** SAS schema pubkey offset for memcmp */
  SAS_SCHEMA: 0,
  /** Token account pubkey offset for memcmp */
  TOKEN_ACCOUNT: 32,
  /** Data type byte offset */
  DATA_TYPE: 64,
} as const;

// ============================================================================
// Schema Configuration
// ============================================================================

/**
 * Schema configuration for registered attestation types
 */
export interface SchemaConfig {
  /** SAS schema address */
  sasSchema: Address;
  /** Signature verification mode */
  signatureMode: SignatureMode;
  /** Storage backend type */
  storageType: StorageType;
  /** Whether attestations can be closed/nullified */
  closeable: boolean;
}

/**
 * Core SATI schema configurations
 */
export const SCHEMA_CONFIGS: Record<string, Omit<SchemaConfig, "sasSchema">> = {
  Feedback: {
    signatureMode: SignatureMode.DualSignature,
    storageType: StorageType.Compressed,
    closeable: false,
  },
  FeedbackPublic: {
    signatureMode: SignatureMode.SingleSigner,
    storageType: StorageType.Compressed,
    closeable: false,
  },
  Validation: {
    signatureMode: SignatureMode.DualSignature,
    storageType: StorageType.Compressed,
    closeable: false,
  },
  ReputationScore: {
    signatureMode: SignatureMode.SingleSigner,
    storageType: StorageType.Regular,
    closeable: true,
  },
} as const;

// ============================================================================
// Utility Functions
// ============================================================================

// Address encoder/decoder singletons
const addressEncoder = getAddressEncoder();
const addressDecoder = getAddressDecoder();

/**
 * Convert Address to 32-byte Uint8Array
 */
function addressToBytes(address: Address): Uint8Array {
  return new Uint8Array(addressEncoder.encode(address));
}

/**
 * Convert 32-byte Uint8Array to Address
 */
function bytesToAddress(bytes: Uint8Array): Address {
  return addressDecoder.decode(bytes);
}

/**
 * Deserialize attestation data based on data type
 */
export function deserializeAttestationData(
  dataType: DataType,
  data: Uint8Array,
): FeedbackData | ValidationData | ReputationScoreData {
  switch (dataType) {
    case DataType.Feedback:
      return deserializeFeedback(data);
    case DataType.Validation:
      return deserializeValidation(data);
    case DataType.ReputationScore:
      return deserializeReputationScore(data);
    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }
}

/**
 * Get the outcome label string
 */
export function getOutcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case Outcome.Negative:
      return "Negative";
    case Outcome.Neutral:
      return "Neutral";
    case Outcome.Positive:
      return "Positive";
    default:
      return "Unknown";
  }
}

/**
 * Convert Outcome to ERC-8004 score (0-100)
 */
export function outcomeToScore(outcome: Outcome): number {
  switch (outcome) {
    case Outcome.Negative:
      return 0;
    case Outcome.Neutral:
      return 50;
    case Outcome.Positive:
      return 100;
    default:
      return 50;
  }
}

/**
 * Get the content type label string
 */
export function getContentTypeLabel(contentType: ContentType): string {
  switch (contentType) {
    case ContentType.None:
      return "None";
    case ContentType.JSON:
      return "JSON";
    case ContentType.UTF8:
      return "UTF-8";
    case ContentType.IPFS:
      return "IPFS";
    case ContentType.Arweave:
      return "Arweave";
    default:
      return "Unknown";
  }
}

/**
 * Get the validation type label string
 */
export function getValidationTypeLabel(validationType: ValidationType): string {
  switch (validationType) {
    case ValidationType.TEE:
      return "TEE";
    case ValidationType.ZKML:
      return "ZKML";
    case ValidationType.Reexecution:
      return "Re-execution";
    case ValidationType.Consensus:
      return "Consensus";
    default:
      return "Unknown";
  }
}
