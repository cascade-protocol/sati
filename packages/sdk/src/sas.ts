/**
 * SATI SAS Integration Module
 *
 * Helpers for interacting with Solana Attestation Service (SAS)
 * for ReputationScoreV3 attestations (stored as regular accounts).
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
 * SATI credential name used for ReputationScoreV3 attestations
 */
export const SATI_CREDENTIAL_NAME = "SATI";

/**
 * Schema name for ReputationScoreV3 attestations in SAS
 */
export const REPUTATION_SCORE_SCHEMA_NAME = "SATIReputationScoreV3";

/**
 * SAS Schema definition interface
 */
export interface SASSchemaDefinition {
  name: string;
  description: string;
  layout: number[];
  fieldNames: string[];
}

// =============================================================================
// SAS Schema Layout Type Reference
// =============================================================================
//
// SAS SchemaDataTypes (from solana-attestation-service/program/src/state/schema.rs):
//   Fixed:    0=U8(1), 1=U16(2), 2=U32(4), 3=U64(8), 4=U128(16)
//             5=I8(1), 6=I16(2), 7=I32(4), 8=I64(8), 9=I128(16)
//             10=Bool(1), 11=Char(4)
//   Variable: 12=String, 13=VecU8, 14-25=other Vec types
//
// IMPORTANT: SAS has NO native Pubkey/Address/Bytes32 type. The largest fixed
// type is U128 at 16 bytes. To represent 32-byte fields (Solana addresses),
// split into two consecutive U128 fields (hi/lo halves, 16 bytes each).
// This is a known limitation of SAS's type system -- see:
//   - https://github.com/solana-foundation/solana-attestation-service/issues/32
//   - cereal_macro/src/lib.rs line 49: unsupported types panic
//   - Koranet example uses String (type 12) for addresses, but that adds
//     4-byte length prefix overhead and requires Borsh serialization changes.
//
// SAS validate_data walks the layout, sums byte sizes per type, and requires
// total == data.len() exactly. It does NOT interpret field semantics.
//
// Feedback/Validation/Delegate schemas use incorrect type numbers
// (7=I32 was mistakenly treated as "pubkey", 9=I128 as "blob").
// These schemas are only used via Light Protocol compressed path which
// bypasses SAS validate_data, so they work in practice despite wrong layouts.
// ReputationScoreV3 (regular SAS path) uses correct types + VecU8 for content.
// =============================================================================

// Schema name constants
export const FEEDBACK_SCHEMA_NAME = "SATIFeedbackV1";
export const FEEDBACK_PUBLIC_SCHEMA_NAME = "SATIFeedbackPublicV1";
export const VALIDATION_SCHEMA_NAME = "SATIValidationV1";
export const DELEGATE_SCHEMA_NAME = "SATIDelegateV1";

/**
 * Feedback schema definition for SAS
 *
 * WARNING: Layout uses incorrect type numbers (7=I32 not pubkey, 9=I128 not blob).
 * Safe because Feedback uses Light Protocol compressed path which bypasses SAS validate_data.
 * Do NOT use this layout for Regular (non-compressed) SAS attestations.
 */
export const FEEDBACK_SAS_SCHEMA: SASSchemaDefinition = {
  name: FEEDBACK_SCHEMA_NAME,
  description: "Feedback attestation with dual signatures from agent and counterparty",
  // WARNING: wrong types (see Feedback note above), safe only for compressed path
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
 * FeedbackPublic schema definition for SAS
 *
 * Same data layout as Feedback but uses CounterpartySigned mode.
 *
 * WARNING: Layout uses incorrect type numbers (see Feedback note above).
 * Safe because FeedbackPublic uses Light Protocol compressed path.
 */
export const FEEDBACK_PUBLIC_SAS_SCHEMA: SASSchemaDefinition = {
  name: FEEDBACK_PUBLIC_SCHEMA_NAME,
  description: "Public feedback attestation with single agent signature (counterparty not verified)",
  // WARNING: wrong types (see Feedback note above), safe only for compressed path
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
 * WARNING: Layout uses incorrect type numbers (see Feedback note above).
 * Safe because Validation uses Light Protocol compressed path.
 */
export const VALIDATION_SAS_SCHEMA: SASSchemaDefinition = {
  name: VALIDATION_SCHEMA_NAME,
  description: "Validation attestation with dual signatures from agent and validator",
  // WARNING: wrong types, safe only for compressed path
  layout: [7, 7, 7, 7, 0, 0, 0, 9],
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
 * ReputationScoreV3 schema definition for SAS
 *
 * 32-byte fields (addresses, hashes) are split into hi/lo U128 pairs
 * because SAS has no native 32-byte type (max fixed = U128 at 16 bytes).
 * Content uses VecU8 (type 13) for variable-length data (JSON metadata, etc.).
 *
 * Layout math: 1 + (16+16)*4 + 1 + (16+16) + 1 + VecU8 = 131 fixed + 4 len prefix + N content
 *
 * SAS VecU8 validation: reads 4-byte LE length prefix, then consumes that many bytes.
 * Empty content = 4 bytes (length=0). JSON content = 4 + N bytes.
 */
export const REPUTATION_SCORE_SAS_SCHEMA: SASSchemaDefinition = {
  name: REPUTATION_SCORE_SCHEMA_NAME,
  description: "Reputation score from an authorized provider for a SATI-registered agent",
  layout: [0, 4, 4, 4, 4, 4, 4, 0, 4, 4, 0, 13],
  fieldNames: [
    "layout_version",
    "task_ref_hi",
    "task_ref_lo",
    "agent_mint_hi",
    "agent_mint_lo",
    "counterparty_hi",
    "counterparty_lo",
    "outcome",
    "data_hash_hi",
    "data_hash_lo",
    "content_type",
    "content",
  ],
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
  // WARNING: wrong types (see Feedback note above). Delegate uses Regular SAS path
  // so this layout IS broken for validate_data. Needs corrected layout when delegation is enabled.
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
 * @param schemaName - Schema name (e.g., "SATIReputationScoreV3")
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
 * Compute nonce for ReputationScoreV3 attestation
 *
 * One ReputationScoreV3 per (provider, agent) pair.
 * nonce = keccak256(provider + agentMint)
 *
 * @param provider - Reputation provider address
 * @param agentMint - Agent's mint address
 * @returns Nonce as Address (base58)
 */
export function computeReputationScoreNonce(provider: Address, agentMint: Address): Address {
  const data = new TextEncoder().encode(`${provider}${agentMint}`);
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Serialize ReputationScoreV3 data for SAS attestation
 *
 * @param data - ReputationScoreV3 data
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
