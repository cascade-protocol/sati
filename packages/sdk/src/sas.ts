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
import { keccak_256 } from "@noble/hashes/sha3";
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
export const REPUTATION_SCORE_SCHEMA_NAME = "SATIReputationScore";

/**
 * SAS Schema definition interface
 */
export interface SASSchemaDefinition {
  name: string;
  description: string;
  layout: number[];
  fieldNames: string[];
}

/**
 * ReputationScore schema definition for SAS
 *
 * Layout: pubkey(32) + pubkey(32) + u8(1) + i64(8) = 73 bytes
 */
export const REPUTATION_SCORE_SAS_SCHEMA: SASSchemaDefinition = {
  name: REPUTATION_SCORE_SCHEMA_NAME,
  description:
    "Reputation score from an authorized provider for a SATI-registered agent",
  // Layout: token_account (pubkey), provider (pubkey), score (u8), timestamp (i64)
  layout: [7, 7, 0, 4], // pubkey=7, u8=0, i64=4
  fieldNames: ["token_account", "provider", "score", "timestamp"],
};

/**
 * Derive SATI credential PDA
 *
 * @param authority - Credential authority address
 * @returns Credential PDA and bump
 */
export async function deriveSatiCredentialPda(
  authority: Address,
): Promise<readonly [Address, number]> {
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
export function computeReputationScoreNonce(
  provider: Address,
  tokenAccount: Address,
): Address {
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
