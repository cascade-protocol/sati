/**
 * SATI SAS Schema Definitions
 *
 * Schema definitions for Solana Attestation Service (SAS) attestations.
 * These schemas define the data structures for SATI reputation and validation.
 *
 * SAS Layout Type Reference:
 * - 0: String
 * - 2: U16
 * - 6: VecU8
 * - 8: I64
 * - 12: String (pubkey as base58)
 * - 13: VecU8 (hash)
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
  layout: [12, 2, 8], // String (pubkey), U16, I64
  fieldNames: [
    "agent_mint", // Agent NFT mint address
    "index_limit", // Maximum feedback index allowed (ERC-8004 indexLimit)
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
  layout: [12, 2, 0, 0, 0, 13, 0], // Pubkey, U16, String, String, String, VecU8, String
  fieldNames: [
    "agent_mint", // Agent NFT mint receiving feedback
    "score", // 0-100 as U16 (ERC-8004 uses uint8; U16 provides headroom)
    "tag1", // Optional categorization
    "tag2", // Optional categorization
    "fileuri", // Off-chain feedback details (IPFS)
    "filehash", // SHA-256 hash (32 bytes)
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
  layout: [12, 0, 13], // Pubkey, String, VecU8
  fieldNames: [
    "feedback_id", // Reference to feedback attestation pubkey
    "response_uri", // Off-chain response details
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
  layout: [12, 0, 0, 13], // Pubkey, String, String, VecU8
  fieldNames: [
    "agent_mint", // Agent NFT mint requesting validation
    "method_id", // Validation method ("tee", "zkml", "restake") - SATI extension
    "request_uri", // Off-chain validation data
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
  layout: [12, 2, 0, 13, 0], // Pubkey, U16, String, VecU8, String
  fieldNames: [
    "request_id", // Reference to request attestation pubkey
    "response", // 0-100 as U16 (0=fail, 100=pass)
    "response_uri", // Off-chain evidence
    "response_hash", // Content hash
    "tag", // Optional categorization
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
