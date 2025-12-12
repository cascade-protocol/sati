/**
 * SATI Client - High-Level SDK Interface
 *
 * Provides a convenient wrapper around the generated Codama client
 * and SAS attestation operations.
 *
 * Note: SAS-based methods (reputation, validation) require the sas-lib SDK
 * which is not yet published. These methods are stubbed with clear errors.
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
  address,
  getSignatureFromTransaction,
  type Address,
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

import type {
  AgentIdentity,
  Feedback,
  ValidationStatus,
  RegisterAgentResult,
  AttestationResult,
  SATIClientOptions,
} from "./types";

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
  option: { __option: "Some"; value: T } | { __option: "None" }
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

    // Derive PDAs
    const [groupMint] = await findGroupMintPda();
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
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstruction(registerIx, msg)
    );

    const signedTx = await signTransactionMessageWithSigners(tx);
    await this.sendAndConfirm(signedTx as SignedBlockhashTransaction, {
      commitment: "confirmed",
    });

    // Get member number from registry
    const [registryConfigAddress] = await findRegistryConfigPda();
    const registryConfig = await fetchRegistryConfig(this.rpc, registryConfigAddress);
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
    const registryConfig = await fetchRegistryConfig(this.rpc, registryConfigAddress);

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
    }
  ): Promise<void> {
    // Token-2022 metadata updates require the spl-token-metadata-interface
    // which needs to be called via raw instruction building.
    // This is better done through @solana/spl-token or direct instruction construction.
    throw new Error(
      "updateAgentMetadata requires spl-token-metadata-interface - use @solana/spl-token updateTokenMetadataField() directly"
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
    const { value: latestBlockhash } = await this.rpc.getLatestBlockhash().send();

    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(payer.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
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
    // This returns accounts sorted by balance descending
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
            | { __option: "None" }
        );

        if (extensions) {
          const groupMemberExt = extensions.find(
            (ext: Extension): ext is Extension & { __kind: "TokenGroupMember" } =>
              ext.__kind === "TokenGroupMember"
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
   *
   * @param _params - Authorization parameters
   * @returns Attestation address
   */
  async authorizeFeedback(_params: {
    agentMint: Address;
    client: Address;
    maxSubmissions: number;
    expiresAt?: number;
  }): Promise<AttestationResult> {
    throw new Error(
      "authorizeFeedback requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Revoke feedback authorization
   *
   * @param _attestation - FeedbackAuth attestation address
   */
  async revokeAuthorization(_attestation: Address): Promise<void> {
    throw new Error(
      "revokeAuthorization requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Submit feedback for an agent
   *
   * Creates a Feedback attestation via SAS.
   * Requires prior authorization from agent owner.
   *
   * @param _params - Feedback parameters
   * @returns Attestation address
   */
  async giveFeedback(_params: {
    agentMint: Address;
    score: number;
    tag1?: string;
    tag2?: string;
    fileUri?: string;
    fileHash?: Uint8Array;
    paymentProof?: string;
  }): Promise<AttestationResult> {
    throw new Error(
      "giveFeedback requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Revoke submitted feedback
   *
   * @param _attestation - Feedback attestation address
   */
  async revokeFeedback(_attestation: Address): Promise<void> {
    throw new Error(
      "revokeFeedback requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Append response to feedback
   *
   * Creates a FeedbackResponse attestation via SAS.
   *
   * @param _params - Response parameters
   * @returns Attestation address
   */
  async appendResponse(_params: {
    feedbackAttestation: Address;
    responseUri: string;
    responseHash?: Uint8Array;
  }): Promise<AttestationResult> {
    throw new Error(
      "appendResponse requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Read feedback attestation
   *
   * @param _attestation - Feedback attestation address
   * @returns Feedback data or null if not found
   */
  async readFeedback(_attestation: Address): Promise<Feedback | null> {
    throw new Error(
      "readFeedback requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  // ============================================================
  // VALIDATION (SAS)
  // ============================================================

  /**
   * Request validation from a validator
   *
   * Creates a ValidationRequest attestation via SAS.
   *
   * @param _params - Request parameters
   * @returns Attestation address
   */
  async requestValidation(_params: {
    agentMint: Address;
    validator: Address;
    methodId: string;
    requestUri: string;
    requestHash?: Uint8Array;
  }): Promise<AttestationResult> {
    throw new Error(
      "requestValidation requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Respond to a validation request
   *
   * Creates a ValidationResponse attestation via SAS.
   * Called by validators.
   *
   * @param _params - Response parameters
   * @returns Attestation address
   */
  async respondToValidation(_params: {
    requestAttestation: Address;
    response: number;
    responseUri?: string;
    responseHash?: Uint8Array;
    tag?: string;
  }): Promise<AttestationResult> {
    throw new Error(
      "respondToValidation requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }

  /**
   * Get validation status
   *
   * @param _attestation - ValidationRequest attestation address
   * @returns Validation status or null if not found
   */
  async getValidationStatus(
    _attestation: Address
  ): Promise<ValidationStatus | null> {
    throw new Error(
      "getValidationStatus requires sas-lib SDK - see https://github.com/solana-foundation/solana-attestation-service"
    );
  }
}
