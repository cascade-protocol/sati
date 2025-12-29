/**
 * Core types for Light Protocol stateless operations.
 *
 * Uses Solana Kit v5+ patterns:
 * - Address instead of PublicKey
 * - Native bigint instead of BN.js
 * - Branded types for type safety
 */

import type { Address } from "@solana/kit";

// =============================================================================
// Tree Types
// =============================================================================

/**
 * Tree type enum matching the on-chain representation.
 */
export enum TreeType {
  /** v1 state merkle tree */
  StateV1 = 1,
  /** v1 address merkle tree */
  AddressV1 = 2,
  /** v2 state merkle tree */
  StateV2 = 3,
  /** v2 address merkle tree */
  AddressV2 = 4,
}

/**
 * Tree info - metadata about a state or address tree.
 *
 * Used for:
 * - State trees: store compressed accounts
 * - Address trees: store PDAs
 */
export interface TreeInfo {
  /** Pubkey of the tree account */
  tree: Address;
  /** Pubkey of the queue account associated with the tree */
  queue: Address;
  /** The type of tree */
  treeType: TreeType;
  /** Optional compressed CPI context account */
  cpiContext?: Address;
  /** Next tree info if this tree is full/rolled over */
  nextTreeInfo: TreeInfo | null;
}

/**
 * @deprecated Use TreeInfo instead.
 */
export type StateTreeInfo = TreeInfo;

/**
 * @deprecated Use TreeInfo instead.
 */
export type AddressTreeInfo = Omit<TreeInfo, "cpiContext" | "nextTreeInfo"> & {
  nextTreeInfo: AddressTreeInfo | null;
};

// =============================================================================
// Merkle Context Types
// =============================================================================

/**
 * Packed merkle context for instruction data.
 */
export interface PackedMerkleContext {
  /** Merkle tree pubkey index in remaining accounts */
  merkleTreePubkeyIndex: number;
  /** Queue pubkey index in remaining accounts */
  queuePubkeyIndex: number;
  /** Leaf index in the tree */
  leafIndex: number;
  /** Whether to prove by index or validity proof */
  proveByIndex: boolean;
}

/**
 * Packed state tree info for compressed accounts.
 */
export interface PackedStateTreeInfo {
  /** Recent valid root index */
  rootIndex: number;
  /** Whether the account can be proven by index */
  proveByIndex: boolean;
  /** Index of the merkle tree in remaining accounts */
  merkleTreePubkeyIndex: number;
  /** Index of the queue in remaining accounts */
  queuePubkeyIndex: number;
  /** Index of the leaf in the state tree */
  leafIndex: number;
}

/**
 * Packed address tree info for new PDAs.
 */
export interface PackedAddressTreeInfo {
  /** Index of the address tree in remaining accounts */
  addressMerkleTreePubkeyIndex: number;
  /** Index of the address queue in remaining accounts */
  addressQueuePubkeyIndex: number;
  /** Recent valid root index */
  rootIndex: number;
}

// =============================================================================
// Compressed Account Types
// =============================================================================

/**
 * Data attached to a compressed account.
 */
export interface CompressedAccountData {
  /** 8-byte discriminator */
  discriminator: Uint8Array;
  /** Account data */
  data: Uint8Array;
  /** 32-byte hash of the data */
  dataHash: Uint8Array;
}

/**
 * Merkle context for a compressed account.
 */
export interface MerkleContext {
  /** Tree info */
  treeInfo: TreeInfo;
  /** Poseidon hash of the account (stored as leaf) */
  hash: bigint;
  /** Position in the state tree */
  leafIndex: number;
  /** Whether the account can be proven by index */
  proveByIndex: boolean;
}

/**
 * Merkle context with full merkle proof.
 */
export interface MerkleContextWithProof extends MerkleContext {
  /** Merkle proof path */
  merkleProof: bigint[];
  /** Root index the proof is valid for */
  rootIndex: number;
  /** Current root */
  root: bigint;
}

/**
 * Compressed account with merkle context.
 */
