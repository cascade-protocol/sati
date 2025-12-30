/**
 * SATI Client - High-Level SDK Interface
 *
 * Provides a convenient wrapper around the generated Codama client
 * for the Solana Agent Trust Infrastructure.
 *
 * Features:
 * - Agent registration via Token-2022 NFT minting
 * - Compressed attestations via Light Protocol (Feedback, Validation)
 * - Regular attestations via SAS (ReputationScore)
 * - Ed25519 signature building for blind feedback model
 *
 * @see https://github.com/cascade-protocol/sati
 */

import {
  pipe,
  generateKeyPairSigner,
  signTransactionMessageWithSigners,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  compileTransaction,
  getSignatureFromTransaction,
  getAddressEncoder,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  sendAndConfirmTransactionFactory,
  address,
  type Address,
  type KeyPairSigner,
  type AddressesByLookupTableAddress,
  type Base58EncodedBytes,
} from "@solana/kit";

import {
  fetchMint as fetchToken2022Mint,
  fetchToken as fetchToken2022Token,
  getTransferInstruction,
  getUpdateTokenMetadataUpdateAuthorityInstruction,
  getUpdateTokenMetadataFieldInstruction,
  tokenMetadataField,
  type Extension,
} from "@solana-program/token-2022";

import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";

import {
  getRegisterAgentInstructionAsync,
  getRegisterSchemaConfigInstructionAsync,
  getCreateAttestationInstructionAsync,
  getCloseAttestationInstructionAsync,
  getCloseRegularAttestationInstructionAsync,
  getCreateRegularAttestationInstructionAsync,
  getLinkEvmAddressInstruction,
  fetchRegistryConfig,
  fetchSchemaConfig,
  SATI_PROGRAM_ADDRESS,
  type SignatureData as GeneratedSignatureData,
  type ValidityProofArgs,
  type PackedAddressTreeInfoArgs,
  type CompressedAccountMetaArgs,
} from "./generated";

import {
  findAssociatedTokenAddress,
  findRegistryConfigPda,
  findSchemaConfigPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "./helpers";

import {
  computeInteractionHash,
  computeFeedbackHash,
  computeValidationHash,
  computeReputationHash,
  computeAttestationNonce,
  computeReputationNonce,
  computeEvmLinkHash,
  type Outcome,
} from "./hashes";

import {
  DataType,
  ContentType,
  ValidationType,
  type SignatureMode,
  type StorageType,
  serializeFeedback,
  serializeValidation,
  serializeReputationScore,
  deserializeReputationScore,
  SAS_HEADER_SIZE,
  type FeedbackData,
  type ValidationData,
  type ReputationScoreData,
} from "./schemas";

import {
  type SATILightClient as LightClient,
  createSATILightClient,
  type ParsedAttestation,
  type AttestationFilter,
} from "./compression";

// SAS imports are dynamically loaded in setupSASSchemas() to avoid bundling sas-lib
// in browser/worker environments that don't need it
type SASSchemaDefinition = {
  name: string;
  description: string;
  layout: number[];
  fieldNames: string[];
};

import { deriveReputationAttestationPda } from "./sas-pdas";

import { createBatchEd25519Instruction } from "./ed25519";

import type {
  SATIClientOptions,
  AgentIdentity,
  RegisterAgentResult,
  UpdateAgentMetadataParams,
  UpdateAgentMetadataResult,
  CloseCompressedAttestationParams,
  CloseRegularAttestationParams,
  CloseAttestationResult,
  SignatureVerificationResult,
  SASDeploymentResult,
  LinkEvmAddressResult,
} from "./types";

import nacl from "tweetnacl";
import bs58 from "bs58";

// Re-export enums and types
export { Outcome } from "./hashes";
export {
  DataType,
  ContentType,
  ValidationType,
  SignatureMode,
  StorageType,
} from "./schemas";

// Default RPC URLs
const RPC_URLS = {
  mainnet: "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
} as const;

// Default WebSocket URLs
const WS_URLS = {
  mainnet: "wss://api.mainnet-beta.solana.com",
  devnet: "wss://api.devnet.solana.com",
  localnet: "ws://127.0.0.1:8900",
} as const;

// ============================================================
// TYPES
// ============================================================

/**
 * Type for a 64-byte Ed25519 signature
 */
type Signature64 = Uint8Array & { length: 64 };

/**
 * Type helper for signed transactions with blockhash lifetime.
 */
type SignedBlockhashTransaction = Awaited<ReturnType<typeof signTransactionMessageWithSigners>> & {
  lifetimeConstraint: { lastValidBlockHeight: bigint; blockhash: string };
};

/**
 * Attestation creation result
 */
export interface AttestationResult {
  /** Attestation address (compressed account address or SAS PDA) */
  address: Address;
  /** Transaction signature */
  signature: string;
}

/**
 * Built transaction ready for signing
 */
export interface BuiltTransaction {
  /** Attestation address that will be created */
  attestationAddress: Address;
  /** Base64-encoded transaction message bytes */
  messageBytes: string;
  /** Addresses that need to sign (first one is fee payer) */
  signers: Address[];
  /** Blockhash used for the transaction */
  blockhash: string;
  /** Last valid block height for the transaction */
  lastValidBlockHeight: bigint;
}

/**
 * Signature data with pubkey for attestation creation
 */
export interface SignatureInput {
  /** Public key that signed */
  pubkey: Address;
  /** 64-byte Ed25519 signature */
  signature: Uint8Array;
}

/**
 * Parameters for creating a Feedback attestation
 */
export interface CreateFeedbackParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** SAS schema address for this feedback type */
  sasSchema: Address;
  /** Task reference (CAIP-220 tx hash or arbitrary ID) */
  taskRef: Uint8Array;
  /** Agent's token account */
  tokenAccount: Address;
  /** Client (feedback giver) */
  counterparty: Address;
  /** Hash of request/interaction data */
  dataHash: Uint8Array;
  /** Content format */
  contentType?: ContentType;
  /** Feedback outcome */
  outcome: Outcome;
  /** Primary tag (max 32 chars) */
  tag1?: string;
  /** Secondary tag (max 32 chars) */
  tag2?: string;
  /** Variable-length content */
  content?: Uint8Array;
  /** Agent's signature (blind) */
  agentSignature: SignatureInput;
  /** Counterparty's signature (with outcome) - optional for SingleSigner schemas */
  counterpartySignature?: SignatureInput;
  /** Optional address lookup table for transaction compression */
  lookupTableAddress?: Address;
}

/**
 * Parameters for building a Feedback transaction (without signing/sending)
 */
export interface BuildFeedbackParams {
  /** Fee payer address (will sign in browser) */
  payer: Address;
  /** SAS schema address for this feedback type */
  sasSchema: Address;
  /** Task reference (CAIP-220 tx hash or arbitrary ID) */
  taskRef: Uint8Array;
  /** Agent's token account */
  tokenAccount: Address;
  /** Client (feedback giver) */
  counterparty: Address;
  /** Hash of request/interaction data */
  dataHash: Uint8Array;
  /** Content format */
  contentType?: ContentType;
  /** Feedback outcome */
  outcome: Outcome;
  /** Primary tag (max 32 chars) */
  tag1?: string;
  /** Secondary tag (max 32 chars) */
  tag2?: string;
  /** Variable-length content */
  content?: Uint8Array;
  /** Agent's signature (blind) */
  agentSignature: SignatureInput;
  /** Counterparty's signature (with outcome) - optional for SingleSigner schemas */
  counterpartySignature?: SignatureInput;
  /** Optional address lookup table for transaction compression */
  lookupTableAddress?: Address;
}

