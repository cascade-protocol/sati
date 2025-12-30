/**
 * SATI SDK - Solana Agent Trust Infrastructure
 *
 * TypeScript SDK for interacting with SATI v2:
 * - Registry: Agent identity registration via Token-2022 NFT
 * - SAS Schemas: Reputation and validation attestation schemas
 * - Client: High-level SATI class for convenient interaction
 *
 * This main entry point is browser-compatible (@solana/kit native).
 *
 * For @solana/web3.js compatibility (Node.js only):
 * ```typescript
 * import { toAddress, toPublicKey, toWeb3Instruction } from "@sati/sdk/web3-compat";
 * ```
 *
 * @packageDocumentation
 */

// Generated Codama client (instructions, accounts, types, errors)
// These are auto-generated from the program IDL
export * from "./generated";

// SDK schema definitions (DataType, Outcome, serialization utilities)
// Note: We selectively export to avoid collisions with generated types
export {
  // Enums (SDK definitions may differ from generated)
  DataType,
  Outcome,
  ContentType,
  ValidationType,
  // Offsets for memcmp filtering
  BASE_OFFSETS,
  COMPRESSED_OFFSETS,
  FEEDBACK_OFFSETS,
  VALIDATION_OFFSETS,
  REPUTATION_SCORE_OFFSETS,
  // Schema size limits and constants
  MAX_CONTENT_SIZE,
  MAX_TAG_LENGTH,
  SAS_HEADER_SIZE,
  // Data interfaces
  type FeedbackData,
  type ValidationData,
  type ReputationScoreData,
  type CompressedAttestation,
  // Serialization
  serializeFeedback,
  serializeValidation,
  serializeReputationScore,
  deserializeFeedback,
  deserializeValidation,
  deserializeReputationScore,
} from "./schemas";

// Domain-separated hash functions for attestations
export * from "./hashes";

// Compression / Light Protocol integration (uses compression-kit)
export type {
  SATILightClient,
  AttestationFilter,
  ParsedAttestation,
  ValidityProofResult,
  CreationProofResult,
  MutationProofResult,
  PackedAddressTreeInfo,
  PackedStateTreeInfo,
  PublicKeyLike,
  AccountMeta,
} from "./compression";

export { SATILightClientImpl, createSATILightClient } from "./compression";

// SAS integration helpers - NOT exported from main entry to avoid bundling sas-lib
// Use: import { ... } from "@cascade-fyi/sati-sdk/sas"
// export * from "./sas";

// SAS PDA derivation helpers (SATI-specific)
export {
  // SATI-specific PDA derivation (uses SATI program PDA as authority)
  deriveSatiPda,
  deriveSatiProgramCredentialPda,
  deriveReputationSchemaPda,
  deriveReputationAttestationPda,
  // Constants
  SAS_PROGRAM_ADDRESS,
  CREDENTIAL_SEED,
  SCHEMA_SEED,
  ATTESTATION_SEED,
  SATI_ATTESTATION_SEED,
  REPUTATION_SCHEMA_NAME,
  REPUTATION_SCHEMA_VERSION,
} from "./sas-pdas";

// Utility helpers and PDA derivation
export * from "./helpers";

// Ed25519 signature verification instruction builder
export * from "./ed25519";

// Off-chain message signing (SRFC-00003 format for Phantom/wallet signing)
export * from "./offchain-signing";

// Type definitions
export * from "./types";

// Deployed config loaders
export {
  loadDeployedConfig,
  hasDeployedConfig,
  getDeployedNetworks,
} from "./deployed";

// High-level client and related types
export {
  Sati,
  type AttestationResult,
  type BuiltTransaction,
  type SignatureInput,
  type CreateFeedbackParams,
  type BuildFeedbackParams,
  type CreateValidationParams,
  type CreateReputationScoreParams,
} from "./client";

// Registration file helpers (ERC-8004 + Phantom compatible)
export {
  // Functions
  buildRegistrationFile,
  fetchRegistrationFile,
  getImageUrl,
  inferMimeType,
  stringifyRegistrationFile,
  // SATI registration helpers
  buildSatiRegistrationEntry,
  hasSatiRegistration,
  getSatiAgentIds,
  // Constants
  SATI_CHAIN_ID,
  SATI_PROGRAM_ID,
  // Types
  type RegistrationFile,
  type RegistrationFileParams,
  type Endpoint,
  type RegistrationEntry,
  type Properties,
  type PropertyFile,
  type TrustMechanism,
} from "./registration";

// Re-export types for convenience
export type { Address } from "@solana/kit";
export { address } from "@solana/kit";
