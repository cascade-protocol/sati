/**
 * SATI Light Client
 *
 * SATI-specific Light Protocol client that uses compression-kit as the underlying
 * RPC layer. This provides SATI-specific query and proof methods for compressed
 * attestations.
 *
 * ## Identity Model
 * - `tokenAccount` = agent's **MINT ADDRESS** (stable identity)
 * - Named for SAS wire format compatibility (NOT an Associated Token Account)
 */

import {
  address,
  type Address,
  getAddressEncoder,
  getAddressDecoder,
  getProgramDerivedAddress,
  getUtf8Encoder,
} from "@solana/kit";
import {
  createPhotonRpc,
  type PhotonRpc,
  type CompressedAccount,
  type ValidityProofWithContext,
  type TreeInfo,
  deriveAddress,
  deriveAddressSeed,
  PackedAccounts,
  createSystemAccountConfig,
  LIGHT_SYSTEM_PROGRAM,
  ACCOUNT_COMPRESSION_PROGRAM,
  NOOP_PROGRAM,
  REGISTERED_PROGRAM_PDA,
  ADDRESS_TREE,
  ADDRESS_QUEUE,
  MERKLE_TREE_PUBKEY,
  NULLIFIER_QUEUE_PUBKEY,
  createBN254,
} from "@cascade-fyi/compression-kit";

import { SATI_PROGRAM_ADDRESS } from "./generated/programs/sati.js";
import type { CompressedAttestation, FeedbackData, ValidationData, DataType, Outcome } from "./schemas";
import { deserializeFeedback, deserializeValidation } from "./schemas";

// Offsets for parsing compressed attestation data (Borsh serialization)
// Note: The `data` field is a Vec<u8> which has a 4-byte length prefix
const BORSH_OFFSETS = {
  SAS_SCHEMA: 0,
  TOKEN_ACCOUNT: 32,
  DATA_TYPE: 64,
  DATA_LEN: 65, // 4-byte u32 LE length prefix for Vec<u8>
  DATA_START: 69, // Actual data bytes start after length prefix
} as const;

// =============================================================================
// Types
// =============================================================================

/**
 * PublicKey-like object (browser-compatible)
 */
export interface PublicKeyLike {
  toBase58(): string;
  toBytes(): Uint8Array;
}

/**
 * Filter options for querying compressed attestations.
 * Note: tokenAccount refers to the agent's mint address (named for SAS wire format compatibility).
 */
export interface AttestationFilter {
  sasSchema?: Address;
  /** Agent's mint address to filter by (named tokenAccount for SAS compatibility) */
  tokenAccount?: Address;
  counterparty?: Address;
  dataType?: DataType;
  outcome?: Outcome;
  responseMin?: number;
  responseMax?: number;
}

/**
 * Parsed compressed attestation with decoded data
 */
export interface ParsedAttestation {
  address: Uint8Array;
  raw: CompressedAccount;
  attestation: CompressedAttestation;
  data: FeedbackData | ValidationData;
}

/**
 * Parsed feedback attestation with FeedbackData
 */
export interface ParsedFeedbackAttestation {
  address: Uint8Array;
  raw: CompressedAccount;
  attestation: CompressedAttestation;
  data: FeedbackData;
}

/**
 * Parsed validation attestation with ValidationData
 */
export interface ParsedValidationAttestation {
  address: Uint8Array;
  raw: CompressedAccount;
  attestation: CompressedAttestation;
  data: ValidationData;
}

/**
 * Validity proof result for instruction building
 */
export interface ValidityProofResult {
  compressedProof: {
    a: number[];
    b: number[];
    c: number[];
  };
  rootIndices: number[];
  leafIndices: number[];
}

/**
 * Packed address tree info for instruction data
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
 * Account meta for remaining accounts
 */
export interface AccountMeta {
  pubkey: PublicKeyLike;
  isSigner: boolean;
  isWritable: boolean;
}

/**
 * Creation proof result with all necessary data for creating compressed accounts
 */
