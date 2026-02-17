/**
 * SATI Schema Definitions
 *
 * Data layouts for SATI attestations with fixed offsets for memcmp filtering.
 * These schemas must match the on-chain program's expectations.
 *
 * ## Universal Base Layout (131 bytes)
 * All schemas share identical first 131 bytes:
 *   - layout_version: 0 (1 byte) - version of the universal base layout
 *   - task_ref: 1-32 (32 bytes) - CAIP-220 tx hash or task ID
 *   - agent_mint: 33-64 (32 bytes) - agent's MINT ADDRESS (Token-2022 NFT identity)
 *   - counterparty: 65-96 (32 bytes) - counterparty address
 *   - outcome: 97 (1 byte) - 0=Negative, 1=Neutral, 2=Positive
 *   - data_hash: 98-129 (32 bytes) - blind commitment (zeros for CounterpartySigned)
 *   - content_type: 130 (1 byte) - format: 0=None, 1=JSON, 2=UTF-8, etc.
 *   - content: 131+ (variable) - up to 512 bytes
 *
 * ## Identity Model
 * - `agentMint` = agent's **MINT ADDRESS** (stable Token-2022 NFT identity)
 * - NOT an Associated Token Account (ATA) - the ATA is used separately for ownership verification
 * - On-chain verification checks ATA ownership for authorization
 */

import { getAddressEncoder, getAddressDecoder, type Address } from "@solana/kit";

// ============================================================================
// Constants
// ============================================================================

/** Maximum content size in bytes (theoretical storage limit) */
export const MAX_CONTENT_SIZE = 512;

/**
 * Maximum content size for DualSignature mode attestations.
 *
 * Due to Solana's 1232-byte transaction limit, content in DualSignature
 * mode is severely constrained because:
 * 1. Content appears TWICE: in data blob AND in SIWS message
 * 2. Agent ATA (32 bytes) can never be in lookup table (user-specific)
 * 3. SIWS message overhead is ~194 bytes
 *
 * Use ContentType.IPFS or ContentType.Arweave for larger content.
 */
export const MAX_DUAL_SIGNATURE_CONTENT_SIZE = 70;

/**
 * Maximum content size for CounterpartySigned mode attestations.
 *
 * CounterpartySigned has a SIWS message containing the content, so content
 * appears TWICE in the transaction (data blob + SIWS Details field).
 * This is similar to DualSignature but with one fewer signature (no agent sig),
 * giving slightly more headroom.
 *
 * Use ContentType.IPFS or ContentType.Arweave for larger content.
 */
export const MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE = 100;

/**
 * Maximum content size for AgentOwnerSigned mode attestations.
 *
 * AgentOwnerSigned has more headroom because:
 * 1. Content appears only once (no SIWS message - agent signs interaction_hash)
 * 2. No counterparty signature verification overhead
 */
export const MAX_AGENT_OWNER_SIGNED_CONTENT_SIZE = 240;

/**
 * Minimum universal base layout size.
 * All schemas share: layout_version(1) + task_ref(32) + agent_mint(32) + counterparty(32) +
 * outcome(1) + data_hash(32) + content_type(1) = 131 bytes.
 */
export const MIN_BASE_LAYOUT_SIZE = 131;

/**
 * Current layout version for universal base layout.
 * Increment when making breaking changes to the layout structure.
 */
export const CURRENT_LAYOUT_VERSION = 1;

/**
 * SAS attestation header size in bytes.
 *
 * Layout: discriminator(1) + nonce(32) + credential(32) + schema(32) + data_len(4)
 * Total: 101 bytes
 *
 * Must match programs/sati/src/constants.rs SAS_HEADER_SIZE
 */
export const SAS_HEADER_SIZE = 101;

/**
 * Offset of the `data_len` field within the SAS attestation account.
 *
 * Layout: discriminator(1) + nonce(32) + credential(32) + schema(32) = 97
 * The 4-byte LE `data_len` field starts at offset 97.
 */
export const SAS_DATA_LEN_OFFSET = 97;

// ============================================================================
// Universal Offsets
// ============================================================================

