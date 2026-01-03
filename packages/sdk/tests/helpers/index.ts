/**
 * SATI Test Helpers
 *
 * Centralized test utilities for unit, integration, and E2E tests.
 *
 * @example
 * ```typescript
 * import {
 *   createTestKeypair,
 *   createFeedbackSignatures,
 *   buildFeedbackData,
 *   buildEd25519Instructions,
 *   Outcome,
 *   ContentType,
 * } from "./helpers";
 * ```
 */

// Signature utilities (Ed25519 signing with @solana/kit Web Crypto)
export {
  signMessage,
  verifySignature,
  createTestKeypair,
  createFeedbackSignatures,
  verifyFeedbackSignatures,
  createValidationSignatures,
  createReputationSignature,
  randomBytes32,
  randomBytes,
  type SignatureData,
  type TestKeypair,
} from "./signatures";

// Account builders and constants (re-exported from SDK source)
export {
  // Layout constants
  MAX_NAME_LENGTH,
  MAX_SYMBOL_LENGTH,
  MAX_URI_LENGTH,
  MAX_TAG_LENGTH,
  MAX_CONTENT_SIZE,
  MIN_BASE_LAYOUT_SIZE,
  CURRENT_LAYOUT_VERSION,
  OFFSETS,
  // Enums
  Outcome,
  ContentType,
  ValidationType,
  SignatureMode,
  StorageType,
  DataType,
  // PDA derivation
  findRegistryConfigPda,
  findSchemaConfigPda,
  findAgentIndexPda,
  // Data builders
  buildFeedbackData,
  buildValidationData,
  buildReputationScoreData,
  // Validation
  isValidOutcome,
  isValidScore,
  isValidContentType,
  isValidValidationType,
  // Types
  type FeedbackDataParams,
  type ValidationDataParams,
  type ReputationScoreDataParams,
} from "./accounts";

// Instruction builders
export {
  buildEd25519Instruction,
  buildEd25519Instructions,
  buildFeedbackEd25519Instructions,
  addressToBytes,
  type Ed25519SignatureParams,
} from "./instructions";

// RPC and connection utilities
export {
  getRpc,
  isTestValidatorReady,
  newAccountWithLamports,
  getTestKeypair,
  sleep,
  waitForIndexer,
  retry,
  DEFAULT_CONFIG,
  type TestRpcConfig,
} from "./test-rpc";

// Address Lookup Table helpers
export {
  createSatiLookupTable,
  type CreateLookupTableResult,
} from "./lookup-table";

// Test Setup
export {
  setupE2ETest,
  setupSignatureTest,
  type E2ETestContext,
  type SignatureTestContext,
  type SetupOptions,
} from "./test-setup";
