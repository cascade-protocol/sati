/**
 * Light Protocol / Photon Type Definitions
 *
 * This file contains only type definitions without runtime imports from
 * @solana/web3.js, making it safe to import in browser environments.
 *
 * For runtime usage, import from "@cascade-fyi/sati-sdk/light".
 */

import type { Address } from "@solana/kit";
import type {
  CompressedAttestation,
  FeedbackData,
  ValidationData,
  DataType,
  Outcome,
} from "./schemas";

// ============================================================================
// Common Types
// ============================================================================

/**
 * PublicKey-like object (browser-compatible)
 * Represents @solana/web3.js PublicKey without importing it
 */
export interface PublicKeyLike {
  toBase58(): string;
  toBytes(): Uint8Array;
}

// ============================================================================
// Query Types
// ============================================================================

/**
 * Filter options for querying compressed attestations
 */
export interface AttestationFilter {
  /** Filter by SAS schema address */
  sasSchema?: Address;
  /** Filter by agent token account */
  tokenAccount?: Address;
  /** Filter by counterparty (feedback giver or validator) */
  counterparty?: Address;
  /** Filter by data type (Feedback=0, Validation=1) */
  dataType?: DataType;
  /** Filter by feedback outcome (Feedback only) */
  outcome?: Outcome;
  /** Filter by validation response score (Validation only) */
  responseMin?: number;
  responseMax?: number;
}

/**
 * Compressed account data (Light Protocol type alias)
 *
 * Uses unknown/any for flexible compatibility with Light Protocol's actual types.
 */
export interface CompressedAccountData {
  discriminator: number[];
  data: ArrayLike<number>;
  dataHash: unknown;
}

/**
 * Compressed account (Light Protocol type alias)
 *
 * This is a simplified version for browser type-checking.
 * The actual Light Protocol type has more fields, but we only use these.
 */
export interface CompressedAccount {
  hash: unknown;
  data: CompressedAccountData | null;
  treeInfo: {
    tree: unknown;
    queue: unknown;
  };
  // Allow additional properties from Light Protocol
  [key: string]: unknown;
}

/**
 * Parsed compressed attestation with decoded data
 */
export interface ParsedAttestation {
  /** Compressed account address */
  address: Uint8Array;
  /** Raw compressed account data */
  raw: CompressedAccount;
  /** Decoded attestation structure */
  attestation: CompressedAttestation;
  /** Decoded schema data (Feedback or Validation) */
  data: FeedbackData | ValidationData;
}

/**
 * Query result with pagination cursor
 */
export interface QueryResult<T> {
  items: T[];
  cursor?: string;
}

// ============================================================================
// Proof Types
// ============================================================================

/**
 * Validity proof result for compressed account operations
 */
export interface ValidityProofResult {
  /** Compressed validity proof (128 bytes) */
  compressedProof: {
    a: number[];
    b: number[];
    c: number[];
  };
  /** Root indices for proof verification */
  rootIndices: number[];
  /** Leaf indices for input accounts */
  leafIndices: number[];
}

/**
 * Packed tree info for instruction data
 */
export interface PackedAddressTreeInfo {
  rootIndex: number;
  addressMerkleTreePubkeyIndex: number;
  addressQueuePubkeyIndex: number;
}

/**
 * Packed state tree info for instruction data
 */
export interface PackedStateTreeInfo {
  merkleTreePubkeyIndex: number;
  queuePubkeyIndex: number;
  leafIndex: number;
  rootIndex: number;
}

/**
 * Account meta for remaining accounts (browser-compatible version)
 */
export interface AccountMeta {
  /** Account address (PublicKey-like object with toBase58()) */
  pubkey: PublicKeyLike;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * Creation proof result with all necessary data for creating compressed accounts
 */
export interface CreationProofResult {
  /** Validity proof */
  proof: ValidityProofResult;
  /** Packed address tree info for instruction data */
  addressTreeInfo: PackedAddressTreeInfo;
  /** Output state tree index */
  outputStateTreeIndex: number;
  /** Remaining accounts for the transaction */
  remainingAccounts: AccountMeta[];
}

/**
 * Update/Close proof result with all necessary data
 */
export interface MutationProofResult {
  /** Validity proof */
  proof: ValidityProofResult;
  /** Packed state tree info for the input account */
  stateTreeInfo: PackedStateTreeInfo;
  /** Output state tree index */
  outputStateTreeIndex: number;
  /** Remaining accounts for the transaction */
  remainingAccounts: AccountMeta[];
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * Rpc client type (opaque for browser compatibility)
 */
export type Rpc = unknown;

/**
 * LightClient interface for browser type checking.
 *
 * This interface is designed to be compatible with the actual LightClient
 * implementation while avoiding direct @solana/web3.js imports.
 */
export interface LightClient {
  getRpc(): Rpc;
  deriveAttestationAddress(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    addressTree: PublicKeyLike;
    addressQueue: PublicKeyLike;
  }>;
  getAttestation(address: Uint8Array): Promise<ParsedAttestation | null>;
  getAttestationByAddress(address: Address): Promise<ParsedAttestation | null>;
  getAttestations(addresses: Uint8Array[]): Promise<ParsedAttestation[]>;
  listFeedbacks(
    filter: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]>;
  listValidations(
    filter: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]>;
  listAttestations(
    tokenAccount: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]>;
  listBySchema(
    sasSchema: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]>;
  getCreationProof(address: PublicKeyLike): Promise<CreationProofResult>;
  getMutationProof(
    compressedAccount: CompressedAccount,
  ): Promise<MutationProofResult>;
  prepareCreate(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    proof: ValidityProofResult;
    addressTreeInfo: PackedAddressTreeInfo;
    outputStateTreeIndex: number;
    remainingAccounts: AccountMeta[];
  }>;
  /** Get all addresses to include in an Address Lookup Table */
  getLookupTableAddresses(): Promise<PublicKeyLike[]>;
}
