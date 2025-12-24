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
  // Schema size limits
  MAX_CONTENT_SIZE,
  MAX_TAG_LENGTH,
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

// Light Protocol / Photon integration for compressed attestations
export {
  LightClient,
  createLightClient,
  getPhotonRpcUrl,
  type AttestationFilter,
  type ParsedAttestation,
  type QueryResult,
  type ValidityProofResult,
  type CreationProofResult,
  type MutationProofResult,
  type PackedAddressTreeInfo,
  type PackedStateTreeInfo,
  // Re-export Light Protocol types
  type CompressedAccountWithMerkleContext,
  type Rpc,
  createRpc,
  bn,
  getDefaultAddressTreeInfo,
  PackedAccounts,
  SystemAccountMetaConfig,
  deriveAddress,
  deriveAddressSeed,
  selectStateTreeInfo,
} from "./light";

// SAS integration helpers
export * from "./sas";

// Utility helpers and PDA derivation
export * from "./helpers";

// Type definitions
export * from "./types";

// Deployed config loaders
export {
  loadDeployedConfig,
  hasDeployedConfig,
  getDeployedNetworks,
} from "./deployed";

// High-level client
export { SATI } from "./client";

// Re-export types for convenience
export type { Address } from "@solana/kit";
export { address } from "@solana/kit";
