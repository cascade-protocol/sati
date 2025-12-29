/**
 * Light Protocol Portable Implementation
 *
 * A worker-compatible reimplementation of Light Protocol functions that
 * doesn't depend on @lightprotocol/stateless.js (which uses Node.js APIs).
 *
 * Uses:
 * - @noble/hashes for keccak256 (pure JS/WASM, works in Workers)
 * - @solana/kit for Address/PublicKey operations
 * - Raw fetch() for Helius Photon RPC calls
 *
 * This implementation is designed for Cloudflare Workers and browser environments
 * where Node.js built-ins (like 'events') are not available.
 */

import { keccak_256 } from "@noble/hashes/sha3";
import {
  address as toAddress,
  getAddressEncoder,
  type Address,
} from "@solana/kit";
import { SATI_PROGRAM_ADDRESS } from "./generated/programs/sati.js";
import type {
  LightClient,
  PublicKeyLike,
  ValidityProofResult,
  PackedAddressTreeInfo,
  AccountMeta as LightAccountMeta,
  AttestationFilter,
  ParsedAttestation,
  CreationProofResult,
  MutationProofResult,
  CompressedAccount,
  Rpc,
} from "./light-types";

// ============================================================================
// Constants
// ============================================================================

// V1 Address Tree (used for mainnet compatibility)
export const ADDRESS_TREE_V1 = "amt1Ayt45jfbdw5YSo7iz6WZxUmnZsQTYXy82hVwyC2";
export const ADDRESS_QUEUE_V1 = "aq1S9z4reTSQAdgWHGD2zDaS39sjGrAxbR31vxJ2F4F";

// V1 State Tree
export const STATE_TREE_V1 = "smt1NamzXdq4AMqS2fS2F1i5KTYPZRhoHgWx38d8WsT";
export const NULLIFIER_QUEUE_V1 = "nfq1NvQDJ2GEgnS8zt9prAe8rjjpAW1zFkrvZoBR148";

// Light Protocol Programs
export const LIGHT_SYSTEM_PROGRAM =
  "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7";
export const ACCOUNT_COMPRESSION_PROGRAM =
  "compr6CUsB5m2jS4Y3831ztGSTnDpnKJTKS95d64XVq";
export const NOOP_PROGRAM = "noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV";
export const REGISTERED_PROGRAM_PDA =
  "35hkDgaAKwMCaxRz2ocSZ6NaUrtKkyNqU6c4RV3tYJRh";

// ============================================================================
// PublicKey Implementation
// ============================================================================

/**
 * Simple PublicKey implementation that satisfies the PublicKeyLike interface.
 * Compatible with @solana/web3.js PublicKey without depending on it.
 */
export class PortablePublicKey implements PublicKeyLike {
  private readonly bytes: Uint8Array;
  private cachedBase58: string | null = null;

  constructor(value: Uint8Array | string) {
    if (typeof value === "string") {
      this.bytes = base58ToUint8Array(value);
      this.cachedBase58 = value;
    } else {
      if (value.length !== 32) {
        throw new Error(
          `Invalid public key length: ${value.length}, expected 32`,
        );
      }
      this.bytes = value;
    }
  }

  toBase58(): string {
    if (this.cachedBase58 === null) {
      this.cachedBase58 = uint8ArrayToBase58(this.bytes);
    }
    return this.cachedBase58;
  }

  toBytes(): Uint8Array {
    return this.bytes;
  }

  toString(): string {
    return this.toBase58();
  }

  equals(other: PublicKeyLike): boolean {
    const otherBytes = other.toBytes();
    if (this.bytes.length !== otherBytes.length) return false;
    for (let i = 0; i < this.bytes.length; i++) {
      if (this.bytes[i] !== otherBytes[i]) return false;
    }
    return true;
  }
}

// ============================================================================
// Types
// ============================================================================

/**
 * Internal account meta type (uses Address for convenience)
 */
interface InternalAccountMeta {
  pubkey: Address;
  isSigner: boolean;
  isWritable: boolean;
}

export interface ValidityProof {
  a: number[];
  b: number[];
  c: number[];
}

