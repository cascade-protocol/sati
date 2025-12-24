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
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  pipe,
  sendAndConfirmTransactionFactory,
  signTransactionMessageWithSigners,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  compressTransactionMessageUsingAddressLookupTables,
  address,
  getSignatureFromTransaction,
  getAddressEncoder,
  type Address,
  type KeyPairSigner,
  type AddressesByLookupTableAddress,
} from "@solana/kit";

import {
  fetchMint as fetchToken2022Mint,
  fetchToken as fetchToken2022Token,
  getTransferInstruction,
  type Extension,
} from "@solana-program/token-2022";

import { fetchAddressLookupTable } from "@solana-program/address-lookup-table";
import { getSetComputeUnitLimitInstruction } from "@solana-program/compute-budget";

import {
  getRegisterAgentInstructionAsync,
  getCreateAttestationInstructionAsync,
  getCloseAttestationInstructionAsync,
  getCloseRegularAttestationInstructionAsync,
  getCreateRegularAttestationInstructionAsync,
  getRegisterSchemaConfigInstructionAsync,
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
} from "./helpers";

import {
  computeInteractionHash,
  computeFeedbackHash,
  computeValidationHash,
  computeReputationHash,
  computeAttestationNonce,
  computeReputationNonce,
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

// Light Protocol types (type-only imports don't trigger bundling)
import type {
  LightClient,
  ParsedAttestation,
  AttestationFilter,
} from "./light";

// Dynamic import helper for Light Protocol (avoids bundling Node.js deps for browser)
async function loadLightClient(): Promise<typeof import("./light")> {
  return import("./light");
}

import type {
  AgentIdentity,
  RegisterAgentResult,
  SATIClientOptions,
  CloseCompressedAttestationParams,
  CloseRegularAttestationParams,
  CloseAttestationResult,
  SASDeploymentResult,
} from "./types";

import { deriveReputationAttestationPda } from "./sas-pdas";

import { createBatchEd25519Instruction } from "./ed25519";

// Re-export types
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

/**
 * Type helper for signed transactions with blockhash lifetime.
 */
type SignedBlockhashTransaction = Awaited<
  ReturnType<typeof signTransactionMessageWithSigners>
> & {
  lifetimeConstraint: { lastValidBlockHeight: bigint; blockhash: string };
};

/**
 * Helper to unwrap Option type from @solana/kit
 */
function unwrapOption<T>(
  option: { __option: "Some"; value: T } | { __option: "None" },
): T | null {
  if (option.__option === "Some") {
    return option.value;
  }
  return null;
}

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
  /** Counterparty's signature (with outcome) */
  counterpartySignature: SignatureInput;
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

/**
 * SATI Client
 *
 * High-level interface for interacting with SATI protocol.
 *
 * @example
 * ```typescript
 * const sati = new SATI({ network: "devnet" });
 *
 * // Register an agent
 * const { mint, memberNumber } = await sati.registerAgent({
 *   payer,
 *   name: "MyAgent",
 *   uri: "ipfs://QmRegistrationFile",
 * });
 *
 * // Create feedback attestation
 * const result = await sati.createFeedback({
 *   payer,
 *   sasSchema,
 *   taskRef: paymentTxHash,
 *   tokenAccount: agentMint,
 *   counterparty: clientPubkey,
 *   outcome: Outcome.Positive,
 *   agentSignature,
 *   counterpartySignature,
 * });
 * ```
 */
export class SATI {
  private rpc: ReturnType<typeof createSolanaRpc>;
  private rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
  private network: "mainnet" | "devnet" | "localnet";
  private lightClient: LightClient | null = null;

  private photonRpcUrl?: string;

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

  /**
   * Get or create Light Protocol client (async to support dynamic import)
   *
   * Light Protocol is loaded dynamically to avoid bundling Node.js
   * dependencies in browser environments.
   */
  async getLightClient(): Promise<LightClient> {
    if (!this.lightClient) {
      const { createLightClient } = await loadLightClient();
      this.lightClient = createLightClient(this.photonRpcUrl);
    }
    return this.lightClient;
  }

  /**
   * Set Light Protocol client (for testing or custom clients)
   */
  setLightClient(client: LightClient): void {
    this.lightClient = client;
  }

  /**
   * Build, optionally compress, sign, and send a transaction.
   *
   * @param instructions - Instructions to include in the transaction
   * @param payer - Transaction fee payer
   * @param lookupTableAddress - Optional address lookup table for compression
   * @returns Transaction signature
   */
  private async buildAndSendTransaction(
    instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
    payer: KeyPairSigner,
    lookupTableAddress?: Address,
    computeUnits: number = 400_000,
  ): Promise<string> {
    const { value: latestBlockhash } = await this.rpc
      .getLatestBlockhash()
      .send();

    // Add compute budget instruction for Light Protocol operations
    const computeBudgetIx = getSetComputeUnitLimitInstruction({
      units: computeUnits,
    });

    const baseTx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(computeBudgetIx, msg),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    // Compress transaction using address lookup table if provided
    const finalTx = await (async () => {
      if (!lookupTableAddress) {
        return baseTx;
      }
      const lookupTableAccount = await fetchAddressLookupTable(
        this.rpc,
        lookupTableAddress,
      );
      const addressesByLookupTable: AddressesByLookupTableAddress = {
        [lookupTableAddress]: lookupTableAccount.data.addresses,
      };
      return compressTransactionMessageUsingAddressLookupTables(
        baseTx,
        addressesByLookupTable,
      );
    })();

    const signedTx = await signTransactionMessageWithSigners(finalTx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    return getSignatureFromTransaction(signedTx).toString();
  }

  // ============================================================
  // REGISTRY
  // ============================================================

  /**
   * Register a new agent identity
   *
   * Creates a Token-2022 NFT with metadata and group membership atomically.
   *
   * @param params - Registration parameters
   * @returns Mint address and member number
   */
  async registerAgent(params: {
    /** Payer for transaction and rent */
    payer: KeyPairSigner;
    /** Agent name (max 32 bytes) */
    name: string;
    /** Agent symbol (max 10 bytes, default: "SATI") */
    symbol?: string;
    /** Registration file URI (max 200 bytes) */
    uri: string;
    /** Additional metadata key-value pairs (max 10 entries) */
    additionalMetadata?: Array<{ key: string; value: string }>;
    /** Make agent non-transferable (soulbound) */
    nonTransferable?: boolean;
    /** Owner of the agent NFT (default: payer) */
    owner?: Address;
  }): Promise<RegisterAgentResult> {
    const {
      payer,
      name,
      symbol = "SATI",
      uri,
      additionalMetadata,
      nonTransferable = false,
      owner,
    } = params;

    // Generate new mint keypair
    const agentMint = await generateKeyPairSigner();

    // Fetch registry config to get the actual group mint
    const [registryConfigAddress] = await findRegistryConfigPda();
    const registryConfig = await fetchRegistryConfig(
      this.rpc,
      registryConfigAddress,
    );
    const groupMint = registryConfig.data.groupMint;
    const ownerAddress = owner ?? payer.address;
    const [agentTokenAccount] = await findAssociatedTokenAddress(
      agentMint.address,
      ownerAddress,
    );

    // Build instruction
    const registerIx = await getRegisterAgentInstructionAsync({
      payer,
      owner: ownerAddress,
      groupMint,
      agentMint,
      agentTokenAccount,
      name,
      symbol,
      uri,
      additionalMetadata: additionalMetadata ?? null,
      nonTransferable,
    });

    // Build and send transaction
    const { value: latestBlockhash } = await this.rpc
      .getLatestBlockhash()
      .send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(registerIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    // Re-fetch registry config to get the updated member number
    const updatedRegistryConfig = await fetchRegistryConfig(
      this.rpc,
      registryConfigAddress,
    );
    const memberNumber = updatedRegistryConfig.data.totalAgents;

    // Extract signature from signed transaction
    const signature = getSignatureFromTransaction(signedTx);

    return {
      mint: agentMint.address,
      memberNumber,
      signature: signature.toString(),
    };
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
    const registryConfig = await fetchRegistryConfig(
      this.rpc,
      registryConfigAddress,
    );

    const isImmutable =
      registryConfig.data.authority === "11111111111111111111111111111111";

    return {
      groupMint: registryConfig.data.groupMint,
      authority: registryConfig.data.authority,
      totalAgents: registryConfig.data.totalAgents,
      isImmutable,
    };
  }

  // ============================================================
  // IDENTITY (Direct Token-2022)
  // ============================================================

  /**
   * Load agent identity from mint address
   *
   * Fetches Token-2022 metadata and group membership.
   *
   * @param mint - Agent NFT mint address
   * @returns Agent identity or null if not found
   */
  async loadAgent(mint: Address): Promise<AgentIdentity | null> {
    try {
      // Fetch mint account with extensions
      const mintAccount = await fetchToken2022Mint(this.rpc, mint);

      // Unwrap extensions Option
      const extensions = unwrapOption(
        mintAccount.data.extensions as
          | { __option: "Some"; value: Extension[] }
          | { __option: "None" },
      );

      if (!extensions) {
        return null;
      }

      // Find TokenMetadata extension
      const metadataExt = extensions.find(
        (ext: Extension): ext is Extension & { __kind: "TokenMetadata" } =>
          ext.__kind === "TokenMetadata",
      );

      if (!metadataExt) {
        return null;
      }

      // Find TokenGroupMember extension for member number
      const groupMemberExt = extensions.find(
        (ext: Extension): ext is Extension & { __kind: "TokenGroupMember" } =>
          ext.__kind === "TokenGroupMember",
      );

      // Find NonTransferable extension
      const nonTransferableExt = extensions.find(
        (ext: Extension) => ext.__kind === "NonTransferable",
      );

      // Get owner by finding the token account
      const owner = await this.getAgentOwner(mint);

      // Convert additionalMetadata Map to Record
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
        symbol: metadataExt.symbol,
        uri: metadataExt.uri,
        memberNumber: groupMemberExt?.memberNumber ?? 0n,
        additionalMetadata,
        nonTransferable: !!nonTransferableExt,
      };
    } catch {
      return null;
    }
  }

  /**
   * Transfer agent to new owner
   *
   * Standard Token-2022 transfer. Requires current owner signature.
   *
   * @param params - Transfer parameters
   */
  async transferAgent(params: {
    /** Payer for transaction fees and new ATA creation */
    payer: KeyPairSigner;
    /** Current owner (must sign) */
    owner: KeyPairSigner;
    /** Agent NFT mint address */
    mint: Address;
    /** New owner address */
    newOwner: Address;
  }): Promise<{ signature: string }> {
    const { payer, owner, mint, newOwner } = params;

    // Get source and destination ATAs
    const [sourceAta] = await findAssociatedTokenAddress(mint, owner.address);
    const [destAta] = await findAssociatedTokenAddress(mint, newOwner);

    // Build transfer instruction
    const transferIx = getTransferInstruction({
      source: sourceAta,
      destination: destAta,
      authority: owner,
      amount: 1n,
    });

    // Build and send transaction
    const { value: latestBlockhash } = await this.rpc
      .getLatestBlockhash()
      .send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
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
   * Get current owner of an agent
   *
   * Finds the token account holding the NFT and returns its owner.
   *
   * @param mint - Agent NFT mint address
   * @returns Owner address
   */
  async getAgentOwner(mint: Address): Promise<Address> {
    // For NFTs (supply=1), we can use getTokenLargestAccounts to find the holder
    const response = await this.rpc
      .getTokenLargestAccounts(mint, { commitment: "confirmed" })
      .send();

    if (!response.value || response.value.length === 0) {
      throw new Error(`No token accounts found for mint ${mint}`);
    }

    // Find the account with balance > 0 (the holder)
    const holderAccount = response.value.find(
      (acc: { address: string; amount: string }) => BigInt(acc.amount) > 0n,
    );

    if (!holderAccount) {
      throw new Error(`No holder found for agent ${mint}`);
    }

    // Fetch the token account to get its owner
    const tokenAccount = await fetchToken2022Token(
      this.rpc,
      address(holderAccount.address),
    );

    return tokenAccount.data.owner;
  }

  // ============================================================
  // COMPRESSED ATTESTATIONS (Light Protocol)
  // ============================================================

  /**
   * Create a Feedback attestation (compressed storage)
   *
   * Uses Light Protocol for cost-efficient storage (~$0.002 per attestation).
   * Requires both agent and counterparty signatures.
   *
   * @param params - Feedback parameters
   * @returns Attestation address and signature
   */
  async createFeedback(
    params: CreateFeedbackParams,
  ): Promise<AttestationResult> {
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

    // Serialize feedback data
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

    // Build signatures array
    const signatures: GeneratedSignatureData[] = [
      {
        pubkey: agentSignature.pubkey,
        sig: agentSignature.signature as unknown as Uint8Array & { length: 64 },
      },
      {
        pubkey: counterpartySignature.pubkey,
        sig: counterpartySignature.signature as unknown as Uint8Array & {
          length: 64;
        },
      },
    ];

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Get Light Protocol proof and remaining accounts
    const light = await this.getLightClient();

    // Compute seeds for address derivation
    // Must match program's derive_address seeds:
    //   ["attestation", sas_schema, token_account, nonce]
    // where nonce = compute_attestation_nonce(task_ref, sas_schema, token_account, counterparty)
    const addressEncoder = getAddressEncoder();
    const nonce = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty,
    );
    const sasSchemaBytes = new Uint8Array(addressEncoder.encode(sasSchema));
    const tokenAccountBytesForSeed = new Uint8Array(
      addressEncoder.encode(tokenAccount),
    );
    const seeds = [
      new TextEncoder().encode("attestation"),
      sasSchemaBytes,
      tokenAccountBytesForSeed,
      nonce,
    ];

    // Get validity proof and packed accounts for creating compressed account
    const {
      address: derivedAddress,
      proof: proofResult,
      addressTreeInfo: packedAddressTreeInfo,
      outputStateTreeIndex,
      remainingAccounts,
    } = await light.prepareCreate(seeds);

    // Convert Light Protocol proof format to instruction format
    // The instruction expects Option<CompressedProof> where CompressedProof has { a, b, c }
    const proof: ValidityProofArgs = proofResult.compressedProof
      ? [
          {
            a: new Uint8Array(proofResult.compressedProof.a),
            b: new Uint8Array(proofResult.compressedProof.b),
            c: new Uint8Array(proofResult.compressedProof.c),
          },
        ]
      : [null];

    // Address tree info from Light Protocol
    const addressTreeInfo: PackedAddressTreeInfoArgs = {
      addressMerkleTreePubkeyIndex:
        packedAddressTreeInfo.addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex: packedAddressTreeInfo.addressQueuePubkeyIndex,
      rootIndex: packedAddressTreeInfo.rootIndex,
    };

    // Build base instruction
    const baseCreateIx = await getCreateAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Feedback,
      data,
      signatures,
      outputStateTreeIndex,
      proof,
      addressTreeInfo,
    });

    // Append remaining accounts to the instruction
    // The generated instruction is frozen, so we create a new object
    const createIx = {
      ...baseCreateIx,
      accounts: [
        ...baseCreateIx.accounts,
        ...remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable
            ? acc.isSigner
              ? 3 // AccountRole.WRITABLE_SIGNER
              : 1 // AccountRole.WRITABLE
            : acc.isSigner
              ? 2 // AccountRole.READONLY_SIGNER
              : 0, // AccountRole.READONLY
        })),
      ],
    };

    // Compute expected message hashes for Ed25519 verification
    const interactionHash = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash,
    );
    const feedbackHash = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      outcome,
    );

    // Create single Ed25519 instruction verifying both signatures (saves ~100 bytes)
    const ed25519Ix = createBatchEd25519Instruction([
      {
        publicKey: new Uint8Array(addressEncoder.encode(agentSignature.pubkey)),
        message: interactionHash,
        signature: agentSignature.signature,
      },
      {
        publicKey: new Uint8Array(
          addressEncoder.encode(counterpartySignature.pubkey),
        ),
        message: feedbackHash,
        signature: counterpartySignature.signature,
      },
    ]);

    // Build and send transaction (Ed25519 instruction must come first)
    const signature = await this.buildAndSendTransaction(
      [ed25519Ix, createIx],
      payer,
      lookupTableAddress,
    );

    // Return the derived compressed account address
    return {
      address: address(derivedAddress.toBase58()),
      signature,
    };
  }

  /**
   * Create a Validation attestation (compressed storage)
   *
   * Uses Light Protocol for cost-efficient storage.
   * Requires both agent and validator signatures.
   *
   * @param params - Validation parameters
   * @returns Attestation address and signature
   */
  async createValidation(
    params: CreateValidationParams,
  ): Promise<AttestationResult> {
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

    // Validate response
    if (response > 100) {
      throw new Error("Response must be 0-100");
    }

    // Serialize validation data
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

    // Build signatures array
    const signatures: GeneratedSignatureData[] = [
      {
        pubkey: agentSignature.pubkey,
        sig: agentSignature.signature as unknown as Uint8Array & { length: 64 },
      },
      {
        pubkey: validatorSignature.pubkey,
        sig: validatorSignature.signature as unknown as Uint8Array & {
          length: 64;
        },
      },
    ];

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Get Light Protocol proof and remaining accounts
    const light = await this.getLightClient();

    // Compute seeds for address derivation
    // Must match program's derive_address seeds:
    //   ["attestation", sas_schema, token_account, nonce]
    // where nonce = compute_attestation_nonce(task_ref, sas_schema, token_account, counterparty)
    const addressEncoder = getAddressEncoder();
    const nonce = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty,
    );
    const seeds = [
      new TextEncoder().encode("attestation"),
      new Uint8Array(addressEncoder.encode(sasSchema)),
      new Uint8Array(addressEncoder.encode(tokenAccount)),
      nonce,
    ];

    // Get validity proof and packed accounts for creating compressed account
    const {
      address: derivedAddress,
      proof: proofResult,
      addressTreeInfo: packedAddressTreeInfo,
      outputStateTreeIndex,
      remainingAccounts,
    } = await light.prepareCreate(seeds);

    // Convert Light Protocol proof format to instruction format
    const proof: ValidityProofArgs = proofResult.compressedProof
      ? [
          {
            a: new Uint8Array(proofResult.compressedProof.a),
            b: new Uint8Array(proofResult.compressedProof.b),
            c: new Uint8Array(proofResult.compressedProof.c),
          },
        ]
      : [null];

    // Address tree info from Light Protocol
    const addressTreeInfo: PackedAddressTreeInfoArgs = {
      addressMerkleTreePubkeyIndex:
        packedAddressTreeInfo.addressMerkleTreePubkeyIndex,
      addressQueuePubkeyIndex: packedAddressTreeInfo.addressQueuePubkeyIndex,
      rootIndex: packedAddressTreeInfo.rootIndex,
    };

    // Build base instruction
    const baseCreateIx = await getCreateAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Validation,
      data,
      signatures,
      outputStateTreeIndex,
      proof,
      addressTreeInfo,
    });

    // Append remaining accounts to the instruction
    const createIx = {
      ...baseCreateIx,
      accounts: [
        ...baseCreateIx.accounts,
        ...remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable
            ? acc.isSigner
              ? 3 // AccountRole.WRITABLE_SIGNER
              : 1 // AccountRole.WRITABLE
            : acc.isSigner
              ? 2 // AccountRole.READONLY_SIGNER
              : 0, // AccountRole.READONLY
        })),
      ],
    };

    // Compute expected message hashes for Ed25519 verification
    const interactionHash = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash,
    );
    const validationHash = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      response,
    );

    // Create single Ed25519 instruction verifying both signatures (saves ~100 bytes)
    const ed25519Ix = createBatchEd25519Instruction([
      {
        publicKey: new Uint8Array(addressEncoder.encode(agentSignature.pubkey)),
        message: interactionHash,
        signature: agentSignature.signature,
      },
      {
        publicKey: new Uint8Array(
          addressEncoder.encode(validatorSignature.pubkey),
        ),
        message: validationHash,
        signature: validatorSignature.signature,
      },
    ]);

    // Build and send transaction (Ed25519 instruction must come first)
    const signature = await this.buildAndSendTransaction(
      [ed25519Ix, createIx],
      payer,
      lookupTableAddress,
    );

    // Return the derived compressed account address
    return {
      address: address(derivedAddress.toBase58()),
      signature,
    };
  }

  /**
   * Close a compressed attestation (Light Protocol)
   *
   * Closes a Feedback or Validation attestation and returns any associated
   * rent to the payer. Only the counterparty from the original attestation
   * can authorize the close.
   *
   * @param params - Close parameters
   * @returns Transaction signature
   */
  async closeCompressedAttestation(
    params: CloseCompressedAttestationParams,
  ): Promise<CloseAttestationResult> {
    const {
      payer,
      counterparty,
      sasSchema,
      attestationAddress,
      lookupTableAddress,
    } = params;

    // 1. Fetch the attestation by address
    const light = await this.getLightClient();
    const parsedAttestation =
      await light.getAttestationByAddress(attestationAddress);

    if (!parsedAttestation) {
      throw new Error(`Attestation not found at address ${attestationAddress}`);
    }

    // 2. Verify the signer is the counterparty
    // Counterparty is at offset 64-96 in the attestation data
    const addressEncoder = getAddressEncoder();
    const counterpartyBytes = parsedAttestation.attestation.data.slice(64, 96);
    const expectedCounterpartyBytes = new Uint8Array(
      addressEncoder.encode(counterparty.address),
    );

    // Compare byte arrays
    const isCounterparty =
      counterpartyBytes.length === expectedCounterpartyBytes.length &&
      counterpartyBytes.every(
        (byte, i) => byte === expectedCounterpartyBytes[i],
      );

    if (!isCounterparty) {
      throw new Error(
        "Signer must be the counterparty from the original attestation",
      );
    }

    // 3. Get mutation proof from Light Protocol
    const mutationResult = await light.getMutationProof(parsedAttestation.raw);

    // 4. Build the compressed account meta
    const accountMeta: CompressedAccountMetaArgs = {
      treeInfo: {
        rootIndex: mutationResult.stateTreeInfo.rootIndex,
        proveByIndex: true,
        merkleTreePubkeyIndex:
          mutationResult.stateTreeInfo.merkleTreePubkeyIndex,
        queuePubkeyIndex: mutationResult.stateTreeInfo.queuePubkeyIndex,
        leafIndex: mutationResult.stateTreeInfo.leafIndex,
      },
      address: parsedAttestation.address,
      outputStateTreeIndex: mutationResult.outputStateTreeIndex,
    };

    // 5. Convert proof format
    const proof: ValidityProofArgs = mutationResult.proof.compressedProof
      ? [
          {
            a: new Uint8Array(mutationResult.proof.compressedProof.a),
            b: new Uint8Array(mutationResult.proof.compressedProof.b),
            c: new Uint8Array(mutationResult.proof.compressedProof.c),
          },
        ]
      : [null];

    // 6. Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // 7. Build the close instruction
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

    // 8. Append remaining accounts
    const closeIx = {
      ...baseCloseIx,
      accounts: [
        ...baseCloseIx.accounts,
        ...mutationResult.remainingAccounts.map((acc) => ({
          address: address(acc.pubkey.toBase58()),
          role: acc.isWritable
            ? acc.isSigner
              ? 3 // AccountRole.WRITABLE_SIGNER
              : 1 // AccountRole.WRITABLE
            : acc.isSigner
              ? 2 // AccountRole.READONLY_SIGNER
              : 0, // AccountRole.READONLY
        })),
      ],
    };

    // 9. Build and send transaction
    const signature = await this.buildAndSendTransaction(
      [closeIx],
      payer,
      lookupTableAddress,
    );

    return { signature };
  }

  /**
   * Close a regular SAS attestation (ReputationScore)
   *
   * Closes a ReputationScore attestation and returns the rent to the payer.
   * Only the provider who created the score can authorize the close.
   *
   * @param params - Close parameters
   * @returns Transaction signature
   */
  async closeRegularAttestation(
    params: CloseRegularAttestationParams,
  ): Promise<CloseAttestationResult> {
    const { payer, provider, sasSchema, satiCredential, attestation } = params;

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Build the close instruction
    const closeIx = await getCloseRegularAttestationInstructionAsync({
      payer,
      signer: provider,
      schemaConfig: schemaConfigPda,
      satiCredential,
      attestation,
      program: SATI_PROGRAM_ADDRESS,
    });

    // Build and send transaction
    const signature = await this.buildAndSendTransaction([closeIx], payer);

    return { signature };
  }

  // ============================================================
  // REGULAR ATTESTATIONS (SAS)
  // ============================================================

  /**
   * Create a ReputationScore attestation (regular SAS storage)
   *
   * Provider-computed scores stored on-chain for direct queryability.
   * One score per (provider, agent) pair - updates replace previous.
   *
   * @param params - ReputationScore parameters
   * @returns Attestation address and signature
   */
  async createReputationScore(
    params: CreateReputationScoreParams,
  ): Promise<AttestationResult> {
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

    // Validate score
    if (score > 100) {
      throw new Error("Score must be 0-100");
    }

    // Validate signature length
    if (providerSignature.length !== 64) {
      throw new Error("Provider signature must be 64 bytes");
    }

    // Compute deterministic nonce from (provider, tokenAccount)
    const nonce = computeReputationNonce(provider, tokenAccount);

    // Serialize reputation score data
    const reputationData: ReputationScoreData = {
      taskRef: nonce,
      tokenAccount,
      counterparty: provider,
      score,
      contentType,
      content,
    };
    const data = serializeReputationScore(reputationData);

    // Compute message hash that provider signed
    const messageHash = computeReputationHash(
      sasSchema,
      tokenAccount,
      provider,
      score,
    );

    // Derive the attestation PDA using the nonce
    const [attestationPda] = await deriveReputationAttestationPda(nonce);

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Create Ed25519 instruction for provider signature verification
    const addressEncoder = getAddressEncoder();
    const ed25519Ix = createBatchEd25519Instruction([
      {
        publicKey: new Uint8Array(addressEncoder.encode(provider)),
        message: messageHash,
        signature: providerSignature,
      },
    ]);

    // Build the create regular attestation instruction
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

    // Build and send transaction (Ed25519 instruction must come first)
    const signature = await this.buildAndSendTransaction(
      [ed25519Ix, createIx],
      payer,
    );

    return {
      address: attestationPda,
      signature,
    };
  }

  // ============================================================
  // QUERY METHODS
  // ============================================================

  /**
   * List Feedback attestations for an agent
   *
   * Queries Photon for compressed attestations.
   *
   * @param tokenAccount - Agent's token account address
   * @param filter - Optional filters
   * @returns Array of parsed attestations
   */
  async listFeedbacks(
    tokenAccount: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    const light = await this.getLightClient();
    return light.listFeedbacks(tokenAccount, filter);
  }

  /**
   * List Validation attestations for an agent
   *
   * Queries Photon for compressed attestations.
   *
   * @param tokenAccount - Agent's token account address
   * @param filter - Optional filters
   * @returns Array of parsed attestations
   */
  async listValidations(
    tokenAccount: Address,
    filter?: Partial<AttestationFilter>,
  ): Promise<ParsedAttestation[]> {
    const light = await this.getLightClient();
    return light.listValidations(tokenAccount, filter);
  }

  /**
   * Get a ReputationScore for an agent from a specific provider
   *
   * Queries on-chain SAS attestation.
   *
   * @param provider - Reputation provider address
   * @param tokenAccount - Agent's token account address
   * @returns ReputationScore data or null if not found
   */
  async getReputationScore(
    provider: Address,
    tokenAccount: Address,
  ): Promise<ReputationScoreData | null> {
    // Compute deterministic nonce (same as on-chain)
    const nonce = computeReputationNonce(provider, tokenAccount);

    // Derive the attestation PDA
    const [attestationPda] = await deriveReputationAttestationPda(nonce);

    // Fetch the account
    const accountInfo = await this.rpc
      .getAccountInfo(attestationPda, { encoding: "base64" })
      .send();

    if (!accountInfo.value) {
      return null;
    }

    // Decode base64 data (browser-compatible)
    const base64Data = accountInfo.value.data[0];
    const binaryString = atob(base64Data);
    const data = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      data[i] = binaryString.charCodeAt(i);
    }

    if (data.length < SAS_HEADER_SIZE) {
      return null;
    }

    // Extract SATI data payload (after SAS header)
    const satiData = new Uint8Array(data.subarray(SAS_HEADER_SIZE));

    // Deserialize the ReputationScore data
    return deserializeReputationScore(satiData);
  }

  // ============================================================
  // SIGNATURE HELPERS
  // ============================================================

  /**
   * Build the interaction hash that the agent should sign (blind to outcome)
   *
   * @param sasSchema - SAS schema address
   * @param taskRef - Task reference (32 bytes)
   * @param tokenAccount - Agent's token account
   * @param dataHash - Hash of interaction data (32 bytes)
   * @returns 32-byte keccak256 hash
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
   *
   * @param sasSchema - SAS schema address
   * @param taskRef - Task reference (32 bytes)
   * @param tokenAccount - Agent's token account
   * @param outcome - Feedback outcome
   * @returns 32-byte keccak256 hash
   */
  buildFeedbackHash(
    sasSchema: Address,
    taskRef: Uint8Array,
    tokenAccount: Address,
    outcome: Outcome,
  ): Uint8Array {
    return computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);
  }

  /**
   * Build the validation hash that the validator should sign (with response)
   *
   * @param sasSchema - SAS schema address
   * @param taskRef - Task reference (32 bytes)
   * @param tokenAccount - Agent's token account
   * @param response - Validation response (0-100)
   * @returns 32-byte keccak256 hash
   */
  buildValidationHash(
    sasSchema: Address,
    taskRef: Uint8Array,
    tokenAccount: Address,
    response: number,
  ): Uint8Array {
    return computeValidationHash(sasSchema, taskRef, tokenAccount, response);
  }

  /**
   * Build the reputation hash that the provider should sign
   *
   * @param sasSchema - SAS schema address
   * @param tokenAccount - Agent's token account
   * @param provider - Provider's address
   * @param score - Reputation score (0-100)
   * @returns 32-byte keccak256 hash
   */
  buildReputationHash(
    sasSchema: Address,
    tokenAccount: Address,
    provider: Address,
    score: number,
  ): Uint8Array {
    return computeReputationHash(sasSchema, tokenAccount, provider, score);
  }

  // ============================================================
  // SCHEMA CONFIG
  // ============================================================

  /**
   * Register a schema configuration
   *
   * Defines how a SAS schema should be handled by SATI.
   *
   * @param params - Schema config parameters
   */
  async registerSchemaConfig(params: {
    /** Payer for transaction */
    payer: KeyPairSigner;
    /** Authority (must sign) */
    authority: KeyPairSigner;
    /** SAS schema address */
    sasSchema: Address;
    /** Signature verification mode */
    signatureMode: SignatureMode;
    /** Storage backend type */
    storageType: StorageType;
    /** Whether attestations can be closed */
    closeable: boolean;
  }): Promise<{ signature: string }> {
    const {
      payer,
      authority,
      sasSchema,
      signatureMode,
      storageType,
      closeable,
    } = params;

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

    const { value: latestBlockhash } = await this.rpc
      .getLatestBlockhash()
      .send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
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
   *
   * @param sasSchema - SAS schema address
   * @returns Schema config or null if not found
   */
  async getSchemaConfig(sasSchema: Address): Promise<{
    signatureMode: SignatureMode;
    storageType: StorageType;
    closeable: boolean;
  } | null> {
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    try {
      const schemaConfig = await fetchSchemaConfig(this.rpc, schemaConfigPda);

      // Parse enum values from IDL format
      const signatureMode = schemaConfig.data
        .signatureMode as unknown as SignatureMode;
      const storageType = schemaConfig.data
        .storageType as unknown as StorageType;

      return {
        signatureMode,
        storageType,
        closeable: schemaConfig.data.closeable,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // SAS DEPLOYMENT
  // ============================================================

  /**
   * Setup SATI SAS schemas
   *
   * Deploys SATI credential and all required schemas to the SAS program.
   * This is an admin operation typically run once per network.
   *
   * Creates:
   * - SATI credential with SATI PDA as authorized signer
   * - feedbackAuth schema
   * - feedback schema
   * - feedbackResponse schema
   * - validationRequest schema
   * - validationResponse schema
   * - certification schema
   * - reputationScore schema
   *
   * @internal This method is not yet implemented. Use scripts/deploy-sas-schemas.ts instead.
   * @throws Always throws - implementation requires SAS SDK integration
   * @param params - Setup parameters
   * @returns Deployment result with addresses and signatures
   */
  async setupSASSchemas(params: {
    /** Payer for transaction fees and account rent */
    payer: KeyPairSigner;
    /** Authority that will control the SATI credential */
    authority: KeyPairSigner;
    /** Deploy test schemas (v0) instead of production */
    testMode?: boolean;
  }): Promise<SASDeploymentResult> {
    const { authority, testMode } = params;
    const mode = testMode ? "test" : "production";

    // TODO: Implement full SAS credential and schema deployment
    // This requires:
    // 1. Import SAS SDK: getCreateCredentialInstruction, getCreateSchemaInstruction
    // 2. Derive SATI authority PDA
    // 3. Check if credential exists, create if not
    // 4. Add SATI PDA as authorized signer on the credential
    // 5. Create each schema (feedbackAuth, feedback, feedbackResponse, etc.)
    // 6. Register SchemaConfig in SATI for each schema
    // 7. Return deployment result

    throw new Error(
      `setupSASSchemas: Not yet implemented for authority ${authority.address} (${mode} mode). ` +
        "Requires SAS SDK integration. Use scripts/deploy-sas-schemas.ts instead.",
    );
  }
}
