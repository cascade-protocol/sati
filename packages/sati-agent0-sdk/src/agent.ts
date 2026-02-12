/**
 * Agent0-compatible agent wrapper backed by SATI infrastructure.
 *
 * Mirrors agent0-sdk's `Agent` class: fluent builders for endpoints,
 * metadata, trust models, and registration file management.
 */

import type { RegistrationFile, Endpoint, AgentId, URI, Address } from "agent0-sdk";
import { EndpointType, TrustModel, EndpointCrawler } from "agent0-sdk";
import {
  createPinataUploader,
  getRegisterAgentInstructionAsync,
  findRegistryConfigPda,
  fetchRegistryConfig,
  findAssociatedTokenAddress,
  findAgentIndexPda,
  type AgentIdentity,
} from "@cascade-fyi/sati-sdk";
import { address as solAddress, generateKeyPairSigner, type TransactionSigner } from "@solana/kit";
import {
  getUpdateTokenMetadataFieldInstruction,
  tokenMetadataField,
  getTransferInstruction,
} from "@solana-program/token-2022";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token-2022";
import type { SatiSDK } from "./sdk.js";
import type { WriteAccess } from "./types.js";
import { formatSatiAgentId, fromAgent0RegistrationFile } from "./adapters.js";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@cascade-fyi/sati-sdk";
import { SolanaTransactionHandle } from "./transaction-handle.js";
import { SatiError, AgentNotFoundError, ReadOnlyError } from "./errors.js";

/**
 * Agent0-compatible agent class backed by SATI's Solana infrastructure.
 *
 * Manages an in-memory registration file that can be flushed to chain
 * via `registerIPFS()`.
 */
export class SatiAgent {
  private _registrationFile: RegistrationFile;
  private _endpointCrawler: EndpointCrawler;
  private _identity: AgentIdentity | undefined;

  private readonly _sdk: SatiSDK;

  constructor(sdk: SatiSDK, registrationFile: RegistrationFile) {
    this._sdk = sdk;
    this._registrationFile = registrationFile;
    this._endpointCrawler = new EndpointCrawler(5000);
  }

  /** @internal Access the underlying SatiSDK instance. */
  get sdk(): SatiSDK {
    return this._sdk;
  }

  /**
   * Create a new agent in memory (not yet registered on-chain).
   * @internal Called by SatiSDK.createAgent()
   */
  static create(sdk: SatiSDK, name: string, description: string, image?: URI): SatiAgent {
    const registrationFile: RegistrationFile = {
      name,
      description,
      image,
      endpoints: [],
      trustModels: [TrustModel.REPUTATION],
      owners: [],
      operators: [],
      active: false,
      x402support: false,
      metadata: {},
      updatedAt: Math.floor(Date.now() / 1000),
    };
    return new SatiAgent(sdk, registrationFile);
  }

  /**
   * Reconstruct an agent from on-chain identity and registration file.
   * @internal Called by SatiSDK.loadAgent()
   */
  static fromIdentity(sdk: SatiSDK, identity: AgentIdentity, registrationFile: RegistrationFile): SatiAgent {
    const agent = new SatiAgent(sdk, registrationFile);
    agent._identity = identity;
    agent._registrationFile.agentId = formatSatiAgentId(identity.mint, sdk.chain);
    agent._registrationFile.agentURI = identity.uri;
    return agent;
  }

  // =========================================================================
  // Read-only properties (mirrors agent0-sdk Agent)
  // =========================================================================

  get agentId(): AgentId | undefined {
    return this._registrationFile.agentId;
  }

  get agentURI(): URI | undefined {
    return this._registrationFile.agentURI;
  }

  get name(): string {
    return this._registrationFile.name;
  }

  get description(): string {
    return this._registrationFile.description;
  }

  get image(): URI | undefined {
    return this._registrationFile.image;
  }

  get mcpEndpoint(): string | undefined {
    return this._registrationFile.endpoints.find((e) => e.type === EndpointType.MCP)?.value;
  }

  get a2aEndpoint(): string | undefined {
    return this._registrationFile.endpoints.find((e) => e.type === EndpointType.A2A)?.value;
  }

  get walletAddress(): Address | undefined {
    return this._registrationFile.walletAddress;
  }

  /** SATI-specific: the on-chain agent identity (available after registration). */
  get identity(): AgentIdentity | undefined {
    return this._identity;
  }

  get ensEndpoint(): string | undefined {
    return this._registrationFile.endpoints.find((e) => e.type === EndpointType.ENS)?.value;
  }