export interface CreationProofResult {
  proof: ValidityProofResult;
  addressTreeInfo: PackedAddressTreeInfo;
  outputStateTreeIndex: number;
  remainingAccounts: AccountMeta[];
}

/**
 * Mutation proof result for closing/updating attestations
 */
export interface MutationProofResult {
  proof: ValidityProofResult;
  stateTreeInfo: PackedStateTreeInfo;
  outputStateTreeIndex: number;
  remainingAccounts: AccountMeta[];
}

// =============================================================================
// Simple PublicKey Implementation
// =============================================================================

/**
 * Simple PublicKey implementation that satisfies the PublicKeyLike interface.
 */
class SimplePublicKey implements PublicKeyLike {
  private readonly bytes: Uint8Array;
  private cachedBase58: string | null = null;

  constructor(value: Uint8Array | string) {
    if (typeof value === "string") {
      this.bytes = new Uint8Array(getAddressEncoder().encode(address(value)));
      this.cachedBase58 = value;
    } else {
      if (value.length !== 32) {
        throw new Error(`Invalid public key length: ${value.length}, expected 32`);
      }
      this.bytes = new Uint8Array(value);
    }
  }

  toBase58(): string {
    if (this.cachedBase58 === null) {
      this.cachedBase58 = getAddressDecoder().decode(this.bytes) as string;
    }
    return this.cachedBase58;
  }

  toBytes(): Uint8Array {
    return this.bytes;
  }
}

// =============================================================================
// SATI Light Client Interface
// =============================================================================

/**
 * SATI Light Client interface for compressed attestation operations.
 */
export interface SATILightClient {
  /** Get the underlying Photon RPC client */
  getRpc(): PhotonRpc;

  /** Derive attestation address from seeds */
  deriveAttestationAddress(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    addressTree: PublicKeyLike;
    addressQueue: PublicKeyLike;
  }>;

  /** Get attestation by address */
  getAttestationByAddress(addr: Address): Promise<ParsedAttestation | null>;

  /** List feedback attestations */
  listFeedbacks(filter: Partial<AttestationFilter>): Promise<ParsedFeedbackAttestation[]>;

  /** List validation attestations */
  listValidations(filter: Partial<AttestationFilter>): Promise<ParsedValidationAttestation[]>;

  /** Get creation proof for a new compressed account */
  getCreationProof(addr: PublicKeyLike): Promise<CreationProofResult>;

  /** Get mutation proof for closing/updating an attestation */
  getMutationProof(compressedAccount: CompressedAccount): Promise<MutationProofResult>;

  /** Prepare everything needed to create a new compressed account */
  prepareCreate(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    proof: ValidityProofResult;
    addressTreeInfo: PackedAddressTreeInfo;
    outputStateTreeIndex: number;
    remainingAccounts: AccountMeta[];
  }>;

  /** Get lookup table addresses for transaction compression */
  getLookupTableAddresses(): Promise<Address[]>;
}

// =============================================================================
// SATI Light Client Implementation
// =============================================================================

/**
 * SATI Light Client implementation using compression-kit.
 */
export class SATILightClientImpl implements SATILightClient {
  private readonly rpc: PhotonRpc;
  private readonly programId: Address;

  constructor(photonRpcUrl: string, programId: Address = SATI_PROGRAM_ADDRESS) {
    this.rpc = createPhotonRpc(photonRpcUrl);
    this.programId = programId;
  }

  getRpc(): PhotonRpc {
    return this.rpc;
  }

  async deriveAttestationAddress(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    addressTree: PublicKeyLike;
    addressQueue: PublicKeyLike;
  }> {
    const addressTree = ADDRESS_TREE;
    const addressQueue = ADDRESS_QUEUE;

    const seed = deriveAddressSeed(seeds, this.programId);
    const derivedAddress = deriveAddress(seed, addressTree);

    return {
      address: new SimplePublicKey(derivedAddress),
      addressTree: new SimplePublicKey(addressTree),
      addressQueue: new SimplePublicKey(addressQueue),
    };
  }