/**
 * Parameters for creating a Validation attestation
 */
export interface CreateValidationParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** SAS schema address */
  sasSchema: Address;
  /** Task reference */
  taskRef: Uint8Array;
  /** Agent's token account */
  tokenAccount: Address;
  /** Validator address */
  counterparty: Address;
  /** Hash of work being validated */
  dataHash: Uint8Array;
  /** Content format */
  contentType?: ContentType;
  /** Validation method type */
  validationType?: ValidationType;
  /** Validation response score (0-100) */
  response: number;
  /** Variable-length content (validation report) */
  content?: Uint8Array;
  /** Agent's signature (blind) */
  agentSignature: SignatureInput;
  /** Validator's signature (with response) */
  validatorSignature: SignatureInput;
  /** Optional address lookup table for transaction compression */
  lookupTableAddress?: Address;
}

/**
 * Parameters for creating a ReputationScore attestation
 */
export interface CreateReputationScoreParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** Provider (reputation scorer) address */
  provider: Address;
  /** Provider's signature over the reputation hash (see computeReputationHash) */
  providerSignature: Uint8Array;
  /** SAS schema address */
  sasSchema: Address;
  /** SATI credential address in SAS */
  satiCredential: Address;
  /** Agent's token account being scored */
  tokenAccount: Address;
  /** Reputation score (0-100) */
  score: number;
  /** Content format */
  contentType?: ContentType;
  /** Methodology/details content */
  content?: Uint8Array;
  /** Expiry timestamp (0 = never expires) */
  expiry?: number;
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert an Address to Base58EncodedBytes for RPC memcmp filters.
 */
function addressToBase58Bytes(addr: Address): Base58EncodedBytes {
  return addr as unknown as Base58EncodedBytes;
}

/**
 * Validate and cast a signature to the expected 64-byte type.
 */
function assertSignature64(sig: Uint8Array): Signature64 {
  if (sig.length !== 64) {
    throw new Error(`Invalid signature length: expected 64 bytes, got ${sig.length}`);
  }
  return sig as Signature64;
}

/**
 * Helper to unwrap Option type from @solana/kit
 */
function unwrapOption<T>(option: { __option: "Some"; value: T } | { __option: "None" }): T | null {
  if (option.__option === "Some") {
    return option.value;
  }
  return null;
}

/**
 * Convert Uint8Array to base58 string
 */
function uint8ArrayToBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

// ============================================================
// SATI CLIENT
// ============================================================

/**
 * Sati Client
 *
 * High-level interface for interacting with SATI protocol.
 *
 * @example
 * ```typescript
 * const sati = new Sati({ network: "devnet", photonRpcUrl: "..." });
 *
 * // Register an agent
 * const { mint, memberNumber } = await sati.registerAgent({
 *   payer,
 *   name: "MyAgent",
 *   uri: "ipfs://QmRegistrationFile",
 * });
 *
 * // Load an agent
 * const agent = await sati.loadAgent(mint);
 *
 * // Create feedback attestation
 * const result = await sati.createFeedback({
 *   payer,
 *   sasSchema,
 *   taskRef,
 *   tokenAccount,
 *   counterparty,
 *   outcome: Outcome.Positive,
 *   agentSignature,
 *   counterpartySignature,
 * });
 *
 * // List feedbacks
 * const feedbacks = await sati.listFeedbacks({ tokenAccount });
 * ```
 */
export class Sati {
  // Internal state
  private rpc: ReturnType<typeof createSolanaRpc>;
  private rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
  private lightClient: LightClient | null = null;
  private photonRpcUrl?: string;

  /** Network configuration */
  readonly network: "mainnet" | "devnet" | "localnet";

