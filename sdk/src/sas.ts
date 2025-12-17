/**
 * SATI SAS Integration Module
 *
 * Helpers for interacting with Solana Attestation Service (SAS)
 * for reputation and validation attestations.
 *
 * ERC-8004 compatible field naming conventions are used.
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
  getCreateAttestationInstruction,
  getCloseAttestationInstruction,
  serializeAttestationData,
  deserializeAttestationData,
  fetchSchema,
  fetchAttestation,
  fetchMaybeCredential,
  fetchMaybeSchema,
  fetchAllMaybeSchema,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";

import {
  FEEDBACK_AUTH_SCHEMA,
  FEEDBACK_SCHEMA,
  FEEDBACK_RESPONSE_SCHEMA,
  VALIDATION_REQUEST_SCHEMA,
  VALIDATION_RESPONSE_SCHEMA,
  CERTIFICATION_SCHEMA,
  type SASSchema,
} from "./schemas";
import type { SATISASConfig } from "./types";

// Re-export SATISASConfig for consumers
export type { SATISASConfig };

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
  getCreateAttestationInstruction,
  getCloseAttestationInstruction,
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
 * SATI credential name used for all attestations
 */
export const SATI_CREDENTIAL_NAME = "SATI";

/**
 * Schema names for SATI attestations
 */
export const SATI_SCHEMA_NAMES = {
  FEEDBACK_AUTH: "SATIFeedbackAuth",
  FEEDBACK: "SATIFeedback",
  FEEDBACK_RESPONSE: "SATIFeedbackResponse",
  VALIDATION_REQUEST: "SATIValidationRequest",
  VALIDATION_RESPONSE: "SATIValidationResponse",
  CERTIFICATION: "SATICertification",
} as const;

/**
 * All SATI schemas with their definitions (keyed by schema name constant)
 */
export const SATI_SAS_SCHEMAS: Record<
  keyof typeof SATI_SCHEMA_NAMES,
  SASSchema
