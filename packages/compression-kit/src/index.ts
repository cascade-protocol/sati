/**
 * @cascade-fyi/compression-kit
 *
 * Solana Kit native implementation of Light Protocol stateless.js.
 *
 * Features:
 * - Edge/browser compatible (no Node.js dependencies)
 * - Uses native bigint instead of BN.js
 * - Uses Solana Kit Address type instead of PublicKey
 * - Works in Cloudflare Workers, Deno, browsers
 *
 * @example
 * ```typescript
 * import {
 *   createPhotonRpc,
 *   deriveAddress,
 *   deriveAddressSeed,
 *   createBN254,
 * } from '@cascade-fyi/compression-kit';
 *
 * // Create RPC client
 * const rpc = createPhotonRpc('https://zk-testnet.helius.dev:8784');
 *
 * // Get compressed accounts
 * const accounts = await rpc.getCompressedAccountsByOwner(ownerAddress);
 *
 * // Derive a compressed account address
 * const seed = deriveAddressSeed([new TextEncoder().encode('my-seed')], programId);
 * const address = deriveAddress(seed);
 * ```
 */

// =============================================================================
// State Types
// =============================================================================

export type {
  // Tree types
  TreeInfo,
  StateTreeInfo,
  AddressTreeInfo,
  // Merkle context
  PackedMerkleContext,
  PackedStateTreeInfo,
  PackedAddressTreeInfo,
  MerkleContext,
  MerkleContextWithProof,
  // Compressed accounts
  CompressedAccountData,
  CompressedAccount,
  CompressedAccountMeta,
  // Proofs
  ValidityProof,
  ValidityProofWithContext,
  AccountProofInput,
  NewAddressProofInput,
  // Tokens
  TokenData,
  ParsedTokenAccount,
  // Instructions
  CompressedCpiContext,
  NewAddressParams,
  NewAddressParamsPacked,
} from "./state/types.js";

export { TreeType } from "./state/types.js";

// BN254 field element utilities
export type { BN254 } from "./state/bn254.js";
export {
  createBN254,
  bn254FromBytes,
  bn254ToBytes,
  encodeBN254toBase58,
  encodeBN254toHex,
  bn254ToDecimalString,
  isBN254,
  assertIsBN254,
  bytesToBigIntBE,
  bytesToBigIntLE,
  bigIntToBytesBE,
  bigIntToBytesLE,
  bn254Add,
  bn254Sub,
  bn254Mul,
  isSmallerThanFieldSize,
} from "./state/bn254.js";

// =============================================================================
// Constants
// =============================================================================

