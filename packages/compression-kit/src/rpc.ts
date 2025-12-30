/**
 * Light Protocol Photon RPC Client using native fetch.
 *
 * This is a portable implementation that works in:
 * - Cloudflare Workers
 * - Browsers
 * - Node.js
 * - Deno
 *
 * Uses Kit-native patterns but with a simple fetch-based transport
 * for the Photon indexer API (not standard Solana RPC).
 */

import type { Address } from "@solana/kit";
import { address } from "@solana/kit";
import bs58 from "bs58";
import { versionedEndpoint, featureFlags } from "./constants.js";
import type {
  CompressedAccount,
  MerkleContextWithProof,
  TreeInfo,
  TreeType,
  ValidityProof,
  ValidityProofWithContext,
  ParsedTokenAccount,
} from "./state/types.js";
import { createBN254, type BN254 } from "./state/bn254.js";
import { RpcErrorCode, createRpcError } from "./errors.js";

// =============================================================================
// Types
// =============================================================================

let requestId = 0n;

/**
 * JSON-RPC request structure.
 */
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: unknown;
}

/**
 * JSON-RPC response structure.
 */
interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/**
 * Context wrapper for RPC responses.
 */
export interface WithContext<T> {
  context: { slot: number };
  value: T;
}

/**
 * Cursor-based pagination wrapper.
 */
export interface WithCursor<T> {
  cursor: string | null;
  items: T;
}

/**
 * Options for paginated requests.
 */
export interface PaginatedOptions {
  cursor?: string;
  limit?: number;
}

/**
 * Memcmp filter for compressed account queries.
 *
 * NOTE: Photon RPC (Light Protocol indexer) does not yet support memcmp filters.
 * This interface is prepared for when support is added.
 * Track: https://github.com/Lightprotocol/light-protocol/issues
 */
export interface MemcmpFilter {
  /** Byte offset into account data to start comparison */
  offset: number;
  /** Bytes to compare (base58 or base64 encoded, or raw Uint8Array) */
  bytes: string | Uint8Array;
  /** Encoding of bytes string ("base58" or "base64"), ignored if bytes is Uint8Array */
  encoding?: "base58" | "base64";
}

/**
 * Options for getCompressedAccountsByOwner.
 */
export interface GetCompressedAccountsByOwnerConfig {
  cursor?: string;
  limit?: number;
  /**
   * Memcmp filters for server-side filtering.
   *
   * NOTE: Not yet supported by Photon RPC. Filters are passed through but
   * will be ignored until Light Protocol adds support.
   */
  filters?: MemcmpFilter[];
}

/**
 * Options for getCompressedTokenAccountsByOwner.
 */
export interface GetCompressedTokenAccountsConfig {
  mint?: Address;
  cursor?: string;
  limit?: number;
}

/**
 * Hash with tree info for proof requests.
 */
export interface HashWithTreeInfo {
  hash: BN254;
  stateTreeInfo: TreeInfo;
}

/**
 * Address with tree info for proof requests.
 */
export interface AddressWithTreeInfo {
  address: BN254;
  addressTreeInfo: TreeInfo;
}

/**
 * Signature metadata from compression indexer.
 */
export interface SignatureWithMetadata {
  blockTime: number;
  signature: string;
  slot: number;
}

/**
 * Token balance info.
 */
export interface TokenBalance {
  balance: bigint;
  mint: Address;
}

// =============================================================================
// RPC Client
// =============================================================================

/**
 * Light Protocol Photon RPC client.
 *
 * Provides methods for querying compressed accounts, requesting validity proofs,
 * and other indexer operations.
 */
