/**
 * SATI Type Definitions
 *
 * Core types for agent identity, reputation, and validation.
 */

import type { Address, KeyPairSigner } from "@solana/kit";

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
  /** Attestation expiry timestamp (0 = no expiry) */
  expiry: number;
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
  /** Response attestation expiry timestamp */
  responseExpiry?: number;
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
 * SATI client configuration options
 */
export interface SATIClientOptions {
  /** Network to connect to */
  network: "mainnet" | "devnet" | "localnet";
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Custom WebSocket URL for subscriptions (overrides network default) */
  wsUrl?: string;
  /** Photon RPC URL for Light Protocol queries (required for compressed attestations) */
  photonRpcUrl?: string;
}

// ============ SAS DEPLOYMENT TYPES ============

/**
 * SAS configuration with credential and schema addresses
 */
export interface SATISASConfig {
  /** SATI credential PDA */
  credential: Address;
  /** Schema PDAs by name */
  schemas: {
    /** Feedback schema (compressed, dual signature) */
    feedback: Address;
    /** Validation schema (compressed, dual signature) */
    validation: Address;
    /** ReputationScore schema (regular SAS, single signer) */
    reputationScore: Address;
  };
}

/**
 * Status of a single schema deployment
 */
export interface SchemaDeploymentStatus {
  /** Schema name (e.g., "SATIFeedback") */
  name: string;
  /** Schema PDA address */
  address: Address;
  /** Whether schema existed before this deployment */
  existed: boolean;
  /** Whether schema was deployed in this run */
  deployed: boolean;
}

/**
 * Result of SAS schema deployment operation
 */
export interface SASDeploymentResult {
  /** Whether deployment was successful */
  success: boolean;
  /** Credential deployment status */
  credential: {
    /** Credential PDA address */
    address: Address;
    /** Whether credential existed before this deployment */
    existed: boolean;
    /** Whether credential was deployed in this run */
    deployed: boolean;
  };
  /** Schema deployment statuses */
  schemas: SchemaDeploymentStatus[];
  /** Transaction signatures for any deployments */
  signatures: string[];
  /** Full SAS config (usable immediately) */
  config: SATISASConfig;
}

/**
 * Persisted deployment configuration (for JSON files)
 */
export interface DeployedSASConfig {
  /** Network identifier */
  network: "devnet" | "mainnet" | "localnet";
  /** Authority that deployed the schemas */
  authority: Address;
  /** Deployment timestamp (ISO string) */
  deployedAt: string;
  /** The SAS configuration */
  config: SATISASConfig;
}

// ============ CLOSE ATTESTATION TYPES ============

/**
 * Parameters for closing a compressed attestation (Light Protocol)
 */
export interface CloseCompressedAttestationParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** Counterparty who must authorize the close (original signer) */
  counterparty: KeyPairSigner;
  /** SAS schema address */
  sasSchema: Address;
  /** Attestation's compressed account address */
  attestationAddress: Address;
  /** Optional address lookup table for transaction compression */
  lookupTableAddress?: Address;
}

/**
 * Parameters for closing a regular SAS attestation (ReputationScore)
 */
export interface CloseRegularAttestationParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** Provider who created the score (must sign) */
  provider: KeyPairSigner;
  /** SAS schema address */
  sasSchema: Address;
  /** SATI credential address */
  satiCredential: Address;
  /** SAS attestation address */
  attestation: Address;
}

/**
 * Result of closing an attestation
 */
export interface CloseAttestationResult {
  /** Transaction signature */
  signature: string;
}
