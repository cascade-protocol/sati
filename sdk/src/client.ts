/**
 * SATI Client - High-Level SDK Interface
 *
 * Provides a convenient wrapper around the generated Codama client
 * and SAS attestation operations for the Solana Agent Trust Infrastructure.
 *
 * Features:
 * - Agent registration via Token-2022 NFT minting
 * - Reputation management via SAS attestations (ERC-8004 compatible)
 * - Validation request/response workflows
 *
 * @see https://github.com/ethereum/ERCs/blob/master/ERCS/erc-8004.md
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
  fetchRegistryConfig,
} from "./generated";

import {
  findGroupMintPda,
  findAssociatedTokenAddress,
  findRegistryConfigPda,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "./helpers";

import {
  deriveSatiAttestationPda,
  deriveEventAuthorityAddress,
  deriveCredentialPda,
  deriveSchemaPda,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  getCreateAttestationInstruction,
  getCloseAttestationInstruction,
  fetchSchema,
  fetchAttestation,
  fetchMaybeCredential,
  fetchAllMaybeSchema,
  deserializeAttestationData,
  serializeFeedbackAuthData,
  serializeFeedbackData,
  serializeFeedbackResponseData,
  serializeValidationRequestData,
  serializeValidationResponseData,
  computeFeedbackAuthNonce,
  computeFeedbackNonce,
  computeFeedbackResponseNonce,
  computeValidationRequestNonce,
  computeValidationResponseNonce,
  SATI_CREDENTIAL_NAME,
  SATI_SCHEMA_NAMES,
  SATI_SAS_SCHEMAS,
  SAS_PROGRAM_ID,
  type SATISASConfig,
} from "./sas";

import type {
  AgentIdentity,
  Feedback,
  ValidationStatus,
  RegisterAgentResult,
  AttestationResult,
  SATIClientOptions,
  SASDeploymentResult,
  SchemaDeploymentStatus,
} from "./types";

import { loadDeployedConfig } from "./deployed";

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
 * Used after setTransactionMessageLifetimeUsingBlockhash to satisfy
 * sendAndConfirmTransactionFactory's type requirements.
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
 * // Load agent identity
 * const agent = await sati.loadAgent(mint);
 * ```
 */
export class SATI {
  private rpc: ReturnType<typeof createSolanaRpc>;
  private rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
  private sendAndConfirm: ReturnType<typeof sendAndConfirmTransactionFactory>;
  private network: "mainnet" | "devnet" | "localnet";
  private sasConfig: SATISASConfig | null = null;

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

