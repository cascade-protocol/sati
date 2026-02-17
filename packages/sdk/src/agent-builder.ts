/**
 * Fluent builder for SATI agent registration and management.
 *
 * Uses sati-sdk native types (no agent0-sdk dependency).
 *
 * @example
 * ```typescript
 * const builder = sati.createAgentBuilder("MyAgent", "AI assistant", "https://example.com/avatar.png");
 * builder
 *   .setMCP("https://mcp.example.com", "2025-06-18", { tools: ["search", "summarize"] })
 *   .setA2A("https://a2a.example.com/.well-known/agent-card.json")
 *   .setActive(true)
 *   .setX402Support(true);
 *
 * const result = await builder.register({
 *   payer,
 *   uploader: createSatiUploader(),
 * });
 * ```
 */

import type { Address, KeyPairSigner } from "@solana/kit";
import type { AgentIdentity, RegisterAgentResult } from "./types";
import type { ServiceDefinition, RegistrationFileParams, TrustMechanism } from "./registration";
import type { MetadataUploader } from "./uploaders";
import type { Sati } from "./client";

export class SatiAgentBuilder {
  private _params: RegistrationFileParams;
  private _identity: AgentIdentity | undefined;
  private readonly _sati: Sati;

  constructor(sati: Sati, name: string, description: string, image: string) {
    this._sati = sati;
    this._params = {
      name,
      description,
      image,
      services: [],
      active: true,
    };
  }

  // =========================================================================
  // Read-only accessors
  // =========================================================================

  /** Current registration file parameters. */
  get params(): RegistrationFileParams {
    return this._params;
  }

  /** On-chain identity (available after register/load). */
  get identity(): AgentIdentity | undefined {
    return this._identity;
  }

  // =========================================================================
  // Fluent setters
  // =========================================================================

  /** Set a generic service definition. */
  setService(service: ServiceDefinition): this {
    if (!this._params.services) this._params.services = [];
    this._params.services = this._params.services.filter((s) => s.name !== service.name);
    this._params.services.push(service);
    return this;
  }

  /**
   * Set MCP endpoint.
   *
   * Unlike agent0-sdk's `SatiAgent.setMCP()`, this does NOT auto-fetch capabilities.
   * Pass tools/prompts/resources explicitly via the `meta` parameter.
   */
  setMCP(url: string, version?: string, meta?: { tools?: string[]; prompts?: string[]; resources?: string[] }): this {
    return this.setService({
      name: "MCP",
      endpoint: url,
      ...(version && { version }),
      ...(meta?.tools?.length && { mcpTools: meta.tools }),
      ...(meta?.prompts?.length && { mcpPrompts: meta.prompts }),
      ...(meta?.resources?.length && { mcpResources: meta.resources }),
    });
  }

  /** Set A2A service. */
  setA2A(url: string, version?: string, meta?: { skills?: string[] }): this {
    return this.setService({
      name: "A2A",
      endpoint: url,
      ...(version && { version }),
      ...(meta?.skills?.length && { a2aSkills: meta.skills }),
    });
  }

  /** Set wallet service. */
  setWallet(address: string): this {
    return this.setService({
      name: "agentWallet",
      endpoint: address,
    });
  }

  /** Remove a service by name. */
  removeService(name: string): this {
    if (this._params.services) {
      this._params.services = this._params.services.filter((s) => s.name !== name);
    }
    return this;
  }

  /** Set agent active status. */
  setActive(active: boolean): this {
    this._params.active = active;
    return this;
  }

  /** Set x402 payment support. */
  setX402Support(x402: boolean): this {
    this._params.x402Support = x402;
    return this;
  }

  /** Set supported trust mechanisms. */
  setSupportedTrust(trusts: TrustMechanism[]): this {
    this._params.supportedTrust = trusts;
    return this;
  }

  /** Set external URL. */
  setExternalUrl(url: string): this {
    this._params.externalUrl = url;
    return this;
  }

  /** Update basic info. */
  updateInfo(opts: { name?: string; description?: string; image?: string }): this {
    if (opts.name !== undefined) this._params.name = opts.name;
    if (opts.description !== undefined) this._params.description = opts.description;
    if (opts.image !== undefined) this._params.image = opts.image;
    return this;
  }

  // =========================================================================
  // On-chain operations
  // =========================================================================

  /**
   * Upload registration file and register agent on-chain.
   *
   * @returns Registration result with mint address, member number, and signature
   */
  async register(opts: {
    payer: KeyPairSigner;
    uploader: MetadataUploader;
    nonTransferable?: boolean;
    owner?: Address;
  }): Promise<RegisterAgentResult> {
    const uri = await this._sati.uploadRegistrationFile(this._params, opts.uploader);
    return this._registerWithUri(uri, opts);
  }

  /**
   * Register agent on-chain with a pre-existing URI.
   *
   * Use when you already have a hosted registration file.
   */
  async registerWithUri(opts: {
    payer: KeyPairSigner;
    uri: string;
    nonTransferable?: boolean;
    owner?: Address;
  }): Promise<RegisterAgentResult> {
    return this._registerWithUri(opts.uri, opts);
  }

  /**
   * Re-upload registration file and update the on-chain URI.
   *
   * Use after modifying the builder via fluent setters.
   */
  async update(opts: {
    payer: KeyPairSigner;
    owner: KeyPairSigner;
    uploader: MetadataUploader;
  }): Promise<{ signature: string }> {
    if (!this._identity) {
      throw new Error("Agent not registered on-chain. Call register() first.");
    }
    const uri = await this._sati.uploadRegistrationFile(this._params, opts.uploader);
    return this._updateUri(uri, opts);
  }

  /**
   * Update the on-chain URI to point to a new registration file.
   */
  async updateUri(opts: { payer: KeyPairSigner; owner: KeyPairSigner; uri: string }): Promise<{ signature: string }> {
    if (!this._identity) {
      throw new Error("Agent not registered on-chain. Call register() first.");
    }
    return this._updateUri(opts.uri, opts);
  }

  /**
   * Load existing on-chain identity into this builder.
   * Useful for wrapping an already-registered agent.
   */
  setIdentity(identity: AgentIdentity): this {
    this._identity = identity;
    return this;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private async _registerWithUri(
    uri: string,
    opts: { payer: KeyPairSigner; nonTransferable?: boolean; owner?: Address },
  ): Promise<RegisterAgentResult> {
    if (this._identity) {
      throw new Error("Agent is already registered on-chain. Use update() instead.");
    }

    const result = await this._sati.registerAgent({
      payer: opts.payer,
      name: this._params.name,
      uri,
      nonTransferable: opts.nonTransferable,
      owner: opts.owner,
    });

    this._identity = {
      mint: result.mint,
      owner: opts.owner ?? opts.payer.address,
      name: this._params.name,
      uri,
      memberNumber: result.memberNumber,
      additionalMetadata: {},
      nonTransferable: opts.nonTransferable ?? false,
    };

    return result;
  }

  private async _updateUri(
    uri: string,
    opts: { payer: KeyPairSigner; owner: KeyPairSigner },
  ): Promise<{ signature: string }> {
    const identity = this._identity;
    if (!identity) {
      throw new Error("Agent not registered on-chain. Call register() first.");
    }

    const result = await this._sati.updateAgentMetadata({
      payer: opts.payer,
      owner: opts.owner,
      mint: identity.mint,
      updates: { uri },
    });

    identity.uri = uri;
    return { signature: result.signature };
  }
}
