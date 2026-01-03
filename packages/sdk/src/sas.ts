/**
 * SATI SAS Integration Module
 *
 * Helpers for interacting with Solana Attestation Service (SAS)
 * for ReputationScore attestations (stored as regular accounts).
 *
 * Note: Feedback and Validation attestations use Light Protocol
 * (compressed accounts) and are handled by the LightClient.
 */

import type { Address, TransactionSigner } from "@solana/kit";
import { address } from "@solana/kit";
import { keccak_256 } from "@noble/hashes/sha3.js";
import bs58 from "bs58";
import {
  deriveCredentialPda,
  deriveSchemaPda,
  deriveAttestationPda,
  deriveEventAuthorityAddress,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  getCreateAttestationInstruction as getSasCreateAttestationInstruction,
  getCloseAttestationInstruction as getSasCloseAttestationInstruction,
  serializeAttestationData,
  deserializeAttestationData,
  fetchSchema,
  fetchAttestation,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchAllMaybeSchema,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";

// Re-export SAS program address
export { SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS as SAS_PROGRAM_ID };

// Re-export key SAS functions for direct use
export {
  deriveCredentialPda,
  deriveSchemaPda,
  deriveAttestationPda,
  deriveEventAuthorityAddress,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  getSasCreateAttestationInstruction,
  getSasCloseAttestationInstruction,
  serializeAttestationData,
  deserializeAttestationData,
  fetchSchema,
  fetchAttestation,
  // Idempotency helpers (return null instead of throwing)
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchAllMaybeSchema,
};

/**
 * SATI credential name used for ReputationScore attestations
 */
export const SATI_CREDENTIAL_NAME = "SATI";

/**
 * Schema name for ReputationScore attestations in SAS
 */
export const REPUTATION_SCORE_SCHEMA_NAME = "SATIReputationScoreV1";

/**
 * SAS Schema definition interface
 */
export interface SASSchemaDefinition {
  name: string;
  description: string;
  layout: number[];
  fieldNames: string[];
}

// Schema name constants (V1 - first production version)
export const FEEDBACK_SCHEMA_NAME = "SATIFeedbackV1";
export const FEEDBACK_PUBLIC_SCHEMA_NAME = "SATIFeedbackPublicV1";
export const VALIDATION_SCHEMA_NAME = "SATIValidationV1";
export const DELEGATE_SCHEMA_NAME = "SATIDelegateV1";

/**
 * Feedback schema definition for SAS
 *
 * Layout: task_ref(32) + token_account(32) + counterparty(32) + data_hash(32) +
 *         content_type(1) + outcome(1) + tag1(var) + tag2(var) + content(var)
 *
 * Note: Variable-length fields use blob type (9)
 */
export const FEEDBACK_SAS_SCHEMA: SASSchemaDefinition = {
  name: FEEDBACK_SCHEMA_NAME,
  description: "Feedback attestation with dual signatures from agent and counterparty",
  // Layout types: pubkey=7, u8=0, blob=9
  layout: [7, 7, 7, 7, 0, 0, 9, 9, 9], // task_ref, token, counter, hash, contentType, outcome, tag1, tag2, content
  fieldNames: [
    "task_ref",
    "token_account",
    "counterparty",
    "data_hash",
    "content_type",
    "outcome",
    "tag1",
    "tag2",
    "content",
  ],
};

/**
 * FeedbackPublic schema definition for SAS
 *
 * Same data layout as Feedback but uses CounterpartySigned mode.
 * Only counterparty signature is verified on-chain; anyone can submit feedback
 * about any agent without requiring the agent's signature.
 */
export const FEEDBACK_PUBLIC_SAS_SCHEMA: SASSchemaDefinition = {
  name: FEEDBACK_PUBLIC_SCHEMA_NAME,
  description: "Public feedback attestation with single agent signature (counterparty not verified)",
  // Same layout as Feedback
  layout: [7, 7, 7, 7, 0, 0, 9, 9, 9],
  fieldNames: [
    "task_ref",
    "token_account",
    "counterparty",
    "data_hash",
    "content_type",
    "outcome",
    "tag1",
    "tag2",
    "content",
  ],
};

/**
 * Validation schema definition for SAS
 *
 * Layout: task_ref(32) + token_account(32) + counterparty(32) + data_hash(32) +
 *         content_type(1) + validation_type(1) + response(1) + content(var)
 */
export const VALIDATION_SAS_SCHEMA: SASSchemaDefinition = {
  name: VALIDATION_SCHEMA_NAME,
  description: "Validation attestation with dual signatures from agent and validator",
  // Layout types: pubkey=7, u8=0, blob=9
  layout: [7, 7, 7, 7, 0, 0, 0, 9], // task_ref, token, counter, hash, contentType, validationType, response, content
  fieldNames: [
    "task_ref",
    "token_account",
    "counterparty",
    "data_hash",
    "content_type",
    "validation_type",
    "response",
    "content",
  ],
};

/**
 * ReputationScore schema definition for SAS
 *
 * Layout: task_ref(32) + token_account(32) + counterparty(32) + score(1) +
 *         content_type(1) + content(var)
 */
export const REPUTATION_SCORE_SAS_SCHEMA: SASSchemaDefinition = {
  name: REPUTATION_SCORE_SCHEMA_NAME,
  description: "Reputation score from an authorized provider for a SATI-registered agent",
  // Layout types: pubkey=7, u8=0, blob=9
  layout: [7, 7, 7, 0, 0, 9], // task_ref, token, counter, score, contentType, content
  fieldNames: ["task_ref", "token_account", "counterparty", "score", "content_type", "content"],
};

/**
 * Delegate schema definition for SAS
 *
 * Uses universal base layout for hot/cold wallet delegation.
 * - task_ref: zero-filled (delegations are not task-bound)
 * - token_account: agent's mint address
 * - counterparty: delegate's public key
 * - outcome: 2 (Positive) for active delegation
 * - data_hash: NFT owner pubkey at delegation time (for ownership binding)
 * - content_type: 0 (None) or 1 (JSON) for expiry metadata
 * - content: optional expiry timestamp or metadata
 *
 * Uses AgentOwnerSigned mode - only agent owner can create delegations.
 * Stored as Regular (SAS) for efficient lookup and revocation.
 */
export const DELEGATE_SAS_SCHEMA: SASSchemaDefinition = {
  name: DELEGATE_SCHEMA_NAME,
  description: "Delegation authorization for hot wallet signing on behalf of agent",
  // Same universal layout as other schemas
  layout: [7, 7, 7, 7, 0, 0, 9, 9, 9],
  fieldNames: [
    "task_ref",
    "token_account",
    "counterparty",
    "data_hash",
    "content_type",
    "outcome",
    "tag1",
    "tag2",
    "content",
  ],
};

/**
 * All SATI schemas for deployment
 */
export const SATI_SCHEMAS = {
  feedback: FEEDBACK_SAS_SCHEMA,
  feedbackPublic: FEEDBACK_PUBLIC_SAS_SCHEMA,
  validation: VALIDATION_SAS_SCHEMA,
  reputationScore: REPUTATION_SCORE_SAS_SCHEMA,
  delegate: DELEGATE_SAS_SCHEMA,
} as const;

/**
 * Derive SATI credential PDA
 *
 * @param authority - Credential authority address
 * @returns Credential PDA and bump
 */
export async function deriveSatiCredentialPda(authority: Address): Promise<readonly [Address, number]> {
  return deriveCredentialPda({
    authority,
    name: SATI_CREDENTIAL_NAME,
  });
}

/**
 * Derive SATI schema PDA
 *
 * @param credentialPda - SATI credential PDA
 * @param schemaName - Schema name (e.g., "SATIReputationScore")
 * @param version - Schema version (default: 1)
 * @returns Schema PDA and bump
 */
export async function deriveSatiSchemaPda(
  credentialPda: Address,
  schemaName: string,
  version: number = 1,
): Promise<readonly [Address, number]> {
  return deriveSchemaPda({
    credential: credentialPda,
    name: schemaName,
    version,
  });
}

/**
 * Derive attestation PDA for a specific schema
 *
 * @param credentialPda - SATI credential PDA
 * @param schemaPda - Schema PDA
 * @param nonce - Unique nonce for this attestation
 * @returns Attestation PDA and bump
 */
export async function deriveSatiAttestationPda(
  credentialPda: Address,
  schemaPda: Address,
  nonce: Address,
): Promise<readonly [Address, number]> {
  return deriveAttestationPda({
    credential: credentialPda,
    schema: schemaPda,
    nonce,
  });
}

/**
 * Get instructions to create SATI credential
 *
 * @param params - Creation parameters
 * @returns Instruction to create credential
 */
export function getCreateSatiCredentialInstruction(params: {
  payer: TransactionSigner;
  authority: TransactionSigner;
  credentialPda: Address;
  authorizedSigners: Address[];
}) {
  return getCreateCredentialInstruction({
    payer: params.payer,
    credential: params.credentialPda,
    authority: params.authority,
    name: SATI_CREDENTIAL_NAME,
    signers: params.authorizedSigners,
  });
}

/**
 * Get instruction to create a SATI schema
 *
 * @param params - Schema creation parameters
 * @returns Instruction to create schema
 */
export function getCreateSatiSchemaInstruction(params: {
  payer: TransactionSigner;
  authority: TransactionSigner;
  credentialPda: Address;
  schemaPda: Address;
  schema: SASSchemaDefinition;
}) {
  return getCreateSchemaInstruction({
    payer: params.payer,
    authority: params.authority,
    credential: params.credentialPda,
    schema: params.schemaPda,
    name: params.schema.name,
    description: params.schema.description,
    layout: new Uint8Array(params.schema.layout),
    fieldNames: params.schema.fieldNames,
  });
}

/**
 * Compute nonce for ReputationScore attestation
 *
 * One reputation score per (provider, agent token account) pair.
 * nonce = keccak256(provider + tokenAccount)
 *
 * @param provider - Reputation provider address
 * @param tokenAccount - Agent's token account address
 * @returns Nonce as Address (base58)
 */
export function computeReputationScoreNonce(provider: Address, tokenAccount: Address): Address {
  const data = new TextEncoder().encode(`${provider}${tokenAccount}`);
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Serialize ReputationScore data for SAS attestation
 *
 * @param data - ReputationScore data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeReputationScoreData(
  data: {
    token_account: string;
    provider: string;
    score: number;
    timestamp: number;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, data);
}
