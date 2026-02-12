/**
 * @cascade-fyi/sati-agent0-sdk
 *
 * Agent0-compatible adapter for SATI - Solana Agent Trust Infrastructure.
 *
 * Provides agent0-sdk compatible interfaces backed by SATI's Solana
 * infrastructure for agent identity, reputation, and attestation.
 *
 * @packageDocumentation
 */

// SATI adapter classes
export { SatiSDK } from "./sdk.js";
export { SatiAgent } from "./agent.js";

// Transaction handle (agent0-sdk TransactionHandle pattern for Solana)
export { SolanaTransactionHandle } from "./transaction-handle.js";
export type { SolanaReceipt, SolanaTransactionResult } from "./transaction-handle.js";

// Typed error classes
export {
  SatiError,
  AgentNotFoundError,
  ReadOnlyError,
  SignerRequiredError,
  SchemaNotDeployedError,
  InvalidAgentIdError,
  UnsupportedOperationError,
} from "./errors.js";

// SATI-specific config and types
export type {
  SatiSDKConfig,
  SatiSearchOptions,
  SatiFeedbackSearchOptions,
  SatiTransactionSender,
  SatiWarning,
  PreparedFeedback,
  WriteAccess,
  ValidationResult,
} from "./types.js";

// Adapters (SATI <-> agent0 converters)
export {
  SOLANA_CAIP2_CHAINS,
  formatSatiAgentId,
  parseSatiAgentId,
  toAgentSummary,
  toAgent0RegistrationFile,
  fromAgent0RegistrationFile,
  toAgent0Endpoints,
  fromAgent0Endpoints,
  toFeedback,
} from "./adapters.js";

// Re-export agent0-sdk types for convenience (consumers don't need to install agent0-sdk for types)
export type {
  AgentSummary,
  Feedback,
  FeedbackFileInput,
  FeedbackIdTuple,
  FeedbackSearchFilters,
  FeedbackSearchOptions,
  SearchFilters,
  SearchOptions,
  RegistrationFile,
  Endpoint,
  AgentId,
  Address,
  URI,
  Timestamp,
} from "agent0-sdk";

export { EndpointType, TrustModel, EndpointCrawler } from "agent0-sdk";

// Re-export Sati type for TypeScript consumers using sdk.sati
export type { Sati } from "@cascade-fyi/sati-sdk";

// Re-export SATI constants and helpers so dashboard frontend doesn't need direct sati-sdk dependency
export { MAX_SINGLE_SIGNATURE_CONTENT_SIZE, SATI_PROGRAM_ADDRESS } from "@cascade-fyi/sati-sdk";
export { parseFeedbackContent, ContentType, Outcome } from "@cascade-fyi/sati-sdk";
export { getImageUrl, buildRegistrationFile, stringifyRegistrationFile } from "@cascade-fyi/sati-sdk";
export { handleTransactionError } from "@cascade-fyi/sati-sdk";
export type { FeedbackContent, RegistrationFile as SatiRegistrationFile } from "@cascade-fyi/sati-sdk";
