/**
 * Light Protocol / Photon Integration
 *
 * Provides query wrappers for compressed attestations stored via Light Protocol.
 * Uses Helius Photon RPC for indexing and validity proof generation.
 *
 * Based on ZK Compression Client Guide:
 * https://www.zkcompression.com/developers/typescript-client
 */

import {
  createRpc,
  type Rpc,
  bn,
  type CompressedAccountWithMerkleContext,
  deriveAddress,
  deriveAddressSeed,
  PackedAccounts,
  SystemAccountMetaConfig,
  selectStateTreeInfo,
  TreeType,
  defaultStaticAccounts,
  type ValidityProofWithContext,
  // V1 address tree constants (exported as strings)
  addressTree as ADDRESS_TREE_V1,
  addressQueue as ADDRESS_QUEUE_V1,
} from "@lightprotocol/stateless.js";
import type { Address } from "@solana/kit";
import { address, getAddressEncoder } from "@solana/kit";
import type { MerkleProofWithContext } from "./types";
import { PublicKey } from "@solana/web3.js";
import {
  DataType,
  COMPRESSED_OFFSETS,
  deserializeFeedback,
  deserializeValidation,
  type FeedbackData,
  type ValidationData,
  type CompressedAttestation,
  type Outcome,
} from "./schemas.js";
import { SATI_PROGRAM_ADDRESS } from "./generated/programs/sati.js";
import bs58 from "bs58";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get V1 address tree info for mainnet compatibility.
 *
 * Uses the exported V1 address tree constants instead of the deprecated
 * `defaultTestStateTreeAccounts()` function. V1 is required because V2
 * is not yet available on mainnet.
 *
 * @returns V1 address tree and queue as PublicKey objects
 */
function getV1AddressTreeInfo(): {
  addressTree: PublicKey;
  addressQueue: PublicKey;
} {
  return {
    addressTree: new PublicKey(ADDRESS_TREE_V1),
    addressQueue: new PublicKey(ADDRESS_QUEUE_V1),
  };
}

/**
 * Browser-compatible base58 encoding for Uint8Array
 * (Photon expects base58-encoded bytes in memcmp filters)
 */
function uint8ArrayToBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

// ============================================================================
// Types
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
 * Parsed compressed attestation with decoded data
 */
export interface ParsedAttestation {
  /** Compressed account address */
  address: Uint8Array;
  /** Raw compressed account data */
  raw: CompressedAccountWithMerkleContext;
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
  remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
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
  remainingAccounts: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }>;
}

// ============================================================================
// Light Protocol Client
// ============================================================================

/**
 * LightClient provides Photon RPC integration for compressed attestations.
 *
 * @example
 * ```typescript
 * const light = new LightClient("https://devnet.helius-rpc.com?api-key=YOUR_KEY");
 *
 * // Query feedbacks for an agent
 * const feedbacks = await light.listFeedbacks(tokenAccount, {
 *   outcome: Outcome.Positive,
 * });
 *
 * // Get creation proof for new attestation
 * const { proof, addressTreeInfo, outputStateTreeIndex, remainingAccounts } =
 *   await light.getCreationProof(address, programId);
 * ```
 */
export class LightClient {
  private rpc: Rpc;
  private programId: PublicKey;

  /**
   * Create a new LightClient
   *
   * @param rpcUrl - Photon RPC URL (Helius endpoint works as Photon)
   * @param programId - Optional custom program ID (defaults to SATI program)
   */
  constructor(rpcUrl?: string, programId?: PublicKey) {
    this.rpc = createRpc(rpcUrl);
    this.programId = programId ?? new PublicKey(SATI_PROGRAM_ADDRESS);
  }

  /**
   * Get the underlying Photon RPC client
   */
  getRpc(): Rpc {
    return this.rpc;
  }

  // ==========================================================================
  // Address Derivation
  // ==========================================================================

