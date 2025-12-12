/**
 * SATI SAS Schema Definitions
 *
 * Schema definitions for Solana Attestation Service (SAS) attestations.
 * These schemas define the data structures for SATI reputation and validation.
 *
 * SAS Layout Type Reference (from solana-attestation-service):
 * - 0: U8     (unsigned 8-bit integer, 0-255)
 * - 1: U16    (unsigned 16-bit integer, 0-65535)
 * - 2: U32    (unsigned 32-bit integer)
 * - 3: U64    (unsigned 64-bit integer)
 * - 8: I64    (signed 64-bit integer, for timestamps)
 * - 12: String (UTF-8 with 4-byte length prefix)
 * - 13: VecU8  (byte array with 4-byte length prefix)
 */

/**
 * SAS Schema definition structure
 */
export interface SASSchema {
  name: string;
  version: number;
  description: string;
  layout: number[];
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
  layout: [12, 1, 8], // String, U16, I64
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
  layout: [12, 0, 12, 12, 12, 13, 12], // String, U8, String, String, String, VecU8, String
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
  layout: [12, 12, 13], // String, String, VecU8
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
  layout: [12, 12, 12, 13], // String, String, String, VecU8
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
  layout: [12, 0, 12, 13, 12], // String, U8, String, VecU8, String
  fieldNames: [
    "request_id", // Reference to request attestation pubkey (base58 string)
    "response", // 0-100 as U8 (0=fail, 100=pass)
    "response_uri", // Off-chain evidence (string)
    "response_hash", // Content hash (32 bytes)
    "tag", // Optional categorization (string)
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
} as const;
