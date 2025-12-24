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

// Light Protocol / Photon types only (runtime values available via @cascade-fyi/sati-sdk/light)
// This avoids bundling Node.js dependencies in browser environments
export type {
  LightClient,
  AttestationFilter,
  ParsedAttestation,
  QueryResult,
  ValidityProofResult,
  CreationProofResult,
  MutationProofResult,
  PackedAddressTreeInfo,
  PackedStateTreeInfo,
  CompressedAccountWithMerkleContext,
  Rpc,
} from "./light";

// SAS integration helpers
export * from "./sas";

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
  SATI,
  type AttestationResult,
  type SignatureInput,
  type CreateFeedbackParams,
  type CreateValidationParams,
  type CreateReputationScoreParams,
} from "./client";

// Re-export types for convenience
export type { Address } from "@solana/kit";
export { address } from "@solana/kit";
