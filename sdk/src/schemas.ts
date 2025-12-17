/**
 * SATI SAS Schema Definitions
 *
 * Schema definitions for Solana Attestation Service (SAS) attestations.
 * These schemas define the data structures for SATI reputation and validation.
 */

/**
 * SAS Layout Types
 *
 * Type-safe enum for schema field layout definitions.
 * These map to the SAS program's internal type codes.
 *
 * @see https://github.com/solana-foundation/solana-attestation-service
 */
export enum SASLayoutType {
  /** Unsigned 8-bit integer (0-255) */
  U8 = 0,
  /** Unsigned 16-bit integer (0-65535) */
  U16 = 1,
  /** Unsigned 32-bit integer */
  U32 = 2,
  /** Unsigned 64-bit integer */
  U64 = 3,
  /** Unsigned 128-bit integer */
  U128 = 4,
  /** Signed 8-bit integer */
  I8 = 5,
  /** Signed 16-bit integer */
  I16 = 6,
  /** Signed 32-bit integer */
  I32 = 7,
  /** Signed 64-bit integer (for timestamps) */
  I64 = 8,
  /** Signed 128-bit integer */
  I128 = 9,
  /** Boolean */
  Bool = 10,
  /** Single character */
  Char = 11,
  /** UTF-8 string with 4-byte length prefix */
  String = 12,
  /** Byte array with 4-byte length prefix */
  VecU8 = 13,
}

/**
 * SAS Schema definition structure
 */
export interface SASSchema {
  name: string;
  version: number;
  description: string;
  layout: SASLayoutType[];
  fieldNames: string[];
}

// ============ FEEDBACK AUTH SCHEMA ============

/**
 * FeedbackAuth Schema - Authorization for client to submit feedback
 *
 * Replaces ERC-8004's off-chain signature with on-chain attestation.
 *
 * Attestation configuration:
 * - credential = agent NFT mint
 * - subject = client pubkey (authorized reviewer)
 * - issuer = agent owner
 * - nonce = hash(agentMint, clientPubkey)
 */
export const FEEDBACK_AUTH_SCHEMA: SASSchema = {
  name: "SATIFeedbackAuth",
  version: 1,
  description: "Authorization for client to submit feedback",
  layout: [SASLayoutType.String, SASLayoutType.U16, SASLayoutType.I64],
  fieldNames: [
    "agent_mint", // Agent NFT mint address (base58 string)
    "index_limit", // Maximum feedback index allowed (ERC-8004: indexLimit)
    "expiry", // Unix timestamp (0 = use SAS expiry)
  ],
};

// ============ FEEDBACK SCHEMA ============

/**
 * Feedback Schema - Client feedback for agent (ERC-8004 compatible)
 *
 * Attestation configuration:
 * - credential = agent NFT mint
 * - issuer = client (feedback giver)
 * - nonce = hash(agent_mint, client_pubkey, timestamp)
 */
export const FEEDBACK_SCHEMA: SASSchema = {
  name: "SATIFeedback",
  version: 1,
  description: "Client feedback for agent (ERC-8004 compatible)",
  layout: [
    SASLayoutType.String, // agent_mint
    SASLayoutType.U8, // score
    SASLayoutType.String, // tag1
    SASLayoutType.String, // tag2
    SASLayoutType.String, // fileuri
    SASLayoutType.VecU8, // filehash
    SASLayoutType.String, // payment_proof
  ],
  fieldNames: [
    "agent_mint", // Agent NFT mint receiving feedback (base58 string)
    "score", // 0-100 as U8 (matches ERC-8004 uint8)
    "tag1", // Optional tag (string)
    "tag2", // Optional tag (string)
    "fileuri", // Off-chain feedback details (IPFS) - matches ERC-8004
    "filehash", // SHA-256 hash (32 bytes) - matches ERC-8004
    "payment_proof", // x402 transaction reference (optional)
  ],
};

// ============ FEEDBACK RESPONSE SCHEMA ============

/**
 * FeedbackResponse Schema - Response to feedback (ERC-8004 appendResponse)
 *
 * Attestation configuration:
 * - credential = agent NFT mint
 * - issuer = responder (agent owner, auditor, etc.)
 * - nonce = hash(feedback_id, responder_pubkey, index)
 */