  /**
   * Derive a compressed account address for an attestation
   *
   * @param seeds - Seeds for address derivation (e.g., [taskRef, sasSchema, tokenAccount])
   * @returns Derived address and address tree info
   */
  async deriveAttestationAddress(seeds: Uint8Array[]): Promise<{
    address: PublicKey;
    addressTree: PublicKey;
    addressQueue: PublicKey;
  }> {
    // Use V1 address trees for mainnet compatibility
    const { addressTree, addressQueue } = getV1AddressTreeInfo();

    const seed = deriveAddressSeed(
      seeds.map((s) => new Uint8Array(s)),
      this.programId,
    );
    const address = deriveAddress(seed, addressTree);

    return { address, addressTree, addressQueue };
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get a compressed attestation by its address
   *
   * @param address - Compressed account address (32 bytes)
   * @returns Parsed attestation or null if not found
   */
  async getAttestation(address: Uint8Array): Promise<ParsedAttestation | null> {
    const account = await this.rpc.getCompressedAccount(bn(address));
    if (!account) return null;

    return this.parseCompressedAccount(account);
  }

  /**
   * Get a compressed attestation by its Address (kit Address type)
   *
   * Convenience wrapper around getAttestation that converts Address to Uint8Array.
   *
   * @param address - Compressed account address (kit Address type)
   * @returns Parsed attestation or null if not found
   */
  async getAttestationByAddress(
    address: Address,
  ): Promise<ParsedAttestation | null> {
    const addressBytes = addressToBytes(address);
    return this.getAttestation(addressBytes);
  }

  /**
   * Get multiple compressed attestations by addresses
   *
   * @param addresses - Array of compressed account addresses
   * @returns Array of parsed attestations (nulls filtered out)
   */
  async getAttestations(addresses: Uint8Array[]): Promise<ParsedAttestation[]> {
    const accounts = await this.rpc.getMultipleCompressedAccounts(
      addresses.map((a) => bn(a)),
    );

    const results: ParsedAttestation[] = [];
    for (const account of accounts) {
      if (account) {
        const parsed = this.parseCompressedAccount(account);
        if (parsed) results.push(parsed);
      }
    }
    return results;
  }

  /**
   * Get a compressed attestation with its Merkle proof
   *
   * Returns both the parsed attestation data and the Merkle proof needed
   * to verify the attestation's inclusion in the state tree.
   *
   * @param attestationAddress - Compressed account address (32 bytes)
   * @returns Attestation with proof, or null if not found
   */
  async getAttestationWithProof(attestationAddress: Uint8Array): Promise<{
    attestation: ParsedAttestation;
    proof: MerkleProofWithContext;
  } | null> {
    // Get the account first to get its hash
    const account = await this.rpc.getCompressedAccount(bn(attestationAddress));
    if (!account) return null;

    // Parse the attestation
    const attestation = this.parseCompressedAccount(account);
    if (!attestation) return null;

    // Get the Merkle proof using the account hash
    const proofResult = await this.rpc.getCompressedAccountProof(account.hash);

    // Convert to our MerkleProofWithContext type
    const proof: MerkleProofWithContext = {
      hash: new Uint8Array(proofResult.hash.toArray("be", 32)),
      leafIndex: proofResult.leafIndex,
      merkleProof: proofResult.merkleProof.map(
        (p) => new Uint8Array(p.toArray("be", 32)),
      ),
      root: new Uint8Array(proofResult.root.toArray("be", 32)),
      rootSeq: proofResult.rootIndex,
      merkleTree: address(proofResult.treeInfo.tree.toBase58()),
    };

    return { attestation, proof };
  }

  /**
   * Verify Merkle proof structure
   *
   * Validates that the proof has correct structure for Light Protocol state trees.
   * Note: Full cryptographic verification (Poseidon hashing) requires Light Protocol WASM.
   *
   * @param proof - Merkle proof from getAttestationWithProof
   * @param expectedRoot - Optional expected root to verify against
   * @returns True if proof structure is valid
   */
  verifyProof(
    proof: MerkleProofWithContext,
    expectedRoot?: Uint8Array,
  ): boolean {
    // Light Protocol uses depth-26 state trees
    const TREE_DEPTH = 26;
    const MAX_LEAVES = 2 ** TREE_DEPTH;

    // 1. Validate proof structure
    if (proof.merkleProof.length !== TREE_DEPTH) {
      return false;
    }

    // 2. Validate leaf index is within bounds
    if (proof.leafIndex < 0 || proof.leafIndex >= MAX_LEAVES) {
      return false;
    }

    // 3. Validate hash is non-zero (account exists)
    const isZero = proof.hash.every((b) => b === 0);
    if (isZero) {
      return false;
    }

    // 4. If expectedRoot provided, check it matches
    if (expectedRoot) {
      if (expectedRoot.length !== proof.root.length) {
        return false;
      }
      for (let i = 0; i < expectedRoot.length; i++) {
        if (expectedRoot[i] !== proof.root[i]) {
          return false;
        }
      }
    }

    // 5. Verify proof siblings are all 32 bytes
    for (const sibling of proof.merkleProof) {
      if (sibling.length !== 32) {
        return false;
      }
    }

    // Note: Full cryptographic verification would require Poseidon hashing
    // to compute: hash(sibling, current) up the tree and compare to root.
    // This requires @lightprotocol/stateless.js WASM module.
    // For now, we validate structure only.

    return true;
  }

  /**
   * List Feedback attestations
   *
   * @param filter - Query filters (tokenAccount, sasSchema, counterparty, outcome)
   * @returns Array of parsed Feedback attestations
   *
   * @example
   * // All feedbacks for an agent
   * listFeedbacks({ tokenAccount })
   *
   * // All feedbacks globally (by schema)
   * listFeedbacks({ sasSchema })
   *
   * // Feedbacks given by a specific counterparty
   * listFeedbacks({ sasSchema, counterparty })
   */
  async listFeedbacks(
    filter: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    let accounts: ParsedAttestation[];

    if (filter.tokenAccount) {
      // Query by token account
      accounts = await this.queryByOwnerWithFilters(filter.tokenAccount, {
        ...filter,
        dataType: DataType.Feedback,
      });
    } else if (filter.sasSchema) {
      // Query all by schema
      accounts = await this.queryProgramAccounts({
        ...filter,
        dataType: DataType.Feedback,
      });
    } else {
      throw new Error(
        "Either tokenAccount or sasSchema must be provided in filter",
      );
    }

    // Filter by dataType
    let results = accounts.filter(
      (a) => a.attestation.dataType === DataType.Feedback,
    );

    // Apply counterparty filter client-side if specified
    if (filter.counterparty) {
      const counterpartyBytes = addressToBytes(filter.counterparty);
      results = results.filter((attestation) => {
        const data = attestation.data as FeedbackData;
        const feedbackCounterpartyBytes = addressToBytes(data.counterparty);
        return arraysEqual(counterpartyBytes, feedbackCounterpartyBytes);
      });
    }

    return results;
  }

  /**
   * List Validation attestations
   *
   * @param filter - Query filters (tokenAccount, sasSchema, counterparty, responseMin, responseMax)
   * @returns Array of parsed Validation attestations
   *
   * @example
   * // All validations for an agent
   * listValidations({ tokenAccount })
   *
   * // All validations globally (by schema)
   * listValidations({ sasSchema })
   */
  async listValidations(
    filter: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    let accounts: ParsedAttestation[];

    if (filter.tokenAccount) {
      // Query by token account
      accounts = await this.queryByOwnerWithFilters(filter.tokenAccount, {
        ...filter,
        dataType: DataType.Validation,
      });
    } else if (filter.sasSchema) {
      // Query all by schema
      accounts = await this.queryProgramAccounts({
        ...filter,
        dataType: DataType.Validation,
      });
    } else {
      throw new Error(
        "Either tokenAccount or sasSchema must be provided in filter",
      );
    }

    // Filter by dataType
    let results = accounts.filter(
      (a) => a.attestation.dataType === DataType.Validation,
    );

    // Apply counterparty filter client-side if specified
    if (filter.counterparty) {
      const counterpartyBytes = addressToBytes(filter.counterparty);
      results = results.filter((attestation) => {
        const data = attestation.data as ValidationData;
        const validationCounterpartyBytes = addressToBytes(data.counterparty);
        return arraysEqual(counterpartyBytes, validationCounterpartyBytes);
      });
    }

    return results;
  }

  /**
   * List all compressed attestations for an agent (Feedback + Validation)
   *
   * @param tokenAccount - Agent's token account address
   * @param filter - Optional filters
   * @returns Array of parsed attestations
   */
  async listAttestations(
    tokenAccount: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    return this.queryByOwnerWithFilters(tokenAccount, {
      ...filter,
      tokenAccount, // Filter by tokenAccount at offset 40
    });
  }

  /**
   * List attestations by SAS schema
   *
   * @param sasSchema - SAS schema address
   * @param filter - Optional filters
   * @returns Array of parsed attestations
   */
  async listBySchema(
    sasSchema: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    // Query all accounts owned by the SATI program and filter by schema
    const accounts = await this.queryProgramAccounts({
      ...filter,
      sasSchema,
    });
    return accounts;
  }

  // ==========================================================================
  // Validity Proof Methods (for Create/Update/Close operations)
  // ==========================================================================

  /**
   * Get validity proof and packed accounts for creating a new compressed attestation
   *
   * This proves that the new address does NOT exist in the address tree.
   *
   * @param address - The derived address for the new account
   * @returns Proof, packed tree info, and remaining accounts for the transaction
   */
  async getCreationProof(address: PublicKey): Promise<CreationProofResult> {
    // Use V1 address trees for mainnet compatibility
    const { addressTree, addressQueue } = getV1AddressTreeInfo();

    // Get validity proof for new address (proves it doesn't exist)
    const proofResult = await this.rpc.getValidityProofV0(
      [], // No input hashes for creation
      [
        {
          address: bn(address.toBytes()),
          tree: addressTree,
          queue: addressQueue,
        },
      ],
    );

    if (!proofResult.compressedProof) {
      throw new Error(
        "Failed to get validity proof: no compressed proof returned",
      );
    }

    // Build packed accounts
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    // Pack address tree accounts
    const addressMerkleTreePubkeyIndex =
      packedAccounts.insertOrGet(addressTree);
    const addressQueuePubkeyIndex = packedAccounts.insertOrGet(addressQueue);

    // Get output state tree (explicitly use V1 to avoid BatchedStateTree discriminator mismatch)
    const stateTreeInfos = await this.rpc.getStateTreeInfos();
    const outputStateTree = selectStateTreeInfo(
      stateTreeInfos,
      TreeType.StateV1,
    ).tree;
    const outputStateTreeIndex = packedAccounts.insertOrGet(outputStateTree);

    const { remainingAccounts } = packedAccounts.toAccountMetas();

    return {
      proof: {
        compressedProof: proofResult.compressedProof,
        rootIndices: proofResult.rootIndices,
        leafIndices: proofResult.leafIndices,
      },
      addressTreeInfo: {
        rootIndex: proofResult.rootIndices[0],
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
      },
      outputStateTreeIndex,
      remainingAccounts,
    };
  }

  /**
   * Get validity proof and packed accounts for updating/closing a compressed account
   *
   * This proves that the account hash EXISTS in the state tree.
   *
   * @param compressedAccount - The existing compressed account
   * @returns Proof, packed tree info, and remaining accounts for the transaction
   */
  async getMutationProof(
    compressedAccount: CompressedAccountWithMerkleContext,
  ): Promise<MutationProofResult> {
    const treeInfo = compressedAccount.treeInfo;

    // Get validity proof for existing account (proves it exists)
    const proofResult = await this.rpc.getValidityProofV0(
      [
        {
          hash: compressedAccount.hash,
          tree: treeInfo.tree,
          queue: treeInfo.queue,
        },
      ],
      [], // No new addresses for update/close
    );

    if (!proofResult.compressedProof) {
      throw new Error(
        "Failed to get validity proof: no compressed proof returned",
      );
    }

    // Build packed accounts
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    // Pack state tree accounts
    const merkleTreePubkeyIndex = packedAccounts.insertOrGet(treeInfo.tree);
    const queuePubkeyIndex = packedAccounts.insertOrGet(treeInfo.queue);

    // Use same tree for output (recommended for updates)
    const outputStateTreeIndex = packedAccounts.insertOrGet(treeInfo.tree);

    const { remainingAccounts } = packedAccounts.toAccountMetas();

    return {
      proof: {
        compressedProof: proofResult.compressedProof,
        rootIndices: proofResult.rootIndices,
        leafIndices: proofResult.leafIndices,
      },
      stateTreeInfo: {
        merkleTreePubkeyIndex,
        queuePubkeyIndex,
        leafIndex: proofResult.leafIndices[0],
        rootIndex: proofResult.rootIndices[0],
      },
      outputStateTreeIndex,
      remainingAccounts,
    };
  }

  /**
   * Get combined proof for create + update in one transaction
   *
   * @param newAddress - New address to create
   * @param existingAccount - Existing account to update
   * @returns Combined proof with both address and state tree info
   */
  async getCombinedProof(
    newAddress: PublicKey,
    existingAccount: CompressedAccountWithMerkleContext,
  ): Promise<{
    proof: ValidityProofResult;
    addressTreeInfo: PackedAddressTreeInfo;
    stateTreeInfo: PackedStateTreeInfo;
    outputStateTreeIndex: number;
    remainingAccounts: Array<{
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }>;
  }> {
    // Use V1 address trees for mainnet compatibility
    const { addressTree, addressQueue } = getV1AddressTreeInfo();
    const treeInfo = existingAccount.treeInfo;

    // Get combined proof (proves new address doesn't exist AND existing account exists)
    const proofResult = await this.rpc.getValidityProofV0(
      [
        {
          hash: existingAccount.hash,
          tree: treeInfo.tree,
          queue: treeInfo.queue,
        },
      ],
      [
        {
          address: bn(newAddress.toBytes()),
          tree: addressTree,
          queue: addressQueue,
        },
      ],
    );

    if (!proofResult.compressedProof) {
      throw new Error(
        "Failed to get validity proof: no compressed proof returned",
      );
    }

    // Build packed accounts
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    // Pack address tree accounts
    const addressMerkleTreePubkeyIndex =
      packedAccounts.insertOrGet(addressTree);
    const addressQueuePubkeyIndex = packedAccounts.insertOrGet(addressQueue);

    // Pack state tree accounts
    const merkleTreePubkeyIndex = packedAccounts.insertOrGet(treeInfo.tree);
    const queuePubkeyIndex = packedAccounts.insertOrGet(treeInfo.queue);

    // Use existing account's tree for output
    const outputStateTreeIndex = packedAccounts.insertOrGet(treeInfo.tree);

    const { remainingAccounts } = packedAccounts.toAccountMetas();

    return {
      proof: {
        compressedProof: proofResult.compressedProof,
        rootIndices: proofResult.rootIndices,
        leafIndices: proofResult.leafIndices,
      },
      addressTreeInfo: {
        rootIndex: proofResult.rootIndices[1], // Address root is second
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
      },
      stateTreeInfo: {
        merkleTreePubkeyIndex,
        queuePubkeyIndex,
        leafIndex: proofResult.leafIndices[0],
        rootIndex: proofResult.rootIndices[0],
      },
      outputStateTreeIndex,
      remainingAccounts,
    };
  }

  // ==========================================================================
  // Tree Info Methods
  // ==========================================================================

  /**
   * Get default address tree info for new account creation.
   * Uses V1 address trees for mainnet compatibility.
   */
  getDefaultAddressTreeInfo(): {
    addressTree: PublicKey;
    addressQueue: PublicKey;
  } {
    return getV1AddressTreeInfo();
  }

  /**
   * Get a random state tree for output accounts
   */
  async getOutputStateTree(): Promise<PublicKey> {
    const stateTreeInfos = await this.rpc.getStateTreeInfos();
    return selectStateTreeInfo(stateTreeInfos, TreeType.StateV1).tree;
  }

  /**
   * Get an output state tree index using a temporary PackedAccounts.
   * This is useful when you need just the index without a full creation proof.
   *
   * @returns Output state tree index
   */
  async getOutputStateTreeIndex(): Promise<number> {
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    const stateTreeInfos = await this.rpc.getStateTreeInfos();
    const outputStateTree = selectStateTreeInfo(
      stateTreeInfos,
      TreeType.StateV1,
    ).tree;
    return packedAccounts.insertOrGet(outputStateTree);
  }

  /**
   * Get address tree info for creating new compressed accounts.
   * Returns packed indices suitable for instruction data.
   *
   * For new address creation (proof = None), we use the default address tree
   * and a zero root index. The program verifies address non-existence during
   * the create instruction.
   *
   * @returns Packed address tree info with indices
   */
  async getAddressTreeInfo(): Promise<PackedAddressTreeInfo> {
    // Use V1 address trees for mainnet compatibility
    const { addressTree, addressQueue } = getV1AddressTreeInfo();

    // Build packed accounts to get indices
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    const addressMerkleTreePubkeyIndex =
      packedAccounts.insertOrGet(addressTree);
    const addressQueuePubkeyIndex = packedAccounts.insertOrGet(addressQueue);

    // For new address creation with proof = None, use default root index 0.
    // The Light Protocol program handles address verification internally.
    return {
      addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex,
      rootIndex: 0,
    };
  }

  /**
   * Prepare everything needed to create a new compressed account.
   *
   * This method:
   * 1. Derives the compressed account address from seeds
   * 2. Gets a validity proof proving the address doesn't exist
   * 3. Packs all required accounts (system + tree accounts)
   * 4. Returns everything needed for the create instruction
   *
   * @param seeds - Seeds for address derivation
   * @returns Creation parameters with proof, indices, and remaining accounts
   */
  async prepareCreate(seeds: Uint8Array[]): Promise<{
    address: PublicKey;
    proof: ValidityProofWithContext;
    addressTreeInfo: PackedAddressTreeInfo;
    outputStateTreeIndex: number;
    remainingAccounts: Array<{
      pubkey: PublicKey;
      isSigner: boolean;
      isWritable: boolean;
    }>;
  }> {
    // 1. Derive the address using V1 address trees for legacy derivation compatibility
    const { addressTree, addressQueue } = getV1AddressTreeInfo();

    const seed = deriveAddressSeed(
      seeds.map((s) => new Uint8Array(s)),
      this.programId,
    );
    const address = deriveAddress(seed, addressTree);

    // 2. Get validity proof proving address doesn't exist
    const proofResult = await this.rpc.getValidityProofV0(
      [], // No existing hashes to prove
      [
        {
          address: bn(address.toBytes()),
          tree: addressTree,
          queue: addressQueue,
        },
      ],
    );

    // 3. Pack accounts
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    // Address tree indices
    const addressMerkleTreePubkeyIndex =
      packedAccounts.insertOrGet(addressTree);
    const addressQueuePubkeyIndex = packedAccounts.insertOrGet(addressQueue);

    // Output state tree (explicitly use V1 to avoid BatchedStateTree discriminator mismatch)
    const stateTreeInfos = await this.rpc.getStateTreeInfos();
    const outputStateTree = selectStateTreeInfo(
      stateTreeInfos,
      TreeType.StateV1,
    ).tree;
    const outputStateTreeIndex = packedAccounts.insertOrGet(outputStateTree);

    // 4. Get remaining accounts with proper offset
    const { remainingAccounts } = packedAccounts.toAccountMetas();

    // NOTE: insertOrGet returns indices relative to the packed/tree accounts slice.
    // The program's CpiAccounts.tree_accounts() slices past system accounts,
    // so these indices are used directly without adding packedStart.
    return {
      address,
      proof: proofResult,
      addressTreeInfo: {
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
        rootIndex: proofResult.rootIndices[0] ?? 0,
      },
      outputStateTreeIndex,
      remainingAccounts,
    };
  }

  // ==========================================================================
  // Address Lookup Table Support
  // ==========================================================================

  /**
   * Get all pubkeys that should be included in an Address Lookup Table
   * for efficient transaction size.
   *
   * Light Protocol transactions include many system accounts that are
   * constant across all operations. Using a lookup table reduces each
   * 32-byte pubkey reference to a 1-byte index, saving ~31 bytes per account.
   *
   * @returns Array of PublicKeys to include in the lookup table
   */
  async getLookupTableAddresses(): Promise<PublicKey[]> {
    const addresses: PublicKey[] = [];

    // 1. Light System Program (the main entry point)
    addresses.push(
      new PublicKey("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7"),
    );

    // 2. Light Protocol static accounts (registered PDA, noop, compression, CPI authority)
    const staticAccounts = defaultStaticAccounts();
    addresses.push(...staticAccounts);

    // 3. SATI program
    addresses.push(this.programId);

    // 4. CPI signer PDA (derived from SATI program with seed 'cpi_authority')
    const [cpiSigner] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("cpi_authority")],
      this.programId,
    );
    addresses.push(cpiSigner);