export {
  // Version flags
  VERSION,
  featureFlags,
  versionedEndpoint,
  // Field constants
  FIELD_SIZE,
  HIGHEST_ADDRESS_PLUS_ONE,
  // Program IDs
  LIGHT_SYSTEM_PROGRAM,
  ACCOUNT_COMPRESSION_PROGRAM,
  NOOP_PROGRAM,
  COMPRESSED_TOKEN_PROGRAM,
  REGISTERED_PROGRAM_PDA,
  // Discriminators
  INVOKE_DISCRIMINATOR,
  INVOKE_CPI_DISCRIMINATOR,
  INVOKE_CPI_WITH_READ_ONLY_DISCRIMINATOR,
  INVOKE_CPI_WITH_ACCOUNT_INFO_DISCRIMINATOR,
  INSERT_INTO_QUEUES_DISCRIMINATOR,
  COMPUTE_BUDGET_PATTERN,
  // Lookup tables
  STATE_TREE_LOOKUP_TABLE_MAINNET,
  STATE_TREE_LOOKUP_TABLE_DEVNET,
  NULLIFIED_STATE_TREE_LOOKUP_TABLE_MAINNET,
  NULLIFIED_STATE_TREE_LOOKUP_TABLE_DEVNET,
  defaultStateTreeLookupTables,
  // Tree accounts
  MERKLE_TREE_PUBKEY,
  NULLIFIER_QUEUE_PUBKEY,
  CPI_CONTEXT_PUBKEY,
  MERKLE_TREE_2_PUBKEY,
  NULLIFIER_QUEUE_2_PUBKEY,
  CPI_CONTEXT_2_PUBKEY,
  ADDRESS_TREE,
  ADDRESS_QUEUE,
  BATCH_MERKLE_TREE_1,
  BATCH_QUEUE_1,
  BATCH_CPI_CONTEXT_1,
  BATCH_MERKLE_TREE_2,
  BATCH_QUEUE_2,
  BATCH_CPI_CONTEXT_2,
  BATCH_ADDRESS_TREE,
  TEST_BATCH_ADDRESS_TREE,
  // Configuration
  DEFAULT_MERKLE_TREE_HEIGHT,
  DEFAULT_MERKLE_TREE_ROOTS,
  UTXO_MERGE_THRESHOLD,
  UTXO_MERGE_MAXIMUM,
  TRANSACTION_MERKLE_TREE_ROLLOVER_THRESHOLD,
  // Fees
  STATE_MERKLE_TREE_ROLLOVER_FEE,
  ADDRESS_QUEUE_ROLLOVER_FEE,
  STATE_MERKLE_TREE_NETWORK_FEE,
  ADDRESS_TREE_NETWORK_FEE_V1,
  ADDRESS_TREE_NETWORK_FEE_V2,
  // Helpers
  getAccountCompressionAuthority,
  defaultStaticAccounts,
  isLocalTest,
  defaultTestStateTreeAccounts,
  localTestActiveStateTreeInfos,
  getDefaultAddressTreeInfo,
} from "./constants.js";

export type { StateTreeLUTPair } from "./constants.js";

// =============================================================================
// Errors
// =============================================================================

export {
  // Error codes
  UtxoErrorCode,
  SelectInUtxosErrorCode,
  CreateUtxoErrorCode,
  RpcErrorCode,
  LookupTableErrorCode,
  HashErrorCode,
  ProofErrorCode,
  MerkleTreeErrorCode,
  UtilsErrorCode,
  BN254ErrorCode,
  // Error classes
  UtxoError,
  SelectInUtxosError,
  CreateUtxoError,
  RpcError,
  LookupTableError,
  HashError,
  ProofError,
  MerkleTreeError,
  UtilsError,
  BN254Error,
  // Factory functions
  createUtxoError,
  createRpcError,
  createProofError,
  createBN254Error,
} from "./errors.js";

// =============================================================================
// Utilities
// =============================================================================

// Conversion utilities
export {
  hashvToBn254FieldSizeBe,
  hashvToBn254FieldSizeBeWithBump,
  hashToBn254FieldSizeBe,
  hexToBytes,
  bytesToHex,
  toHex,
  toArray,
  mergeBytes,
  bytesEqual,
  padBytes,
  pushUniqueItems,
  bytesToDecimalString,
  validateBN254Hash,
  assertValidBN254Hash,
} from "./utils/conversion.js";

// Address utilities
export {
  deriveAddressSeed,
  deriveAddress,
  deriveAddressSeedV2,
  deriveAddressV2,
  getIndexOrAdd,
  packNewAddressParams,
  addressToBytes,
  bytesToAddress,
} from "./utils/address.js";

// Instruction utilities
export type { SystemAccountMetaConfig } from "./utils/instruction.js";
export {
  createSystemAccountConfig,
  createSystemAccountConfigWithCpi,
  getCpiSignerPda,
  getAccountCompressionAuthority as getCompressionAuthority,
  getSystemProgram,
  getLightSystemAccountMetas,
  getLightSystemAccountMetasV2,
  PackedAccounts,
} from "./utils/instruction.js";

// =============================================================================
// RPC Client
// =============================================================================

export type {
  WithContext,
  WithCursor,
  PaginatedOptions,
  GetCompressedAccountsByOwnerConfig,
  GetCompressedTokenAccountsConfig,
  HashWithTreeInfo,
  AddressWithTreeInfo,
  SignatureWithMetadata,
  TokenBalance,
} from "./rpc.js";

export { PhotonRpc, createPhotonRpc } from "./rpc.js";
