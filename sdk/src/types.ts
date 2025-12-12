/**
 * SATI Type Definitions
 *
 * Core types for agent identity, reputation, and validation.
 */

import type { Address } from "@solana/kit";

/**
 * Agent identity information retrieved from Token-2022 NFT
 */
export interface AgentIdentity {
  /** Agent NFT mint address */
  mint: Address;
  /** Current owner of the agent NFT */
  owner: Address;
  /** Agent name from metadata */
  name: string;
  /** Agent symbol from metadata */
  symbol: string;
  /** Registration file URI (IPFS/HTTP) */
  uri: string;
  /** Token group member number */
  memberNumber: bigint;
  /** Additional metadata key-value pairs */
  additionalMetadata: Record<string, string>;
  /** Whether the agent is non-transferable (soulbound) */
  nonTransferable: boolean;
}

/**
 * Feedback attestation data from SAS
 */
export interface Feedback {
  /** Feedback attestation address */
  attestation: Address;
  /** Agent mint receiving feedback */
  agentMint: Address;
  /** Feedback score (0-100) */
  score: number;
  /** Optional categorization tags */
  tag1?: string;
  tag2?: string;
  /** URI to off-chain feedback details */
  fileUri?: string;
  /** SHA-256 hash of feedback file */
  fileHash?: Uint8Array;
  /** x402 payment proof reference */
  paymentProof?: string;
  /** Feedback giver's address */
  issuer: Address;
  /** Unix timestamp of submission */
  timestamp: number;
  /** Whether attestation is revoked */
  revoked: boolean;
}

/**
 * Feedback authorization attestation data from SAS
 */
export interface FeedbackAuthorization {
  /** Authorization attestation address */
  attestation: Address;
  /** Agent mint that authorized feedback */
  agentMint: Address;
  /** Authorized client address */
  client: Address;
  /** Maximum feedback index allowed (ERC-8004 indexLimit) */
  indexLimit: number;
  /** Expiration timestamp (0 = no expiry) */
  expiry: number;
  /** Whether authorization is revoked */
  revoked: boolean;
}

/**
 * Validation request attestation data from SAS
 */
export interface ValidationRequest {
  /** Request attestation address */
  attestation: Address;
  /** Agent mint requesting validation */
  agentMint: Address;
  /** Validator address */
  validator: Address;
  /** Validation method ("tee", "zkml", "restake") */
  methodId: string;
  /** URI to validation request data */
  requestUri: string;
  /** SHA-256 hash of request content */
  requestHash?: Uint8Array;
  /** Request timestamp */
  timestamp: number;
}

/**
 * Validation status and response
 */
export interface ValidationStatus {
  /** Request attestation address */
  requestAttestation: Address;
  /** Response attestation address (if responded) */
  responseAttestation?: Address;
  /** Validation score (0-100, where 0=fail, 100=pass) */
  response?: number;
  /** URI to validation evidence */
  responseUri?: string;
  /** SHA-256 hash of response content */
  responseHash?: Uint8Array;
  /** Optional categorization tag */
  tag?: string;
  /** Validator address */
  validator: Address;
  /** Whether validation is complete */
  completed: boolean;
  /** Response timestamp */
  respondedAt?: number;
}

/**
 * Registration result from registerAgent
 */
export interface RegisterAgentResult {
  /** Agent NFT mint address */
  mint: Address;
  /** Token group member number */
  memberNumber: bigint;
  /** Transaction signature */
  signature: string;
}

/**
 * Attestation result from SAS operations
 */
export interface AttestationResult {
  /** Attestation account address */
  attestation: Address;
  /** Transaction signature */
  signature: string;
}

/**
 * SATI client configuration options
 */
export interface SATIClientOptions {
  /** Network to connect to */
  network: "mainnet" | "devnet" | "localnet";
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Custom WebSocket URL for subscriptions (overrides network default) */
  wsUrl?: string;
}