export interface CompressedAccount extends MerkleContext {
  /** Owner program or user */
  owner: Address;
  /** Lamports attached to the account */
  lamports: bigint;
  /** Optional persistent address */
  address: Uint8Array | null;
  /** Optional account data */
  data: CompressedAccountData | null;
  /** Whether this account is read-only in the transaction */
  readOnly: boolean;
}

/**
 * Compressed account meta for instruction data.
 */
export interface CompressedAccountMeta {
  /** Packed tree info */
  treeInfo: PackedStateTreeInfo;
  /** Address (32 bytes or null) */
  address: Uint8Array | null;
  /** Lamports or null */
  lamports: bigint | null;
  /** Output state tree index */
  outputStateTreeIndex: number;
}

// =============================================================================
// Proof Types
// =============================================================================

/**
 * Validity proof for compressed accounts.
 *
 * Proves existence of N compressed accounts or uniqueness of N PDAs.
 */
export interface ValidityProof {
  /** 32 bytes - G1 point x */
  a: Uint8Array;
  /** 64 bytes - G2 point */
  b: Uint8Array;
  /** 32 bytes - G1 point y */
  c: Uint8Array;
}

/**
 * Validity proof with context information.
 */
export interface ValidityProofWithContext {
  /** The proof (null if prove-by-index for all accounts) */
  compressedProof: ValidityProof | null;
  /** State roots */
  roots: bigint[];
  /** Root indices */
  rootIndices: number[];
  /** Leaf indices */
  leafIndices: number[];
  /** Leaf hashes */
  leaves: bigint[];
  /** Tree infos */
  treeInfos: TreeInfo[];
  /** Whether to prove by index for each account */
  proveByIndices: boolean[];
}

/**
 * Account proof input for validity proof request.
 */
export interface AccountProofInput {
  /** Account hash */
  hash: bigint;
  /** Tree info */
  treeInfo: TreeInfo;
  /** Leaf index */
  leafIndex: number;
  /** Root index */
  rootIndex: number;
  /** Whether to prove by index */
  proveByIndex: boolean;
}

/**
 * New address proof input for validity proof request.
 */
export interface NewAddressProofInput {
  /** Tree info */
  treeInfo: TreeInfo;
  /** Address bytes (32) */
  address: Uint8Array;
  /** Root index */
  rootIndex: number;
  /** Current root */
  root: bigint;
}

// =============================================================================
// Token Types
// =============================================================================

/**
 * Compressed token data.
 */
export interface TokenData {
  /** Token mint */
  mint: Address;
  /** Token owner */
  owner: Address;
  /** Token amount */
  amount: bigint;
  /** Delegate (if any) */
  delegate: Address | null;
  /** Account state (0=uninitialized, 1=initialized, 2=frozen) */
  state: number;
  /** Token extension TLV data */
  tlv: Uint8Array | null;
}

/**
 * Parsed token account combining compressed account and token data.
 */
export interface ParsedTokenAccount {
  /** Compressed account */
  compressedAccount: CompressedAccount;
  /** Parsed token data */
  parsed: TokenData;
}

// =============================================================================
// Instruction Types
// =============================================================================

/**
 * Compressed CPI context for multi-program transactions.
 */
export interface CompressedCpiContext {
  /** Whether to set the CPI context */
  setContext: boolean;
  /** Whether this is the first context set (wipes previous) */
  firstSetContext: boolean;
  /** Index of CPI context account in remaining accounts */
  cpiContextAccountIndex: number;
}

/**
 * New address parameters for creating PDAs.
 */
export interface NewAddressParams {
  /** Seed for address derivation */
  seed: Uint8Array;
  /** Root index for address tree */
  addressMerkleTreeRootIndex: number;
  /** Address tree pubkey */
  addressMerkleTreePubkey: Address;
  /** Address queue pubkey */
  addressQueuePubkey: Address;
}

/**
 * Packed new address parameters for instruction data.
 */
export interface NewAddressParamsPacked {
  /** Seed bytes */
  seed: Uint8Array;
  /** Address tree root index */
  addressMerkleTreeRootIndex: number;
  /** Index of address tree in remaining accounts */
  addressMerkleTreeAccountIndex: number;
  /** Index of address queue in remaining accounts */
  addressQueueAccountIndex: number;
}