/**
 * Universal base layout offsets (all schemas share these).
 * Must match programs/sati/src/constants.rs offsets module.
 */
export const OFFSETS = {
  /** Layout version (1 byte) - version of the universal base layout */
  LAYOUT_VERSION: 0,
  /** CAIP-220 tx hash or task identifier (32 bytes) */
  TASK_REF: 1,
  /** Agent's mint address (32 bytes) - Token-2022 NFT identity */
  AGENT_MINT: 33,
  /** Counterparty address (32 bytes) */
  COUNTERPARTY: 65,
  /** Outcome: 0=Negative, 1=Neutral, 2=Positive */
  OUTCOME: 97,
  /** Blind commitment hash (32 bytes, zeros for CounterpartySigned) */
  DATA_HASH: 98,
  /** Content format: 0=None, 1=JSON, 2=UTF-8, etc. */
  CONTENT_TYPE: 130,
  /** Variable-length content (up to 512 bytes) */
  CONTENT: 131,
} as const;

/** Alias for backward compatibility */
export const BASE_OFFSETS = OFFSETS;

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
  /** ReputationScoreV3 attestation (regular storage) */
  ReputationScore = 2,
}

/**
 * Feedback outcome values (ERC-8004 compatible)
 *
 * Maps to ERC-8004 outcome semantics:
 * - Negative(0) - unfavorable interaction
 * - Neutral(1) - default / no strong signal
 * - Positive(2) - favorable interaction
 */
export enum Outcome {
  /** Negative feedback */
  Negative = 0,
  /** Neutral feedback (default) */
  Neutral = 1,
  /** Positive feedback */
  Positive = 2,
}

/**
 * Content type determines how to interpret the variable-length content field
 */
export enum ContentType {
  /** Empty content - just use outcome */
  None = 0,
  /** Inline JSON object */
  JSON = 1,
  /** Plain UTF-8 text */
  UTF8 = 2,
  /** IPFS CIDv1 (~36 bytes) */
  IPFS = 3,
  /** Arweave transaction ID (32 bytes) */
  Arweave = 4,
  /** End-to-end encrypted (X25519-XChaCha20-Poly1305) */
  Encrypted = 5,
}

/**
 * Validation method types.
 *
 * Note: In universal layout, this is stored in JSON content,
 * not as a binary field. Kept for SDK convenience.
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

// Import from generated (Codama is the source of truth)
// Already exported via "export * from ./generated" in index.ts
import { SignatureMode } from "./generated/types/signatureMode";
import { StorageType } from "./generated/types/storageType";

// ============================================================================
// Base Layout
// ============================================================================

/**
 * Universal base data layout (131 bytes)
 *
 * All schemas MUST use this layout. Program parses this for signature
 * verification; schema-specific data goes in JSON content.
 */
export interface BaseLayout {
  /** CAIP-220 tx hash or arbitrary task ID (32 bytes) */
  taskRef: Uint8Array;
  /** Agent's mint address (32 bytes) - Token-2022 NFT identity */
  agentMint: Address;
  /** Counterparty address (32 bytes) */
  counterparty: Address;
  /** Outcome: 0=Negative, 1=Neutral, 2=Positive */
  outcome: Outcome;
  /** Hash of request/interaction data for agent's blind signature (32 bytes) */
  dataHash: Uint8Array;
  /** Content format (see ContentType) */
  contentType: ContentType;
  /** Variable-length content based on contentType */
  content: Uint8Array;
}

// ============================================================================
// Feedback Schema (data_type = 0)
// ============================================================================

/**
 * Feedback schema - uses universal base layout
 *
 * Schema-specific fields (value, tags, message) go in JSON content:
 * { "value": 85, "valueDecimals": 0, "tag1": "quality", "tag2": "latency", "m": "Great response!" }
 */
export interface FeedbackData extends BaseLayout {}

/**
 * Feedback JSON content structure (optional fields in content)
 */