  async getAttestationByAddress(addr: Address): Promise<ParsedAttestation | null> {
    const account = await this.rpc.getCompressedAccount({ address: addr });
    if (!account || !account.data) return null;

    return this.parseAttestation(account);
  }

  async listFeedbacks(filter: Partial<AttestationFilter>): Promise<ParsedFeedbackAttestation[]> {
    // Query compressed accounts owned by SATI program with memcmp filters
    const accounts = await this.queryAttestations(filter, 0); // DataType.Feedback = 0
    return accounts as ParsedFeedbackAttestation[];
  }

  async listValidations(filter: Partial<AttestationFilter>): Promise<ParsedValidationAttestation[]> {
    const accounts = await this.queryAttestations(filter, 1); // DataType.Validation = 1
    return accounts as ParsedValidationAttestation[];
  }

  async getCreationProof(addr: PublicKeyLike): Promise<CreationProofResult> {
    const addressBytes = addr.toBytes();
    const addressBN254 = createBN254(addressBytes);

    const proofResult = await this.rpc.getValidityProof(
      [],
      [
        {
          address: addressBN254,
          addressTreeInfo: {
            tree: ADDRESS_TREE,
            queue: ADDRESS_QUEUE,
            treeType: 2, // AddressV1
            nextTreeInfo: null,
          },
        },
      ],
    );

    const packedAccounts = await PackedAccounts.newWithSystemAccounts(createSystemAccountConfig(this.programId));

    const addressTreeIndex = packedAccounts.insertOrGet(ADDRESS_TREE);
    const addressQueueIndex = packedAccounts.insertOrGet(ADDRESS_QUEUE);
    const outputStateTreeIndex = packedAccounts.insertOrGet(MERKLE_TREE_PUBKEY);

    const { remainingAccounts } = packedAccounts.toAccountMetas();

    return {
      proof: this.convertProof(proofResult),
      addressTreeInfo: {
        rootIndex: proofResult.rootIndices[0] ?? 0,
        addressMerkleTreePubkeyIndex: addressTreeIndex,
        addressQueuePubkeyIndex: addressQueueIndex,
      },
      outputStateTreeIndex,
      remainingAccounts: remainingAccounts.map((m: { address: Address; role: number }) => ({
        pubkey: new SimplePublicKey(m.address),
        isSigner: m.role === 2 || m.role === 3,
        isWritable: m.role === 1 || m.role === 3,
      })),
    };
  }

  async getMutationProof(compressedAccount: CompressedAccount): Promise<MutationProofResult> {
    const hash = compressedAccount.hash;
    const hashBN254 = typeof hash === "bigint" ? hash : createBN254(hash as Uint8Array);

    const proofResult = await this.rpc.getValidityProof(
      [
        {
          hash: hashBN254,
          stateTreeInfo: compressedAccount.treeInfo as TreeInfo,
        },
      ],
      [],
    );

    const packedAccounts = await PackedAccounts.newWithSystemAccounts(createSystemAccountConfig(this.programId));

    const treeInfo = compressedAccount.treeInfo as TreeInfo;
    const merkleTreeIndex = packedAccounts.insertOrGet(treeInfo.tree);
    const queueIndex = packedAccounts.insertOrGet(treeInfo.queue);
    const outputStateTreeIndex = packedAccounts.insertOrGet(MERKLE_TREE_PUBKEY);

    const { remainingAccounts } = packedAccounts.toAccountMetas();

    return {
      proof: this.convertProof(proofResult),
      stateTreeInfo: {
        merkleTreePubkeyIndex: merkleTreeIndex,
        queuePubkeyIndex: queueIndex,
        leafIndex: compressedAccount.leafIndex as number,
        rootIndex: proofResult.rootIndices[0] ?? 0,
      },
      outputStateTreeIndex,
      remainingAccounts: remainingAccounts.map((m: { address: Address; role: number }) => ({
        pubkey: new SimplePublicKey(m.address),
        isSigner: m.role === 2 || m.role === 3,
        isWritable: m.role === 1 || m.role === 3,
      })),
    };
  }

