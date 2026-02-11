/**
 * Main SDK class for the SATI Agent0 adapter.
 *
 * Provides agent0-sdk compatible method signatures backed by SATI's
 * Solana infrastructure. Drop-in replacement for agent0-sdk's SDK class
 * when working with SATI agents.
 */

import {
  Sati,
  loadDeployedConfig,
  fetchRegistrationFile as fetchSatiRegistrationFile,
  buildRegistrationFile as buildSatiRegistrationFile,
  Outcome,
  ContentType,
  serializeFeedback,
  zeroDataHash,
  buildCounterpartyMessage,
  type AgentIdentity,
  type SATISASConfig,
  type FeedbackData,
  type RegistrationFile as SatiRegistrationFile,
} from "@cascade-fyi/sati-sdk";
import { signBytes, address as solAddress } from "@solana/kit";
import type {
  AgentSummary,
  Feedback,
  FeedbackFileInput,
  FeedbackSearchFilters,
  FeedbackSearchOptions,
  SearchFilters,
  SearchOptions,
  AgentId,
  URI,
  Address,
} from "agent0-sdk";
import type { SatiSDKConfig } from "./types.js";
import { SatiAgent } from "./agent.js";
import {
  SOLANA_CAIP2_CHAINS,
  parseSatiAgentId,
  toAgentSummary,
  toAgent0RegistrationFile,
  toFeedback,
} from "./adapters.js";

/**
 * SATI Agent0 SDK - agent0-sdk compatible interface backed by Solana.
 *
 * Method signatures match agent0-sdk's `SDK` class so that example code
 * can switch between EVM and Solana by changing only the import and config.
 *
 * @example
 * ```typescript
 * import { SatiSDK } from "@cascade-fyi/sati-agent0-sdk";
 * import { generateKeyPairSigner } from "@solana/kit";
 *
 * const signer = await generateKeyPairSigner();
 * const sdk = new SatiSDK({
 *   network: "devnet",
 *   signer,
 * });
 *
 * const agent = sdk.createAgent("MyAgent", "An AI assistant");
 * ```
 */
export class SatiSDK {
  private readonly _config: SatiSDKConfig;
  private readonly _sati: Sati;
  private readonly _sasConfig: SATISASConfig | null;
  private readonly _chain: string;

  constructor(config: SatiSDKConfig) {
    this._config = config;
    this._sati = new Sati({
      network: config.network,
      rpcUrl: config.rpcUrl,
    });
    this._sasConfig = loadDeployedConfig(config.network);
    this._chain = SOLANA_CAIP2_CHAINS[config.network] ?? `solana:${config.network}`;
  }

  /** Get the SATI network. */
  get network(): SatiSDKConfig["network"] {
    return this._config.network;
  }

  /** Get the CAIP-2 chain reference. */
  get chain(): string {
    return this._chain;
  }

  /** @internal Access the underlying Sati client. */
  get sati(): Sati {
    return this._sati;
  }

  /** @internal Access the SAS schema config. */
  get sasConfig(): SATISASConfig | null {
    return this._sasConfig;
  }

  // =========================================================================
  // Agent lifecycle (mirrors agent0-sdk SDK methods)
  // =========================================================================

  /**
   * Create a new agent (off-chain object in memory).
   * Call `agent.registerIPFS()` to register on-chain.
   */
  createAgent(name: string, description: string, image?: URI): SatiAgent {
    return SatiAgent.create(this, name, description, image);
  }

  /**
   * Load an existing agent by agent0-compatible AgentId.
   */
  async loadAgent(agentId: AgentId): Promise<SatiAgent> {
    const identity = await this._resolveIdentity(agentId);
    const regFile = await fetchSatiRegistrationFile(identity.uri);
    const fallback: SatiRegistrationFile =
      regFile ??
      buildSatiRegistrationFile({
        name: identity.name,
        description: "",
        image: "https://placehold.co/256",
      });
    const agent0RegFile = toAgent0RegistrationFile(fallback, identity, this._chain);
    return SatiAgent.fromIdentity(this, identity, agent0RegFile);
  }

  /**
   * Get agent summary (read-only).
   */
  async getAgent(agentId: AgentId): Promise<AgentSummary | null> {
    const mint = parseSatiAgentId(agentId);
    if (mint === null) return null;

    const identity = await this._sati.loadAgent(solAddress(mint));
    if (!identity) return null;

    const regFile = await fetchSatiRegistrationFile(identity.uri);
    return toAgentSummary(identity, this._chain, regFile);
  }