export interface ValidityProofWithContext {
  compressedProof: ValidityProof;
  rootIndices: number[];
  leafIndices: number[];
  roots: string[];
  leaves: string[];
  merkleTrees: string[];
}

export interface PrepareCreateResult {
  address: PublicKeyLike;
  proof: ValidityProofResult;
  addressTreeInfo: PackedAddressTreeInfo;
  outputStateTreeIndex: number;
  remainingAccounts: LightAccountMeta[];
}

export enum TreeType {
  StateV1 = 1,
  AddressV1 = 2,
  StateV2 = 3,
  AddressV2 = 4,
}

export interface TreeInfo {
  tree: Address;
  queue: Address;
  treeType: TreeType;
  cpiContext?: Address;
  nextTreeInfo: TreeInfo | null;
}

// ============================================================================
// Hash Functions (ported from @lightprotocol/stateless.js)
// ============================================================================

/**
 * Hash multiple byte arrays with Keccak256 and truncate to fit BN254 field.
 * Sets first byte to 0 to ensure result is less than field size.
 */
export function hashvToBn254FieldSizeBe(bytes: Uint8Array[]): Uint8Array {
  const hasher = keccak_256.create();
  for (const input of bytes) {
    hasher.update(input);
  }
  const hash = hasher.digest();
  hash[0] = 0; // Truncate to 31 bytes effectively
  return hash;
}

/**
 * Hash bytes with Keccak256 using bump seeds until result fits BN254 field.
 * @deprecated Use hashvToBn254FieldSizeBe instead for new code
 */
export function hashToBn254FieldSizeBe(
  bytes: Uint8Array,
): [Uint8Array, number] | null {
  const bumpSeed = 255;
  while (bumpSeed >= 0) {
    const inputWithBumpSeed = new Uint8Array(bytes.length + 1);
    inputWithBumpSeed.set(bytes);
    inputWithBumpSeed[bytes.length] = bumpSeed;

    const hash = keccak_256(inputWithBumpSeed);
    if (hash.length !== 32) {
      throw new Error("Invalid hash length");
    }
    hash[0] = 0;

    // Check if hash is smaller than BN254 field size
    // (simplified check - first byte is 0, so it's always smaller)
    return [hash, bumpSeed];
  }
  return null;
}

// ============================================================================
// Address Derivation (ported from @lightprotocol/stateless.js)
// ============================================================================

/**
 * Derive address seed from seeds and program ID.
 * Hash = keccak256(programId || seed1 || seed2 || ...)
 */
export function deriveAddressSeed(
  seeds: Uint8Array[],
  programId: Address,
): Uint8Array {
  const encoder = getAddressEncoder();
  const programIdBytes = new Uint8Array(encoder.encode(programId));
  const combinedSeeds: Uint8Array[] = [programIdBytes, ...seeds];
  return hashvToBn254FieldSizeBe(combinedSeeds);
}

/**
 * Derive compressed account address from seed and address tree.
 * Address = keccak256(addressTree || seed) truncated to BN254
 */
export function deriveAddress(
  seed: Uint8Array,
  addressMerkleTree: Address = toAddress(ADDRESS_TREE_V1),
): Address {
  if (seed.length !== 32) {
    throw new Error("Seed length must be 32 bytes");
  }

  const encoder = getAddressEncoder();
  const treeBytes = new Uint8Array(encoder.encode(addressMerkleTree));

  const combined = new Uint8Array(treeBytes.length + seed.length);
  combined.set(treeBytes);
  combined.set(seed, treeBytes.length);

  const result = hashToBn254FieldSizeBe(combined);
  if (result === null) {
    throw new Error("Failed to derive address");
  }

  return toAddress(uint8ArrayToBase58(result[0]));
}

// ============================================================================
// Account Packing (ported from @lightprotocol/stateless.js)
// ============================================================================

/**
 * Configuration for Light Protocol system accounts.
 */
export class SystemAccountMetaConfig {
  selfProgram: Address;
  cpiContext?: Address;
  solCompressionRecipient?: Address;
  solPoolPda?: Address;

  private constructor(
    selfProgram: Address,
    cpiContext?: Address,
    solCompressionRecipient?: Address,
    solPoolPda?: Address,
  ) {
    this.selfProgram = selfProgram;
    this.cpiContext = cpiContext;
    this.solCompressionRecipient = solCompressionRecipient;
    this.solPoolPda = solPoolPda;
  }

