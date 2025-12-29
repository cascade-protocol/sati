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
 * Options for getCompressedAccountsByOwner.
 */
export interface GetCompressedAccountsByOwnerConfig {
  cursor?: string;
  limit?: number;
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
   */
  async getValidityProof(
    hashes: HashWithTreeInfo[],
    newAddresses: AddressWithTreeInfo[],
  ): Promise<ValidityProofWithContext> {
    const method = versionedEndpoint("getValidityProof");
    const params = {
      hashes: hashes.map((h) => ({
        hash: encodeBN254(h.hash),
        tree: h.stateTreeInfo.tree,
        queue: h.stateTreeInfo.queue,
      })),
      newAddresses: newAddresses.map((a) => ({
        address: encodeBN254(a.address),
        tree: a.addressTreeInfo.tree,
        queue: a.addressTreeInfo.queue,
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
    discriminator: string;
  } | null;
  lamports: string;
  owner: string;
  leafIndex: number;
  tree?: string; // V1
  merkleContext?: {
    tree: string;
    queue: string;
    treeType: number;
    cpiContext?: string | null;
  }; // V2
  proveByIndex?: boolean;
  seq?: string | null;
  slotCreated: string;
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
    };
    leafIndex: number;
  }>; // V2
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
          discriminator: hexToBytes(raw.data.discriminator),
          data: base64ToBytes(raw.data.data),
          dataHash: base58ToBytes(raw.data.dataHash),
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
      nextTreeInfo: null,
    };
  }

  if ("treeContext" in raw && raw.treeContext) {
    const ctx = raw.treeContext;
    return {
      tree: address(ctx.tree),
      queue: address(ctx.queue),
      treeType: ctx.treeType as TreeType,
      cpiContext: ctx.cpiContext ? address(ctx.cpiContext) : undefined,
      nextTreeInfo: null,
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
  if (raw.accounts) {
    // V2 format
    return {
      compressedProof: proof,
      roots: raw.accounts.map((a) => createBN254(a.root, "base58")),
      rootIndices: raw.accounts.map((a) => a.rootIndex.rootIndex),
      leafIndices: raw.accounts.map((a) => a.leafIndex),
      leaves: raw.accounts.map((a) => createBN254(a.hash, "base58")),
      treeInfos: raw.accounts.map((a) => ({
        tree: address(a.merkleContext.tree),
        queue: address(a.merkleContext.queue),
        treeType: a.merkleContext.treeType as TreeType,
        nextTreeInfo: null,
      })),
      proveByIndices: raw.accounts.map((a) => a.rootIndex.proveByIndex),
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
      state: raw.tokenData.state === "initialized" ? 1 : 0,
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

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
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