  /**
   * Search agents with filters.
   *
   * Fetches agents from on-chain registry and optionally loads registration
   * files for detailed filtering. Name filter is applied on-chain data;
   * active/hasMCP/hasA2A/supportedTrust filters require registration file fetches.
   */
  async searchAgents(filters?: SearchFilters, _options?: SearchOptions): Promise<AgentSummary[]> {
    const agents = await this._sati.listAllAgents({ limit: 100 });

    // Determine if we need registration files for filtering
    const needsRegFile =
      filters?.active !== undefined ||
      filters?.hasMCP !== undefined ||
      filters?.hasA2A !== undefined ||
      filters?.hasEndpoints !== undefined ||
      filters?.supportedTrust !== undefined;

    const results: AgentSummary[] = [];
    for (const identity of agents) {
      // Name filter on on-chain data (cheap)
      if (filters?.name && !identity.name.toLowerCase().includes(filters.name.toLowerCase())) {
        continue;
      }

      const regFile = needsRegFile ? await fetchSatiRegistrationFile(identity.uri) : null;
      const summary = toAgentSummary(identity, this._chain, regFile);

      // Apply registration-file-dependent filters
      if (filters?.active !== undefined && summary.active !== filters.active) continue;
      if (filters?.hasMCP && !summary.mcp) continue;
      if (filters?.hasA2A && !summary.a2a) continue;
      if (filters?.hasEndpoints === true && !summary.mcp && !summary.a2a && !summary.ens && !summary.did) continue;
      if (filters?.supportedTrust) {
        const hasAll = filters.supportedTrust.every((t) => summary.supportedTrusts.includes(t));
        if (!hasAll) continue;
      }

      results.push(summary);
    }

    return results;
  }

  /**
   * Transfer agent ownership to a new Solana address.
   */
  async transferAgent(agentId: AgentId, newOwner: Address): Promise<{ signature: string }> {
    const identity = await this._resolveIdentity(agentId);
    const signer = this._config.signer;

    return this._sati.transferAgent({
      payer: signer,
      owner: signer,
      mint: identity.mint,
      newOwner: solAddress(newOwner),
    });
  }

  /**
   * Check if address owns the agent.
   */
  async isAgentOwner(agentId: AgentId, addr: Address): Promise<boolean> {
    const owner = await this.getAgentOwner(agentId);
    return owner === addr;
  }

  /**
   * Get agent owner address.
   */
  async getAgentOwner(agentId: AgentId): Promise<Address> {
    const identity = await this._resolveIdentity(agentId);
    return (await this._sati.getAgentOwner(identity.mint)) as Address;
  }

  // =========================================================================
  // Feedback (mirrors agent0-sdk SDK methods)
  // =========================================================================

  /**
   * Prepare an off-chain feedback file.
   */
  prepareFeedbackFile(input: FeedbackFileInput, extra?: Record<string, unknown>): FeedbackFileInput {
    return { ...input, ...extra };
  }

  /**
   * Give feedback to an agent.
   *
   * Uses FeedbackPublicV1 schema (CounterpartySigned mode).
   * Outcome is always Neutral; value/tags stored in content JSON.
   */
  async giveFeedback(
    agentId: AgentId,
    value: number | string,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackFile?: FeedbackFileInput,
  ): Promise<{ signature: string; feedback: Feedback }> {
    const sasConfig = this._requireSASConfig();
    const feedbackPublicSchema = sasConfig.schemas.feedbackPublic;
    if (!feedbackPublicSchema) {
      throw new Error("FeedbackPublic schema not deployed on this network");
    }

    const identity = await this._resolveIdentity(agentId);
    const signer = this._config.signer;

    // Build content JSON
    const contentObj: Record<string, unknown> = {};
    if (value !== undefined) contentObj.score = typeof value === "string" ? Number.parseFloat(value) : value;
    if (tag1) contentObj.tags = tag2 ? [tag1, tag2] : [tag1];
    if (endpoint) contentObj.endpoint = endpoint;
    if (feedbackFile?.text) contentObj.m = feedbackFile.text;

    const content =
      Object.keys(contentObj).length > 0 ? new TextEncoder().encode(JSON.stringify(contentObj)) : new Uint8Array(0);
    const contentType = content.length > 0 ? ContentType.JSON : ContentType.None;

    // Random 32-byte task reference for uniqueness
    const taskRef = new Uint8Array(32);
    globalThis.crypto.getRandomValues(taskRef);

    // Serialize feedback data to build SIWS message
    const feedbackData: FeedbackData = {
      taskRef,
      agentMint: identity.mint,
      counterparty: signer.address,
      dataHash: zeroDataHash(),
      outcome: Outcome.Neutral,
      contentType,
      content,
    };
    const serializedData = serializeFeedback(feedbackData);

    // Build SIWS message and sign with counterparty (signer)
    const { messageBytes } = buildCounterpartyMessage({
      schemaName: "FeedbackPublic",
      data: serializedData,
    });
    const sig = await signBytes(signer.keyPair.privateKey, messageBytes);

    // Create feedback via SATI (CounterpartySigned mode)
    const result = await this._sati.createFeedback({
      payer: signer,
      sasSchema: feedbackPublicSchema,
      taskRef,
      agentMint: identity.mint,
      counterparty: signer.address,
      dataHash: zeroDataHash(),
      outcome: Outcome.Neutral,
      contentType,
      content,
      agentSignature: {
        pubkey: signer.address,
        signature: new Uint8Array(sig),
      },
      counterpartyMessage: messageBytes,
      lookupTableAddress: sasConfig.lookupTable,
    });

    // Build agent0 Feedback response
    const feedback = toFeedback({
      agentMint: identity.mint,
      chain: this._chain,
      reviewer: signer.address,
      feedbackIndex: 0,
      content: {
        value: typeof value === "string" ? Number.parseFloat(value) : value,
        tag1,
        tag2,
        endpoint,
        text: feedbackFile?.text,
      },
      txSignature: result.signature,
    });

    return { signature: result.signature, feedback };
  }