  async prepareCreate(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    proof: ValidityProofResult;
    addressTreeInfo: PackedAddressTreeInfo;
    outputStateTreeIndex: number;
    remainingAccounts: AccountMeta[];
  }> {
    const { address: derivedAddress, addressTree, addressQueue } = await this.deriveAttestationAddress(seeds);

    const addressBN254 = createBN254(derivedAddress.toBytes());

    const proofResult = await this.rpc.getValidityProof(
      [],
      [
        {
          address: addressBN254,
          addressTreeInfo: {
            tree: addressTree.toBase58() as Address,
            queue: addressQueue.toBase58() as Address,
            treeType: 2, // AddressV1
            nextTreeInfo: null,
          },
        },
      ],
    );

    const packedAccounts = await PackedAccounts.newWithSystemAccounts(createSystemAccountConfig(this.programId));

    const addressTreeIndex = packedAccounts.insertOrGet(addressTree.toBase58() as Address);
    const addressQueueIndex = packedAccounts.insertOrGet(addressQueue.toBase58() as Address);
    const outputStateTreeIndex = packedAccounts.insertOrGet(MERKLE_TREE_PUBKEY);

    const { remainingAccounts } = packedAccounts.toAccountMetas();

    return {
      address: derivedAddress,
      proof: this.convertProof(proofResult),
      addressTreeInfo: {
        rootIndex: proofResult.rootIndices[0] ?? 0,
        addressMerkleTreePubkeyIndex: addressTreeIndex,
        addressQueuePubkeyIndex: addressQueueIndex,
      },
      outputStateTreeIndex,
      remainingAccounts: remainingAccounts.map((m: { address: Address; role: number }) => ({
        pubkey: new SimplePublicKey(m.address),
        isSigner: m.role === 2 || m.role === 3,
        isWritable: m.role === 1 || m.role === 3,
      })),
    };
  }

