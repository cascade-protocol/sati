/**
 * Agent0-compatible agent wrapper backed by SATI infrastructure.
 *
 * Internally delegates state management to sati-sdk's SatiAgentBuilder.
 * The builder holds the SATI-native RegistrationFileParams as the source
 * of truth; this class adds agent0-specific features (EndpointCrawler,
 * metadata dict, CAIP-2 IDs) and converts to agent0 types on demand.
 */

import type { RegistrationFile, AgentId, URI, Address } from "agent0-sdk";
import { type EndpointType, TrustModel, EndpointCrawler } from "agent0-sdk";
import {
  createPinataUploader,
  createSatiUploader,
  getRegisterAgentInstructionAsync,
  findRegistryConfigPda,
  fetchRegistryConfig,
  findAssociatedTokenAddress,
  findAgentIndexPda,
  type AgentIdentity,
  type SatiAgentBuilder,
  type Endpoint as SatiEndpoint,
} from "@cascade-fyi/sati-sdk";
import { address as solAddress, generateKeyPairSigner, type TransactionSigner } from "@solana/kit";
import {
  getUpdateTokenMetadataFieldInstruction,
  tokenMetadataField,
  getTransferInstruction,
} from "@solana-program/token-2022";
import { getCreateAssociatedTokenIdempotentInstruction } from "@solana-program/token-2022";
import type { SatiAgent0 } from "./sdk.js";
import type { WriteAccess } from "./types.js";
import { formatSatiAgentId, toAgent0Endpoints, AGENT0_TO_SATI_NAME } from "./adapters.js";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@cascade-fyi/sati-sdk";
import { SolanaTransactionHandle } from "./transaction-handle.js";
import { SatiError, AgentNotFoundError, ReadOnlyError } from "./errors.js";
import type { RegistrationFile as SatiRegistrationFile } from "@cascade-fyi/sati-sdk";

/**
 * Agent0-compatible agent class backed by SATI's Solana infrastructure.
 *
 * State is managed by an internal SatiAgentBuilder. Agent0-specific extras
 * (metadata dict, OASF endpoint crawling) are layered on top.
 */
export class SatiAgent {
  private readonly _builder: SatiAgentBuilder;
  private readonly _endpointCrawler: EndpointCrawler;
  private readonly _sdk: SatiAgent0;

  /** Agent0-specific metadata (not stored in builder) */
  private _metadata: Record<string, unknown>;

  /** Last modification timestamp (agent0-specific) */
  private _updatedAt: number;

  constructor(sdk: SatiAgent0, builder: SatiAgentBuilder, metadata?: Record<string, unknown>) {
    this._sdk = sdk;
    this._builder = builder;
    this._endpointCrawler = new EndpointCrawler(5000);
    this._metadata = metadata ?? {};
    this._updatedAt = Math.floor(Date.now() / 1000);
  }

  /** @internal Access the underlying SatiAgent0 instance. */
  get sdk(): SatiAgent0 {
    return this._sdk;
  }

  /**
   * Create a new agent in memory (not yet registered on-chain).
   * @internal Called by SatiAgent0.createAgent()
   */
  static create(sdk: SatiAgent0, name: string, description: string, image?: URI): SatiAgent {
    const builder = sdk.sati.createAgentBuilder(name, description, image ?? "");
    builder.setActive(false).setX402Support(false).setSupportedTrust(["reputation"]);
    return new SatiAgent(sdk, builder);
  }

  /**
   * Reconstruct an agent from on-chain identity and SATI registration file.
   * @internal Called by SatiAgent0.loadAgent()
   */
  static fromIdentity(sdk: SatiAgent0, identity: AgentIdentity, satiRegFile: SatiRegistrationFile): SatiAgent {
    const builder = sdk.sati.createAgentBuilder(satiRegFile.name, satiRegFile.description, satiRegFile.image);

    // Populate builder from SATI registration file services
    for (const ep of satiRegFile.services ?? []) {
      builder.setService(ep);
    }
    if (satiRegFile.active !== undefined) builder.setActive(satiRegFile.active);
    if (satiRegFile.x402Support !== undefined) builder.setX402Support(satiRegFile.x402Support);
    if (satiRegFile.supportedTrust) builder.setSupportedTrust(satiRegFile.supportedTrust);
    if (satiRegFile.external_url) builder.setExternalUrl(satiRegFile.external_url);

    builder.setIdentity(identity);

    return new SatiAgent(sdk, builder);
  }