export class PhotonRpc {
  readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(endpoint: string, headers?: Record<string, string>) {
    this.endpoint = endpoint;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    };
  }

  // ===========================================================================
  // Core RPC Methods
  // ===========================================================================

  /**
   * Make a JSON-RPC request to the Photon indexer.
   */
  private async request<T>(method: string, params: unknown): Promise<T> {
    const id = (++requestId).toString();
    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw createRpcError(RpcErrorCode.RPC_INVALID, "request", `HTTP ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as JsonRpcResponse<T>;

    if (json.error) {
      throw createRpcError(RpcErrorCode.RPC_INVALID, method, `${json.error.code}: ${json.error.message}`);
    }

    return json.result as T;
  }

  /**
   * Request with context wrapper.
   */
  private async requestWithContext<T>(method: string, params: unknown): Promise<WithContext<T>> {
    return this.request<WithContext<T>>(method, params);
  }

  // ===========================================================================
  // Health & Status
  // ===========================================================================

  /**
   * Get indexer health status.
   */
  async getIndexerHealth(): Promise<string> {
    return this.request<string>("getIndexerHealth", {});
  }

  /**
   * Get current indexer slot.
   */
  async getIndexerSlot(): Promise<number> {
    return this.request<number>("getIndexerSlot", {});
  }

  // ===========================================================================
  // Compressed Accounts
  // ===========================================================================

  /**
   * Get a single compressed account by address or hash.
   */
  async getCompressedAccount(addressOrHash: { address?: Address; hash?: BN254 }): Promise<CompressedAccount | null> {
    const method = versionedEndpoint("getCompressedAccount");
    const params: Record<string, string> = {};

    if (addressOrHash.address) {
      params.address = addressOrHash.address;
    }
    if (addressOrHash.hash !== undefined) {
      params.hash = encodeBN254(addressOrHash.hash);
    }

    const result = await this.requestWithContext<RawCompressedAccount | null>(method, params);

    if (!result.value) return null;
    return parseCompressedAccount(result.value);
  }

  /**
   * Get multiple compressed accounts by hashes.
   */
  async getMultipleCompressedAccounts(hashes: BN254[]): Promise<CompressedAccount[]> {
    const method = versionedEndpoint("getMultipleCompressedAccounts");
    const params = {
      hashes: hashes.map(encodeBN254),
    };

    const result = await this.requestWithContext<{ items: RawCompressedAccount[] }>(method, params);

    return result.value.items.map(parseCompressedAccount);
  }

  /**
   * Get compressed accounts by owner.
   *
   * NOTE: `filters` parameter is prepared for when Photon RPC supports memcmp filters.
   * Currently filters are passed through but may be ignored by the server.
   */
  async getCompressedAccountsByOwner(
    owner: Address,
    config?: GetCompressedAccountsByOwnerConfig,
  ): Promise<WithCursor<CompressedAccount[]>> {
    const method = versionedEndpoint("getCompressedAccountsByOwner");
    const params = {
      owner,
      cursor: config?.cursor,
      limit: config?.limit,
      // Pass through filters when Photon RPC adds support
      filters: config?.filters,
    };

    const result = await this.requestWithContext<{
      items: RawCompressedAccount[];
      cursor: string | null;
    }>(method, params);

    return {
      items: result.value.items.map(parseCompressedAccount),
      cursor: result.value.cursor,
    };
  }

  /**
   * Get compressed SOL balance by owner.
   */
  async getCompressedBalanceByOwner(owner: Address): Promise<bigint> {
    const method = versionedEndpoint("getCompressedBalanceByOwner");
    const result = await this.requestWithContext<string>(method, { owner });
    return BigInt(result.value);
  }

  // ===========================================================================
  // Merkle Proofs
  // ===========================================================================

  /**
   * Get merkle proof for a compressed account.
   */
  async getCompressedAccountProof(hash: BN254): Promise<MerkleContextWithProof> {
    const method = versionedEndpoint("getCompressedAccountProof");
    const params = { hash: encodeBN254(hash) };

    const result = await this.requestWithContext<RawMerkleProof>(method, params);
    return parseMerkleProof(result.value);
  }

  /**
   * Get merkle proofs for multiple compressed accounts.
   */
  async getMultipleCompressedAccountProofs(hashes: BN254[]): Promise<MerkleContextWithProof[]> {
    const method = versionedEndpoint("getMultipleCompressedAccountProofs");
    const params = { hashes: hashes.map(encodeBN254) };

    const result = await this.requestWithContext<RawMerkleProof[]>(method, params);
    return result.value.map(parseMerkleProof);
  }

  // ===========================================================================
  // Validity Proofs
  // ===========================================================================

  /**
   * Get validity proof for compressed accounts and/or new addresses.
   *
   * This is the main method for obtaining ZK proofs needed to use
   * compressed accounts in transactions.
   *
   * Note: The Photon API expects:
   * - `hashes`: array of base58 strings (account hashes)
   * - `newAddressesWithTrees`: array of { address: string, tree: string }
   */
  async getValidityProof(
    hashes: HashWithTreeInfo[],
    newAddresses: AddressWithTreeInfo[],
  ): Promise<ValidityProofWithContext> {
    const method = versionedEndpoint("getValidityProof");
    // Format params according to Photon API spec:
    // - hashes: just base58 strings (not objects)
    // - newAddressesWithTrees: objects with address and tree only (no queue)
    const params = {
      hashes: hashes.map((h) => encodeBN254(h.hash)),
      newAddressesWithTrees: newAddresses.map((a) => ({
        address: encodeBN254(a.address),
        tree: a.addressTreeInfo.tree,
      })),
    };

    const result = await this.requestWithContext<RawValidityProof>(method, params);
    return parseValidityProof(result.value);
  }

  // ===========================================================================
  // Token Accounts
  // ===========================================================================

  /**
   * Get compressed token accounts by owner.
   */
  async getCompressedTokenAccountsByOwner(
    owner: Address,
    config?: GetCompressedTokenAccountsConfig,
  ): Promise<WithCursor<ParsedTokenAccount[]>> {
    const method = versionedEndpoint("getCompressedTokenAccountsByOwner");
    const params = {
      owner,
      mint: config?.mint,
      cursor: config?.cursor,
      limit: config?.limit,
    };

    const result = await this.requestWithContext<{
      items: RawTokenAccount[];
      cursor: string | null;
    }>(method, params);

    return {
      items: result.value.items.map(parseTokenAccount),
      cursor: result.value.cursor,
    };
  }

  /**
   * Get compressed token balances by owner.
   */
  async getCompressedTokenBalancesByOwner(
    owner: Address,
    config?: GetCompressedTokenAccountsConfig,
  ): Promise<WithCursor<TokenBalance[]>> {
    const method = versionedEndpoint("getCompressedTokenBalancesByOwner");
    const params = {
      owner,
      mint: config?.mint,
      cursor: config?.cursor,
      limit: config?.limit,
    };

    const result = await this.requestWithContext<{
      items: Array<{ balance: string; mint: string }>;
      cursor: string | null;
    }>(method, params);

    return {
      items: result.value.items.map((item) => ({
        balance: BigInt(item.balance),
        mint: address(item.mint),
      })),
      cursor: result.value.cursor,
    };
  }

  // ===========================================================================
  // Signatures
  // ===========================================================================

  /**
   * Get compression signatures for an account hash.
   */
  async getCompressionSignaturesForAccount(hash: BN254): Promise<SignatureWithMetadata[]> {
    const method = "getCompressionSignaturesForAccount";
    const params = { hash: encodeBN254(hash) };

    const result = await this.requestWithContext<{
      items: SignatureWithMetadata[];
    }>(method, params);

    return result.value.items;
  }

  /**
   * Get compression signatures for an address.
   */
  async getCompressionSignaturesForAddress(
    addr: Address,
    options?: PaginatedOptions,
  ): Promise<WithCursor<SignatureWithMetadata[]>> {
    const method = "getCompressionSignaturesForAddress";
    const params = {
      address: addr,
      cursor: options?.cursor,
      limit: options?.limit,
    };

    const result = await this.requestWithContext<{
      items: SignatureWithMetadata[];
      cursor: string | null;
    }>(method, params);

    return {
      items: result.value.items,
      cursor: result.value.cursor,
    };
  }

  /**
   * Get compression signatures for an owner.
   */
  async getCompressionSignaturesForOwner(
    owner: Address,
    options?: PaginatedOptions,
  ): Promise<WithCursor<SignatureWithMetadata[]>> {
    const method = "getCompressionSignaturesForOwner";
    const params = {
      owner,
      cursor: options?.cursor,
      limit: options?.limit,
    };

    const result = await this.requestWithContext<{
      items: SignatureWithMetadata[];
      cursor: string | null;
    }>(method, params);

    return {
      items: result.value.items,
      cursor: result.value.cursor,
    };
  }

  /**
   * Get latest non-voting signatures (compression transactions).
   */
  async getLatestCompressionSignatures(cursor?: string, limit?: number): Promise<WithCursor<SignatureWithMetadata[]>> {
    const method = "getLatestCompressionSignatures";
    const params = { cursor, limit };

    const result = await this.requestWithContext<{
      items: SignatureWithMetadata[];
      cursor: string | null;
    }>(method, params);

    return {
      items: result.value.items,
      cursor: result.value.cursor,
    };
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Encode BN254 to base58 string for RPC params.
 */
function encodeBN254(value: BN254): string {
  // Convert to 32-byte big-endian and base58 encode
  const bytes = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  // Use bs58 to encode to base58 string
  return bs58.encode(bytes);
}

// =============================================================================
// Raw Response Types (from Photon API)
// =============================================================================

interface RawCompressedAccount {
  address: string | null;
  hash: string;
  data: {
    data: string;
    dataHash: string;
    discriminator: string | number; // u64 as string or number from Photon API
  } | null;
  lamports: string | number; // Can be string or number from API
  owner: string;
  leafIndex: number;
  tree?: string; // V1
  merkleContext?: {
    tree: string;
    queue: string;
    treeType: number;
    cpiContext?: string | null;
    nextTreeContext?: {
      tree: string;
      queue: string;
      treeType: number;
      cpiContext?: string | null;
    } | null;
  }; // V2
  proveByIndex?: boolean;
  seq?: string | number | null; // Can be string or number
  slotCreated: string | number; // Can be string or number
}

interface RawMerkleProof {
  hash: string;
  leafIndex: number;
  merkleTree?: string; // V1
  treeContext?: {
    tree: string;
    queue: string;
    treeType: number;
    cpiContext?: string | null;
    nextTreeContext?: {
      tree: string;
      queue: string;
      treeType: number;
      cpiContext?: string | null;
    } | null;
  }; // V2
  proof: string[];
  root: string;
  rootSeq: number;
  proveByIndex?: boolean;
}

interface RawValidityProof {
  compressedProof: {
    a: number[];
    b: number[];
    c: number[];
  } | null;
  roots: string[];
  rootIndices: number[];
  leafIndices: number[];
  leaves: string[];
  merkleTrees?: string[]; // V1
  accounts?: Array<{
    hash: string;
    root: string;
    rootIndex: { rootIndex: number; proveByIndex: boolean };
    merkleContext: {
      tree: string;
      queue: string;
      treeType: number;
      cpiContext?: string | null;
    };
    leafIndex: number;
  }>; // V2 - state tree proofs
  addresses?: Array<{
    address: string;
    root: string;
    rootIndex: number; // Note: plain number for addresses, not object
    merkleContext: {
      tree: string;
      queue: string;
      treeType: number;
      cpiContext?: string | null;
    };
  }>; // V2 - address tree proofs (non-inclusion)
}

interface RawTokenAccount {
  account: RawCompressedAccount;
  tokenData: {
    mint: string;
    owner: string;
    amount: string;
    delegate: string | null;
    state: string;
  };
}

// =============================================================================
// Parsing Functions
// =============================================================================

function parseCompressedAccount(raw: RawCompressedAccount): CompressedAccount {
  const treeInfo = parseTreeInfo(raw);

  return {
    owner: address(raw.owner),
    lamports: BigInt(raw.lamports),
    address: raw.address ? base58ToBytes(raw.address) : null,
    data: raw.data
      ? {
          discriminator: discriminatorToBytes(raw.data.discriminator),
          data: base64ToBytes(raw.data.data),
          dataHash: base58ToBytesLE(raw.data.dataHash, 32),
        }
      : null,
    treeInfo,
    hash: createBN254(raw.hash, "base58"),
    leafIndex: raw.leafIndex,
    proveByIndex: raw.proveByIndex ?? false,
    readOnly: false,
  };
}

function parseTreeInfo(raw: RawCompressedAccount | RawMerkleProof): TreeInfo {
  if (featureFlags.isV2() && "merkleContext" in raw && raw.merkleContext) {
    const ctx = raw.merkleContext;
    return {
      tree: address(ctx.tree),
      queue: address(ctx.queue),
      treeType: ctx.treeType as TreeType,
      cpiContext: ctx.cpiContext ? address(ctx.cpiContext) : undefined,
      nextTreeInfo: ctx.nextTreeContext
        ? {
            tree: address(ctx.nextTreeContext.tree),
            queue: address(ctx.nextTreeContext.queue),
            treeType: ctx.nextTreeContext.treeType as TreeType,
            cpiContext: ctx.nextTreeContext.cpiContext ? address(ctx.nextTreeContext.cpiContext) : undefined,
            nextTreeInfo: null,
          }
        : null,
    };
  }

  if ("treeContext" in raw && raw.treeContext) {
    const ctx = raw.treeContext;
    return {
      tree: address(ctx.tree),
      queue: address(ctx.queue),
      treeType: ctx.treeType as TreeType,
      cpiContext: ctx.cpiContext ? address(ctx.cpiContext) : undefined,
      nextTreeInfo: ctx.nextTreeContext
        ? {
            tree: address(ctx.nextTreeContext.tree),
            queue: address(ctx.nextTreeContext.queue),
            treeType: ctx.nextTreeContext.treeType as TreeType,
            cpiContext: ctx.nextTreeContext.cpiContext ? address(ctx.nextTreeContext.cpiContext) : undefined,
            nextTreeInfo: null,
          }
        : null,
    };
  }

  // V1 fallback
  const tree =
    "tree" in raw && raw.tree ? raw.tree : "merkleTree" in raw ? ((raw as RawMerkleProof).merkleTree ?? "") : "";
  return {
    tree: address(tree),
    queue: address(tree), // V1 doesn't have separate queue in response
    treeType: 1 as TreeType, // StateV1
    nextTreeInfo: null,
  };
}

function parseMerkleProof(raw: RawMerkleProof): MerkleContextWithProof {
  const treeInfo = parseTreeInfo(raw);

  return {
    treeInfo,
    hash: createBN254(raw.hash, "base58"),
    leafIndex: raw.leafIndex,
    proveByIndex: raw.proveByIndex ?? false,
    merkleProof: raw.proof.map((p) => createBN254(p, "base58")),
    rootIndex: raw.rootSeq,
    root: createBN254(raw.root, "base58"),
  };
}

function parseValidityProof(raw: RawValidityProof): ValidityProofWithContext {
  const proof: ValidityProof | null = raw.compressedProof
    ? {
        a: new Uint8Array(raw.compressedProof.a),
        b: new Uint8Array(raw.compressedProof.b),
        c: new Uint8Array(raw.compressedProof.c),
      }
    : null;

  // Parse based on V1 vs V2 response format
  if (raw.accounts || raw.addresses) {
    // V2 format - handle both accounts (state proofs) and addresses (address proofs)
    const accounts = raw.accounts ?? [];
    const addresses = raw.addresses ?? [];

    return {
      compressedProof: proof,
      roots: accounts
        .map((a) => createBN254(a.root, "base58"))
        .concat(addresses.map((a) => createBN254(a.root, "base58"))),
      rootIndices: accounts.map((a) => a.rootIndex.rootIndex).concat(addresses.map((a) => a.rootIndex)), // Plain number for addresses
      leafIndices: accounts.map((a) => a.leafIndex).concat(addresses.map(() => 0)), // Always 0 for addresses
      leaves: accounts
        .map((a) => createBN254(a.hash, "base58"))
        .concat(addresses.map((a) => createBN254(a.address, "base58"))),
      treeInfos: accounts
        .map((a) => ({
          tree: address(a.merkleContext.tree),
          queue: address(a.merkleContext.queue),
          treeType: a.merkleContext.treeType as TreeType,
          cpiContext: a.merkleContext.cpiContext ? address(a.merkleContext.cpiContext) : undefined,
          nextTreeInfo: null,
        }))
        .concat(
          addresses.map((a) => ({
            tree: address(a.merkleContext.tree),
            queue: address(a.merkleContext.queue),
            treeType: a.merkleContext.treeType as TreeType,
            cpiContext: a.merkleContext.cpiContext ? address(a.merkleContext.cpiContext) : undefined,
            nextTreeInfo: null,
          })),
        ),
      proveByIndices: accounts.map((a) => a.rootIndex.proveByIndex).concat(addresses.map(() => false)), // Always false for addresses
    };
  }

  // V1 format
  return {
    compressedProof: proof,
    roots: raw.roots.map((r) => createBN254(r, "base58")),
    rootIndices: raw.rootIndices,
    leafIndices: raw.leafIndices,
    leaves: raw.leaves.map((l) => createBN254(l, "base58")),
    treeInfos: (raw.merkleTrees ?? []).map((t) => ({
      tree: address(t),
      queue: address(t),
      treeType: 1 as TreeType,
      nextTreeInfo: null,
    })),
    proveByIndices: raw.leafIndices.map(() => false),
  };
}

function parseTokenAccount(raw: RawTokenAccount): ParsedTokenAccount {
  return {
    compressedAccount: parseCompressedAccount(raw.account),
    parsed: {
      mint: address(raw.tokenData.mint),
      owner: address(raw.tokenData.owner),
      amount: BigInt(raw.tokenData.amount),
      delegate: raw.tokenData.delegate ? address(raw.tokenData.delegate) : null,
      state: ["uninitialized", "initialized", "frozen"].indexOf(raw.tokenData.state),
      tlv: null,
    },
  };
}

// =============================================================================
// Encoding Utilities
// =============================================================================

function base58ToBytes(value: string): Uint8Array {
  return bs58.decode(value);
}

function base64ToBytes(value: string): Uint8Array {
  // atob is available in all modern runtimes: browsers, Node.js 16+,
  // Cloudflare Workers, Deno, and Bun
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert u64 discriminator (as string or number) to 8-byte little-endian array.
 * Photon API returns discriminator as a decimal string/number representing a u64.
 */
function discriminatorToBytes(value: string | number): Uint8Array {
  const bigintValue = typeof value === "string" ? BigInt(value) : BigInt(value);
  const bytes = new Uint8Array(8);
  let v = bigintValue;
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

/**
 * Convert base58 string to little-endian byte array.
 * Used for dataHash which Light Protocol stores as little-endian.
 * Light Protocol: base58 → BN → .toArray('le', size)
 */
function base58ToBytesLE(value: string, size: number): Uint8Array {
  // Decode base58 to get the raw bytes
  const decoded = bs58.decode(value);
  // Convert to bigint for proper LE conversion
  let bigintValue = 0n;
  for (let i = 0; i < decoded.length; i++) {
    bigintValue = (bigintValue << 8n) | BigInt(decoded[i]);
  }
  // Convert bigint to little-endian bytes
  const bytes = new Uint8Array(size);
  let v = bigintValue;
  for (let i = 0; i < size; i++) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Photon RPC client.
 *
 * @param endpoint - Photon indexer URL (e.g., "https://zk-testnet.helius.dev:8784")
 * @param headers - Optional additional headers
 * @returns PhotonRpc instance
 *
 * @example
 * ```typescript
 * import { createPhotonRpc } from '@cascade-fyi/compression-kit';
 *
 * const rpc = createPhotonRpc('https://mainnet.helius-rpc.com/?api-key=YOUR_KEY');
 * const accounts = await rpc.getCompressedAccountsByOwner(ownerAddress);
 * ```
 */
export function createPhotonRpc(endpoint: string, headers?: Record<string, string>): PhotonRpc {
  return new PhotonRpc(endpoint, headers);
}