    // 5. Address tree accounts (V1 for mainnet compatibility)
    const { addressTree, addressQueue } = getV1AddressTreeInfo();
    addresses.push(addressTree, addressQueue);

    // 6. State tree accounts (fetch current active V1 trees)
    const stateTreeInfos = await this.rpc.getStateTreeInfos();
    const stateTree = selectStateTreeInfo(stateTreeInfos, TreeType.StateV1);
    addresses.push(stateTree.tree, stateTree.queue);

    // 7. Ed25519 program for signature verification
    addresses.push(
      new PublicKey("Ed25519SigVerify111111111111111111111111111"),
    );

    // 8. System program
    addresses.push(new PublicKey("11111111111111111111111111111111"));

    // 9. Instructions sysvar (required for Ed25519 signature introspection)
    addresses.push(
      new PublicKey("Sysvar1nstructions1111111111111111111111111"),
    );

    // 10. Event authority PDA (Anchor __event_authority seed)
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("__event_authority")],
      this.programId,
    );
    addresses.push(eventAuthority);

    // 11. Compute Budget program (used for setting compute units)
    addresses.push(
      new PublicKey("ComputeBudget111111111111111111111111111111"),
    );

    // Remove duplicates
    const seen = new Set<string>();
    return addresses.filter((addr) => {
      const key = addr.toBase58();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  /**
   * Query compressed accounts by owner with memcmp filters
   */
  private async queryByOwnerWithFilters(
    _owner: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    // Build memcmp filters (tokenAccount should be passed in filter)
    const filters = this.buildMemcmpFilters(filter);

    // Query accounts owned by the program
    const response = await this.rpc.getCompressedAccountsByOwner(
      this.programId,
      {
        filters,
      },
    );

    // Parse results
    const results: ParsedAttestation[] = [];
    for (const account of response.items) {
      const parsed = this.parseCompressedAccount(account);
      if (parsed) {
        results.push(parsed);
      }
    }

    return results;
  }

  /**
   * Query all program accounts with filters
   */
  private async queryProgramAccounts(
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    const filters = this.buildMemcmpFilters(filter);

    const response = await this.rpc.getCompressedAccountsByOwner(
      this.programId,
      {
        filters,
      },
    );

    const results: ParsedAttestation[] = [];
    for (const account of response.items) {
      const parsed = this.parseCompressedAccount(account);
      if (parsed) results.push(parsed);
    }

    return results;
  }

  /**
   * Build memcmp filters for Photon queries
   */
  private buildMemcmpFilters(filter?: Partial<AttestationFilter>): Array<{
    memcmp: { offset: number; bytes: string };
  }> {
    const filters: Array<{ memcmp: { offset: number; bytes: string } }> = [];

    if (!filter) return filters;

    // SAS schema filter at offset 0
    if (filter.sasSchema) {
      filters.push({
        memcmp: {
          offset: COMPRESSED_OFFSETS.SAS_SCHEMA,
          bytes: uint8ArrayToBase58(addressToBytes(filter.sasSchema)),
        },
      });
    }

    // Token account filter at offset 32
    if (filter.tokenAccount) {
      filters.push({
        memcmp: {
          offset: COMPRESSED_OFFSETS.TOKEN_ACCOUNT,
          bytes: uint8ArrayToBase58(addressToBytes(filter.tokenAccount)),
        },
      });
    }

    // Data type filter at offset 64
    if (filter.dataType !== undefined) {
      filters.push({
        memcmp: {
          offset: COMPRESSED_OFFSETS.DATA_TYPE,
          bytes: uint8ArrayToBase58(new Uint8Array([filter.dataType])),
        },
      });
    }

    return filters;
  }

  /**
   * Parse a compressed account into typed attestation
   */
  private parseCompressedAccount(
    account: CompressedAccountWithMerkleContext,
  ): ParsedAttestation | null {
    try {
      const data = account.data;
      // Minimum: 32 (sasSchema) + 32 (tokenAccount) + 1 (dataType) = 65 bytes
      if (!data || data.data.length < 65) return null;

      const bytes = new Uint8Array(data.data);

      // Parse CompressedAttestation structure
      // Note: Light Protocol returns discriminator separately, data starts at 0
      let offset = 0;

      const sasSchema = bytes.slice(offset, offset + 32);
      offset += 32;

      const tokenAccount = bytes.slice(offset, offset + 32);
      offset += 32;

      const dataType = bytes[offset++] as DataType;

      // Parse Vec<u8> data field (4-byte length prefix + data)
      const dataLen = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
      ).getUint32(0, true);
      offset += 4;
      const schemaData = bytes.slice(offset, offset + dataLen);
      offset += dataLen;

      // Parse signatures count and data
      const numSignatures = bytes[offset++];
      const signature1 = bytes.slice(offset, offset + 64);
      offset += 64;
      // Only read signature2 if numSignatures >= 2, otherwise zero-fill (SingleSigner)
      const signature2 =
        numSignatures >= 2
          ? bytes.slice(offset, offset + 64)
          : new Uint8Array(64);

      const attestation: CompressedAttestation = {
        sasSchema,
        tokenAccount,
        dataType,
        data: schemaData,
        numSignatures,
        signature1,
        signature2,
      };

      // Decode schema-specific data
      let parsedData: FeedbackData | ValidationData;
      if (dataType === DataType.Feedback) {
        parsedData = deserializeFeedback(schemaData);
      } else if (dataType === DataType.Validation) {
        parsedData = deserializeValidation(schemaData);
      } else {
        return null; // ReputationScore uses regular storage
      }

      return {
        address: account.hash
          ? new Uint8Array(account.hash.toArray())
          : new Uint8Array(32),
        raw: account,
        attestation,
        data: parsedData,
      };
    } catch (e) {
      console.error("Failed to parse compressed account:", e);
      return null;
    }
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert Address to 32-byte Uint8Array
 */
function addressToBytes(address: Address): Uint8Array {
  const encoder = getAddressEncoder();
  return new Uint8Array(encoder.encode(address));
}

/**
 * Compare two byte arrays for equality
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Create a default Light Protocol client
 *
 * @param rpcUrl - Optional Photon RPC URL (Helius endpoints work as Photon)
 * @param programId - Optional custom program ID
 * @returns LightClient instance
 */
export function createLightClient(
  rpcUrl?: string,
  programId?: PublicKey,
): LightClient {
  return new LightClient(rpcUrl, programId);
}

/**
 * Get the default Photon RPC URL for a network
 *
 * Note: Helius endpoints work as Photon endpoints!
 *
 * @param network - "mainnet" | "devnet" | "localnet"
 * @param apiKey - Helius API key (required for mainnet/devnet)
 * @returns Photon RPC URL
 */
export function getPhotonRpcUrl(
  network: "mainnet" | "devnet" | "localnet",
  apiKey?: string,
): string {
  switch (network) {
    case "mainnet":
      if (!apiKey) throw new Error("API key required for mainnet");
      return `https://mainnet.helius-rpc.com?api-key=${apiKey}`;
    case "devnet":
      if (!apiKey) throw new Error("API key required for devnet");
      return `https://devnet.helius-rpc.com?api-key=${apiKey}`;
    case "localnet":
      return "http://127.0.0.1:8899";
    default:
      throw new Error(`Unknown network: ${network}`);
  }
}

// ============================================================================
// Re-exports from Light Protocol
// ============================================================================

export {
  createRpc,
  bn,
  deriveAddress,
  deriveAddressSeed,
  PackedAccounts,
  SystemAccountMetaConfig,
  selectStateTreeInfo,
  TreeType,
  type Rpc,
  type CompressedAccountWithMerkleContext,
};

// Export V1 address tree constants for direct access
export { ADDRESS_TREE_V1, ADDRESS_QUEUE_V1 };