export interface FeedbackContent {
  /** ERC-8004 signed fixed-point value */
  value?: number;
  /** Decimal places for value (0-18) */
  valueDecimals?: number;
  /** First tag dimension */
  tag1?: string;
  /** Second tag dimension */
  tag2?: string;
  /** Endpoint URI being reviewed */
  endpoint?: string;
  /** Feedback message */
  m?: string;
  /** Reviewer identity (address or name) */
  reviewer?: string;
  /** URI to external feedback document */
  feedbackURI?: string;
  /** Hash of the external feedback document */
  feedbackHash?: string;
}

/**
 * Fixed offsets in Feedback schema (same as universal)
 */
export const FEEDBACK_OFFSETS = OFFSETS;

/**
 * Serialize Feedback data to bytes
 */
export function serializeFeedback(data: FeedbackData): Uint8Array {
  return serializeUniversalLayout(data);
}

/**
 * Deserialize Feedback data from bytes
 */
export function deserializeFeedback(bytes: Uint8Array): FeedbackData {
  return deserializeUniversalLayout(bytes);
}

/**
 * Parse Feedback JSON content
 */
export function parseFeedbackContent(content: Uint8Array, contentType: ContentType): FeedbackContent | null {
  if (contentType !== ContentType.JSON || content.length === 0) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(content);
    return JSON.parse(text) as FeedbackContent;
  } catch {
    return null;
  }
}

// ============================================================================
// Validation Schema (data_type = 1)
// ============================================================================

/**
 * Validation schema - uses universal base layout
 *
 * Schema-specific fields (type, confidence) go in JSON content:
 * { "type": "tee", "confidence": 95, "methodology": "..." }
 */
export interface ValidationData extends BaseLayout {}

/**
 * Validation JSON content structure (optional fields in content)
 */
export interface ValidationContent {
  /** Validation method: "tee", "zkml", "reexecution", "consensus" */
  type?: string;
  /** Confidence score: 0-100 */
  confidence?: number;
  /** Methodology description */
  methodology?: string;
}

/**
 * Fixed offsets in Validation schema (same as universal)
 */
export const VALIDATION_OFFSETS = OFFSETS;

/**
 * Serialize Validation data to bytes
 */
export function serializeValidation(data: ValidationData): Uint8Array {
  return serializeUniversalLayout(data);
}

/**
 * Deserialize Validation data from bytes
 */
export function deserializeValidation(bytes: Uint8Array): ValidationData {
  return deserializeUniversalLayout(bytes);
}

/**
 * Parse Validation JSON content
 */
export function parseValidationContent(content: Uint8Array, contentType: ContentType): ValidationContent | null {
  if (contentType !== ContentType.JSON || content.length === 0) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(content);
    return JSON.parse(text) as ValidationContent;
  } catch {
    return null;
  }
}

// ============================================================================
// ReputationScoreV3 Schema (data_type = 2)
// ============================================================================

/**
 * ReputationScoreV3 schema - uses universal base layout (regular SAS storage)
 *
 * Provider-computed scores with direct on-chain queryability.
 * One ReputationScoreV3 per (provider, agent) pair - updates replace previous.
 *
 * Note: task_ref is deterministic: keccak256(counterparty, agent_mint)
 *
 * Schema-specific fields go in JSON content:
 * { "score": 85, "methodology": "weighted_average", "feedbackCount": 42 }
 */
export interface ReputationScoreData extends BaseLayout {}

/**
 * ReputationScoreV3 JSON content structure (optional fields in content)
 */
export interface ReputationScoreContent {
  /** Normalized reputation score: 0-100 */
  score?: number;
  /** Scoring algorithm identifier (e.g., "weighted_average", "bayesian") */
  methodology?: string;
  /** Number of feedbacks analyzed */
  feedbackCount?: number;
  /** Number of validations analyzed */
  validationCount?: number;
}

/**
 * Fixed offsets in ReputationScoreV3 schema (same as universal)
 */
export const REPUTATION_SCORE_OFFSETS = OFFSETS;

/**
 * Serialize ReputationScoreV3 data to bytes
 *
 * SAS schema uses VecU8 (type 13) for the content field, which requires
 * a 4-byte LE length prefix before the content bytes.
 *
 * Output: 131 base bytes + 4-byte LE content length + N content bytes
 */
