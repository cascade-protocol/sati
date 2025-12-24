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
  address,
  getSignatureFromTransaction,
  getProgramDerivedAddress,
  getAddressEncoder,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";

import {
  fetchMint as fetchToken2022Mint,
  fetchToken as fetchToken2022Token,
  getTransferInstruction,
  type Extension,
} from "@solana-program/token-2022";

import {
  getRegisterAgentInstructionAsync,
  getCreateAttestationInstructionAsync,
  getCloseAttestationInstructionAsync,
  getCreateRegularAttestationInstructionAsync,
  getCloseRegularAttestationInstructionAsync,
  getRegisterSchemaConfigInstructionAsync,
  fetchRegistryConfig,
  fetchSchemaConfig,
  fetchMaybeSchemaConfig,
  SATI_PROGRAM_ADDRESS,
  type SignatureData as GeneratedSignatureData,
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
  Outcome,
} from "./hashes";

import {
  DataType,
  ContentType,
  ValidationType,
  SignatureMode,
  StorageType,
  serializeFeedback,
  serializeValidation,
  serializeReputationScore,
  deserializeFeedback,
  deserializeValidation,
  type FeedbackData,
  type ValidationData,
  type ReputationScoreData,
} from "./schemas";

import {
  LightClient,
  createLightClient,
  type ParsedAttestation,
  type AttestationFilter,
} from "./light";

import type {
  AgentIdentity,
  RegisterAgentResult,
  SATIClientOptions,
} from "./types";

// Re-export types
export { Outcome } from "./hashes";
export { DataType, ContentType, ValidationType, SignatureMode, StorageType } from "./schemas";

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
  option: { __option: "Some"; value: T } | { __option: "None" }
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
}

/**
 * Parameters for creating a ReputationScore attestation
 */
export interface CreateReputationScoreParams {
  /** Payer for transaction fees */
  payer: KeyPairSigner;
  /** Provider (reputation scorer) - must sign */
  provider: KeyPairSigner;
  /** SAS schema address */
  sasSchema: Address;
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