  // =========================================================================
  // Read-only properties (mirrors agent0-sdk Agent)
  // =========================================================================

  get agentId(): AgentId | undefined {
    const identity = this._builder.identity;
    return identity ? formatSatiAgentId(identity.mint, this._sdk.chain) : undefined;
  }

  get agentURI(): URI | undefined {
    return this._builder.identity?.uri;
  }

  get name(): string {
    return this._builder.params.name;
  }

  get description(): string {
    return this._builder.params.description;
  }

  get image(): URI | undefined {
    return this._builder.params.image || undefined;
  }

  get mcpEndpoint(): string | undefined {
    return this._findEndpoint("MCP")?.endpoint;
  }

  get a2aEndpoint(): string | undefined {
    return this._findEndpoint("A2A")?.endpoint;
  }

  get walletAddress(): Address | undefined {
    return this._findEndpoint("agentWallet")?.endpoint as Address | undefined;
  }

  /** SATI-specific: the on-chain agent identity (available after registration). */
  get identity(): AgentIdentity | undefined {
    return this._builder.identity;
  }

  get ensEndpoint(): string | undefined {
    return this._findEndpoint("ENS")?.endpoint;
  }

  get didEndpoint(): string | undefined {
    return this._findEndpoint("DID")?.endpoint;
  }

  get mcpTools(): string[] {
    return this._findEndpoint("MCP")?.mcpTools ?? [];
  }

  get mcpPrompts(): string[] {
    return this._findEndpoint("MCP")?.mcpPrompts ?? [];
  }

  get mcpResources(): string[] {
    return this._findEndpoint("MCP")?.mcpResources ?? [];
  }

  get a2aSkills(): string[] {
    return this._findEndpoint("A2A")?.a2aSkills ?? [];
  }

  get oasfSkills(): string[] {
    return this._findEndpoint("OASF")?.skills ?? [];
  }

  get oasfDomains(): string[] {
    return this._findEndpoint("OASF")?.domains ?? [];
  }

  // =========================================================================
  // Endpoint management (mirrors agent0-sdk Agent)
  // =========================================================================