  static new(selfProgram: Address): SystemAccountMetaConfig {
    return new SystemAccountMetaConfig(selfProgram);
  }

  static newWithCpiContext(
    selfProgram: Address,
    cpiContext: Address,
  ): SystemAccountMetaConfig {
    return new SystemAccountMetaConfig(selfProgram, cpiContext);
  }
}

/**
 * Get account compression authority PDA.
 */
function getAccountCompressionAuthority(): Address {
  // Pre-computed PDA for Light System Program with seed "cpi_authority"
  // This is a constant that doesn't change
  return toAddress("8VryJThVpXyFDMPxLHYGvnZ2fMN9BgjVspdDe9HboMHc");
}

/**
 * Find CPI signer PDA for a program.
 */
function findCpiSigner(programId: Address): Address {
  // This would normally use PublicKey.findProgramAddressSync
  // For now, we'll compute it manually or use a pre-computed value
  // TODO: Implement proper PDA derivation for arbitrary programs
  // For SATI, we can pre-compute this
  if (programId === SATI_PROGRAM_ADDRESS) {
    // Pre-computed CPI signer for SATI program
    return toAddress("2DH1tAbDgECp9WfrsgQxTdqXzLgBr1dg5ZaPDJmMpwXv");
  }
  throw new Error(`CPI signer not pre-computed for program: ${programId}`);
}

/**
 * Get Light Protocol system account metas.
 */
export function getLightSystemAccountMetas(
  config: SystemAccountMetaConfig,
): InternalAccountMeta[] {
  const cpiSigner = findCpiSigner(config.selfProgram);

  const metas: InternalAccountMeta[] = [
    {
      pubkey: toAddress(LIGHT_SYSTEM_PROGRAM),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: cpiSigner, isSigner: false, isWritable: false },
    {
      pubkey: toAddress(REGISTERED_PROGRAM_PDA),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: toAddress(NOOP_PROGRAM),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: getAccountCompressionAuthority(),
      isSigner: false,
      isWritable: false,
    },
    {
      pubkey: toAddress(ACCOUNT_COMPRESSION_PROGRAM),
      isSigner: false,
      isWritable: false,
    },
    { pubkey: config.selfProgram, isSigner: false, isWritable: false },
  ];

  if (config.solPoolPda) {
    metas.push({
      pubkey: config.solPoolPda,
      isSigner: false,
      isWritable: true,
    });
  }

  if (config.solCompressionRecipient) {
    metas.push({
      pubkey: config.solCompressionRecipient,
      isSigner: false,
      isWritable: true,
    });
  }

  // System program
  metas.push({
    pubkey: toAddress("11111111111111111111111111111111"),
    isSigner: false,
    isWritable: false,
  });

  if (config.cpiContext) {
    metas.push({
      pubkey: config.cpiContext,
      isSigner: false,
      isWritable: true,
    });
  }

  return metas;
}

/**
 * Packed accounts helper for building transactions.
 */
export class PackedAccounts {
  private preAccounts: InternalAccountMeta[] = [];
  private systemAccounts: InternalAccountMeta[] = [];
  private nextIndex: number = 0;
  private map: Map<string, [number, InternalAccountMeta]> = new Map();

  static newWithSystemAccounts(
    config: SystemAccountMetaConfig,
  ): PackedAccounts {
    const instance = new PackedAccounts();
    instance.addSystemAccounts(config);
    return instance;
  }

  addPreAccountsSigner(pubkey: Address): void {
    this.preAccounts.push({ pubkey, isSigner: true, isWritable: false });
  }

  addPreAccountsSignerMut(pubkey: Address): void {
    this.preAccounts.push({ pubkey, isSigner: true, isWritable: true });
  }

  addPreAccountsMeta(accountMeta: InternalAccountMeta): void {
    this.preAccounts.push(accountMeta);
  }

  addSystemAccounts(config: SystemAccountMetaConfig): void {
    this.systemAccounts.push(...getLightSystemAccountMetas(config));
  }