export function serializeReputationScore(data: ReputationScoreData): Uint8Array {
  // Serialize base layout with empty content (131 bytes)
  const baseData = serializeUniversalLayout({ ...data, content: new Uint8Array(0) });

  const contentBytes = data.content.slice(0, MAX_CONTENT_SIZE);
  const contentLen = contentBytes.length;

  // Append VecU8: 4-byte LE length prefix + content bytes
  const buffer = new Uint8Array(baseData.length + 4 + contentLen);
  buffer.set(baseData, 0);
  new DataView(buffer.buffer).setUint32(baseData.length, contentLen, true);
  if (contentLen > 0) {
    buffer.set(contentBytes, baseData.length + 4);
  }
  return buffer;
}

/**
 * Deserialize ReputationScoreV3 data from bytes
 *
 * SAS schema uses VecU8 (type 13) for the content field. The data format is:
 * 131 base bytes + 4-byte LE content length + N content bytes.
 *
 * Reads the VecU8 length prefix to extract exact content bytes,
 * ignoring any trailing data (e.g., SAS tail bytes).
 */
export function deserializeReputationScore(bytes: Uint8Array): ReputationScoreData {
  const minSize = MIN_BASE_LAYOUT_SIZE + 4; // 131 base + 4 VecU8 prefix
  if (bytes.length < minSize) {
    throw new Error(`Data too small for ReputationScoreV3 (minimum ${minSize} bytes, got ${bytes.length})`);
  }

  // Parse base fields (layout_version through content_type, 131 bytes)
  const base = deserializeUniversalLayout(bytes.slice(0, MIN_BASE_LAYOUT_SIZE));

  // Read VecU8 length prefix at offset 131 (4-byte LE)
  const lenSlice = bytes.slice(MIN_BASE_LAYOUT_SIZE, MIN_BASE_LAYOUT_SIZE + 4);
  const contentLen = new DataView(lenSlice.buffer).getUint32(0, true);

  // Bounds check: contentLen must not exceed available bytes
  const contentStart = MIN_BASE_LAYOUT_SIZE + 4;
  const available = bytes.length - contentStart;
  if (contentLen > available) {
    throw new Error(`ReputationScoreV3 content length ${contentLen} exceeds available data (${available} bytes)`);
  }

  // Extract exact content bytes
  const content = bytes.slice(contentStart, contentStart + contentLen);

  return {
    ...base,
    content,
  };
}

/**
 * Parse ReputationScoreV3 JSON content
 */
export function parseReputationScoreContent(
  content: Uint8Array,
  contentType: ContentType,
): ReputationScoreContent | null {
  if (contentType !== ContentType.JSON || content.length === 0) {
    return null;
  }
  try {
    const text = new TextDecoder().decode(content);
    return JSON.parse(text) as ReputationScoreContent;
  } catch {
    return null;
  }
}

/**
 * Validate ReputationScoreV3 JSON content structure.
 * Throws on invalid content.
 */
export function validateReputationScoreContent(content: ReputationScoreContent): void {
  if (content.score !== undefined) {
    if (typeof content.score !== "number" || content.score < 0 || content.score > 100) {
      throw new Error("score must be a number between 0 and 100");
    }
  }
  if (content.methodology !== undefined && typeof content.methodology !== "string") {
    throw new Error("methodology must be a string");
  }
  if (content.feedbackCount !== undefined) {
    if (
      typeof content.feedbackCount !== "number" ||
      content.feedbackCount < 0 ||
      !Number.isInteger(content.feedbackCount)
    ) {
      throw new Error("feedbackCount must be a non-negative integer");
    }
  }
  if (content.validationCount !== undefined) {
    if (
      typeof content.validationCount !== "number" ||
      content.validationCount < 0 ||
      !Number.isInteger(content.validationCount)
    ) {
      throw new Error("validationCount must be a non-negative integer");
    }
  }
}

// ============================================================================
// Compressed Attestation Structure
// ============================================================================

