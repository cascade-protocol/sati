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

// SATI-specific config
export type { SatiSDKConfig } from "./types.js";

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
