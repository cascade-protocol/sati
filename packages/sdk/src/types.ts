/**
 * SATI Type Definitions
 *
 * Core types for agent identity, reputation, and validation.
 */

import type { Address, KeyPairSigner } from "@solana/kit";
import type { ParsedAttestation } from "./light-types";

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
    /** FeedbackPublic schema (compressed, single signer - agent only) */
    feedbackPublic?: Address;
    /** Validation schema (compressed, dual signature) */
    validation: Address;
    /** ReputationScore schema (regular SAS, single signer) */
    reputationScore: Address;
  };
  /** Address Lookup Table for transaction compression (optional, created after schemas) */
  lookupTable?: Address;
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

// ============ SIGNATURE VERIFICATION TYPES ============

/**
 * Result of signature verification on an attestation
 */
export interface SignatureVerificationResult {
  /** Whether all signatures are valid */
  valid: boolean;
  /** Whether agent signature is valid */
  agentValid: boolean;
  /** Whether counterparty signature is valid (client/validator/provider) */
  counterpartyValid: boolean;
}

// ============ AGENT METADATA UPDATE TYPES ============

/**
 * Parameters for updating agent metadata
 */
export interface UpdateAgentMetadataParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** Current owner (must be update authority) */
  owner: KeyPairSigner;
  /** Agent NFT mint address */
  mint: Address;
  /** Updates to apply */
  updates: {
    /** New name (optional) */
    name?: string;
    /** New URI (optional) */
    uri?: string;
    /** Additional metadata entries to add/update */
    additionalMetadata?: Array<[string, string]>;
  };
}

/**
 * Result of updating agent metadata
 */
export interface UpdateAgentMetadataResult {
  /** Transaction signature */
  signature: string;
}

// ============ MERKLE PROOF TYPES ============

/**
 * Merkle proof with context from Light Protocol
 * Used for verifying compressed account inclusion in state tree
 */
export interface MerkleProofWithContext {
  /** Account hash (leaf in the Merkle tree) */
  hash: Uint8Array;
  /** Position in the tree */
  leafIndex: number;
  /** Sibling hashes (26 elements for depth-26 tree) */
  merkleProof: Uint8Array[];
  /** Current Merkle root */
  root: Uint8Array;
  /** Root sequence number */
  rootSeq: number;
  /** State tree account pubkey */
  merkleTree: Address;
}

/**
 * Result of getAttestationWithProof
 */
export interface AttestationWithProof {
  /** Parsed attestation data */
  attestation: ParsedAttestation;
  /** Merkle proof for verification */
  proof: MerkleProofWithContext;
}