  constructor(options: SATIClientOptions) {
    this.network = options.network;
    const rpcUrl = options.rpcUrl ?? RPC_URLS[options.network];
    const wsUrl = options.wsUrl ?? WS_URLS[options.network];

    this.rpc = createSolanaRpc(rpcUrl);
    this.rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
    this.sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc: this.rpc,
      rpcSubscriptions: this.rpcSubscriptions,
    });

    // Store Photon URL for lazy initialization
    this.photonRpcUrl = options.photonRpcUrl;
  }

  // ============================================================
  // INTERNAL ACCESSORS
  // ============================================================

  /** @internal */
  getRpc(): ReturnType<typeof createSolanaRpc> {
    return this.rpc;
  }

  /** @internal */
  getSendAndConfirm(): ReturnType<typeof sendAndConfirmTransactionFactory> {
    return this.sendAndConfirm;
  }

  /** @internal */
  async getLightClient(): Promise<LightClient> {
    if (this.lightClient) {
      return this.lightClient;
    }
    if (!this.photonRpcUrl) {
      throw new Error("Photon RPC URL is required for Light Protocol operations");
    }
    this.lightClient = createSATILightClient(this.photonRpcUrl);
    return this.lightClient;
  }

  /** @internal */
  setLightClient(client: LightClient): void {
    this.lightClient = client;
  }

  // ============================================================
  // REGISTRY (Agent Management)
  // ============================================================

  /**
   * Register a new agent identity
   *
   * Creates a Token-2022 NFT with metadata and group membership atomically.
   */
  async registerAgent(params: {
    /** Payer for transaction and rent */
    payer: KeyPairSigner;
    /** Agent name (max 32 bytes) */
    name: string;
    /** Registration file URI (max 200 bytes) */
    uri: string;
    /** Additional metadata key-value pairs (max 10 entries) */
    additionalMetadata?: Array<{ key: string; value: string }>;
    /** Make agent non-transferable (soulbound) */
    nonTransferable?: boolean;
    /** Owner of the agent NFT (default: payer) */
    owner?: Address;
  }): Promise<RegisterAgentResult> {
    const { payer, name, uri, additionalMetadata, nonTransferable = false, owner } = params;

    // Generate new mint keypair
    const agentMint = await generateKeyPairSigner();

    // Fetch registry config to get the actual group mint
    const [registryConfigAddress] = await findRegistryConfigPda();
    const registryConfig = await fetchRegistryConfig(this.rpc, registryConfigAddress);
    const groupMint = registryConfig.data.groupMint;
    const ownerAddress = owner ?? payer.address;
    const [agentTokenAccount] = await findAssociatedTokenAddress(agentMint.address, ownerAddress);

    // Build instruction
    const registerIx = await getRegisterAgentInstructionAsync({
      payer,
      owner: ownerAddress,
      groupMint,
      agentMint,
      agentTokenAccount,
      name,
      symbol: "", // Empty - vestigial field from fungible tokens
      uri,
      additionalMetadata: additionalMetadata ?? null,
      nonTransferable,
    });

    // Build and send transaction
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(registerIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    // Re-fetch registry config to get the updated member number
    const updatedRegistryConfig = await fetchRegistryConfig(this.rpc, registryConfigAddress);
    const memberNumber = updatedRegistryConfig.data.totalAgents;

    const signature = getSignatureFromTransaction(signedTx);

    return {
      mint: agentMint.address,
      memberNumber,
      signature: signature.toString(),
    };
  }

  /**
   * Load agent identity from mint address
   */
  async loadAgent(mint: Address): Promise<AgentIdentity | null> {
    try {
      const mintAccount = await fetchToken2022Mint(this.rpc, mint);

      const extensions = unwrapOption(
        mintAccount.data.extensions as { __option: "Some"; value: Extension[] } | { __option: "None" },
      );

      if (!extensions) {
        return null;
      }

      const metadataExt = extensions.find(
        (ext: Extension): ext is Extension & { __kind: "TokenMetadata" } => ext.__kind === "TokenMetadata",
      );

      if (!metadataExt) {
        return null;
      }

      const groupMemberExt = extensions.find(
        (ext: Extension): ext is Extension & { __kind: "TokenGroupMember" } => ext.__kind === "TokenGroupMember",
      );

      const nonTransferableExt = extensions.find((ext: Extension) => ext.__kind === "NonTransferable");

      const owner = await this.getAgentOwner(mint);

      const additionalMetadata: Record<string, string> = {};
      if (metadataExt.additionalMetadata) {
        for (const [key, value] of metadataExt.additionalMetadata) {
          additionalMetadata[key] = value;
        }
      }

      return {
        mint,
        owner,
        name: metadataExt.name,
        uri: metadataExt.uri,
        memberNumber: groupMemberExt?.memberNumber ?? 0n,
        additionalMetadata,
        nonTransferable: !!nonTransferableExt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("could not find account") || message.includes("Account not found")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Transfer agent to new owner
   */
  async transferAgent(params: {
    payer: KeyPairSigner;
    owner: KeyPairSigner;
    mint: Address;
    newOwner: Address;
  }): Promise<{ signature: string }> {
    const { payer, owner, mint, newOwner } = params;

    const [sourceAta] = await findAssociatedTokenAddress(mint, owner.address);
    const [destAta] = await findAssociatedTokenAddress(mint, newOwner);

    const transferIx = getTransferInstruction({
      source: sourceAta,
      destination: destAta,
      authority: owner,
      amount: 1n,
    });

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(transferIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);
    return { signature: signature.toString() };
  }

  /**
   * Transfer agent with metadata update authority
   */
  async transferAgentWithAuthority(params: {
    payer: KeyPairSigner;
    owner: KeyPairSigner;
    mint: Address;
    newOwner: Address;
  }): Promise<{ signature: string }> {
    const { payer, owner, mint, newOwner } = params;

    const [sourceAta] = await findAssociatedTokenAddress(mint, owner.address);
    const [destAta] = await findAssociatedTokenAddress(mint, newOwner);

    const transferIx = getTransferInstruction({
      source: sourceAta,
      destination: destAta,
      authority: owner,
      amount: 1n,
    });

    const updateAuthorityIx = getUpdateTokenMetadataUpdateAuthorityInstruction({
      metadata: mint,
      updateAuthority: owner,
      newUpdateAuthority: newOwner,
    });

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions([transferIx, updateAuthorityIx], msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);
    return { signature: signature.toString() };
  }

  /**
   * Get current owner of an agent
   */
  async getAgentOwner(mint: Address): Promise<Address> {
    const response = await this.rpc.getTokenLargestAccounts(mint, { commitment: "confirmed" }).send();

    if (!response.value || response.value.length === 0) {
      throw new Error(`No token accounts found for mint ${mint}`);
    }

    const holderAccount = response.value.find((acc: { address: string; amount: string }) => BigInt(acc.amount) > 0n);

    if (!holderAccount) {
      throw new Error(`No holder found for agent ${mint}`);
    }

    const tokenAccount = await fetchToken2022Token(this.rpc, address(holderAccount.address));

    return tokenAccount.data.owner;
  }

  /**
   * Get registry statistics
   */
  async getRegistryStats(): Promise<{
    groupMint: Address;
    authority: Address;
    totalAgents: bigint;
    isImmutable: boolean;
  }> {
    const [registryConfigAddress] = await findRegistryConfigPda();
    const registryConfig = await fetchRegistryConfig(this.rpc, registryConfigAddress);

    const isImmutable = registryConfig.data.authority === "11111111111111111111111111111111";

    return {
      groupMint: registryConfig.data.groupMint,
      authority: registryConfig.data.authority,
      totalAgents: registryConfig.data.totalAgents,
      isImmutable,
    };
  }

  /**
   * List agents owned by a specific wallet
   */
  async listAgentsByOwner(owner: Address): Promise<AgentIdentity[]> {
    const stats = await this.getRegistryStats();
    const groupMint = stats.groupMint;

    const tokenAccountsResult = await this.rpc
      .getTokenAccountsByOwner(
        owner,
        { programId: address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb") },
        { encoding: "jsonParsed" },
      )
      .send();

    const potentialMints: Address[] = [];

    for (const { account } of tokenAccountsResult.value) {
      const parsed = account.data as {
        parsed?: {
          info?: {
            mint?: string;
            tokenAmount?: { amount: string; decimals: number };
          };
        };
      };

      const info = parsed.parsed?.info;
      if (!info?.mint || !info?.tokenAmount) continue;

      if (info.tokenAmount.amount !== "1" || info.tokenAmount.decimals !== 0) {
        continue;
      }

      potentialMints.push(info.mint as Address);
    }

    if (potentialMints.length === 0) {
      return [];
    }

    const mintAccountsResult = await this.rpc.getMultipleAccounts(potentialMints, { encoding: "jsonParsed" }).send();

    const agents: AgentIdentity[] = [];

    for (let i = 0; i < potentialMints.length; i++) {
      const mintAccount = mintAccountsResult.value[i];
      if (!mintAccount) continue;

      const parsed = mintAccount.data as {
        parsed?: {
          info?: {
            extensions?: Array<{
              extension: string;
              state: Record<string, unknown>;
            }>;
          };
        };
      };

      const extensions = parsed.parsed?.info?.extensions;
      if (!extensions) continue;

      const groupMemberExt = extensions.find((ext) => ext.extension === "tokenGroupMember");
      if (!groupMemberExt) continue;

      const memberState = groupMemberExt.state as {
        group?: string;
        memberNumber?: number;
      };
      if (memberState.group !== groupMint) continue;

      const metadataExt = extensions.find((ext) => ext.extension === "tokenMetadata");
      if (!metadataExt) continue;

      const metadataState = metadataExt.state as {
        name?: string;
        symbol?: string;
        uri?: string;
        additionalMetadata?: Array<[string, string]>;
      };

      const nonTransferableExt = extensions.find((ext) => ext.extension === "nonTransferable");

      const additionalMetadata: Record<string, string> = {};
      if (metadataState.additionalMetadata) {
        for (const [key, value] of metadataState.additionalMetadata) {
          additionalMetadata[key] = value;
        }
      }

      agents.push({
        mint: potentialMints[i],
        owner,
        name: metadataState.name ?? "Unknown",
        uri: metadataState.uri ?? "",
        memberNumber: BigInt(memberState.memberNumber ?? 0),
        additionalMetadata,
        nonTransferable: !!nonTransferableExt,
      });
    }

    return agents;
  }

  /**
   * Update agent metadata
   */
  async updateAgentMetadata(params: UpdateAgentMetadataParams): Promise<UpdateAgentMetadataResult> {
    const { payer, owner, mint, updates } = params;

    type UpdateInstruction = ReturnType<typeof getUpdateTokenMetadataFieldInstruction>;
    const ixList: UpdateInstruction[] = [];

    if (updates.name !== undefined) {
      ixList.push(
        getUpdateTokenMetadataFieldInstruction({
          metadata: mint,
          updateAuthority: owner,
          field: tokenMetadataField("Name"),
          value: updates.name,
        }),
      );
    }

    if (updates.uri !== undefined) {
      ixList.push(
        getUpdateTokenMetadataFieldInstruction({
          metadata: mint,
          updateAuthority: owner,
          field: tokenMetadataField("Uri"),
          value: updates.uri,
        }),
      );
    }

    if (updates.additionalMetadata) {
      for (const [key, value] of updates.additionalMetadata) {
        ixList.push(
          getUpdateTokenMetadataFieldInstruction({
            metadata: mint,
            updateAuthority: owner,
            field: tokenMetadataField("Key", [key]),
            value,
          }),
        );
      }
    }

    if (ixList.length === 0) {
      throw new Error("No updates specified");
    }

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions(ixList, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);
    return { signature: signature.toString() };
  }

  /**
   * Link an EVM address to a SATI agent via secp256k1 signature verification.
   * Proves the agent owner controls the specified EVM address.
   *
   * Use cases:
   * - Link ERC-8004 registered agents (Ethereum) to SATI identity
   * - Prove ownership of any EVM EOA for cross-chain identity
   *
   * @example
   * ```typescript
   * // 1. Build the message hash
   * const evmAddressBytes = hexToBytes("742d35Cc6634C0532925a3b844Bc9e7595f0bEb7");
   * const messageHash = computeEvmLinkHash(agentMint, evmAddressBytes, "eip155:1");
   *
   * // 2. Sign with Ethereum wallet (e.g., using ethers.js or viem)
   * const signature = await wallet.signMessage(messageHash);
   *
   * // 3. Link on SATI
   * await sati.linkEvmAddress({
   *   payer: keypair,
   *   agentMint: "AgentMint...",
   *   evmAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb7",
   *   chainId: "eip155:1",
   *   signature: signatureBytes,
   *   recoveryId: 0,
   * });
   * ```
   */
  async linkEvmAddress(params: {
    /** Payer for transaction fees */
    payer: KeyPairSigner;
    /** Agent NFT mint address */
    agentMint: Address;
    /** EVM address (0x-prefixed hex string) */
    evmAddress: string;
    /** CAIP-2 chain identifier (e.g., "eip155:1", "eip155:8453") */
    chainId: string;
    /** secp256k1 signature (64 bytes: r || s) */
    signature: Uint8Array;
    /** Recovery ID (0 or 1) */
    recoveryId: number;
  }): Promise<LinkEvmAddressResult> {
    const { payer, agentMint, evmAddress, chainId, signature, recoveryId } = params;

    // Parse EVM address (remove 0x prefix if present)
    const evmAddressClean = evmAddress.startsWith("0x") ? evmAddress.slice(2) : evmAddress;
    const hexPairs = evmAddressClean.match(/.{2}/g);
    if (!hexPairs || hexPairs.length !== 20) {
      throw new Error("Invalid EVM address format or length");
    }
    const evmAddressBytes = new Uint8Array(hexPairs.map((byte) => parseInt(byte, 16)));
    if (signature.length !== 64) {
      throw new Error("Signature must be 64 bytes");
    }
    if (recoveryId !== 0 && recoveryId !== 1) {
      throw new Error("Recovery ID must be 0 or 1");
    }

    // Find owner's ATA
    const [ata] = await findAssociatedTokenAddress(agentMint, payer.address);

    // Build instruction
    const ix = getLinkEvmAddressInstruction({
      owner: payer,
      agentMint,
      ata,
      evmAddress: evmAddressBytes,
      chainId,
      signature,
      recoveryId,
    });

    // Send transaction
    const txSig = await this.sendSingleTransaction([ix], payer);
    return { signature: txSig };
  }

  /**
   * Build the EVM link hash that the EVM wallet should sign.
   * This is a convenience wrapper around computeEvmLinkHash.
   */
  buildEvmLinkHash(agentMint: Address, evmAddress: Uint8Array, chainId: string): Uint8Array {
    return computeEvmLinkHash(agentMint, evmAddress, chainId);
  }

  // ============================================================
  // SCHEMAS
  // ============================================================

  /**
   * Register a schema configuration
   */
  async registerSchemaConfig(params: {
    payer: KeyPairSigner;
    authority: KeyPairSigner;
    sasSchema: Address;
    signatureMode: SignatureMode;
    storageType: StorageType;
    closeable: boolean;
  }): Promise<{ signature: string }> {
    const { payer, authority, sasSchema, signatureMode, storageType, closeable } = params;

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    const registerIx = await getRegisterSchemaConfigInstructionAsync({
      payer,
      authority,
      sasSchema,
      schemaConfig: schemaConfigPda,
      signatureMode,
      storageType,
      closeable,
    });

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(registerIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);
    return { signature: signature.toString() };
  }

  /**
   * Get schema configuration
   */
  async getSchemaConfig(sasSchema: Address): Promise<{
    signatureMode: SignatureMode;
    storageType: StorageType;
    closeable: boolean;
  } | null> {
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    try {
      const schemaConfig = await fetchSchemaConfig(this.rpc, schemaConfigPda);

      const signatureMode = schemaConfig.data.signatureMode as unknown as SignatureMode;
      const storageType = schemaConfig.data.storageType as unknown as StorageType;

      return {
        signatureMode,
        storageType,
        closeable: schemaConfig.data.closeable,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("could not find account") || message.includes("Account not found")) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Setup SATI SAS schemas (admin operation)
   */
  async setupSASSchemas(params: {
    payer: KeyPairSigner;
    authority: KeyPairSigner;
    testMode?: boolean;
  }): Promise<SASDeploymentResult> {
    // Dynamically import sas-lib to avoid bundling it in browser/worker environments
    const {
      deriveSatiCredentialPda,
      deriveSatiSchemaPda,
      getCreateSatiCredentialInstruction,
      getCreateSatiSchemaInstruction,
      fetchMaybeCredential,
      fetchMaybeSchema,
      SATI_SCHEMAS,
    } = await import("./sas");

    const { payer, authority, testMode = false } = params;
    const schemaVersion = testMode ? 0 : 1;

    const signatures: string[] = [];
    const schemaStatuses: Array<{
      name: string;
      address: Address;
      existed: boolean;
      deployed: boolean;
    }> = [];

    const [credentialPda] = await deriveSatiCredentialPda(authority.address);
    let credentialExisted = false;
    let credentialDeployed = false;

    const existingCredential = await fetchMaybeCredential(this.rpc, credentialPda);

    if (existingCredential) {
      credentialExisted = true;
      console.log(`Credential already exists: ${credentialPda}`);
    } else {
      console.log(`Creating credential: ${credentialPda}`);
      const createCredentialIx = getCreateSatiCredentialInstruction({
        payer,
        authority,
        credentialPda,
        authorizedSigners: [],
      });

      const sig = await this.sendSingleTransaction([createCredentialIx], payer);
      signatures.push(sig);
      credentialDeployed = true;
      console.log(`Credential created: ${sig}`);
    }

    const schemaEntries: Array<{
      key: "feedback" | "feedbackPublic" | "validation" | "reputationScore";
      def: SASSchemaDefinition;
    }> = [
      { key: "feedback", def: SATI_SCHEMAS.feedback },
      { key: "feedbackPublic", def: SATI_SCHEMAS.feedbackPublic },
      { key: "validation", def: SATI_SCHEMAS.validation },
      { key: "reputationScore", def: SATI_SCHEMAS.reputationScore },
    ];

    const schemaPdas: Record<string, Address> = {};

    for (const { key, def } of schemaEntries) {
      const [schemaPda] = await deriveSatiSchemaPda(credentialPda, def.name, schemaVersion);
      schemaPdas[key] = schemaPda;

      const existingSchema = await fetchMaybeSchema(this.rpc, schemaPda);

      if (existingSchema) {
        schemaStatuses.push({
          name: def.name,
          address: schemaPda,
          existed: true,
          deployed: false,
        });
        console.log(`Schema ${def.name} already exists: ${schemaPda}`);
      } else {
        console.log(`Creating schema ${def.name}: ${schemaPda}`);
        const createSchemaIx = getCreateSatiSchemaInstruction({
          payer,
          authority,
          credentialPda,
          schemaPda,
          schema: def,
        });

        const sig = await this.sendSingleTransaction([createSchemaIx], payer);
        signatures.push(sig);
        schemaStatuses.push({
          name: def.name,
          address: schemaPda,
          existed: false,
          deployed: true,
        });
        console.log(`Schema ${def.name} created: ${sig}`);
      }
    }

    const [registryPda] = await findRegistryConfigPda();
    const registryConfig = await fetchRegistryConfig(this.rpc, registryPda);

    if (registryConfig.data.authority === authority.address) {
      console.log("\nRegistering schema configs in SATI program...");

      const schemaConfigs: Array<{
        key: "feedback" | "feedbackPublic" | "validation" | "reputationScore";
        signatureMode: 0 | 1;
        storageType: 0 | 1;
        closeable: boolean;
      }> = [
        { key: "feedback", signatureMode: 0, storageType: 0, closeable: false },
        { key: "feedbackPublic", signatureMode: 1, storageType: 0, closeable: false },
        { key: "validation", signatureMode: 0, storageType: 0, closeable: false },
        { key: "reputationScore", signatureMode: 1, storageType: 1, closeable: true },
      ];

      for (const config of schemaConfigs) {
        const sasSchema = schemaPdas[config.key];
        const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

        try {
          await fetchSchemaConfig(this.rpc, schemaConfigPda);
          console.log(`SchemaConfig for ${config.key} already registered`);
        } catch {
          console.log(`Registering SchemaConfig for ${config.key}...`);
          const registerIx = await getRegisterSchemaConfigInstructionAsync({
            payer,
            authority,
            registryConfig: registryPda,
            sasSchema,
            signatureMode: config.signatureMode,
            storageType: config.storageType,
            closeable: config.closeable,
          });

          const sig = await this.sendSingleTransaction([registerIx], payer);
          signatures.push(sig);
          console.log(`SchemaConfig for ${config.key} registered: ${sig}`);
        }
      }
    } else {
      console.log("\nSkipping SATI schema config registration (not registry authority)");
    }

    return {
      success: true,
      credential: {
        address: credentialPda,
        existed: credentialExisted,
        deployed: credentialDeployed,
      },
      schemas: schemaStatuses,
      signatures,
      config: {
        credential: credentialPda,
        schemas: {
          feedback: schemaPdas.feedback,
          feedbackPublic: schemaPdas.feedbackPublic,
          validation: schemaPdas.validation,
          reputationScore: schemaPdas.reputationScore,
        },
      },
    };
  }

  // ============================================================
  // COMPRESSED ATTESTATIONS (Light Protocol)
  // ============================================================

  /**
   * Create a Feedback attestation (compressed storage)
   *
   * Note: tokenAccount is the agent's MINT address (stable identity).
   * The agentSignature.pubkey should be the NFT owner who signed.
   * On-chain verification ensures the owner holds the NFT via ATA.
   *
   * @throws Error if tokenAccount is not a registered SATI agent mint
   */
  async createFeedback(params: CreateFeedbackParams): Promise<AttestationResult> {
    const {
      payer,
      sasSchema,
      taskRef,
      tokenAccount,
      counterparty,
      dataHash,
      contentType = ContentType.None,
      outcome,
      tag1 = "",
      tag2 = "",
      content = new Uint8Array(0),
      agentSignature,
      counterpartySignature,
      lookupTableAddress,
    } = params;

    // Validate tokenAccount is a registered agent mint
    await this.validateTokenAccountIsRegisteredAgent(tokenAccount);

    const feedbackData: FeedbackData = {
      taskRef,
      tokenAccount,
      counterparty,
      dataHash,
      contentType,
      outcome,
      tag1,
      tag2,
      content,
    };
    const data = serializeFeedback(feedbackData);

    const signatures: GeneratedSignatureData[] = [
      {
        pubkey: agentSignature.pubkey,
        sig: assertSignature64(agentSignature.signature),
      },
    ];

    if (counterpartySignature) {
      signatures.push({
        pubkey: counterpartySignature.pubkey,
        sig: assertSignature64(counterpartySignature.signature),
      });
    }

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Derive agent's ATA - verifies signer (agentSignature.pubkey) owns the agent NFT (tokenAccount mint)
    // tokenAccount is the agent's MINT address (identity), NOT a wallet address
    const [agentAta] = await findAssociatedTokenAddress(
      tokenAccount, // mint address (agent identity)
      agentSignature.pubkey, // owner who signed
    );

    const light = await this.getLightClient();

    const addressEncoder = getAddressEncoder();
    const nonce = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);
    const sasSchemaBytes = new Uint8Array(addressEncoder.encode(sasSchema));
    const tokenAccountBytesForSeed = new Uint8Array(addressEncoder.encode(tokenAccount));
    const seeds = [new TextEncoder().encode("attestation"), sasSchemaBytes, tokenAccountBytesForSeed, nonce];

    const {
      address: derivedAddress,
      proof: proofResult,
      addressTreeInfo: packedAddressTreeInfo,
      outputStateTreeIndex,
      remainingAccounts,
    } = await light.prepareCreate(seeds);

    const proof: ValidityProofArgs = proofResult.compressedProof
      ? [
          {
            a: new Uint8Array(proofResult.compressedProof.a),
            b: new Uint8Array(proofResult.compressedProof.b),
            c: new Uint8Array(proofResult.compressedProof.c),
          },
        ]
      : [null];

    const addressTreeInfo: PackedAddressTreeInfoArgs = {
      addressMerkleTreePubkeyIndex: packedAddressTreeInfo.addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex: packedAddressTreeInfo.addressQueuePubkeyIndex,
      rootIndex: packedAddressTreeInfo.rootIndex,
    };

    const baseCreateIx = await getCreateAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      agentAta, // Proves signer owns the agent NFT
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS, // Agent NFTs use Token-2022
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Feedback,
      data,
      signatures,
      outputStateTreeIndex,
      proof,
      addressTreeInfo,
    });

    const createIx = {
      ...baseCreateIx,
      accounts: [
        ...baseCreateIx.accounts,
        ...remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable ? (acc.isSigner ? 3 : 1) : acc.isSigner ? 2 : 0,
        })),
      ],
    };

    const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);

    const ed25519Entries = [
      {
        publicKey: new Uint8Array(addressEncoder.encode(agentSignature.pubkey)),
        message: interactionHash,
        signature: agentSignature.signature,
      },
    ];

    if (counterpartySignature) {
      const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);
      ed25519Entries.push({
        publicKey: new Uint8Array(addressEncoder.encode(counterpartySignature.pubkey)),
        message: feedbackHash,
        signature: counterpartySignature.signature,
      });
    }

    const ed25519Ix = createBatchEd25519Instruction(ed25519Entries);

    const signature = await this.buildAndSendTransaction([ed25519Ix, createIx], payer, lookupTableAddress);

    return {
      address: address(derivedAddress.toBase58()),
      signature,
    };
  }

  /**
   * Build a Feedback transaction without signing or sending
   *
   * Note: tokenAccount is the agent's MINT address (stable identity).
   * The agentSignature.pubkey should be the NFT owner who signed.
   * On-chain verification ensures the owner holds the NFT via ATA.
   *
   * @throws Error if tokenAccount is not a registered SATI agent mint
   */
  async buildFeedbackTransaction(params: BuildFeedbackParams): Promise<BuiltTransaction> {
    const {
      payer,
      sasSchema,
      taskRef,
      tokenAccount,
      counterparty,
      dataHash,
      contentType = ContentType.None,
      outcome,
      tag1 = "",
      tag2 = "",
      content = new Uint8Array(0),
      agentSignature,
      counterpartySignature,
      lookupTableAddress,
    } = params;

    // Validate tokenAccount is a registered agent mint
    await this.validateTokenAccountIsRegisteredAgent(tokenAccount);

    const feedbackData: FeedbackData = {
      taskRef,
      tokenAccount,
      counterparty,
      dataHash,
      contentType,
      outcome,
      tag1,
      tag2,
      content,
    };
    const data = serializeFeedback(feedbackData);

    const signatures: GeneratedSignatureData[] = [
      {
        pubkey: agentSignature.pubkey,
        sig: assertSignature64(agentSignature.signature),
      },
    ];

    if (counterpartySignature) {
      signatures.push({
        pubkey: counterpartySignature.pubkey,
        sig: assertSignature64(counterpartySignature.signature),
      });
    }

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Derive agent's ATA - verifies signer (agentSignature.pubkey) owns the agent NFT (tokenAccount mint)
    // tokenAccount is the agent's MINT address (identity), NOT a wallet address
    const [agentAta] = await findAssociatedTokenAddress(
      tokenAccount, // mint address (agent identity)
      agentSignature.pubkey, // owner who signed
    );

    const light = await this.getLightClient();

    const addressEncoder = getAddressEncoder();
    const nonce = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);
    const sasSchemaBytes = new Uint8Array(addressEncoder.encode(sasSchema));
    const tokenAccountBytesForSeed = new Uint8Array(addressEncoder.encode(tokenAccount));
    const seeds = [new TextEncoder().encode("attestation"), sasSchemaBytes, tokenAccountBytesForSeed, nonce];

    const {
      address: derivedAddress,
      proof: proofResult,
      addressTreeInfo: packedAddressTreeInfo,
      outputStateTreeIndex,
      remainingAccounts,
    } = await light.prepareCreate(seeds);

    const proof: ValidityProofArgs = proofResult.compressedProof
      ? [
          {
            a: new Uint8Array(proofResult.compressedProof.a),
            b: new Uint8Array(proofResult.compressedProof.b),
            c: new Uint8Array(proofResult.compressedProof.c),
          },
        ]
      : [null];

    const addressTreeInfo: PackedAddressTreeInfoArgs = {
      addressMerkleTreePubkeyIndex: packedAddressTreeInfo.addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex: packedAddressTreeInfo.addressQueuePubkeyIndex,
      rootIndex: packedAddressTreeInfo.rootIndex,
    };

    const baseCreateIx = await getCreateAttestationInstructionAsync({
      payer: { address: payer } as KeyPairSigner,
      schemaConfig: schemaConfigPda,
      agentAta, // Proves signer owns the agent NFT
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS, // Agent NFTs use Token-2022
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Feedback,
      data,
      signatures,
      outputStateTreeIndex,
      proof,
      addressTreeInfo,
    });

    const createIx = {
      ...baseCreateIx,
      accounts: [
        ...baseCreateIx.accounts,
        ...remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable ? (acc.isSigner ? 3 : 1) : acc.isSigner ? 2 : 0,
        })),
      ],
    };

    const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);
    const ed25519Entries = [
      {
        publicKey: new Uint8Array(addressEncoder.encode(agentSignature.pubkey)),
        message: interactionHash,
        signature: agentSignature.signature,
      },
    ];

    if (counterpartySignature) {
      const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);
      ed25519Entries.push({
        publicKey: new Uint8Array(addressEncoder.encode(counterpartySignature.pubkey)),
        message: feedbackHash,
        signature: counterpartySignature.signature,
      });
    }

    const ed25519Ix = createBatchEd25519Instruction(ed25519Entries);

    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const computeBudgetIx = getSetComputeUnitLimitInstruction({
      units: 400_000,
    });

    const baseTxMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(computeBudgetIx, msg),
      (msg) => appendTransactionMessageInstructions([ed25519Ix, createIx], msg),
    );

    const finalTxMessage = await (async () => {
      if (!lookupTableAddress) {
        return baseTxMessage;
      }
      const lookupTableAccount = await fetchAddressLookupTable(this.rpc, lookupTableAddress);
      const addressesByLookupTable: AddressesByLookupTableAddress = {
        [lookupTableAddress]: lookupTableAccount.data.addresses,
      };
      return compressTransactionMessageUsingAddressLookupTables(baseTxMessage, addressesByLookupTable);
    })();

    const compiledTx = compileTransaction(finalTxMessage);

    const messageBytes = compiledTx.messageBytes as unknown as Uint8Array;
    const binaryString = Array.from(messageBytes)
      .map((byte) => String.fromCharCode(byte))
      .join("");
    const messageBase64 = btoa(binaryString);

    return {
      attestationAddress: address(derivedAddress.toBase58()),
      messageBytes: messageBase64,
      signers: Object.keys(compiledTx.signatures) as Address[],
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    };
  }

  /**
   * Create a Validation attestation (compressed storage)
   *
   * Note: tokenAccount is the agent's MINT address (stable identity).
   * The agentSignature.pubkey should be the NFT owner who signed.
   * On-chain verification ensures the owner holds the NFT via ATA.
   *
   * @throws Error if tokenAccount is not a registered SATI agent mint
   */
  async createValidation(params: CreateValidationParams): Promise<AttestationResult> {
    const {
      payer,
      sasSchema,
      taskRef,
      tokenAccount,
      counterparty,
      dataHash,
      contentType = ContentType.None,
      validationType = ValidationType.TEE,
      response,
      content = new Uint8Array(0),
      agentSignature,
      validatorSignature,
      lookupTableAddress,
    } = params;

    if (!Number.isInteger(response) || response < 0 || response > 100) {
      throw new Error("Response must be an integer 0-100");
    }

    // Validate tokenAccount is a registered agent mint
    await this.validateTokenAccountIsRegisteredAgent(tokenAccount);

    const validationData: ValidationData = {
      taskRef,
      tokenAccount,
      counterparty,
      dataHash,
      contentType,
      validationType,
      response,
      content,
    };
    const data = serializeValidation(validationData);

    const signatures: GeneratedSignatureData[] = [
      {
        pubkey: agentSignature.pubkey,
        sig: assertSignature64(agentSignature.signature),
      },
      {
        pubkey: validatorSignature.pubkey,
        sig: assertSignature64(validatorSignature.signature),
      },
    ];

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Derive agent's ATA - verifies signer (agentSignature.pubkey) owns the agent NFT (tokenAccount mint)
    // tokenAccount is the agent's MINT address (identity), NOT a wallet address
    const [agentAta] = await findAssociatedTokenAddress(
      tokenAccount, // mint address (agent identity)
      agentSignature.pubkey, // owner who signed
    );

    const light = await this.getLightClient();

    const addressEncoder = getAddressEncoder();
    const nonce = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);
    const seeds = [
      new TextEncoder().encode("attestation"),
      new Uint8Array(addressEncoder.encode(sasSchema)),
      new Uint8Array(addressEncoder.encode(tokenAccount)),
      nonce,
    ];

    const {
      address: derivedAddress,
      proof: proofResult,
      addressTreeInfo: packedAddressTreeInfo,
      outputStateTreeIndex,
      remainingAccounts,
    } = await light.prepareCreate(seeds);

    const proof: ValidityProofArgs = proofResult.compressedProof
      ? [
          {
            a: new Uint8Array(proofResult.compressedProof.a),
            b: new Uint8Array(proofResult.compressedProof.b),
            c: new Uint8Array(proofResult.compressedProof.c),
          },
        ]
      : [null];

    const addressTreeInfo: PackedAddressTreeInfoArgs = {
      addressMerkleTreePubkeyIndex: packedAddressTreeInfo.addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex: packedAddressTreeInfo.addressQueuePubkeyIndex,
      rootIndex: packedAddressTreeInfo.rootIndex,
    };

    const baseCreateIx = await getCreateAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      agentAta, // Proves signer owns the agent NFT
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS, // Agent NFTs use Token-2022
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Validation,
      data,
      signatures,
      outputStateTreeIndex,
      proof,
      addressTreeInfo,
    });

    const createIx = {
      ...baseCreateIx,
      accounts: [
        ...baseCreateIx.accounts,
        ...remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable ? (acc.isSigner ? 3 : 1) : acc.isSigner ? 2 : 0,
        })),
      ],
    };

    const interactionHash = computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);
    const validationHash = computeValidationHash(sasSchema, taskRef, tokenAccount, response);

    const ed25519Ix = createBatchEd25519Instruction([
      {
        publicKey: new Uint8Array(addressEncoder.encode(agentSignature.pubkey)),
        message: interactionHash,
        signature: agentSignature.signature,
      },
      {
        publicKey: new Uint8Array(addressEncoder.encode(validatorSignature.pubkey)),
        message: validationHash,
        signature: validatorSignature.signature,
      },
    ]);

    const signature = await this.buildAndSendTransaction([ed25519Ix, createIx], payer, lookupTableAddress);

    return {
      address: address(derivedAddress.toBase58()),
      signature,
    };
  }

  /**
   * Close a compressed attestation (Light Protocol)
   */
  async closeCompressedAttestation(params: CloseCompressedAttestationParams): Promise<CloseAttestationResult> {
    const { payer, counterparty, sasSchema, attestationAddress, lookupTableAddress } = params;

    const light = await this.getLightClient();
    const parsedAttestation = await light.getAttestationByAddress(attestationAddress);

    if (!parsedAttestation) {
      throw new Error(`Attestation not found at address ${attestationAddress}`);
    }

    const addressEncoder = getAddressEncoder();
    const counterpartyBytes = parsedAttestation.attestation.data.slice(64, 96);
    const expectedCounterpartyBytes = new Uint8Array(addressEncoder.encode(counterparty.address));

    const isCounterparty =
      counterpartyBytes.length === expectedCounterpartyBytes.length &&
      counterpartyBytes.every((byte, i) => byte === expectedCounterpartyBytes[i]);

    if (!isCounterparty) {
      throw new Error("Signer must be the counterparty from the original attestation");
    }

    const mutationResult = await light.getMutationProof(parsedAttestation.raw);

    const accountMeta: CompressedAccountMetaArgs = {
      treeInfo: {
        rootIndex: mutationResult.stateTreeInfo.rootIndex,
        proveByIndex: true,
        merkleTreePubkeyIndex: mutationResult.stateTreeInfo.merkleTreePubkeyIndex,
        queuePubkeyIndex: mutationResult.stateTreeInfo.queuePubkeyIndex,
        leafIndex: mutationResult.stateTreeInfo.leafIndex,
      },
      address: parsedAttestation.address,
      outputStateTreeIndex: mutationResult.outputStateTreeIndex,
    };

    const proof: ValidityProofArgs = mutationResult.proof.compressedProof
      ? [
          {
            a: new Uint8Array(mutationResult.proof.compressedProof.a),
            b: new Uint8Array(mutationResult.proof.compressedProof.b),
            c: new Uint8Array(mutationResult.proof.compressedProof.c),
          },
        ]
      : [null];

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    const baseCloseIx = await getCloseAttestationInstructionAsync({
      signer: counterparty,
      schemaConfig: schemaConfigPda,
      program: SATI_PROGRAM_ADDRESS,
      dataType: parsedAttestation.attestation.dataType,
      currentData: parsedAttestation.attestation.data,
      numSignatures: parsedAttestation.attestation.numSignatures,
      signature1: parsedAttestation.attestation.signature1,
      signature2: parsedAttestation.attestation.signature2,
      address: attestationAddress,
      proof,
      accountMeta,
    });

    const closeIx = {
      ...baseCloseIx,
      accounts: [
        ...baseCloseIx.accounts,
        ...mutationResult.remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable ? (acc.isSigner ? 3 : 1) : acc.isSigner ? 2 : 0,
        })),
      ],
    };

    const signature = await this.buildAndSendTransaction([closeIx], payer, lookupTableAddress);

    return { signature };
  }

  // ============================================================
  // REGULAR ATTESTATIONS (SAS)
  // ============================================================

  /**
   * Create a ReputationScore attestation (regular SAS storage)
   *
   * @throws Error if tokenAccount is not a registered SATI agent mint
   */
  async createReputationScore(params: CreateReputationScoreParams): Promise<AttestationResult> {
    const {
      payer,
      provider,
      providerSignature,
      sasSchema,
      satiCredential,
      tokenAccount,
      score,
      contentType = ContentType.None,
      content = new Uint8Array(0),
      expiry = 0,
    } = params;

    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new Error("Score must be an integer 0-100");
    }

    if (providerSignature.length !== 64) {
      throw new Error("Provider signature must be 64 bytes");
    }

    // Validate tokenAccount is a registered agent mint
    await this.validateTokenAccountIsRegisteredAgent(tokenAccount);

    const nonce = computeReputationNonce(provider, tokenAccount);

    const reputationData: ReputationScoreData = {
      taskRef: nonce,
      tokenAccount,
      counterparty: provider,
      score,
      contentType,
      content,
    };
    const data = serializeReputationScore(reputationData);

    const messageHash = computeReputationHash(sasSchema, tokenAccount, provider, score);

    const [attestationPda] = await deriveReputationAttestationPda(nonce);

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    const addressEncoder = getAddressEncoder();
    const ed25519Ix = createBatchEd25519Instruction([
      {
        publicKey: new Uint8Array(addressEncoder.encode(provider)),
        message: messageHash,
        signature: providerSignature,
      },
    ]);

    const createIx = await getCreateRegularAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      satiCredential,
      sasSchema,
      attestation: attestationPda,
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.ReputationScore,
      data,
      signatures: [
        {
          pubkey: provider,
          sig: providerSignature,
        },
      ],
      expiry: BigInt(expiry),
    });

    const signature = await this.buildAndSendTransaction([ed25519Ix, createIx], payer);

    return {
      address: attestationPda,
      signature,
    };
  }

  /**
   * Close a regular SAS attestation (ReputationScore)
   */
  async closeRegularAttestation(params: CloseRegularAttestationParams): Promise<CloseAttestationResult> {
    const { payer, provider, sasSchema, satiCredential, attestation } = params;

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    const closeIx = await getCloseRegularAttestationInstructionAsync({
      payer,
      signer: provider,
      schemaConfig: schemaConfigPda,
      satiCredential,
      attestation,
      program: SATI_PROGRAM_ADDRESS,
    });

    const signature = await this.buildAndSendTransaction([closeIx], payer);

    return { signature };
  }

  // ============================================================
  // QUERY METHODS
  // ============================================================

  /**
   * List Feedback attestations
   */
  async listFeedbacks(filter: Partial<AttestationFilter>): Promise<ParsedAttestation[]> {
    const light = await this.getLightClient();
    return light.listFeedbacks(filter);
  }

  /**
   * List Validation attestations
   */
  async listValidations(filter: Partial<AttestationFilter>): Promise<ParsedAttestation[]> {
    const light = await this.getLightClient();
    return light.listValidations(filter);
  }

  /**
   * Get a ReputationScore for an agent from a specific provider
   */
  async getReputationScore(provider: Address, tokenAccount: Address): Promise<ReputationScoreData | null> {
    const nonce = computeReputationNonce(provider, tokenAccount);

    const [attestationPda] = await deriveReputationAttestationPda(nonce);

    const accountInfo = await this.rpc.getAccountInfo(attestationPda, { encoding: "base64" }).send();

    if (!accountInfo.value) {
      return null;
    }

    const base64Data = accountInfo.value.data[0];
    const binaryString = atob(base64Data);
    const data = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      data[i] = binaryString.charCodeAt(i);
    }

    if (data.length < SAS_HEADER_SIZE) {
      return null;
    }

    const satiData = new Uint8Array(data.subarray(SAS_HEADER_SIZE));

    return deserializeReputationScore(satiData);
  }

  /**
   * List ReputationScore attestations for an agent
   */
  async listReputationScores(tokenAccount: Address, sasSchema: Address): Promise<ReputationScoreData[]> {
    const accounts = await this.rpc
      .getProgramAccounts(address(SATI_PROGRAM_ADDRESS), {
        encoding: "base64",
        filters: [
          {
            memcmp: {
              offset: BigInt(8),
              bytes: addressToBase58Bytes(sasSchema),
              encoding: "base58",
            },
          },
          {
            memcmp: {
              offset: BigInt(40),
              bytes: addressToBase58Bytes(tokenAccount),
              encoding: "base58",
            },
          },
        ],
      })
      .send();

    const results: ReputationScoreData[] = [];
    for (const { account } of accounts) {
      try {
        const [base64Data] = account.data as [string, string];
        const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
        const attestationData = bytes.slice(SAS_HEADER_SIZE);
        results.push(deserializeReputationScore(attestationData));
      } catch {
        // Skip malformed accounts
      }
    }

    return results;
  }

  // ============================================================
  // SIGNATURE HELPERS
  // ============================================================

  /**
   * Build the interaction hash that the agent should sign (blind to outcome)
   */
  buildInteractionHash(
    sasSchema: Address,
    taskRef: Uint8Array,
    tokenAccount: Address,
    dataHash: Uint8Array,
  ): Uint8Array {
    return computeInteractionHash(sasSchema, taskRef, tokenAccount, dataHash);
  }

  /**
   * Build the feedback hash that the counterparty should sign (with outcome)
   */
  buildFeedbackHash(sasSchema: Address, taskRef: Uint8Array, tokenAccount: Address, outcome: Outcome): Uint8Array {
    return computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);
  }

  /**
   * Build the validation hash that the validator should sign (with response)
   */
  buildValidationHash(sasSchema: Address, taskRef: Uint8Array, tokenAccount: Address, response: number): Uint8Array {
    return computeValidationHash(sasSchema, taskRef, tokenAccount, response);
  }

  /**
   * Build the reputation hash that the provider should sign
   */
  buildReputationHash(sasSchema: Address, tokenAccount: Address, provider: Address, score: number): Uint8Array {
    return computeReputationHash(sasSchema, tokenAccount, provider, score);
  }

  // ============================================================
  // SIGNATURE VERIFICATION
  // ============================================================

  /**
   * Verify signatures on a parsed attestation
   */
  verifySignatures(attestation: ParsedAttestation): SignatureVerificationResult {
    const { attestation: compressed, data } = attestation;
    const addressEncoder = getAddressEncoder();

    const sasSchema = address(uint8ArrayToBase58(compressed.sasSchema));
    const tokenAccount = address(uint8ArrayToBase58(compressed.tokenAccount));

    const signature1 = compressed.signature1;
    const signature2 = compressed.signature2;

    const agentPubkey = compressed.tokenAccount;

    if (compressed.dataType === DataType.Feedback) {
      const feedbackData = data as FeedbackData;

      const interactionHash = computeInteractionHash(
        sasSchema,
        feedbackData.taskRef,
        tokenAccount,
        feedbackData.dataHash,
      );

      const feedbackHash = computeFeedbackHash(sasSchema, feedbackData.taskRef, tokenAccount, feedbackData.outcome);

      const counterpartyPubkey = new Uint8Array(addressEncoder.encode(feedbackData.counterparty));

      const agentValid = nacl.sign.detached.verify(interactionHash, signature1, agentPubkey);
      const counterpartyValid = nacl.sign.detached.verify(feedbackHash, signature2, counterpartyPubkey);

      return {
        valid: agentValid && counterpartyValid,
        agentValid,
        counterpartyValid,
      };
    } else if (compressed.dataType === DataType.Validation) {
      const validationData = data as ValidationData;

      const interactionHash = computeInteractionHash(
        sasSchema,
        validationData.taskRef,
        tokenAccount,
        validationData.dataHash,
      );

      const validationHash = computeValidationHash(
        sasSchema,
        validationData.taskRef,
        tokenAccount,
        validationData.response,
      );

      const validatorPubkey = new Uint8Array(addressEncoder.encode(validationData.counterparty));

      const agentValid = nacl.sign.detached.verify(interactionHash, signature1, agentPubkey);
      const counterpartyValid = nacl.sign.detached.verify(validationHash, signature2, validatorPubkey);

      return {
        valid: agentValid && counterpartyValid,
        agentValid,
        counterpartyValid,
      };
    }

    return {
      valid: false,
      agentValid: false,
      counterpartyValid: false,
    };
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  /**
   * Validate that tokenAccount is a registered SATI agent mint.
   *
   * This validation runs at SDK level to fail fast with clear errors
   * before attempting on-chain operations.
   *
   * @param tokenAccount - Address to validate as a registered agent mint
   * @throws Error if tokenAccount is not a registered SATI agent
   */
  private async validateTokenAccountIsRegisteredAgent(tokenAccount: Address): Promise<void> {
    try {
      const agent = await this.loadAgent(tokenAccount);
      if (!agent) {
        throw new Error(`tokenAccount ${tokenAccount} is not a registered SATI agent mint`);
      }
    } catch (error) {
      // Re-throw with consistent error message for any lookup failure
      const message = error instanceof Error ? error.message : String(error);
      // Already has our message format
      if (message.includes("is not a registered SATI agent mint")) {
        throw error;
      }
      // Wrap other errors (account not found, decode errors, etc.)
      throw new Error(`tokenAccount ${tokenAccount} is not a registered SATI agent mint`);
    }
  }

  /**
   * Build, optionally compress, sign, and send a transaction.
   */
  private async buildAndSendTransaction(
    instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
    payer: KeyPairSigner,
    lookupTableAddress?: Address,
    computeUnits: number = 400_000,
  ): Promise<string> {
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const computeBudgetIx = getSetComputeUnitLimitInstruction({
      units: computeUnits,
    });

    const baseTx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(computeBudgetIx, msg),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    const finalTx = await (async () => {
      if (!lookupTableAddress) {
        return baseTx;
      }
      const lookupTableAccount = await fetchAddressLookupTable(this.rpc, lookupTableAddress);
      const addressesByLookupTable: AddressesByLookupTableAddress = {
        [lookupTableAddress]: lookupTableAccount.data.addresses,
      };
      return compressTransactionMessageUsingAddressLookupTables(baseTx, addressesByLookupTable);
    })();

    const signedTx = await signTransactionMessageWithSigners(finalTx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    return getSignatureFromTransaction(signedTx).toString();
  }

  /**
   * Send a single transaction without address lookup table.
   */
  private async sendSingleTransaction(
    instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
    payer: KeyPairSigner,
  ): Promise<string> {
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const signature = getSignatureFromTransaction(signedTx);

    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    return signature;
  }
}