/**
 * CompressedAttestation structure (Light Protocol storage)
 *
 * This represents the full compressed account structure with Light Protocol fields.
 * Public-facing fields use Address type for better API ergonomics.
 */
export interface CompressedAttestation {
  /** SAS schema address */
  sasSchema: Address;
  /** Agent's mint address (Token-2022 NFT identity) */
  agentMint: Address;
  /** Schema-conformant data bytes */
  data: Uint8Array;
  /** Number of signatures stored (1 or 2) */
  numSignatures: number;
  /** First signature (agent for DualSignature, counterparty for CounterpartySigned) */
  signature1: Uint8Array;
  /** Second signature (counterparty for DualSignature, zeroed for CounterpartySigned/AgentOwnerSigned) */
  signature2: Uint8Array;
}

/**
 * Fixed offsets in CompressedAttestation data for memcmp filters.
 *
 * Note: Light Protocol returns the discriminator as a separate field in the
 * response, NOT prefixed to the data bytes. The data bytes start directly
 * with the attestation fields:
 *   - bytes 0-31:  sasSchema (Pubkey)
 *   - bytes 32-63: agentMint (Pubkey)
 *   - bytes 64+:   schemaData (Vec<u8>)
 */
export const COMPRESSED_OFFSETS = {
  /** SAS schema pubkey offset for memcmp */
  SAS_SCHEMA: 0,
  /** Agent mint address offset for memcmp */
  AGENT_MINT: 32,
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
  /**
   * Schema for delegation verification (only for AgentOwnerSigned mode).
   * If set, allows delegates (via Delegate attestations) to sign on behalf of agent owner.
   * If null, only the agent owner can sign.
   */
  delegationSchema: Address | null;
  /** Whether attestations can be closed/nullified */
  closeable: boolean;
  /** Human-readable schema name (max 32 chars) */
  name: string;
}

/**
 * Core SATI schema configurations.
 * Names are used in SIWS signing messages shown to users.
 *
 * Note: delegationSchema is null here and set at deployment time for schemas
 * that support delegation (Feedback, Validation). The Delegate schema address
 * is used to verify delegation attestations at runtime.
 */