  insertOrGet(pubkey: Address): number {
    return this.insertOrGetConfig(pubkey, false, true);
  }

  insertOrGetReadOnly(pubkey: Address): number {
    return this.insertOrGetConfig(pubkey, false, false);
  }

  insertOrGetConfig(
    pubkey: Address,
    isSigner: boolean,
    isWritable: boolean,
  ): number {
    const key = pubkey as string;
    const entry = this.map.get(key);
    if (entry) {
      return entry[0];
    }
    const index = this.nextIndex++;
    const meta: InternalAccountMeta = { pubkey, isSigner, isWritable };
    this.map.set(key, [index, meta]);
    return index;
  }

  private hashSetAccountsToMetas(): InternalAccountMeta[] {
    const entries = Array.from(this.map.entries());
    entries.sort((a, b) => a[1][0] - b[1][0]);
    return entries.map(([, [, meta]]) => meta);
  }

  private getOffsets(): [number, number] {
    const systemStart = this.preAccounts.length;
    const packedStart = systemStart + this.systemAccounts.length;
    return [systemStart, packedStart];
  }

  toAccountMetas(): {
    remainingAccounts: LightAccountMeta[];
    systemStart: number;
    packedStart: number;
  } {
    const packed = this.hashSetAccountsToMetas();
    const [systemStart, packedStart] = this.getOffsets();

    // Convert InternalAccountMeta to LightAccountMeta (with PublicKeyLike pubkey)
    const internalMetas: InternalAccountMeta[] = [
      ...this.preAccounts,
      ...this.systemAccounts,
      ...packed,
    ];

    const remainingAccounts: LightAccountMeta[] = internalMetas.map((meta) => ({
      pubkey: new PortablePublicKey(meta.pubkey as string),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    }));

    return {
      remainingAccounts,
      systemStart,
      packedStart,
    };
  }
}

// ============================================================================
// RPC Client (using raw fetch)
// ============================================================================

interface RpcResponse<T> {
  jsonrpc: string;
  id: string | number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Make a JSON-RPC call to Helius Photon.
 */
async function rpcCall<T>(
  rpcUrl: string,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "light-portable",
      method,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`RPC request failed: ${response.status}`);
  }

  const data = (await response.json()) as RpcResponse<T>;
  if (data.error) {
    throw new Error(`RPC error: ${data.error.message}`);
  }

  return data.result as T;
}

interface GetValidityProofParams {
  hashes?: string[];
  newAddressesWithTrees?: Array<{ address: string; tree: string }>;
}

interface GetValidityProofResult {
  context: { slot: number };
  value: {
    compressedProof: { a: string; b: string; c: string };
    leafIndices: number[];
    leaves: string[];
    merkleTrees: string[];
    rootIndices: number[];
    roots: string[];
  };
}

/**
 * Get validity proof from Helius Photon RPC.
 */
export async function getValidityProof(
  rpcUrl: string,
  params: GetValidityProofParams,
): Promise<ValidityProofWithContext> {
  const result = await rpcCall<GetValidityProofResult>(
    rpcUrl,
    "getValidityProof",
    params,
  );

  // Convert hex strings to number arrays
  const { a, b, c } = result.value.compressedProof;

  return {
    compressedProof: {
      a: hexToBytes(a),
      b: hexToBytes(b),
      c: hexToBytes(c),
    },
    rootIndices: result.value.rootIndices,
    leafIndices: result.value.leafIndices,
    roots: result.value.roots,
    leaves: result.value.leaves,
    merkleTrees: result.value.merkleTrees,
  };
}

// ============================================================================
// Portable Light Client
// ============================================================================

/**
 * Portable Light Protocol client that works in Cloudflare Workers.
 *
 * Implements the LightClient interface with only the methods needed for
 * transaction building. Query methods (listFeedbacks, listValidations, etc.)
 * throw errors as they require full Photon API access not available in Workers.
 *
 * Use this client in Worker environments where @lightprotocol/stateless.js
 * cannot be used due to Node.js API dependencies.
 */
export class PortableLightClient implements LightClient {
  private rpcUrl: string;
  private programId: Address;