  get didEndpoint(): string | undefined {
    return this._registrationFile.endpoints.find((e) => e.type === EndpointType.DID)?.value;
  }

  get mcpTools(): string[] {
    const ep = this._registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return (ep?.meta?.mcpTools as string[]) ?? [];
  }

  get mcpPrompts(): string[] {
    const ep = this._registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return (ep?.meta?.mcpPrompts as string[]) ?? [];
  }

  get mcpResources(): string[] {
    const ep = this._registrationFile.endpoints.find((e) => e.type === EndpointType.MCP);
    return (ep?.meta?.mcpResources as string[]) ?? [];
  }

  get a2aSkills(): string[] {
    const ep = this._registrationFile.endpoints.find((e) => e.type === EndpointType.A2A);
    return (ep?.meta?.a2aSkills as string[]) ?? [];
  }

  get oasfSkills(): string[] {
    const ep = this._registrationFile.endpoints.find((e) => e.type === EndpointType.OASF);
    return (ep?.meta?.skills as string[]) ?? [];
  }

  get oasfDomains(): string[] {
    const ep = this._registrationFile.endpoints.find((e) => e.type === EndpointType.OASF);
    return (ep?.meta?.domains as string[]) ?? [];
  }

  // =========================================================================
  // Endpoint management (mirrors agent0-sdk Agent)
  // =========================================================================