export const FEEDBACK_RESPONSE_SCHEMA: SASSchema = {
  name: "SATIFeedbackResponse",
  version: 1,
  description: "Response to feedback (ERC-8004 appendResponse)",
  layout: [
    SASLayoutType.String, // feedback_id
    SASLayoutType.String, // response_uri
    SASLayoutType.VecU8, // response_hash
  ],
  fieldNames: [
    "feedback_id", // Reference to feedback attestation pubkey (base58 string)
    "response_uri", // Off-chain response details (string)
    "response_hash", // Content hash (32 bytes)
  ],
};

// ============ VALIDATION REQUEST SCHEMA ============

/**
 * ValidationRequest Schema - Agent requests work validation
 *
 * Attestation configuration:
 * - credential = agent NFT mint
 * - subject = validator pubkey
 * - issuer = agent owner
 * - nonce = hash(agent_mint, validator_pubkey, user_nonce)
 */
export const VALIDATION_REQUEST_SCHEMA: SASSchema = {
  name: "SATIValidationRequest",
  version: 1,
  description: "Agent requests work validation",
  layout: [
    SASLayoutType.String, // agent_mint
    SASLayoutType.String, // method_id
    SASLayoutType.String, // request_uri
    SASLayoutType.VecU8, // request_hash
  ],
  fieldNames: [
    "agent_mint", // Agent NFT mint requesting validation (base58 string)
    "method_id", // Validation method ("tee", "zkml", "restake") - SATI extension
    "request_uri", // Off-chain validation data (string)
    "request_hash", // Content hash (32 bytes)
  ],
};

// ============ VALIDATION RESPONSE SCHEMA ============

/**
 * ValidationResponse Schema - Validator responds to request
 *
 * Attestation configuration:
 * - credential = agent NFT mint (from request)
 * - issuer = validator
 * - nonce = hash(request_id, response_index)
 */
export const VALIDATION_RESPONSE_SCHEMA: SASSchema = {
  name: "SATIValidationResponse",
  version: 1,
  description: "Validator responds to request",
  layout: [
    SASLayoutType.String, // request_id
    SASLayoutType.U8, // response
    SASLayoutType.String, // response_uri
    SASLayoutType.VecU8, // response_hash
    SASLayoutType.String, // tag
  ],
  fieldNames: [
    "request_id", // Reference to request attestation pubkey (base58 string)
    "response", // 0-100 as U8 (0=fail, 100=pass)
    "response_uri", // Off-chain evidence (string)
    "response_hash", // Content hash (32 bytes)
    "tag", // Optional categorization (string)
  ],
};

// ============ CERTIFICATION SCHEMA ============

/**
 * Certification Schema - Immutable certification for agent
 *
 * For permanent, unmodifiable records (security audits, compliance
 * certifications, credential attestations). SAS attestations are
 * immutable by design - content cannot be modified after creation.
 *
 * Attestation configuration:
 * - credential = agent NFT mint
 * - issuer = certifier (e.g., audit firm)
 * - nonce = hash(agent_mint, certifier_pubkey, cert_type, issued_at)
 */
export const CERTIFICATION_SCHEMA: SASSchema = {
  name: "SATICertification",
  version: 1,
  description: "Immutable certification for agent",
  layout: [
    SASLayoutType.String, // certifier
    SASLayoutType.String, // cert_type
    SASLayoutType.String, // cert_uri
    SASLayoutType.I64, // issued_at
  ],
  fieldNames: [
    "certifier", // Certifying entity (e.g., "OtterSec")
    "cert_type", // Certification type (e.g., "security-audit")
    "cert_uri", // Link to full certificate/report
    "issued_at", // Unix timestamp
  ],
};

// ============ ALL SCHEMAS ============

/**
 * All SATI SAS schemas
 */
export const SATI_SCHEMAS = {
  feedbackAuth: FEEDBACK_AUTH_SCHEMA,
  feedback: FEEDBACK_SCHEMA,
  feedbackResponse: FEEDBACK_RESPONSE_SCHEMA,
  validationRequest: VALIDATION_REQUEST_SCHEMA,
  validationResponse: VALIDATION_RESPONSE_SCHEMA,
  certification: CERTIFICATION_SCHEMA,
} as const;

/**
 * Schema names for lookup
 */
export const SCHEMA_NAMES = {
  FEEDBACK_AUTH: "SATIFeedbackAuth",
  FEEDBACK: "SATIFeedback",
  FEEDBACK_RESPONSE: "SATIFeedbackResponse",
  VALIDATION_REQUEST: "SATIValidationRequest",
  VALIDATION_RESPONSE: "SATIValidationResponse",
  CERTIFICATION: "SATICertification",
} as const;