export const SCHEMA_CONFIGS: Record<string, Omit<SchemaConfig, "sasSchema">> = {
  Feedback: {
    signatureMode: SignatureMode.DualSignature,
    storageType: StorageType.Compressed,
    delegationSchema: null, // Set at deployment to Delegate schema address
    closeable: false,
    name: "FeedbackV1",
  },
  FeedbackPublic: {
    signatureMode: SignatureMode.CounterpartySigned,
    storageType: StorageType.Compressed,
    delegationSchema: null, // No delegation for CounterpartySigned
    closeable: false,
    name: "FeedbackPublicV1",
  },
  Validation: {
    signatureMode: SignatureMode.DualSignature,
    storageType: StorageType.Compressed,
    delegationSchema: null, // Set at deployment to Delegate schema address
    closeable: false,
    name: "ValidationV1",
  },
  ReputationScore: {
    signatureMode: SignatureMode.CounterpartySigned,
    storageType: StorageType.Regular,
    delegationSchema: null, // Provider controls, no delegation
    closeable: true,
    name: "ReputationScoreV3",
  },
  Delegate: {
    signatureMode: SignatureMode.AgentOwnerSigned,
    storageType: StorageType.Regular,
    delegationSchema: null, // No delegation for delegation itself (no recursive delegation)
    closeable: true,
    name: "DelegateV1",
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
export function addressToBytes(address: Address): Uint8Array {
  return new Uint8Array(addressEncoder.encode(address));
}

/**
 * Convert 32-byte Uint8Array to Address
 */
export function bytesToAddress(bytes: Uint8Array): Address {
  return addressDecoder.decode(bytes);
}

/**
 * Serialize universal base layout data to bytes
 */
export function serializeUniversalLayout(data: BaseLayout): Uint8Array {
  const contentBytes = data.content.slice(0, MAX_CONTENT_SIZE);

  // Total size: 131 (base) + content
  const totalSize = MIN_BASE_LAYOUT_SIZE + contentBytes.length;
  const buffer = new Uint8Array(totalSize);
  let offset = 0;

  // layoutVersion (1 byte)
  buffer[offset++] = CURRENT_LAYOUT_VERSION;

  // taskRef (32 bytes)
  buffer.set(data.taskRef, offset);
  offset += 32;

  // agentMint (32 bytes)
  buffer.set(addressToBytes(data.agentMint), offset);
  offset += 32;

  // counterparty (32 bytes)
  buffer.set(addressToBytes(data.counterparty), offset);
  offset += 32;

  // outcome (1 byte)
  buffer[offset++] = data.outcome;

  // dataHash (32 bytes)
  buffer.set(data.dataHash, offset);
  offset += 32;

  // contentType (1 byte)
  buffer[offset++] = data.contentType;

  // content (variable, no length prefix - length derived from total size)
  buffer.set(contentBytes, offset);

  return buffer;
}

/**
 * Deserialize universal base layout data from bytes
 */
export function deserializeUniversalLayout(bytes: Uint8Array): BaseLayout {
  if (bytes.length < MIN_BASE_LAYOUT_SIZE) {
    throw new Error(`Data too small (minimum ${MIN_BASE_LAYOUT_SIZE} bytes, got ${bytes.length})`);
  }

  let offset = 0;

  // Skip layoutVersion (1 byte) - already validated on-chain
  offset += 1;

  // taskRef (32 bytes)
  const taskRef = bytes.slice(offset, offset + 32);
  offset += 32;

  // agentMint (32 bytes)
  const agentMint = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // counterparty (32 bytes)
  const counterparty = bytesToAddress(bytes.slice(offset, offset + 32));
  offset += 32;

  // outcome (1 byte)
  const outcome = bytes[offset++] as Outcome;

  // dataHash (32 bytes)
  const dataHash = bytes.slice(offset, offset + 32);
  offset += 32;

  // contentType (1 byte)
  const contentType = bytes[offset++] as ContentType;

  // content (remaining bytes)
  const content = bytes.slice(offset);

  return {
    taskRef,
    agentMint,
    counterparty,
    outcome,
    dataHash,
    contentType,
    content,
  };
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
    case ContentType.Encrypted:
      return "Encrypted";
    default:
      return "Unknown";
  }
}

/**
 * Create JSON content bytes from a content object
 */
export function createJsonContent<T>(content: T): Uint8Array {
  const json = JSON.stringify(content);
  return new TextEncoder().encode(json);
}

/**
 * Build typed ERC-8004 feedback content bytes.
 * Maps friendly param names to FeedbackContent fields and serializes to JSON bytes.
 */
export function buildFeedbackContent(params: {
  value?: number;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  message?: string;
  reviewer?: string;
  feedbackURI?: string;
  feedbackHash?: string;
}): Uint8Array {
  const content: FeedbackContent = {};
  if (params.value !== undefined) content.value = params.value;
  if (params.valueDecimals !== undefined) content.valueDecimals = params.valueDecimals;
  if (params.tag1) content.tag1 = params.tag1;
  if (params.tag2) content.tag2 = params.tag2;
  if (params.endpoint) content.endpoint = params.endpoint;
  if (params.message) content.m = params.message;
  if (params.reviewer) content.reviewer = params.reviewer;
  if (params.feedbackURI) content.feedbackURI = params.feedbackURI;
  if (params.feedbackHash) content.feedbackHash = params.feedbackHash;
  return createJsonContent(content);
}

/**
 * Create zero-filled data hash (for CounterpartySigned/AgentOwnerSigned schemas)
 */
export function zeroDataHash(): Uint8Array {
  return new Uint8Array(32);
}

/**
 * Validate universal base layout
 */
export function validateBaseLayout(data: Uint8Array): void {
  if (data.length < MIN_BASE_LAYOUT_SIZE) {
    throw new Error(`Data too small (minimum ${MIN_BASE_LAYOUT_SIZE} bytes)`);
  }

  const version = data[OFFSETS.LAYOUT_VERSION];
  if (version !== CURRENT_LAYOUT_VERSION) {
    throw new Error(`Unsupported layout version: ${version} (expected ${CURRENT_LAYOUT_VERSION})`);
  }

  const outcome = data[OFFSETS.OUTCOME];
  if (outcome > 2) {
    throw new Error(`Invalid outcome value: ${outcome} (must be 0, 1, or 2)`);
  }

  const contentType = data[OFFSETS.CONTENT_TYPE];
  if (contentType > 15) {
    throw new Error(`Invalid content type: ${contentType} (must be 0-15)`);
  }

  const contentLen = data.length - OFFSETS.CONTENT;
  if (contentLen > MAX_CONTENT_SIZE) {
    throw new Error(`Content too large: ${contentLen} bytes (max ${MAX_CONTENT_SIZE})`);
  }
}

// ============================================================================
// Content Size Validation
// ============================================================================

/**
 * Content size validation options
 */
export interface ContentSizeValidationOptions {
  /** Throw error if content exceeds limit (default: true) */
  throwOnError?: boolean;
}

/**
 * Content size validation result
 */
export interface ContentSizeValidationResult {
  /** Whether content size is valid */
  valid: boolean;
  /** Maximum allowed size for this mode */
  maxSize: number;
  /** Actual content size */
  actualSize: number;
  /** Error message if invalid */
  error?: string;
}

/**
 * Get maximum content size for a signature mode.
 *
 * @param signatureMode - DualSignature, CounterpartySigned, or AgentOwnerSigned
 * @returns Maximum content size in bytes
 *
 * @example
 * ```typescript
 * const maxSize = getMaxContentSize(SignatureMode.DualSignature);
 * // => 70
 * ```
 */
export function getMaxContentSize(signatureMode: SignatureMode): number {
  switch (signatureMode) {
    case SignatureMode.DualSignature:
      return MAX_DUAL_SIGNATURE_CONTENT_SIZE;
    case SignatureMode.CounterpartySigned:
      return MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE;
    case SignatureMode.AgentOwnerSigned:
      return MAX_AGENT_OWNER_SIGNED_CONTENT_SIZE;
  }
}

/**
 * Validate content size for a given signature mode.
 *
 * @param content - Content bytes to validate
 * @param signatureMode - DualSignature, CounterpartySigned, or AgentOwnerSigned
 * @param options - Validation options
 * @returns Validation result
 * @throws Error if content exceeds limit and throwOnError is true (default)
 *
 * @example
 * ```typescript
 * // Check before building transaction
 * const result = validateContentSize(myContent, SignatureMode.DualSignature, { throwOnError: false });
 * if (!result.valid) {
 *   console.log(`Content too large: ${result.actualSize}/${result.maxSize} bytes`);
 * }
 *
 * // Or throw on error (default behavior)
 * validateContentSize(myContent, SignatureMode.DualSignature); // throws if too large
 * ```
 */
export function validateContentSize(
  content: Uint8Array,
  signatureMode: SignatureMode,
  options: ContentSizeValidationOptions = {},
): ContentSizeValidationResult {
  const { throwOnError = true } = options;
  const maxSize = getMaxContentSize(signatureMode);
  const actualSize = content.length;
  const valid = actualSize <= maxSize;

  const result: ContentSizeValidationResult = {
    valid,
    maxSize,
    actualSize,
  };

  if (!valid) {
    const modeNames: Record<number, string> = {
      [SignatureMode.DualSignature]: "DualSignature",
      [SignatureMode.CounterpartySigned]: "CounterpartySigned",
      [SignatureMode.AgentOwnerSigned]: "AgentOwnerSigned",
    };
    const modeName = modeNames[signatureMode] ?? "Unknown";
    result.error = `Content too large for ${modeName} mode: ${actualSize} bytes exceeds maximum ${maxSize} bytes. Use ContentType.IPFS or ContentType.Arweave for larger content.`;

    if (throwOnError) {
      throw new Error(result.error);
    }
  }

  return result;
}