  /**
   * Set MCP endpoint. Auto-fetches capabilities by default.
   */
  async setMCP(endpoint: string, version = "2025-06-18", autoFetch = true): Promise<this> {
    this._registrationFile.endpoints = this._registrationFile.endpoints.filter((ep) => ep.type !== EndpointType.MCP);

    const meta: Record<string, unknown> = { version };
    if (autoFetch) {
      try {
        const capabilities = await this._endpointCrawler.fetchMcpCapabilities(endpoint);
        if (capabilities) {
          if (capabilities.mcpTools) meta.mcpTools = capabilities.mcpTools;
          if (capabilities.mcpPrompts) meta.mcpPrompts = capabilities.mcpPrompts;
          if (capabilities.mcpResources) meta.mcpResources = capabilities.mcpResources;
        }
      } catch {
        // Soft fail - continue without capabilities
      }
    }

    this._registrationFile.endpoints.push({
      type: EndpointType.MCP,
      value: endpoint,
      meta,
    });
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Set A2A endpoint. Auto-fetches capabilities by default.
   */
  async setA2A(agentcard: string, version = "0.30", autoFetch = true): Promise<this> {
    this._registrationFile.endpoints = this._registrationFile.endpoints.filter((ep) => ep.type !== EndpointType.A2A);

    const meta: Record<string, unknown> = { version };
    if (autoFetch) {
      try {
        const capabilities = await this._endpointCrawler.fetchA2aCapabilities(agentcard);
        if (capabilities?.a2aSkills) {
          meta.a2aSkills = capabilities.a2aSkills;
        }
      } catch {
        // Soft fail - continue without capabilities
      }
    }

    this._registrationFile.endpoints.push({
      type: EndpointType.A2A,
      value: agentcard,
      meta,
    });
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Set ENS endpoint.
   */
  setENS(name: string, version = "1.0"): this {
    this._registrationFile.endpoints = this._registrationFile.endpoints.filter((ep) => ep.type !== EndpointType.ENS);
    this._registrationFile.endpoints.push({
      type: EndpointType.ENS,
      value: name,
      meta: { version },
    });
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Remove endpoint(s).
   */
  removeEndpoint(opts?: { type?: EndpointType; value?: string }): this {
    if (!opts || (opts.type === undefined && opts.value === undefined)) {
      this._registrationFile.endpoints = [];
    } else {
      this._registrationFile.endpoints = this._registrationFile.endpoints.filter((ep) => {
        const typeMatches = opts.type === undefined || ep.type === opts.type;
        const valueMatches = opts.value === undefined || ep.value === opts.value;
        return !(typeMatches && valueMatches);
      });
    }
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Remove all endpoints (alias for removeEndpoint() with no args).
   */
  removeEndpoints(): this {
    return this.removeEndpoint();
  }

  // =========================================================================
  // Wallet management (mirrors agent0-sdk Agent)
  // =========================================================================

  /**
   * Get wallet address from the registration file.
   */
  getWallet(): Address | undefined {
    return this._registrationFile.walletAddress;
  }

  /**
   * Set wallet address and add a WALLET endpoint.
   * In-memory only - call registerIPFS() or registerHTTP() to persist on-chain.
   */
  setWallet(addr: Address): this {
    this._registrationFile.walletAddress = addr;
    this._registrationFile.endpoints = this._registrationFile.endpoints.filter((ep) => ep.type !== EndpointType.WALLET);
    this._registrationFile.endpoints.push({
      type: EndpointType.WALLET,
      value: addr,
    });
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Remove wallet address and wallet endpoint.
   */
  unsetWallet(): this {
    this._registrationFile.walletAddress = undefined;
    this._registrationFile.endpoints = this._registrationFile.endpoints.filter((ep) => ep.type !== EndpointType.WALLET);
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  // =========================================================================
  // OASF skills and domains (mirrors agent0-sdk Agent)
  // =========================================================================

  addSkill(slug: string): this {
    const oasfEp = this._getOrCreateOasfEndpoint();
    if (!oasfEp.meta) oasfEp.meta = {};
    if (!Array.isArray(oasfEp.meta.skills)) oasfEp.meta.skills = [];
    const skills = oasfEp.meta.skills as string[];
    if (!skills.includes(slug)) skills.push(slug);
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  removeSkill(slug: string): this {
    const oasfEp = this._registrationFile.endpoints.find((ep) => ep.type === EndpointType.OASF);
    if (oasfEp?.meta) {
      const skills = oasfEp.meta.skills;
      if (Array.isArray(skills)) {
        const idx = skills.indexOf(slug);
        if (idx !== -1) skills.splice(idx, 1);
      }
      this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  addDomain(slug: string): this {
    const oasfEp = this._getOrCreateOasfEndpoint();
    if (!oasfEp.meta) oasfEp.meta = {};
    if (!Array.isArray(oasfEp.meta.domains)) oasfEp.meta.domains = [];
    const domains = oasfEp.meta.domains as string[];
    if (!domains.includes(slug)) domains.push(slug);
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  removeDomain(slug: string): this {
    const oasfEp = this._registrationFile.endpoints.find((ep) => ep.type === EndpointType.OASF);
    if (oasfEp?.meta) {
      const domains = oasfEp.meta.domains;
      if (Array.isArray(domains)) {
        const idx = domains.indexOf(slug);
        if (idx !== -1) domains.splice(idx, 1);
      }
      this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  // =========================================================================
  // Status and trust (mirrors agent0-sdk Agent)
  // =========================================================================

  setActive(active: boolean): this {
    this._registrationFile.active = active;
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setX402Support(x402Support: boolean): this {
    this._registrationFile.x402support = x402Support;
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setTrust(reputation = false, cryptoEconomic = false, teeAttestation = false): this {
    const trustModels: (TrustModel | string)[] = [];
    if (reputation) trustModels.push(TrustModel.REPUTATION);
    if (cryptoEconomic) trustModels.push(TrustModel.CRYPTO_ECONOMIC);
    if (teeAttestation) trustModels.push(TrustModel.TEE_ATTESTATION);
    this._registrationFile.trustModels = trustModels;
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  // =========================================================================
  // Metadata (mirrors agent0-sdk Agent)
  // =========================================================================

  setMetadata(kv: Record<string, unknown>): this {
    Object.assign(this._registrationFile.metadata, kv);
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  getMetadata(): Record<string, unknown> {
    return { ...this._registrationFile.metadata };
  }

  delMetadata(key: string): this {
    if (key in this._registrationFile.metadata) {
      delete this._registrationFile.metadata[key];
      this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  /**
   * Update basic agent information.
   */
  updateInfo(name?: string, description?: string, image?: URI): this {
    if (name !== undefined) this._registrationFile.name = name;
    if (description !== undefined) this._registrationFile.description = description;
    if (image !== undefined) this._registrationFile.image = image;
    this._registrationFile.updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Get the current in-memory registration file.
   */
  getRegistrationFile(): RegistrationFile {
    return this._registrationFile;
  }

  // =========================================================================
  // On-chain operations (SATI-backed)
  // =========================================================================

  /**
   * Register agent on-chain with IPFS.
   *
   * Converts the in-memory agent0 registration file to SATI format,
   * uploads to IPFS via Pinata, then mints the agent NFT on Solana.
   *
   * @throws SatiError if image URL is not set or pinataJwt is not configured
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async registerIPFS(): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (this._identity) {
      throw new SatiError("ALREADY_REGISTERED", "Agent is already registered on-chain. Use updateIPFS() instead.");
    }
    if (!this._registrationFile.image) {
      throw new SatiError(
        "IMAGE_REQUIRED",
        "Image URL is required for registration. Set it via updateInfo() or createAgent().",
      );
    }

    const pinataJwt = this._sdk.config.pinataJwt;
    if (!pinataJwt) {
      throw new SatiError("PINATA_JWT_REQUIRED", "pinataJwt is required for IPFS uploads. Set it in SatiSDKConfig.");
    }

    // Convert agent0 registration file to SATI format and upload to IPFS
    const satiParams = fromAgent0RegistrationFile(this._registrationFile);
    const uploader = createPinataUploader(pinataJwt);
    const uri = await this._sdk.sati.uploadRegistrationFile(satiParams, uploader);

    return this._registerOnChain(uri);
  }

  /**
   * Register agent on-chain with an HTTP URI.
   *
   * Same as registerIPFS but takes a URI directly instead of uploading to IPFS.
   * Use this when you already have a hosted registration file.
   *
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async registerHTTP(agentUri: URI): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (this._identity) {
      throw new SatiError("ALREADY_REGISTERED", "Agent is already registered on-chain. Use updateHTTP() instead.");
    }
    return this._registerOnChain(agentUri);
  }

  /**
   * Re-upload the current in-memory registration file to IPFS and update the on-chain URI.
   *
   * Use after modifying the agent via fluent builders (setMCP, addSkill, setMetadata, etc.)
   * to persist changes on-chain.
   *
   * @throws AgentNotFoundError if agent is not registered on-chain
   * @throws SatiError if pinataJwt is not configured
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async updateIPFS(): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (!this._identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerIPFS() first.");
    }

    const pinataJwt = this._sdk.config.pinataJwt;
    if (!pinataJwt) {
      throw new SatiError("PINATA_JWT_REQUIRED", "pinataJwt is required for IPFS uploads. Set it in SatiSDKConfig.");
    }

    const satiParams = fromAgent0RegistrationFile(this._registrationFile);
    const uploader = createPinataUploader(pinataJwt);
    const newUri = await this._sdk.sati.uploadRegistrationFile(satiParams, uploader);
    return this.setAgentURI(newUri);
  }

  /**
   * Update the on-chain URI to point to a new HTTP-hosted registration file.
   *
   * @throws AgentNotFoundError if agent is not registered on-chain
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async updateHTTP(agentUri: URI): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (!this._identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerHTTP() first.");
    }
    return this.setAgentURI(agentUri);
  }

  /**
   * Update the agent's on-chain URI (metadata pointer).
   *
   * @throws AgentNotFoundError if agent is not registered on-chain
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async setAgentURI(agentURI: URI): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (!this._identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerIPFS() or registerHTTP() first.");
    }

    const access = this._requireWriteAccess("setAgentURI");

    if (access.type === "keypair") {
      const result = await this._sdk.sati.updateAgentMetadata({
        payer: access.signer,
        owner: access.signer,
        mint: solAddress(this._identity.mint),
        updates: { uri: agentURI },
      });
      this._identity.uri = agentURI;
      this._registrationFile.agentURI = agentURI;
      return new SolanaTransactionHandle(result.signature, this._registrationFile);
    }

    // Sender path: build instruction and send via wallet
    const updateIx = getUpdateTokenMetadataFieldInstruction({
      metadata: this._identity.mint,
      updateAuthority: { address: solAddress(access.sender.address) } as TransactionSigner,
      field: tokenMetadataField("Uri"),
      value: agentURI,
    });

    const signature = await access.sender.signAndSend([updateIx]);
    this._identity.uri = agentURI;
    this._registrationFile.agentURI = agentURI;
    return new SolanaTransactionHandle(signature, this._registrationFile);
  }

  /**
   * Transfer agent ownership to a new Solana address.
   *
   * @throws AgentNotFoundError if agent is not registered on-chain
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async transfer(
    newOwner: Address,
  ): Promise<SolanaTransactionHandle<{ txHash: string; from: string; to: string; agentId: AgentId | undefined }>> {
    if (!this._identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerIPFS() or registerHTTP() first.");
    }

    const access = this._requireWriteAccess("transfer");

    if (access.type === "keypair") {
      const result = await this._sdk.sati.transferAgent({
        payer: access.signer,
        owner: access.signer,
        mint: this._identity.mint,
        newOwner: solAddress(newOwner),
      });
      return new SolanaTransactionHandle(result.signature, {
        txHash: result.signature,
        from: access.signer.address,
        to: newOwner,
        agentId: this.agentId,
      });
    }

    // Sender path: build ATA creation + transfer instructions
    const ownerAddr = solAddress(access.sender.address);
    const [sourceAta] = await findAssociatedTokenAddress(this._identity.mint, ownerAddr);
    const [destAta] = await findAssociatedTokenAddress(this._identity.mint, solAddress(newOwner));

    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: { address: ownerAddr } as TransactionSigner,
      owner: solAddress(newOwner),
      mint: this._identity.mint,
      ata: destAta,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const transferIx = getTransferInstruction({
      source: sourceAta,
      destination: destAta,
      authority: ownerAddr,
      amount: 1n,
    });

    const signature = await access.sender.signAndSend([createAtaIx, transferIx]);
    return new SolanaTransactionHandle(signature, {
      txHash: signature,
      from: access.sender.address,
      to: newOwner,
      agentId: this.agentId,
    });
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private _requireWriteAccess(operation?: string): WriteAccess {
    if (this._sdk.config.signer) return { type: "keypair", signer: this._sdk.config.signer };
    if (this._sdk.config.transactionSender) return { type: "sender", sender: this._sdk.config.transactionSender };
    throw new ReadOnlyError(operation);
  }

  /**
   * Shared registration logic for registerIPFS/registerHTTP.
   * Supports both keypair and sender paths.
   */
  private async _registerOnChain(uri: string): Promise<SolanaTransactionHandle<RegistrationFile>> {
    const access = this._requireWriteAccess("registerAgent");

    if (access.type === "keypair") {
      const result = await this._sdk.sati.registerAgent({
        payer: access.signer,
        name: this._registrationFile.name,
        uri,
      });
      this._storeIdentity(result.mint, access.signer.address, uri, result.memberNumber);
      return new SolanaTransactionHandle(result.signature, this._registrationFile);
    }

    // Sender path: build register instruction manually.
    // Retry on collision - concurrent registrations can race on memberNumber PDA.
    const agentMint = await generateKeyPairSigner();
    const rpc = this._sdk.sati.getRpc();
    const [registryConfigAddress] = await findRegistryConfigPda();
    const ownerAddress = solAddress(access.sender.address);
    const [agentTokenAccount] = await findAssociatedTokenAddress(agentMint.address, ownerAddress);

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1500;
    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const registryConfig = await fetchRegistryConfig(rpc, registryConfigAddress);
        const groupMint = registryConfig.data.groupMint;
        const memberNumber = registryConfig.data.totalAgents + 1n;
        const [agentIndex] = await findAgentIndexPda(memberNumber);

        const registerIx = await getRegisterAgentInstructionAsync({
          payer: { address: ownerAddress } as TransactionSigner,
          owner: ownerAddress,
          groupMint,
          agentMint,
          agentTokenAccount,
          agentIndex,
          name: this._registrationFile.name,
          symbol: "",
          uri,
          additionalMetadata: null,
          nonTransferable: false,
        });

        const signature = await access.sender.signAndSend([registerIx], [agentMint]);
        this._storeIdentity(agentMint.address, ownerAddress, uri, memberNumber);
        return new SolanaTransactionHandle(signature, this._registrationFile);
      } catch (error) {
        lastError = error;
        if (!isRegistrationCollisionError(error)) throw error;
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    throw new SatiError("REGISTRATION_FAILED", `Registration failed after ${MAX_RETRIES} attempts`, {
      cause: lastError,
    });
  }

  private _storeIdentity(
    mint: import("@solana/kit").Address,
    owner: import("@solana/kit").Address,
    uri: string,
    memberNumber: bigint,
  ): void {
    this._identity = {
      mint,
      owner,
      name: this._registrationFile.name,
      uri,
      memberNumber,
      additionalMetadata: {},
      nonTransferable: false,
    };
    this._registrationFile.agentId = formatSatiAgentId(mint, this._sdk.chain);
    this._registrationFile.agentURI = uri;
  }

  private _getOrCreateOasfEndpoint(): Endpoint {
    const existing = this._registrationFile.endpoints.find((ep) => ep.type === EndpointType.OASF);
    if (existing) return existing;

    const oasfEndpoint: Endpoint = {
      type: EndpointType.OASF,
      value: "https://github.com/agntcy/oasf/",
      meta: { version: "v0.8.0", skills: [], domains: [] },
    };
    this._registrationFile.endpoints.push(oasfEndpoint);
    return oasfEndpoint;
  }
}

/** Detect PDA collision errors from concurrent registrations. */
function isRegistrationCollisionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("already in use") || msg.includes("already been initialized") || msg.includes("0x0");
}