  async getLookupTableAddresses(): Promise<Address[]> {
    // Solana system programs
    const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
    const ED25519_PROGRAM = address("Ed25519SigVerify111111111111111111111111111");
    const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
    const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");
    const TOKEN_2022_PROGRAM = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

    // Derive event authority PDA: PDA(SATI_PROGRAM, ["__event_authority"])
    const [eventAuthority] = await getProgramDerivedAddress({
      programAddress: this.programId,
      seeds: [getUtf8Encoder().encode("__event_authority")],
    });

    return [
      // Light Protocol core
      LIGHT_SYSTEM_PROGRAM,
      ACCOUNT_COMPRESSION_PROGRAM,
      NOOP_PROGRAM,
      REGISTERED_PROGRAM_PDA,

      // Light Protocol state trees
      ADDRESS_TREE,
      ADDRESS_QUEUE,
      MERKLE_TREE_PUBKEY,
      NULLIFIER_QUEUE_PUBKEY,

      // SATI program and PDAs
      this.programId,
      eventAuthority,

      // Solana system programs
      SYSTEM_PROGRAM,
      ED25519_PROGRAM,
      INSTRUCTIONS_SYSVAR,
      COMPUTE_BUDGET_PROGRAM,
      TOKEN_2022_PROGRAM,
    ];
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private convertProof(proofResult: ValidityProofWithContext): ValidityProofResult {
    return {
      compressedProof: proofResult.compressedProof
        ? {
            a: Array.from(proofResult.compressedProof.a),
            b: Array.from(proofResult.compressedProof.b),
            c: Array.from(proofResult.compressedProof.c),
          }
        : { a: [], b: [], c: [] },
      rootIndices: proofResult.rootIndices,
      leafIndices: proofResult.leafIndices,
    };
  }

  private async queryAttestations(filter: Partial<AttestationFilter>, dataType: number): Promise<ParsedAttestation[]> {
    // Build memcmp filters based on SATI schema offsets
    // For now, query by owner and filter in memory
    // TODO: Use proper memcmp filters when supported by compression-kit

    const result = await this.rpc.getCompressedAccountsByOwner(this.programId);
    const attestations: ParsedAttestation[] = [];

    for (const account of result.items) {
      if (!account.data) continue;

      try {
        const parsed = this.parseAttestation(account);
        if (!parsed) continue;

        // Apply filters
        if (parsed.attestation.dataType !== dataType) continue;
        if (filter.sasSchema && parsed.attestation.sasSchema !== filter.sasSchema) continue;
        if (filter.tokenAccount && parsed.attestation.tokenAccount !== filter.tokenAccount) continue;

        attestations.push(parsed);
      } catch {
        // Skip invalid attestations
      }
    }

    return attestations;
  }

  private parseAttestation(account: CompressedAccount): ParsedAttestation | null {
    if (!account.data) return null;

    const rawData = account.data.data;
    const data = rawData instanceof Uint8Array ? new Uint8Array(rawData) : new Uint8Array(rawData as ArrayLike<number>);

    // Minimum: sasSchema(32) + tokenAccount(32) + dataType(1) + dataLen(4) = 69 bytes
    if (data.length < BORSH_OFFSETS.DATA_START) return null;

    // Parse fixed fields and convert to Address
    const addressDecoder = getAddressDecoder();
    const sasSchemaBytes = data.slice(BORSH_OFFSETS.SAS_SCHEMA, BORSH_OFFSETS.SAS_SCHEMA + 32);
    const tokenAccountBytes = data.slice(BORSH_OFFSETS.TOKEN_ACCOUNT, BORSH_OFFSETS.TOKEN_ACCOUNT + 32);
    const sasSchema = addressDecoder.decode(sasSchemaBytes);
    const tokenAccount = addressDecoder.decode(tokenAccountBytes);
    const dataType = data[BORSH_OFFSETS.DATA_TYPE];

    // Parse Vec length (4-byte u32 LE at offset 65)
    const dataLen =
      data[BORSH_OFFSETS.DATA_LEN] |
      (data[BORSH_OFFSETS.DATA_LEN + 1] << 8) |
      (data[BORSH_OFFSETS.DATA_LEN + 2] << 16) |
      (data[BORSH_OFFSETS.DATA_LEN + 3] << 24);
    const schemaDataEnd = BORSH_OFFSETS.DATA_START + dataLen;

    // Validate we have enough bytes for: schemaData + numSignatures(1) + sig1(64) + sig2(64)
    if (data.length < schemaDataEnd + 129) return null;

    const schemaData = data.slice(BORSH_OFFSETS.DATA_START, schemaDataEnd);
    const numSignatures = data[schemaDataEnd];
    const signature1 = data.slice(schemaDataEnd + 1, schemaDataEnd + 65);
    const signature2 = numSignatures > 1 ? data.slice(schemaDataEnd + 65, schemaDataEnd + 129) : new Uint8Array(64);

    const attestation: CompressedAttestation = {
      sasSchema,
      tokenAccount,
      dataType: dataType as DataType,
      numSignatures,
      data: schemaData,
      signature1,
      signature2,
    };

    // Deserialize schema-specific data
    let parsedData: FeedbackData | ValidationData;
    if (dataType === 0) {
      parsedData = deserializeFeedback(schemaData);
    } else {
      parsedData = deserializeValidation(schemaData);
    }

    return {
      address: account.address ?? new Uint8Array(32),
      raw: account,
      attestation,
      data: parsedData,
    };
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a SATI Light Client.
 *
 * @param photonRpcUrl - Photon indexer URL
 * @param programId - Optional SATI program ID (defaults to deployed address)
 */
export function createSATILightClient(photonRpcUrl: string, programId?: Address): SATILightClient {
  return new SATILightClientImpl(photonRpcUrl, programId);
}