  /**
   * Set MCP endpoint. Auto-fetches capabilities by default.
   */
  async setMCP(endpoint: string, version = "2025-06-18", autoFetch = true): Promise<this> {
    const meta: { tools?: string[]; prompts?: string[]; resources?: string[] } = {};
    if (autoFetch) {
      try {
        const capabilities = await this._endpointCrawler.fetchMcpCapabilities(endpoint);
        if (capabilities) {
          if (capabilities.mcpTools) meta.tools = capabilities.mcpTools;
          if (capabilities.mcpPrompts) meta.prompts = capabilities.mcpPrompts;
          if (capabilities.mcpResources) meta.resources = capabilities.mcpResources;
        }
      } catch {
        // Soft fail - continue without capabilities
      }
    }
    this._builder.setMCP(endpoint, version, meta);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Set A2A endpoint. Auto-fetches capabilities by default.
   */
  async setA2A(agentcard: string, version = "0.30", autoFetch = true): Promise<this> {
    const meta: { skills?: string[] } = {};
    if (autoFetch) {
      try {
        const capabilities = await this._endpointCrawler.fetchA2aCapabilities(agentcard);
        if (capabilities?.a2aSkills) {
          meta.skills = capabilities.a2aSkills;
        }
      } catch {
        // Soft fail - continue without capabilities
      }
    }
    this._builder.setA2A(agentcard, version, meta);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Set ENS endpoint.
   */
  setENS(name: string, version = "1.0"): this {
    this._builder.setService({ name: "ENS", endpoint: name, version });
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Remove endpoint(s).
   */
  removeEndpoint(opts?: { type?: EndpointType; value?: string }): this {
    const services = this._builder.params.services ?? [];
    if (!opts || (opts.type === undefined && opts.value === undefined)) {
      // Remove all
      for (const ep of [...services]) {
        this._builder.removeService(ep.name);
      }
    } else {
      for (const ep of [...services]) {
        const satiName = opts.type !== undefined ? (AGENT0_TO_SATI_NAME[opts.type] ?? opts.type) : undefined;
        const typeMatches = satiName === undefined || ep.name === satiName;
        const valueMatches = opts.value === undefined || ep.endpoint === opts.value;
        if (typeMatches && valueMatches) {
          this._builder.removeService(ep.name);
        }
      }
    }
    this._updatedAt = Math.floor(Date.now() / 1000);
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
    return this._findEndpoint("agentWallet")?.endpoint as Address | undefined;
  }

  /**
   * Set wallet address and add a WALLET endpoint.
   * In-memory only - call registerIPFS() or registerHTTP() to persist on-chain.
   */
  setWallet(addr: Address): this {
    this._builder.setWallet(addr);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Remove wallet address and wallet endpoint.
   */
  unsetWallet(): this {
    this._builder.removeService("agentWallet");
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  // =========================================================================
  // OASF skills and domains (mirrors agent0-sdk Agent)
  // =========================================================================

  addSkill(slug: string): this {
    const oasfEp = this._findEndpoint("OASF");
    const skills = [...(oasfEp?.skills ?? [])];
    if (!skills.includes(slug)) skills.push(slug);
    this._builder.setService({
      name: "OASF",
      endpoint: oasfEp?.endpoint ?? "https://github.com/agntcy/oasf/",
      version: oasfEp?.version ?? "v0.8.0",
      skills,
      domains: oasfEp?.domains,
    });
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  removeSkill(slug: string): this {
    const oasfEp = this._findEndpoint("OASF");
    if (oasfEp?.skills) {
      const skills = oasfEp.skills.filter((s) => s !== slug);
      this._builder.setService({
        name: "OASF",
        endpoint: oasfEp.endpoint,
        version: oasfEp.version,
        skills,
        domains: oasfEp.domains,
      });
      this._updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  addDomain(slug: string): this {
    const oasfEp = this._findEndpoint("OASF");
    const domains = [...(oasfEp?.domains ?? [])];
    if (!domains.includes(slug)) domains.push(slug);
    this._builder.setService({
      name: "OASF",
      endpoint: oasfEp?.endpoint ?? "https://github.com/agntcy/oasf/",
      version: oasfEp?.version ?? "v0.8.0",
      skills: oasfEp?.skills,
      domains,
    });
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  removeDomain(slug: string): this {
    const oasfEp = this._findEndpoint("OASF");
    if (oasfEp?.domains) {
      const domains = oasfEp.domains.filter((d) => d !== slug);
      this._builder.setService({
        name: "OASF",
        endpoint: oasfEp.endpoint,
        version: oasfEp.version,
        skills: oasfEp.skills,
        domains,
      });
      this._updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  // =========================================================================
  // Status and trust (mirrors agent0-sdk Agent)
  // =========================================================================

  setActive(active: boolean): this {
    this._builder.setActive(active);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setX402Support(x402Support: boolean): this {
    this._builder.setX402Support(x402Support);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  setTrust(reputation = false, cryptoEconomic = false, teeAttestation = false): this {
    const trusts: ("reputation" | "crypto-economic" | "tee-attestation")[] = [];
    if (reputation) trusts.push("reputation");
    if (cryptoEconomic) trusts.push("crypto-economic");
    if (teeAttestation) trusts.push("tee-attestation");
    this._builder.setSupportedTrust(trusts);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  // =========================================================================
  // Metadata (mirrors agent0-sdk Agent)
  // =========================================================================

  setMetadata(kv: Record<string, unknown>): this {
    Object.assign(this._metadata, kv);
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  getMetadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  delMetadata(key: string): this {
    if (key in this._metadata) {
      delete this._metadata[key];
      this._updatedAt = Math.floor(Date.now() / 1000);
    }
    return this;
  }

  /**
   * Update basic agent information.
   */
  updateInfo(name?: string, description?: string, image?: URI): this {
    this._builder.updateInfo({
      ...(name !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(image !== undefined && { image }),
    });
    this._updatedAt = Math.floor(Date.now() / 1000);
    return this;
  }

  /**
   * Get the current in-memory registration file (agent0 format).
   *
   * Constructed on-demand from the internal builder state.
   */
  getRegistrationFile(): RegistrationFile {
    return this._toAgent0RegFile();
  }

  // =========================================================================
  // On-chain operations (SATI-backed)
  // =========================================================================

  /**
   * Register agent on-chain with IPFS.
   *
   * Converts the in-memory registration to SATI format,
   * uploads to IPFS, then mints the agent NFT on Solana.
   *
   * @throws SatiError if image URL is not set
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async registerIPFS(): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (this._builder.identity) {
      throw new SatiError("ALREADY_REGISTERED", "Agent is already registered on-chain. Use updateIPFS() instead.");
    }
    if (!this._builder.params.image) {
      throw new SatiError(
        "IMAGE_REQUIRED",
        "Image URL is required for registration. Set it via updateInfo() or createAgent().",
      );
    }

    const access = this._requireWriteAccess("registerAgent");
    const pinataJwt = this._sdk.config.pinataJwt;
    const uploader = pinataJwt ? createPinataUploader(pinataJwt) : createSatiUploader();

    if (access.type === "keypair") {
      const result = await this._builder.register({ payer: access.signer, uploader });
      this._updatedAt = Math.floor(Date.now() / 1000);
      return new SolanaTransactionHandle(result.signature, this._toAgent0RegFile());
    }

    // Sender path: upload manually, then build instructions
    const uri = await this._sdk.sati.uploadRegistrationFile(this._builder.params, uploader);
    return this._registerOnChainSender(access, uri);
  }

  /**
   * Register agent on-chain with an HTTP URI.
   *
   * Same as registerIPFS but takes a URI directly instead of uploading to IPFS.
   *
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async registerHTTP(agentUri: URI): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (this._builder.identity) {
      throw new SatiError("ALREADY_REGISTERED", "Agent is already registered on-chain. Use updateHTTP() instead.");
    }

    const access = this._requireWriteAccess("registerAgent");

    if (access.type === "keypair") {
      const result = await this._builder.registerWithUri({ payer: access.signer, uri: agentUri });
      this._updatedAt = Math.floor(Date.now() / 1000);
      return new SolanaTransactionHandle(result.signature, this._toAgent0RegFile());
    }

    return this._registerOnChainSender(access, agentUri);
  }

  /**
   * Re-upload the current in-memory registration file to IPFS and update the on-chain URI.
   *
   * @throws AgentNotFoundError if agent is not registered on-chain
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async updateIPFS(): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (!this._builder.identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerIPFS() first.");
    }

    const access = this._requireWriteAccess("updateIPFS");
    const pinataJwt = this._sdk.config.pinataJwt;
    const uploader = pinataJwt ? createPinataUploader(pinataJwt) : createSatiUploader();

    if (access.type === "keypair") {
      const result = await this._builder.update({ payer: access.signer, owner: access.signer, uploader });
      this._updatedAt = Math.floor(Date.now() / 1000);
      return new SolanaTransactionHandle(result.signature, this._toAgent0RegFile());
    }

    // Sender path: upload manually, then update URI
    const newUri = await this._sdk.sati.uploadRegistrationFile(this._builder.params, uploader);
    return this.setAgentURI(newUri);
  }

  /**
   * Update the on-chain URI to point to a new HTTP-hosted registration file.
   *
   * @throws AgentNotFoundError if agent is not registered on-chain
   * @throws ReadOnlyError if SDK is in read-only mode
   */
  async updateHTTP(agentUri: URI): Promise<SolanaTransactionHandle<RegistrationFile>> {
    if (!this._builder.identity) {
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
    const identity = this._builder.identity;
    if (!identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerIPFS() or registerHTTP() first.");
    }

    const access = this._requireWriteAccess("setAgentURI");

    if (access.type === "keypair") {
      const result = await this._builder.updateUri({ payer: access.signer, owner: access.signer, uri: agentURI });
      this._updatedAt = Math.floor(Date.now() / 1000);
      return new SolanaTransactionHandle(result.signature, this._toAgent0RegFile());
    }

    // Sender path: build instruction and send via wallet
    const updateIx = getUpdateTokenMetadataFieldInstruction({
      metadata: identity.mint,
      updateAuthority: { address: solAddress(access.sender.address) } as TransactionSigner,
      field: tokenMetadataField("Uri"),
      value: agentURI,
    });

    const signature = await access.sender.signAndSend([updateIx]);
    // Manually update builder identity URI
    this._builder.setIdentity({ ...identity, uri: agentURI });
    this._updatedAt = Math.floor(Date.now() / 1000);
    return new SolanaTransactionHandle(signature, this._toAgent0RegFile());
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
    const identity = this._builder.identity;
    if (!identity) {
      throw new AgentNotFoundError("Agent not registered on-chain. Call registerIPFS() or registerHTTP() first.");
    }

    const access = this._requireWriteAccess("transfer");

    if (access.type === "keypair") {
      const result = await this._sdk.sati.transferAgent({
        payer: access.signer,
        owner: access.signer,
        mint: identity.mint,
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
    const [sourceAta] = await findAssociatedTokenAddress(identity.mint, ownerAddr);
    const [destAta] = await findAssociatedTokenAddress(identity.mint, solAddress(newOwner));

    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: { address: ownerAddr } as TransactionSigner,
      owner: solAddress(newOwner),
      mint: identity.mint,
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

  /** Find a SATI endpoint by name in the builder's params. */
  private _findEndpoint(name: string): SatiEndpoint | undefined {
    return this._builder.params.services?.find((ep) => ep.name === name);
  }

  /** Construct agent0 RegistrationFile on-demand from builder state. */
  private _toAgent0RegFile(): RegistrationFile {
    const params = this._builder.params;
    const identity = this._builder.identity;
    const endpoints = toAgent0Endpoints(params.services ?? []);
    const trustModels: (TrustModel | string)[] = (params.supportedTrust ?? []).map((t) => {
      if (t === "reputation") return TrustModel.REPUTATION;
      if (t === "crypto-economic") return TrustModel.CRYPTO_ECONOMIC;
      if (t === "tee-attestation") return TrustModel.TEE_ATTESTATION;
      return t;
    });

    const walletEp = params.services?.find((ep) => ep.name === "agentWallet");

    return {
      agentId: identity ? formatSatiAgentId(identity.mint, this._sdk.chain) : undefined,
      agentURI: identity?.uri,
      name: params.name,
      description: params.description,
      image: params.image || undefined,
      endpoints,
      trustModels,
      walletAddress: walletEp?.endpoint as Address | undefined,
      owners: identity ? [identity.owner] : [],
      operators: [],
      active: params.active ?? true,
      x402support: params.x402Support ?? false,
      metadata: { ...this._metadata },
      updatedAt: this._updatedAt,
    };
  }

  /**
   * Sender-path registration: build instructions manually and send via wallet.
   * Retries on PDA collision from concurrent registrations.
   */
  private async _registerOnChainSender(
    access: Extract<WriteAccess, { type: "sender" }>,
    uri: string,
  ): Promise<SolanaTransactionHandle<RegistrationFile>> {
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
          name: this._builder.params.name,
          symbol: "",
          uri,
          additionalMetadata: null,
          nonTransferable: false,
        });

        const signature = await access.sender.signAndSend([registerIx], [agentMint]);
        this._builder.setIdentity({
          mint: agentMint.address,
          owner: ownerAddress,
          name: this._builder.params.name,
          uri,
          memberNumber,
          additionalMetadata: {},
          nonTransferable: false,
        });
        this._updatedAt = Math.floor(Date.now() / 1000);
        return new SolanaTransactionHandle(signature, this._toAgent0RegFile());
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
}

/** Detect PDA collision errors from concurrent registrations. */
function isRegistrationCollisionError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("already in use") || msg.includes("already been initialized") || msg.includes("0x0");
}
