/**
 * SATI SDK - Solana Agent Trust Infrastructure
 *
 * TypeScript SDK for interacting with SATI v2:
 * - Registry: Agent identity registration via Token-2022 NFT
 * - SAS Schemas: Reputation and validation attestation schemas
 * - Client: High-level SATI class for convenient interaction
 *
 * @solana/kit native - browser-compatible.
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
  // Universal offsets (all schemas share these)
  OFFSETS,
  // Offsets for memcmp filtering (backward compat aliases)
  BASE_OFFSETS,
  COMPRESSED_OFFSETS,
  FEEDBACK_OFFSETS,
  VALIDATION_OFFSETS,
  REPUTATION_SCORE_OFFSETS,
  // Schema size limits and constants
  MAX_CONTENT_SIZE,
  MIN_BASE_LAYOUT_SIZE,
  SAS_HEADER_SIZE,
  // Content size limits by signature mode (transaction size constraints)
  MAX_DUAL_SIGNATURE_CONTENT_SIZE,
  MAX_SINGLE_SIGNATURE_CONTENT_SIZE,
  // Data interfaces (all extend BaseLayout)
  type BaseLayout,
  type FeedbackData,
  type ValidationData,
  type ReputationScoreData,
  type CompressedAttestation,
  // Content type interfaces (for JSON content)
  type FeedbackContent,
  type ValidationContent,
  type ReputationScoreContent,
  // Content size validation (for transaction size limits)
  type ContentSizeValidationOptions,
  type ContentSizeValidationResult,
  // Serialization (universal layout)
  serializeFeedback,
  serializeValidation,
  serializeReputationScore,
  deserializeFeedback,
  deserializeValidation,
  deserializeReputationScore,
  serializeUniversalLayout,
  deserializeUniversalLayout,
  // Content parsers
  parseFeedbackContent,
  parseValidationContent,
  parseReputationScoreContent,
  // Helpers
  addressToBytes,
  bytesToAddress,
  getOutcomeLabel,
  outcomeToScore,
  getContentTypeLabel,
  createJsonContent,
  zeroDataHash,
  validateBaseLayout,
  // Content size helpers
  getMaxContentSize,
  validateContentSize,
} from "./schemas";

// Domain-separated hash functions for attestations
export * from "./hashes";

// Compression / Light Protocol integration (uses compression-kit)
export type {
  SATILightClient,
  AttestationFilter,
  PaginatedAttestations,
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

// Off-chain message signing (SIWS-style format with CAIP-10 identifiers)
export * from "./offchain-signing";

// Content encryption (X25519-XChaCha20-Poly1305)
export {
  // Constants
  ENCRYPTION_VERSION,
  NONCE_SIZE,
  PUBKEY_SIZE,
  TAG_SIZE,
  PRIVKEY_SIZE,
  MIN_ENCRYPTED_SIZE,
  MAX_PLAINTEXT_SIZE,
  // Types
  type EncryptedPayload,
  type EncryptionKeypair,
  // Key derivation
  deriveEncryptionKeypair,
  deriveEncryptionPublicKey,
  // Encryption / Decryption
  encryptContent,
  decryptContent,
  // Serialization
  serializeEncryptedPayload,
  deserializeEncryptedPayload,
} from "./encryption";

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