    // Initialize Light client if Photon URL provided
    if (options.photonRpcUrl) {
      this.lightClient = createLightClient(options.photonRpcUrl);
    }
  }

  /**
   * Get or create Light Protocol client
   */
  getLightClient(): LightClient {
    if (!this.lightClient) {
      this.lightClient = createLightClient();
    }
    return this.lightClient;
  }

  /**
   * Set Light Protocol client
   */
  setLightClient(client: LightClient): void {
    this.lightClient = client;
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
      registryConfigAddress
    );
    const groupMint = registryConfig.data.groupMint;
    const ownerAddress = owner ?? payer.address;
    const [agentTokenAccount] = await findAssociatedTokenAddress(
      agentMint.address,
      ownerAddress
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
      (msg) => appendTransactionMessageInstruction(registerIx, msg)
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    // Re-fetch registry config to get the updated member number
    const updatedRegistryConfig = await fetchRegistryConfig(
      this.rpc,
      registryConfigAddress
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
      registryConfigAddress
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
          | { __option: "None" }
      );

      if (!extensions) {
        return null;
      }

      // Find TokenMetadata extension
      const metadataExt = extensions.find(
        (ext: Extension): ext is Extension & { __kind: "TokenMetadata" } =>
          ext.__kind === "TokenMetadata"
      );

      if (!metadataExt) {
        return null;
      }

      // Find TokenGroupMember extension for member number
      const groupMemberExt = extensions.find(
        (ext: Extension): ext is Extension & { __kind: "TokenGroupMember" } =>
          ext.__kind === "TokenGroupMember"
      );

      // Find NonTransferable extension
      const nonTransferableExt = extensions.find(
        (ext: Extension) => ext.__kind === "NonTransferable"
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
      (msg) => appendTransactionMessageInstruction(transferIx, msg)
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
      (acc: { address: string; amount: string }) => BigInt(acc.amount) > 0n
    );

    if (!holderAccount) {
      throw new Error(`No holder found for agent ${mint}`);
    }

    // Fetch the token account to get its owner
    const tokenAccount = await fetchToken2022Token(
      this.rpc,
      address(holderAccount.address)
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
        sig: counterpartySignature.signature as unknown as Uint8Array & { length: 64 },
      },
    ];

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Get Light Protocol proof and tree info
    const light = this.getLightClient();
    const outputStateTreeIndex = await light.getOutputStateTreeIndex();

    // For creation, we need empty proof and address tree info
    // In production, these would come from the Photon RPC
    const proofBytes = new Uint8Array(0);
    const addressTreeInfoBytes = new Uint8Array(0);

    // Build instruction
    const createIx = await getCreateAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Feedback,
      data,
      signatures,
      outputStateTreeIndex,
      proofBytes,
      addressTreeInfoBytes,
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
      (msg) => appendTransactionMessageInstruction(createIx, msg)
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    // Compute deterministic address
    const nonce = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);
    const addressBytes = nonce; // Simplified - actual address derivation requires Light Protocol

    return {
      address: address(Buffer.from(addressBytes).toString("base64")),
      signature: signature.toString(),
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
        sig: validatorSignature.signature as unknown as Uint8Array & { length: 64 },
      },
    ];

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // Get Light Protocol proof and tree info
    const light = this.getLightClient();
    const outputStateTreeIndex = await light.getOutputStateTreeIndex();

    const proofBytes = new Uint8Array(0);
    const addressTreeInfoBytes = new Uint8Array(0);

    // Build instruction
    const createIx = await getCreateAttestationInstructionAsync({
      payer,
      schemaConfig: schemaConfigPda,
      program: SATI_PROGRAM_ADDRESS,
      dataType: DataType.Validation,
      data,
      signatures,
      outputStateTreeIndex,
      proofBytes,
      addressTreeInfoBytes,
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
      (msg) => appendTransactionMessageInstruction(createIx, msg)
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    // Compute deterministic address
    const nonce = computeAttestationNonce(taskRef, sasSchema, tokenAccount, counterparty);

    return {
      address: address(Buffer.from(nonce).toString("base64")),
      signature: signature.toString(),
    };
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
  async createReputationScore(params: CreateReputationScoreParams): Promise<AttestationResult> {
    const {
      payer,
      provider,
      sasSchema,
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

    // Compute deterministic task_ref
    const taskRef = computeReputationNonce(provider.address, tokenAccount);

    // Serialize reputation score data
    const reputationData: ReputationScoreData = {
      taskRef,
      tokenAccount,
      counterparty: provider.address,
      score,
      contentType,
      content,
    };
    const data = serializeReputationScore(reputationData);

    // Compute hash for provider signature
    const messageHash = computeReputationHash(sasSchema, tokenAccount, provider.address, score);

    // Get schema config PDA
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    // TODO: Implement proper SAS credential and schema derivation
    // For now, this method is a placeholder - requires additional SAS setup
    throw new Error(
      "createReputationScore: Not yet implemented. Requires SAS credential and schema configuration. " +
      "Use the LightClient for Feedback/Validation attestations instead."
    );

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
    filter?: Partial<AttestationFilter>
  ): Promise<ParsedAttestation[]> {
    const light = this.getLightClient();
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
    filter?: Partial<AttestationFilter>
  ): Promise<ParsedAttestation[]> {
    const light = this.getLightClient();
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
    tokenAccount: Address
  ): Promise<ReputationScoreData | null> {
    // Compute deterministic nonce
    const nonce = computeReputationNonce(provider, tokenAccount);

    // TODO: Query SAS attestation by nonce
    // This requires SAS program integration

    return null;
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
    dataHash: Uint8Array
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
    outcome: Outcome
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
    response: number
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
    score: number
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
    const { payer, authority, sasSchema, signatureMode, storageType, closeable } = params;

    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);

    const registerIx = await getRegisterSchemaConfigInstructionAsync({
      payer,
      authority,
      sasSchema,
      schemaConfig: schemaConfigPda,
      signatureMode: { [SignatureMode[signatureMode]]: {} } as any,
      storageType: { [StorageType[storageType]]: {} } as any,
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
      (msg) => appendTransactionMessageInstruction(registerIx, msg)
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
      const signatureMode = schemaConfig.data.signatureMode as unknown as SignatureMode;
      const storageType = schemaConfig.data.storageType as unknown as StorageType;

      return {
        signatureMode,
        storageType,
        closeable: schemaConfig.data.closeable,
      };
    } catch {
      return null;
    }
  }
}