  constructor(rpcUrl: string, programId: Address = SATI_PROGRAM_ADDRESS) {
    this.rpcUrl = rpcUrl;
    this.programId = programId;
  }

  /**
   * Get the RPC client (returns null for portable implementation)
   */
  getRpc(): Rpc {
    return null;
  }

  /**
   * Get V1 address tree info for mainnet compatibility.
   */
  getV1AddressTreeInfo(): { addressTree: Address; addressQueue: Address } {
    return {
      addressTree: toAddress(ADDRESS_TREE_V1),
      addressQueue: toAddress(ADDRESS_QUEUE_V1),
    };
  }

  /**
   * Get V1 state tree for output.
   */
  getV1StateTree(): TreeInfo {
    return {
      tree: toAddress(STATE_TREE_V1),
      queue: toAddress(NULLIFIER_QUEUE_V1),
      treeType: TreeType.StateV1,
      nextTreeInfo: null,
    };
  }

  /**
   * Derive compressed account address from seeds
   */
  async deriveAttestationAddress(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    addressTree: PublicKeyLike;
    addressQueue: PublicKeyLike;
  }> {
    const { addressTree, addressQueue } = this.getV1AddressTreeInfo();
    const seed = deriveAddressSeed(seeds, this.programId);
    const derivedAddress = deriveAddress(seed, addressTree);

    return {
      address: new PortablePublicKey(derivedAddress as string),
      addressTree: new PortablePublicKey(addressTree as string),
      addressQueue: new PortablePublicKey(addressQueue as string),
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
   */
  async prepareCreate(seeds: Uint8Array[]): Promise<{
    address: PublicKeyLike;
    proof: ValidityProofResult;
    addressTreeInfo: PackedAddressTreeInfo;
    outputStateTreeIndex: number;
    remainingAccounts: LightAccountMeta[];
  }> {
    // 1. Derive the address using V1 address trees
    const { addressTree, addressQueue } = this.getV1AddressTreeInfo();

    const seed = deriveAddressSeed(seeds, this.programId);
    const derivedAddress = deriveAddress(seed, addressTree);

    // 2. Get validity proof proving address doesn't exist
    const proofResult = await getValidityProof(this.rpcUrl, {
      hashes: [],
      newAddressesWithTrees: [
        {
          address: derivedAddress as string,
          tree: addressTree as string,
        },
      ],
    });

    // 3. Pack accounts
    const packedAccounts = new PackedAccounts();
    const systemAccountConfig = SystemAccountMetaConfig.new(this.programId);
    packedAccounts.addSystemAccounts(systemAccountConfig);

    // Address tree indices
    const addressMerkleTreePubkeyIndex =
      packedAccounts.insertOrGet(addressTree);
    const addressQueuePubkeyIndex = packedAccounts.insertOrGet(addressQueue);

    // Output state tree (use V1)
    const outputStateTree = this.getV1StateTree();
    const outputStateTreeIndex = packedAccounts.insertOrGet(
      outputStateTree.tree,
    );

    // 4. Get remaining accounts
    const { remainingAccounts } = packedAccounts.toAccountMetas();

    // Convert proof format to match ValidityProofResult
    const proof: ValidityProofResult = {
      compressedProof: proofResult.compressedProof,
      rootIndices: proofResult.rootIndices,
      leafIndices: proofResult.leafIndices,
    };

    return {
      address: new PortablePublicKey(derivedAddress as string),
      proof,
      addressTreeInfo: {
        addressMerkleTreePubkeyIndex,
        addressQueuePubkeyIndex,
        rootIndex: proofResult.rootIndices[0] ?? 0,
      },
      outputStateTreeIndex,
      remainingAccounts,
    };
  }

  // ============================================================================
  // Query Methods (Not implemented in portable client)
  // ============================================================================

  /**
   * Get attestation by address bytes
   * @throws Not implemented in portable client
   */
  async getAttestation(
    _address: Uint8Array,
  ): Promise<ParsedAttestation | null> {
    throw new Error(
      "getAttestation is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * Get attestation by Address string
   * @throws Not implemented in portable client
   */
  async getAttestationByAddress(
    _address: Address,
  ): Promise<ParsedAttestation | null> {
    throw new Error(
      "getAttestationByAddress is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * Get multiple attestations by addresses
   * @throws Not implemented in portable client
   */
  async getAttestations(
    _addresses: Uint8Array[],
  ): Promise<ParsedAttestation[]> {
    throw new Error(
      "getAttestations is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * List feedback attestations
   * @throws Not implemented in portable client
   */
  async listFeedbacks(
    _filter: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    throw new Error(
      "listFeedbacks is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * List validation attestations
   * @throws Not implemented in portable client
   */
  async listValidations(
    _filter: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    throw new Error(
      "listValidations is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * List attestations for a token account
   * @throws Not implemented in portable client
   */
  async listAttestations(
    _tokenAccount: Address,
    _filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    throw new Error(
      "listAttestations is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * List attestations by schema
   * @throws Not implemented in portable client
   */
  async listBySchema(
    _sasSchema: Address,
    _filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    throw new Error(
      "listBySchema is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for query operations.",
    );
  }

  /**
   * Get creation proof for an address
   * @throws Not implemented in portable client
   */
  async getCreationProof(
    _address: PublicKeyLike,
  ): Promise<CreationProofResult> {
    throw new Error(
      "getCreationProof is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for proof operations.",
    );
  }

  /**
   * Get mutation proof for closing/updating an attestation
   * @throws Not implemented in portable client
   */
  async getMutationProof(
    _compressedAccount: CompressedAccount,
  ): Promise<MutationProofResult> {
    throw new Error(
      "getMutationProof is not implemented in PortableLightClient. " +
        "Use the full LightClient from @cascade-fyi/sati-sdk/light for proof operations.",
    );
  }

  /**
   * Get lookup table addresses
   */
  async getLookupTableAddresses(): Promise<PublicKeyLike[]> {
    // Return the common addresses used in Light Protocol transactions
    return [
      new PortablePublicKey(LIGHT_SYSTEM_PROGRAM),
      new PortablePublicKey(ACCOUNT_COMPRESSION_PROGRAM),
      new PortablePublicKey(NOOP_PROGRAM),
      new PortablePublicKey(REGISTERED_PROGRAM_PDA),
      new PortablePublicKey(ADDRESS_TREE_V1),
      new PortablePublicKey(ADDRESS_QUEUE_V1),
      new PortablePublicKey(STATE_TREE_V1),
      new PortablePublicKey(NULLIFIER_QUEUE_V1),
    ];
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode Uint8Array to Base58 string.
 */
export function uint8ArrayToBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Count leading zeros
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) {
    zeros++;
  }

  // Convert to big integer
  let num = BigInt(0);
  for (let i = 0; i < bytes.length; i++) {
    num = num * BigInt(256) + BigInt(bytes[i]);
  }

  // Convert to base58
  let result = "";
  while (num > 0) {
    const remainder = Number(num % BigInt(58));
    num = num / BigInt(58);
    result = BASE58_ALPHABET[remainder] + result;
  }

  // Add leading '1's for each leading zero byte
  for (let i = 0; i < zeros; i++) {
    result = "1" + result;
  }

  return result;
}

/**
 * Decode Base58 string to Uint8Array.
 */
export function base58ToUint8Array(str: string): Uint8Array {
  if (str.length === 0) return new Uint8Array(0);

  // Count leading '1's (zeros)
  let zeros = 0;
  while (zeros < str.length && str[zeros] === "1") {
    zeros++;
  }

  // Convert from base58
  let num = BigInt(0);
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`Invalid base58 character: ${char}`);
    }
    num = num * BigInt(58) + BigInt(index);
  }

  // Convert to bytes
  const bytes: number[] = [];
  while (num > 0) {
    bytes.unshift(Number(num % BigInt(256)));
    num = num / BigInt(256);
  }

  // Add leading zeros
  for (let i = 0; i < zeros; i++) {
    bytes.unshift(0);
  }

  return new Uint8Array(bytes);
}

/**
 * Convert hex string to byte array (number[]).
 */
function hexToBytes(hex: string): number[] {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Create a default portable Light client.
 */
export function createPortableLightClient(
  rpcUrl: string,
  programId?: Address,
): PortableLightClient {
  return new PortableLightClient(rpcUrl, programId);
}