  /**
   * Search feedback with filters.
   */
  async searchFeedback(filters: FeedbackSearchFilters, options?: FeedbackSearchOptions): Promise<Feedback[]> {
    const sasConfig = this._requireSASConfig();

    // Build SATI attestation filter
    const satiFilter: Record<string, unknown> = {
      sasSchema: sasConfig.schemas.feedbackPublic ?? sasConfig.schemas.feedback,
    };

    // Resolve agentId to agentMint (use agentId or first of agents[])
    let knownIdentity: AgentIdentity | null = null;
    const targetAgentId = filters.agentId ?? filters.agents?.[0];
    if (targetAgentId) {
      knownIdentity = await this._resolveIdentity(targetAgentId);
      satiFilter.agentMint = knownIdentity.mint;
    }

    // Resolve reviewer to counterparty
    if (filters.reviewers?.length) {
      satiFilter.counterparty = solAddress(filters.reviewers[0]);
    }

    const result = await this._sati.listFeedbacks(satiFilter);

    const feedbacks: Feedback[] = [];
    for (let i = 0; i < result.items.length; i++) {
      const item = result.items[i];

      // Parse content JSON
      const rawContent =
        item.data.contentType === ContentType.JSON && item.data.content.length > 0
          ? (JSON.parse(new TextDecoder().decode(item.data.content)) as Record<string, unknown>)
          : null;

      const score = rawContent?.score as number | undefined;
      const tags = (rawContent?.tags as string[]) ?? [];
      const text = rawContent?.m as string | undefined;
      const endpointVal = rawContent?.endpoint as string | undefined;

      // Client-side tag filtering
      if (filters.tags?.length) {
        const hasAll = filters.tags.every((t) => tags.includes(t));
        if (!hasAll) continue;
      }

      // Client-side value filtering
      if (options?.minValue !== undefined && (score === undefined || score < options.minValue)) continue;
      if (options?.maxValue !== undefined && (score === undefined || score > options.maxValue)) continue;

      feedbacks.push(
        toFeedback({
          agentMint: item.data.agentMint,
          chain: this._chain,
          reviewer: item.data.counterparty,
          feedbackIndex: i,
          content: {
            value: score,
            tag1: tags[0],
            tag2: tags[1],
            endpoint: endpointVal,
            text,
          },
        }),
      );
    }

    return feedbacks;
  }

  /**
   * Append response to feedback.
   *
   * @throws Error - Not supported on SATI at the moment.
   */
  async appendResponse(
    _agentId: AgentId,
    _clientAddress: Address,
    _feedbackIndex: number,
    _response: { uri: URI; hash: string },
  ): Promise<never> {
    throw new Error("appendResponse is not supported on SATI at the moment");
  }

  /**
   * Get reputation summary for an agent.
   *
   * Computes average score from all FeedbackPublic attestations,
   * optionally filtered by tags.
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string,
  ): Promise<{ count: number; averageValue: number }> {
    const sasConfig = this._requireSASConfig();
    const identity = await this._resolveIdentity(agentId);

    const result = await this._sati.listFeedbacks({
      sasSchema: sasConfig.schemas.feedbackPublic ?? sasConfig.schemas.feedback,
      agentMint: identity.mint,
    });

    if (result.items.length === 0) {
      return { count: 0, averageValue: 0 };
    }

    let sum = 0;
    let count = 0;

    for (const item of result.items) {
      const rawContent =
        item.data.contentType === ContentType.JSON && item.data.content.length > 0
          ? (JSON.parse(new TextDecoder().decode(item.data.content)) as Record<string, unknown>)
          : null;

      const score = rawContent?.score as number | undefined;
      const tags = (rawContent?.tags as string[]) ?? [];

      // Apply tag filters
      if (tag1 && !tags.includes(tag1)) continue;
      if (tag2 && !tags.includes(tag2)) continue;

      if (score !== undefined) {
        sum += score;
        count++;
      }
    }

    return {
      count,
      averageValue: count > 0 ? sum / count : 0,
    };
  }

  // =========================================================================
  // Internal accessors (used by SatiAgent)
  // =========================================================================

  /** @internal */
  get config(): SatiSDKConfig {
    return this._config;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  private _requireSASConfig(): SATISASConfig {
    if (!this._sasConfig) {
      throw new Error(`No SAS config deployed for network "${this._config.network}". Deploy schemas first.`);
    }
    return this._sasConfig;
  }

  private async _resolveIdentity(agentId: AgentId): Promise<AgentIdentity> {
    const mint = parseSatiAgentId(agentId);
    if (mint === null) {
      throw new Error(`Invalid SATI agent ID: ${agentId}. Expected format: solana:<chainRef>:<mintAddress>`);
    }

    const identity = await this._sati.loadAgent(solAddress(mint));
    if (!identity) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    return identity;
  }
}