> = {
  FEEDBACK_AUTH: FEEDBACK_AUTH_SCHEMA,
  FEEDBACK: FEEDBACK_SCHEMA,
  FEEDBACK_RESPONSE: FEEDBACK_RESPONSE_SCHEMA,
  VALIDATION_REQUEST: VALIDATION_REQUEST_SCHEMA,
  VALIDATION_RESPONSE: VALIDATION_RESPONSE_SCHEMA,
  CERTIFICATION: CERTIFICATION_SCHEMA,
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
 * @param schemaName - Schema name (e.g., "SATIFeedback")
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
 * @param nonce - Unique nonce for this attestation (e.g., hash of agent + client)
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
  schema: SASSchema;
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
 * Serialize feedback authorization data for attestation
 *
 * @param data - FeedbackAuth data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeFeedbackAuthData(
  data: {
    agent_mint: string;
    index_limit: number;
    expiry: number;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, data);
}

/**
 * Serialize feedback data for attestation
 *
 * @param data - Feedback data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeFeedbackData(
  data: {
    agent_mint: string;
    score: number;
    tag1?: string;
    tag2?: string;
    fileuri?: string;
    filehash?: Uint8Array;
    payment_proof?: string;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, {
    agent_mint: data.agent_mint,
    score: data.score,
    tag1: data.tag1 ?? "",
    tag2: data.tag2 ?? "",
    fileuri: data.fileuri ?? "",
    filehash: data.filehash ?? new Uint8Array(32),
    payment_proof: data.payment_proof ?? "",
  });
}

/**
 * Serialize feedback response data for attestation
 *
 * @param data - FeedbackResponse data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeFeedbackResponseData(
  data: {
    feedback_id: string;
    response_uri: string;
    response_hash?: Uint8Array;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, {
    feedback_id: data.feedback_id,
    response_uri: data.response_uri,
    response_hash: data.response_hash ?? new Uint8Array(32),
  });
}

/**
 * Serialize validation request data for attestation
 *
 * @param data - ValidationRequest data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeValidationRequestData(
  data: {
    agent_mint: string;
    method_id: string;
    request_uri: string;
    request_hash?: Uint8Array;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, {
    agent_mint: data.agent_mint,
    method_id: data.method_id,
    request_uri: data.request_uri,
    request_hash: data.request_hash ?? new Uint8Array(32),
  });
}

/**
 * Serialize validation response data for attestation
 *
 * @param data - ValidationResponse data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeValidationResponseData(
  data: {
    request_id: string;
    response: number;
    response_uri?: string;
    response_hash?: Uint8Array;
    tag?: string;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, {
    request_id: data.request_id,
    response: data.response,
    response_uri: data.response_uri ?? "",
    response_hash: data.response_hash ?? new Uint8Array(32),
    tag: data.tag ?? "",
  });
}

/**
 * Compute nonce for FeedbackAuth attestation
 * nonce = keccak256("feedbackAuth:" + agentMint + ":" + clientPubkey)
 *
 * @param agentMint - Agent NFT mint address
 * @param clientPubkey - Client public key
 * @returns Nonce as Address (base58)
 */
export function computeFeedbackAuthNonce(
  agentMint: Address,
  clientPubkey: Address,
): Address {
  const data = new TextEncoder().encode(
    `feedbackAuth:${agentMint}:${clientPubkey}`,
  );
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Compute nonce for Feedback attestation
 * nonce = keccak256("feedback:" + agentMint + ":" + clientPubkey + ":" + timestamp)
 *
 * @param agentMint - Agent NFT mint address
 * @param clientPubkey - Client public key
 * @param timestamp - Unix timestamp
 * @returns Nonce as Address (base58)
 */
export function computeFeedbackNonce(
  agentMint: Address,
  clientPubkey: Address,
  timestamp: number,
): Address {
  const data = new TextEncoder().encode(
    `feedback:${agentMint}:${clientPubkey}:${timestamp}`,
  );
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Compute nonce for FeedbackResponse attestation
 * nonce = keccak256("response:" + feedbackId + ":" + responderPubkey + ":" + index)
 *
 * @param feedbackId - Feedback attestation address
 * @param responderPubkey - Responder public key
 * @param index - Response index
 * @returns Nonce as Address (base58)
 */
export function computeFeedbackResponseNonce(
  feedbackId: Address,
  responderPubkey: Address,
  index: number,
): Address {
  const data = new TextEncoder().encode(
    `response:${feedbackId}:${responderPubkey}:${index}`,
  );
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Compute nonce for ValidationRequest attestation
 * nonce = keccak256("validationReq:" + agentMint + ":" + validatorPubkey + ":" + userNonce)
 *
 * @param agentMint - Agent NFT mint address
 * @param validatorPubkey - Validator public key
 * @param userNonce - User-provided nonce
 * @returns Nonce as Address (base58)
 */
export function computeValidationRequestNonce(
  agentMint: Address,
  validatorPubkey: Address,
  userNonce: number,
): Address {
  const data = new TextEncoder().encode(
    `validationReq:${agentMint}:${validatorPubkey}:${userNonce}`,
  );
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Compute nonce for ValidationResponse attestation
 * nonce = keccak256("validationResp:" + requestId + ":" + responseIndex)
 *
 * @param requestId - Request attestation address
 * @param responseIndex - Response index
 * @returns Nonce as Address (base58)
 */
export function computeValidationResponseNonce(
  requestId: Address,
  responseIndex: number,
): Address {
  const data = new TextEncoder().encode(
    `validationResp:${requestId}:${responseIndex}`,
  );
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}

/**
 * Serialize certification data for attestation
 *
 * @param data - Certification data
 * @param schemaData - Schema account data from fetchSchema
 * @returns Serialized data buffer
 */
export function serializeCertificationData(
  data: {
    certifier: string;
    cert_type: string;
    cert_uri: string;
    issued_at: number;
  },
  schemaData: Awaited<ReturnType<typeof fetchSchema>>["data"],
): Uint8Array {
  return serializeAttestationData(schemaData, data);
}

/**
 * Compute nonce for Certification attestation
 * nonce = keccak256("certification:" + agentMint + ":" + certifierPubkey + ":" + certType + ":" + issuedAt)
 *
 * @param agentMint - Agent NFT mint address
 * @param certifierPubkey - Certifier public key
 * @param certType - Certification type (e.g., "security-audit")
 * @param issuedAt - Unix timestamp
 * @returns Nonce as Address (base58)
 */
export function computeCertificationNonce(
  agentMint: Address,
  certifierPubkey: Address,
  certType: string,
  issuedAt: number,
): Address {
  const data = new TextEncoder().encode(
    `certification:${agentMint}:${certifierPubkey}:${certType}:${issuedAt}`,
  );
  const hash = keccak_256(data);
  return address(bs58.encode(hash));
}