    // Auto-load deployed SAS config if available for this network
    const deployedConfig = loadDeployedConfig(this.network);
    if (deployedConfig) {
      this.sasConfig = deployedConfig;
    }
  }

  /**
   * Set SAS configuration for reputation/validation operations
   *
   * This should be called after SATI schemas are deployed to the network.
   * Use setupSASSchemas() to deploy schemas if they don't exist yet.
   *
   * @param config - SAS credential and schema addresses
   */
  setSASConfig(config: SATISASConfig): void {
    this.sasConfig = config;
  }

  /**
   * Get current SAS configuration
   */
  getSASConfig(): SATISASConfig | null {
    return this.sasConfig;
  }

  /**
   * Ensure SAS config is set, throw if not
   */
  private requireSASConfig(): SATISASConfig {
    if (!this.sasConfig) {
      throw new Error(
        "SAS configuration not set. Call setSASConfig() or setupSASSchemas() first.",
      );
    }
    return this.sasConfig;
  }

  // ============================================================
  // REGISTRY
  // ============================================================

  /**
   * Register a new agent identity
   *
   * Creates a Token-2022 NFT with metadata and group membership atomically.
   *
   * **Compute Budget Note:**
   * Each additional metadata entry adds ~5-10k compute units.
   * When using >5 entries, the on-chain program logs a warning suggesting
   * 400k CUs. If transactions fail with compute exceeded, prepend a
   * SetComputeUnitLimit instruction to your transaction.
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

    // Derive PDAs
    const [groupMint] = await findGroupMintPda();
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

    // Get member number from registry
    const [registryConfigAddress] = await findRegistryConfigPda();
    const registryConfig = await fetchRegistryConfig(
      this.rpc,
      registryConfigAddress,
    );
    const memberNumber = registryConfig.data.totalAgents;

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
   * Update agent metadata
   *
   * Directly calls Token-2022 updateTokenMetadataField instruction.
   * Requires owner signature.
   *
   * Note: This method requires building raw instructions for the
   * spl-token-metadata-interface. For now, use @solana/spl-token directly
   * or the Anchor client for metadata updates.
   *
   * @param _mint - Agent NFT mint address
   * @param _updates - Fields to update
   */
  async updateAgentMetadata(
    _mint: Address,
    _updates: {
      name?: string;
      uri?: string;
      additionalMetadata?: Array<{ key: string; value: string }>;
    },
  ): Promise<void> {
    // Token-2022 metadata updates require the spl-token-metadata-interface
    // which needs to be called via raw instruction building.
    // This is better done through @solana/spl-token or direct instruction construction.
    throw new Error(
      "updateAgentMetadata requires spl-token-metadata-interface - use @solana/spl-token updateTokenMetadataField() directly",
    );
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
    // This returns accounts sorted by balance descending
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

  /**
   * List registered agents
   *
   * Uses getProgramAccounts to find all SATI agent NFTs.
   * For better performance at scale, use an indexer.
   *
   * @param params - Pagination parameters
   * @returns Array of agent identities
   */
  async listAgents(params?: {
    offset?: number;
    limit?: number;
  }): Promise<AgentIdentity[]> {
    const { offset = 0, limit = 100 } = params ?? {};

    // Get the group mint to filter by collection
    const [groupMint] = await findGroupMintPda();

    // Use getProgramAccounts to find all mints that are members of the SATI group
    // Filter by GroupMemberPointer extension pointing to our group
    const accounts = await this.rpc
      .getProgramAccounts(TOKEN_2022_PROGRAM_ADDRESS, {
        commitment: "confirmed",
        encoding: "base64",
        // Mints are 82 bytes base + extensions, filter by minimum size
        dataSlice: { offset: 0, length: 0 }, // Just get addresses first
      })
      .send();

    // Load agents in batches
    const agents: AgentIdentity[] = [];
    const addressesToCheck = accounts
      .slice(offset, offset + limit * 2) // Fetch extra since some may not be agents
      .map((acc: { pubkey: Address }) => acc.pubkey);

    for (const addr of addressesToCheck) {
      if (agents.length >= limit) break;

      const agent = await this.loadAgent(addr);
      if (agent) {
        // Verify it belongs to our registry by checking group membership
        const mintAccount = await fetchToken2022Mint(this.rpc, addr);
        const extensions = unwrapOption(
          mintAccount.data.extensions as
            | { __option: "Some"; value: Extension[] }
            | { __option: "None" },
        );

        if (extensions) {
          const groupMemberExt = extensions.find(
            (
              ext: Extension,
            ): ext is Extension & { __kind: "TokenGroupMember" } =>
              ext.__kind === "TokenGroupMember",
          );

          if (groupMemberExt && groupMemberExt.group === groupMint) {
            agents.push(agent);
          }
        }
      }
    }

    return agents;
  }

  // ============================================================
  // REPUTATION (SAS)
  // ============================================================

  /**
   * Authorize a client to submit feedback
   *
   * Creates a FeedbackAuth attestation via SAS.
   * Must be called by the agent owner.
   *
   * @param params - Authorization parameters
   * @returns Attestation address and signature
   */
  async authorizeFeedback(params: {
    /** Payer for transaction */
    payer: KeyPairSigner;
    /** Agent owner (must sign) */
    agentOwner: KeyPairSigner;
    /** Agent NFT mint address */
    agentMint: Address;
    /** Client to authorize */
    client: Address;
    /** Maximum feedback index allowed (ERC-8004: indexLimit) */
    indexLimit: number;
    /** Expiration timestamp (0 = no expiry) */
    expiry?: number;
  }): Promise<AttestationResult> {
    const sasConfig = this.requireSASConfig();
    const {
      payer,
      agentOwner,
      agentMint,
      client,
      indexLimit,
      expiry = 0,
    } = params;

    // Derive attestation PDA
    const nonce = computeFeedbackAuthNonce(agentMint, client);
    const [attestationPda] = await deriveSatiAttestationPda(
      sasConfig.credential,
      sasConfig.schemas.feedbackAuth,
      nonce,
    );

    // Fetch schema for serialization
    const schema = await fetchSchema(this.rpc, sasConfig.schemas.feedbackAuth);

    // Serialize attestation data
    const data = serializeFeedbackAuthData(
      {
        agent_mint: agentMint,
        index_limit: indexLimit,
        expiry,
      },
      schema.data,
    );

    // Calculate expiry timestamp (1 year from now if not specified)
    const expiryTimestamp =
      expiry || Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

    // Create attestation instruction
    const createAttestationIx = await getCreateAttestationInstruction({
      payer,
      authority: agentOwner,
      credential: sasConfig.credential,
      schema: sasConfig.schemas.feedbackAuth,
      attestation: attestationPda,
      nonce,
      expiry: expiryTimestamp,
      data,
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
      (msg) => appendTransactionMessageInstruction(createAttestationIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    return {
      attestation: attestationPda,
      signature: signature.toString(),
    };
  }

  /**
   * Revoke feedback authorization
   *
   * Closes the FeedbackAuth attestation and reclaims rent.
   *
   * @param params - Revocation parameters
   */
  async revokeAuthorization(params: {
    /** Payer (receives rent refund) */
    payer: KeyPairSigner;
    /** Authority who created the attestation */
    authority: KeyPairSigner;
    /** FeedbackAuth attestation address to revoke */
    attestation: Address;
  }): Promise<{ signature: string }> {
    const sasConfig = this.requireSASConfig();
    const { payer, authority, attestation } = params;

    // Get event authority for close instruction
    const eventAuthority = await deriveEventAuthorityAddress();

    // Create close attestation instruction
    const closeIx = await getCloseAttestationInstruction({
      payer,
      attestation,
      authority,
      credential: sasConfig.credential,
      eventAuthority,
      attestationProgram: SAS_PROGRAM_ID,
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
      (msg) => appendTransactionMessageInstruction(closeIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);
    return { signature: signature.toString() };
  }

  /**
   * Submit feedback for an agent
   *
   * Creates a Feedback attestation via SAS.
   * Requires prior authorization from agent owner via authorizeFeedback().
   *
   * @param params - Feedback parameters
   * @returns Attestation address and signature
   */
  async giveFeedback(params: {
    /** Payer for transaction */
    payer: KeyPairSigner;
    /** Client submitting feedback (must be authorized) */
    client: KeyPairSigner;
    /** Agent NFT mint receiving feedback */
    agentMint: Address;
    /** Score 0-100 */
    score: number;
    /** Optional tag (ERC-8004: tag1) */
    tag1?: string;
    /** Optional tag (ERC-8004: tag2) */
    tag2?: string;
    /** Off-chain feedback file URI (ERC-8004: fileuri) */
    fileuri?: string;
    /** File hash (ERC-8004: filehash) */
    filehash?: Uint8Array;
    /** x402 payment proof reference */
    paymentProof?: string;
  }): Promise<AttestationResult> {
    const sasConfig = this.requireSASConfig();
    const {
      payer,
      client,
      agentMint,
      score,
      tag1,
      tag2,
      fileuri,
      filehash,
      paymentProof,
    } = params;

    // Validate score
    if (score < 0 || score > 100) {
      throw new Error("Score must be between 0 and 100");
    }

    // Derive attestation PDA with timestamp-based nonce
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = computeFeedbackNonce(agentMint, client.address, timestamp);
    const [attestationPda] = await deriveSatiAttestationPda(
      sasConfig.credential,
      sasConfig.schemas.feedback,
      nonce,
    );

    // Fetch schema for serialization
    const schema = await fetchSchema(this.rpc, sasConfig.schemas.feedback);

    // Serialize attestation data
    const data = serializeFeedbackData(
      {
        agent_mint: agentMint,
        score,
        tag1,
        tag2,
        fileuri,
        filehash,
        payment_proof: paymentProof,
      },
      schema.data,
    );

    // Default expiry: never (0 means use schema default or never)
    const expiryTimestamp = 0;

    // Create attestation instruction
    const createAttestationIx = await getCreateAttestationInstruction({
      payer,
      authority: client,
      credential: sasConfig.credential,
      schema: sasConfig.schemas.feedback,
      attestation: attestationPda,
      nonce,
      expiry: expiryTimestamp,
      data,
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
      (msg) => appendTransactionMessageInstruction(createAttestationIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    return {
      attestation: attestationPda,
      signature: signature.toString(),
    };
  }

  /**
   * Revoke submitted feedback
   *
   * Closes the Feedback attestation and reclaims rent.
   *
   * @param params - Revocation parameters
   */
  async revokeFeedback(params: {
    /** Payer (receives rent refund) */
    payer: KeyPairSigner;
    /** Client who submitted the feedback */
    client: KeyPairSigner;
    /** Feedback attestation address to revoke */
    attestation: Address;
  }): Promise<{ signature: string }> {
    const sasConfig = this.requireSASConfig();
    const { payer, client, attestation } = params;

    // Get event authority for close instruction
    const eventAuthority = await deriveEventAuthorityAddress();

    // Create close attestation instruction
    const closeIx = await getCloseAttestationInstruction({
      payer,
      attestation,
      authority: client,
      credential: sasConfig.credential,
      eventAuthority,
      attestationProgram: SAS_PROGRAM_ID,
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
      (msg) => appendTransactionMessageInstruction(closeIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);
    return { signature: signature.toString() };
  }

  /**
   * Append response to feedback
   *
   * Creates a FeedbackResponse attestation via SAS.
   * Can be called by agent owner, auditor, or anyone.
   *
   * @param params - Response parameters
   * @returns Attestation address and signature
   */
  async appendResponse(params: {
    /** Payer for transaction */
    payer: KeyPairSigner;
    /** Responder (signer) */
    responder: KeyPairSigner;
    /** Feedback attestation being responded to */
    feedbackAttestation: Address;
    /** Off-chain response URI */
    responseUri: string;
    /** Response content hash */
    responseHash?: Uint8Array;
    /** Response index (allows multiple responses, default: 0) */
    responseIndex?: number;
  }): Promise<AttestationResult> {
    const sasConfig = this.requireSASConfig();
    const {
      payer,
      responder,
      feedbackAttestation,
      responseUri,
      responseHash,
      responseIndex = 0,
    } = params;

    // Derive attestation PDA
    const nonce = computeFeedbackResponseNonce(
      feedbackAttestation,
      responder.address,
      responseIndex,
    );
    const [attestationPda] = await deriveSatiAttestationPda(
      sasConfig.credential,
      sasConfig.schemas.feedbackResponse,
      nonce,
    );

    // Fetch schema for serialization
    const schema = await fetchSchema(
      this.rpc,
      sasConfig.schemas.feedbackResponse,
    );

    // Serialize attestation data
    const data = serializeFeedbackResponseData(
      {
        feedback_id: feedbackAttestation,
        response_uri: responseUri,
        response_hash: responseHash,
      },
      schema.data,
    );

    // Create attestation instruction
    const createAttestationIx = await getCreateAttestationInstruction({
      payer,
      authority: responder,
      credential: sasConfig.credential,
      schema: sasConfig.schemas.feedbackResponse,
      attestation: attestationPda,
      nonce,
      expiry: 0, // Never expires
      data,
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
      (msg) => appendTransactionMessageInstruction(createAttestationIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    return {
      attestation: attestationPda,
      signature: signature.toString(),
    };
  }

  /**
   * Read feedback attestation
   *
   * @param attestation - Feedback attestation address
   * @returns Feedback data or null if not found
   */
  async readFeedback(attestation: Address): Promise<Feedback | null> {
    const sasConfig = this.requireSASConfig();

    try {
      // Fetch attestation and schema
      const [attestationAccount, schema] = await Promise.all([
        fetchAttestation(this.rpc, attestation),
        fetchSchema(this.rpc, sasConfig.schemas.feedback),
      ]);

      // Deserialize attestation data
      const data = deserializeAttestationData(
        schema.data,
        attestationAccount.data.data as Uint8Array,
      ) as {
        agent_mint: string;
        score: number;
        tag1: string;
        tag2: string;
        fileuri: string;
        filehash: Uint8Array;
        payment_proof: string;
      };

      return {
        attestation,
        agentMint: address(data.agent_mint),
        score: data.score,
        tag1: data.tag1 || undefined,
        tag2: data.tag2 || undefined,
        fileUri: data.fileuri || undefined,
        fileHash: data.filehash?.length > 0 ? data.filehash : undefined,
        paymentProof: data.payment_proof || undefined,
        issuer: attestationAccount.data.signer,
        expiry: Number(attestationAccount.data.expiry),
        revoked: false, // If we can read it, it's not revoked (closed)
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // VALIDATION (SAS)
  // ============================================================

  /**
   * Request validation from a validator
   *
   * Creates a ValidationRequest attestation via SAS.
   * Must be called by agent owner.
   *
   * @param params - Request parameters
   * @returns Attestation address and signature
   */
  async requestValidation(params: {
    /** Payer for transaction */
    payer: KeyPairSigner;
    /** Agent owner (must sign) */
    agentOwner: KeyPairSigner;
    /** Agent NFT mint requesting validation */
    agentMint: Address;
    /** Validator address */
    validator: Address;
    /** Validation method ("tee", "zkml", "restake") */
    methodId: string;
    /** Off-chain validation request URI */
    requestUri: string;
    /** Request content hash */
    requestHash?: Uint8Array;
  }): Promise<AttestationResult> {
    const sasConfig = this.requireSASConfig();
    const {
      payer,
      agentOwner,
      agentMint,
      validator,
      methodId,
      requestUri,
      requestHash,
    } = params;

    // Derive attestation PDA
    const userNonce = Math.floor(Date.now() / 1000); // Use timestamp as unique nonce
    const nonce = computeValidationRequestNonce(
      agentMint,
      validator,
      userNonce,
    );
    const [attestationPda] = await deriveSatiAttestationPda(
      sasConfig.credential,
      sasConfig.schemas.validationRequest,
      nonce,
    );

    // Fetch schema for serialization
    const schema = await fetchSchema(
      this.rpc,
      sasConfig.schemas.validationRequest,
    );

    // Serialize attestation data
    const data = serializeValidationRequestData(
      {
        agent_mint: agentMint,
        method_id: methodId,
        request_uri: requestUri,
        request_hash: requestHash,
      },
      schema.data,
    );

    // Create attestation instruction
    const createAttestationIx = await getCreateAttestationInstruction({
      payer,
      authority: agentOwner,
      credential: sasConfig.credential,
      schema: sasConfig.schemas.validationRequest,
      attestation: attestationPda,
      nonce,
      expiry: 0, // Never expires
      data,
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
      (msg) => appendTransactionMessageInstruction(createAttestationIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    return {
      attestation: attestationPda,
      signature: signature.toString(),
    };
  }

  /**
   * Respond to a validation request
   *
   * Creates a ValidationResponse attestation via SAS.
   * Called by validators.
   *
   * @param params - Response parameters
   * @returns Attestation address and signature
   */
  async respondToValidation(params: {
    /** Payer for transaction */
    payer: KeyPairSigner;
    /** Validator (must sign) */
    validator: KeyPairSigner;
    /** ValidationRequest attestation being responded to */
    requestAttestation: Address;
    /** Response score 0-100 (0=fail, 100=pass) */
    response: number;
    /** Off-chain response/evidence URI */
    responseUri?: string;
    /** Response content hash */
    responseHash?: Uint8Array;
    /** Optional categorization tag */
    tag?: string;
    /** Response index (allows multiple responses, default: 0) */
    responseIndex?: number;
  }): Promise<AttestationResult> {
    const sasConfig = this.requireSASConfig();
    const {
      payer,
      validator,
      requestAttestation,
      response,
      responseUri,
      responseHash,
      tag,
      responseIndex = 0,
    } = params;

    // Validate response score
    if (response < 0 || response > 100) {
      throw new Error("Response must be between 0 and 100");
    }

    // Derive attestation PDA
    const nonce = computeValidationResponseNonce(
      requestAttestation,
      responseIndex,
    );
    const [attestationPda] = await deriveSatiAttestationPda(
      sasConfig.credential,
      sasConfig.schemas.validationResponse,
      nonce,
    );

    // Fetch schema for serialization
    const schema = await fetchSchema(
      this.rpc,
      sasConfig.schemas.validationResponse,
    );

    // Serialize attestation data
    const data = serializeValidationResponseData(
      {
        request_id: requestAttestation,
        response,
        response_uri: responseUri,
        response_hash: responseHash,
        tag,
      },
      schema.data,
    );

    // Create attestation instruction
    const createAttestationIx = await getCreateAttestationInstruction({
      payer,
      authority: validator,
      credential: sasConfig.credential,
      schema: sasConfig.schemas.validationResponse,
      attestation: attestationPda,
      nonce,
      expiry: 0, // Never expires
      data,
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
      (msg) => appendTransactionMessageInstruction(createAttestationIx, msg),
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    const signature = getSignatureFromTransaction(signedTx);

    return {
      attestation: attestationPda,
      signature: signature.toString(),
    };
  }

  /**
   * Get validation status
   *
   * Fetches the validation request and looks for any responses.
   *
   * @param requestAttestation - ValidationRequest attestation address
   * @param responseIndex - Response index to check (default: 0)
   * @returns Validation status or null if not found
   */
  async getValidationStatus(
    requestAttestation: Address,
    responseIndex: number = 0,
  ): Promise<ValidationStatus | null> {
    const sasConfig = this.requireSASConfig();

    try {
      // Fetch request attestation and schema
      const [requestAccount, requestSchema] = await Promise.all([
        fetchAttestation(this.rpc, requestAttestation),
        fetchSchema(this.rpc, sasConfig.schemas.validationRequest),
      ]);

      // Deserialize request data
      const _requestData = deserializeAttestationData(
        requestSchema.data,
        requestAccount.data.data as Uint8Array,
      ) as {
        agent_mint: string;
        method_id: string;
        request_uri: string;
        request_hash: Uint8Array;
      };

      // Try to find response attestation at the specified index
      const responseNonce = computeValidationResponseNonce(
        requestAttestation,
        responseIndex,
      );
      const [responseAttestationPda] = await deriveSatiAttestationPda(
        sasConfig.credential,
        sasConfig.schemas.validationResponse,
        responseNonce,
      );

      type ValidationResponseData = {
        request_id: string;
        response: number;
        response_uri: string;
        response_hash: Uint8Array;
        tag: string;
      };
      let responseData: ValidationResponseData | null = null;
      let responseAccount: Awaited<ReturnType<typeof fetchAttestation>> | null =
        null;

      try {
        const [respAccount, responseSchema] = await Promise.all([
          fetchAttestation(this.rpc, responseAttestationPda),
          fetchSchema(this.rpc, sasConfig.schemas.validationResponse),
        ]);
        responseAccount = respAccount;
        responseData = deserializeAttestationData(
          responseSchema.data,
          respAccount.data.data as Uint8Array,
        ) as ValidationResponseData;
      } catch {
        // No response yet
      }

      const responseHash = responseData?.response_hash;
      return {
        requestAttestation,
        responseAttestation: responseData ? responseAttestationPda : undefined,
        response: responseData?.response,
        responseUri: responseData?.response_uri || undefined,
        responseHash:
          responseHash && responseHash.length > 0 ? responseHash : undefined,
        tag: responseData?.tag || undefined,
        validator: requestAccount.data.signer, // Request signer is the agent owner
        completed: responseData !== null,
        responseExpiry: responseAccount
          ? Number(responseAccount.data.expiry)
          : undefined,
      };
    } catch {
      return null;
    }
  }

  // ============================================================
  // SAS SETUP
  // ============================================================

  /**
   * Setup SATI SAS schemas with idempotent deployment.
   *
   * This method is safe to call multiple times. It will:
   * 1. Check which components already exist on-chain
   * 2. Deploy only missing credential and schemas
   * 3. Verify all components exist after deployment
   *
   * @param params - Setup parameters
   * @returns Deployment result with status and config
   */
  async setupSASSchemas(params: {
    /** Payer for account creation */
    payer: KeyPairSigner;
    /** Credential authority (controls schema creation) */
    authority: KeyPairSigner;
    /** Authorized signers for attestations */
    authorizedSigners?: Address[];
    /** Deploy test schemas (v0) instead of production schemas */
    testMode?: boolean;
  }): Promise<SASDeploymentResult> {
    const {
      payer,
      authority,
      authorizedSigners = [authority.address],
      testMode = false,
    } = params;

    // Define credential and schema names based on mode
    const credentialName = testMode ? "SATI_TEST_v0" : SATI_CREDENTIAL_NAME;

    // Test mode schema names with v0 suffix to avoid polluting production namespace
    const testSchemaNames = {
      FEEDBACK_AUTH: "TestFeedbackAuth_v0",
      FEEDBACK: "TestFeedback_v0",
      FEEDBACK_RESPONSE: "TestFeedbackResponse_v0",
      VALIDATION_REQUEST: "TestValidationRequest_v0",
      VALIDATION_RESPONSE: "TestValidationResponse_v0",
      CERTIFICATION: "TestCertification_v0",
    } as const;

    const schemaNames = testMode ? testSchemaNames : SATI_SCHEMA_NAMES;

    // Derive credential PDA
    const [credentialPda] = await deriveCredentialPda({
      authority: authority.address,
      name: credentialName,
    });

    // Derive all schema PDAs
    const schemaKeys = [
      "FEEDBACK_AUTH",
      "FEEDBACK",
      "FEEDBACK_RESPONSE",
      "VALIDATION_REQUEST",
      "VALIDATION_RESPONSE",
      "CERTIFICATION",
    ] as const;

    const schemaPdas: Address[] = [];
    for (const key of schemaKeys) {
      const [pda] = await deriveSchemaPda({
        credential: credentialPda,
        name: schemaNames[key],
        version: 1,
      });
      schemaPdas.push(pda);
    }

    // Phase 1: Check existing state
    const credentialAccount = await fetchMaybeCredential(
      this.rpc,
      credentialPda,
    );
    const schemaAccounts = await fetchAllMaybeSchema(this.rpc, schemaPdas);

    const credentialExists = credentialAccount.exists;
    const schemaExistsFlags = schemaAccounts.map((acc) => acc.exists);

    // Phase 2: Build instructions for missing components only
    const instructions: Instruction[] = [];

    if (!credentialExists) {
      instructions.push(
        getCreateCredentialInstruction({
          payer,
          credential: credentialPda,
          authority,
          name: credentialName,
          signers: authorizedSigners,
        }),
      );
    }

    // Build schema definitions with potentially overridden names
    const schemaDefinitions = [
      {
        key: "FEEDBACK_AUTH" as const,
        pda: schemaPdas[0],
        baseSchema: SATI_SAS_SCHEMAS.FEEDBACK_AUTH,
      },
      {
        key: "FEEDBACK" as const,
        pda: schemaPdas[1],
        baseSchema: SATI_SAS_SCHEMAS.FEEDBACK,
      },
      {
        key: "FEEDBACK_RESPONSE" as const,
        pda: schemaPdas[2],
        baseSchema: SATI_SAS_SCHEMAS.FEEDBACK_RESPONSE,
      },
      {
        key: "VALIDATION_REQUEST" as const,
        pda: schemaPdas[3],
        baseSchema: SATI_SAS_SCHEMAS.VALIDATION_REQUEST,
      },
      {
        key: "VALIDATION_RESPONSE" as const,
        pda: schemaPdas[4],
        baseSchema: SATI_SAS_SCHEMAS.VALIDATION_RESPONSE,
      },
      {
        key: "CERTIFICATION" as const,
        pda: schemaPdas[5],
        baseSchema: SATI_SAS_SCHEMAS.CERTIFICATION,
      },
    ];

    for (let i = 0; i < schemaDefinitions.length; i++) {
      if (!schemaExistsFlags[i]) {
        const { key, pda, baseSchema } = schemaDefinitions[i];
        // Use test mode name but keep the original schema layout/description
        const schemaWithName = {
          ...baseSchema,
          name: schemaNames[key],
        };
        instructions.push(
          getCreateSchemaInstruction({
            payer,
            authority,
            credential: credentialPda,
            schema: pda,
            name: schemaWithName.name,
            description: schemaWithName.description,
            layout: new Uint8Array(schemaWithName.layout),
            fieldNames: schemaWithName.fieldNames,
          }),
        );
      }
    }

    // Phase 3: Deploy in batches (to avoid tx size limits)
    // Each schema creation is ~200-300 bytes, so batch 2-3 at a time
    const signatures: string[] = [];
    const BATCH_SIZE = 2; // Conservative batch size for safety

    // Separate credential instruction from schema instructions
    const credentialIx = !credentialExists ? instructions.shift() : null;
    const schemaIxs = instructions; // Remaining are schema instructions

    // Deploy credential first if needed (must exist before schemas)
    if (credentialIx) {
      const { value: latestBlockhash } = await this.rpc
        .getLatestBlockhash()
        .send();

      const tx = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayer(payer.address, msg),
        (msg) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => appendTransactionMessageInstruction(credentialIx, msg),
      );

      const signedTx = await signTransactionMessageWithSigners(tx);
      await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
        commitment: "confirmed",
      });

      const signature = getSignatureFromTransaction(signedTx);
      signatures.push(signature);
    }

    // Deploy schemas in batches
    for (let i = 0; i < schemaIxs.length; i += BATCH_SIZE) {
      const batch = schemaIxs.slice(i, i + BATCH_SIZE);

      const { value: latestBlockhash } = await this.rpc
        .getLatestBlockhash()
        .send();

      const tx = pipe(
        createTransactionMessage({ version: 0 }),
        (msg) => setTransactionMessageFeePayer(payer.address, msg),
        (msg) =>
          setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
        (msg) => appendTransactionMessageInstructions(batch, msg),
      );

      const signedTx = await signTransactionMessageWithSigners(tx);
      await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
        commitment: "confirmed",
      });

      const signature = getSignatureFromTransaction(signedTx);
      signatures.push(signature);
    }

    // Phase 4: Build config and result
    const config: SATISASConfig = {
      credential: credentialPda,
      schemas: {
        feedbackAuth: schemaPdas[0],
        feedback: schemaPdas[1],
        feedbackResponse: schemaPdas[2],
        validationRequest: schemaPdas[3],
        validationResponse: schemaPdas[4],
        certification: schemaPdas[5],
      },
    };

    // Auto-set the config
    this.sasConfig = config;

    // Build schema statuses
    const schemaStatuses: SchemaDeploymentStatus[] = schemaDefinitions.map(
      (item, idx) => ({
        name: schemaNames[item.key],
        address: schemaPdas[idx],
        existed: schemaExistsFlags[idx],
        deployed: !schemaExistsFlags[idx],
      }),
    );

    // Phase 5: Verify deployment
    const verification = await this.verifySASDeployment(config);

    return {
      success: verification.verified,
      credential: {
        address: credentialPda,
        existed: credentialExists,
        deployed: !credentialExists,
      },
      schemas: schemaStatuses,
      signatures,
      config,
    };
  }

  /**
   * Verify that all SAS components exist on-chain.
   *
   * @param config - SAS configuration to verify
   * @returns Verification result with list of missing components
   */
  private async verifySASDeployment(config: SATISASConfig): Promise<{
    verified: boolean;
    missing: string[];
  }> {
    const missing: string[] = [];

    // Check credential
    const credentialAccount = await fetchMaybeCredential(
      this.rpc,
      config.credential,
    );
    if (!credentialAccount.exists) {
      missing.push("credential");
    }

    // Check all schemas
    const schemaAddresses = Object.values(config.schemas);
    const schemaNames = Object.keys(config.schemas);
    const schemaAccounts = await fetchAllMaybeSchema(this.rpc, schemaAddresses);

    schemaAccounts.forEach((acc, idx) => {
      if (!acc.exists) {
        missing.push(schemaNames[idx]);
      }
    });

    return {
      verified: missing.length === 0,
      missing,
    };
  }
}
