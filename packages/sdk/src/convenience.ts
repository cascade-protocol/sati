/**
 * Convenience types for high-level SATI SDK methods.
 *
 * These types power the simplified API on the `Sati` class -
 * giveFeedback, searchFeedback, searchAgents, etc.
 */

import type { Address, KeyPairSigner } from "@solana/kit";
import type { Outcome, ContentType } from "./schemas";
import type { AgentIdentity } from "./types";
import type { RegistrationFile } from "./registration";

// ============================================================================
// Feedback
// ============================================================================

/** Simplified parameters for giving feedback on an agent. */
export interface GiveFeedbackParams {
  /** Payer for transaction fees (also the counterparty/reviewer) */
  payer: KeyPairSigner;
  /** Agent mint address to review */
  agentMint: Address;
  /** ERC-8004 signed fixed-point value (e.g. 87 for score, -32 for -3.2% yield) */
  value?: number;
  /** Decimal places for value (0-18). E.g. valueDecimals=0 means integer, =2 means 2 decimal places. Default 0. */
  valueDecimals?: number;
  /** First tag dimension (e.g. "starred", "uptime", "successRate") */
  tag1?: string;
  /** Second tag dimension (optional sub-category) */
  tag2?: string;
  /** Human-readable feedback message */
  message?: string;
  /** Endpoint URI being reviewed */
  endpoint?: string;
  /** Explicit outcome (defaults to Neutral if not set) */
  outcome?: Outcome;
  /** Task reference (32-byte CAIP-220 tx hash or task ID) */
  taskRef?: Uint8Array;
}

/** Result from giveFeedback. */
export interface GiveFeedbackResult {
  /** Transaction signature */
  signature: string;
  /** Compressed account address of the attestation */
  attestationAddress: Address;
}

/** Prepared feedback for browser wallet signing (counterparty signs externally). */
export interface PreparedFeedbackData {
  /** SIWS message bytes for the counterparty to sign */
  messageBytes: Uint8Array;
  /** Agent mint address */
  agentMint: Address;
  /** Counterparty address (the reviewer) */
  counterparty: Address;
  /** Task reference (32 bytes) */
  taskRef: Uint8Array;
  /** Data hash (zeros for CounterpartySigned) */
  dataHash: Uint8Array;
  /** Feedback outcome */
  outcome: Outcome;
  /** Content type byte */
  contentType: ContentType;
  /** Serialized content bytes */
  content: Uint8Array;
  /** SAS schema address */
  sasSchema: Address;
  /** Address lookup table (if available) */
  lookupTable?: Address;
  /** Original input values for reconstructing display data */
  meta: { value?: number; valueDecimals?: number; tag1?: string; tag2?: string; message?: string; endpoint?: string };
}

// ============================================================================
// Search & Query
// ============================================================================

/** Options for searching feedback attestations. */
export interface FeedbackSearchOptions {
  /** Filter by agent mint */
  agentMint?: Address;
  /** Filter by counterparty (reviewer) */
  counterparty?: Address;
  /** Filter by tag1 */
  tag1?: string;
  /** Filter by tag2 */
  tag2?: string;
  /** Minimum value (inclusive) */
  minValue?: number;
  /** Maximum value (inclusive) */
  maxValue?: number;
  /** Include transaction hash in results (extra RPC call) */
  includeTxHash?: boolean;
}

/** Parsed feedback attestation. */
export interface ParsedFeedback {
  /** Compressed account address */
  compressedAddress: Address;
  /** Agent mint address */
  agentMint: Address;
  /** Counterparty (reviewer) address */
  counterparty: Address;
  /** Feedback outcome */
  outcome: Outcome;
  /** ERC-8004 signed fixed-point value */
  value?: number;
  /** Decimal places for value (0-18) */
  valueDecimals?: number;
  /** First tag dimension */
  tag1?: string;
  /** Second tag dimension */
  tag2?: string;
  /** Feedback message */
  message?: string;
  /** Endpoint reviewed */
  endpoint?: string;
  /** Approximate creation timestamp (Unix seconds) */
  createdAt: number;
  /** Transaction signature (only if includeTxHash was true) */
  txSignature?: string;
}

/** Reputation summary aggregated from feedback. */
export interface ReputationSummary {
  /** Number of feedback attestations with values */
  count: number;
  /** Average value across attestations (raw, not adjusted for valueDecimals) */
  averageValue: number;
}

// ============================================================================
// Agent Search
// ============================================================================

/** Options for searching registered agents. */
export interface AgentSearchOptions {
  /** Filter by agent name (substring match) */
  name?: string;
  /** Filter by owner address */
  owner?: Address;
  /** Filter by active status in registration file */
  active?: boolean;
  /** Filter by endpoint types (e.g., ["MCP", "A2A"]) */
  endpointTypes?: string[];
  /** Maximum results to return */
  limit?: number;
  /** Offset for pagination (member number) */
  offset?: bigint;
  /** Include feedback stats per agent */
  includeFeedbackStats?: boolean;
}

/** Agent search result with identity and optional metadata. */
export interface AgentSearchResult {
  /** On-chain agent identity */
  identity: AgentIdentity;
  /** Fetched registration file (null if fetch failed) */
  registrationFile: RegistrationFile | null;
  /** Feedback statistics (only if includeFeedbackStats was true) */
  feedbackStats?: ReputationSummary;
}

// ============================================================================
// Validation
// ============================================================================

/** Parsed validation attestation. */
export interface ParsedValidation {
  /** Compressed account address */
  compressedAddress: Address;
  /** Agent mint address */
  agentMint: Address;
  /** Counterparty (validator) address */
  counterparty: Address;
  /** Validation outcome */
  outcome: Outcome;
  /** Approximate creation timestamp (Unix seconds) */
  createdAt: number;
}
