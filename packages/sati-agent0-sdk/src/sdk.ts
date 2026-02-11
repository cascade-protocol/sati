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
  findAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ADDRESS,
  type AgentIdentity,
  type SATISASConfig,
  type FeedbackData,
  type RegistrationFile as SatiRegistrationFile,
} from "@cascade-fyi/sati-sdk";
import { signBytes, address as solAddress, getAddressDecoder } from "@solana/kit";
import { getCreateAssociatedTokenIdempotentInstruction, getTransferInstruction } from "@solana-program/token-2022";
import type {
  AgentSummary,
  Feedback,
  FeedbackFileInput,
  FeedbackSearchFilters,
  SearchFilters,
  AgentId,
  URI,
  Address,
} from "agent0-sdk";
import type {
  SatiSDKConfig,
  SatiSearchOptions,
  SatiFeedbackSearchOptions,
  SatiFeedbackOptions,
  WriteAccess,
  PreparedFeedback,
  ValidationResult,
} from "./types.js";
import type { KeyPairSigner } from "@solana/kit";
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

  /**
   * Chain ID (0 for Solana - not an EVM chain).
   * Use `chain` property for the CAIP-2 identifier.
   */
  get chainId(): number {
    return 0;
  }

  /** Get the CAIP-2 chain reference. */
  get chain(): string {
    return this._chain;
  }

  /** True if SDK has no signer or transaction sender configured (read-only mode). */
  get isReadOnly(): boolean {
    return !this._config.signer && !this._config.transactionSender;
  }

  /**
   * Access the underlying SATI client for SATI-specific operations
   * not covered by the agent0-sdk interface (e.g. validations, compression).
   */
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
   * Fetches agents from on-chain registry and applies client-side filtering
   * against on-chain data and registration files.
   *
   * Supports most agent0-sdk SearchFilters. Unsupported filters (require indexer):
   * `keyword`, `registeredAtFrom/To`, `updatedAtFrom/To`, `hasMetadataKey`,
   * `metadataValue`, `operators`.
   *
   * Pass `includeFeedbackStats: true` in options to populate `feedbackCount` and
   * `averageValue` on results (slower - extra RPC calls per agent).
   * Automatically enabled when `filters.feedback` is set.
   */
  async searchAgents(filters?: SearchFilters, options?: SatiSearchOptions): Promise<AgentSummary[]> {
    // Step 1: Fetch agents - use listAgentsByOwner when filtering by owners
    let agents: AgentIdentity[];
    if (filters?.owners?.length) {
      const ownerResults = await Promise.all(filters.owners.map((o) => this._sati.listAgentsByOwner(solAddress(o))));
      agents = ownerResults.flat();
    } else {
      agents = await this._sati.listAllAgents({ limit: 1000 });
    }

    // Step 2: Apply on-chain filters (cheap, no reg file needed)
    if (filters?.agentIds?.length) {
      const mintSet = new Set(
        filters.agentIds.map((id) => parseSatiAgentId(id)).filter((m): m is string => m !== null),
      );
      agents = agents.filter((a) => mintSet.has(a.mint));
    }
    if (filters?.name) {
      const lower = filters.name.toLowerCase();
      agents = agents.filter((a) => a.name.toLowerCase().includes(lower));
    }

    // Step 3: Determine if we need registration files
    const needsRegFile = !!(
      filters?.description ||
      filters?.active !== undefined ||
      filters?.hasMCP ||
      filters?.hasA2A ||
      filters?.hasOASF ||
      filters?.hasWeb ||
      filters?.hasEndpoints !== undefined ||
      filters?.hasRegistrationFile !== undefined ||
      filters?.x402support !== undefined ||
      filters?.supportedTrust?.length ||
      filters?.mcpTools?.length ||
      filters?.mcpPrompts?.length ||
      filters?.mcpResources?.length ||
      filters?.a2aSkills?.length ||
      filters?.oasfSkills?.length ||
      filters?.oasfDomains?.length ||
      filters?.walletAddress ||
      filters?.webContains ||
      filters?.mcpContains ||
      filters?.a2aContains ||
      filters?.ensContains ||
      filters?.didContains
    );

    const regFiles: (SatiRegistrationFile | null)[] = needsRegFile
      ? await Promise.all(agents.map((a) => fetchSatiRegistrationFile(a.uri)))
      : agents.map(() => null);

    // Step 4: Optionally fetch feedback stats
    const wantFeedbackStats = !!(options?.includeFeedbackStats || filters?.feedback);
    let feedbackStatsMap: Map<string, { count: number; averageValue: number }> | null = null;

    if (wantFeedbackStats && this._sasConfig) {
      feedbackStatsMap = new Map();
      const schema = this._sasConfig.schemas.feedbackPublic ?? this._sasConfig.schemas.feedback;
      await Promise.all(
        agents.map(async (agent) => {
          try {
            const result = await this._sati.listFeedbacks({ sasSchema: schema, agentMint: agent.mint });
            const scores = result.items
              .map((item) => {
                if (item.data.contentType === ContentType.JSON && item.data.content.length > 0) {
                  const raw = JSON.parse(new TextDecoder().decode(item.data.content)) as Record<string, unknown>;
                  return raw?.score as number | undefined;
                }
                return undefined;
              })
              .filter((s): s is number => s !== undefined);
            const count = scores.length;
            const averageValue = count > 0 ? scores.reduce((a, b) => a + b, 0) / count : 0;
            feedbackStatsMap?.set(agent.mint, { count, averageValue });
          } catch {
            /* skip on error */
          }
        }),
      );
    }

    // Step 5: Apply all filters
    const results: AgentSummary[] = [];
    for (let i = 0; i < agents.length; i++) {
      const identity = agents[i];
      const regFile = regFiles[i];
      const endpoints = regFile?.endpoints ?? [];

      // Registration file existence
      if (filters?.hasRegistrationFile === true && !regFile) continue;
      if (filters?.hasRegistrationFile === false && regFile) continue;

      // Description substring
      if (filters?.description) {
        if (!regFile?.description?.toLowerCase().includes(filters.description.toLowerCase())) continue;
      }

      // Status flags
      if (filters?.active !== undefined && (regFile?.active ?? true) !== filters.active) continue;
      if (filters?.x402support !== undefined && (regFile?.x402support ?? false) !== filters.x402support) continue;

      // Endpoint existence
      if (filters?.hasMCP && !endpoints.some((e) => e.name.toUpperCase() === "MCP")) continue;
      if (filters?.hasA2A && !endpoints.some((e) => e.name.toUpperCase() === "A2A")) continue;
      if (filters?.hasOASF && !endpoints.some((e) => e.name.toUpperCase() === "OASF")) continue;
      if (filters?.hasWeb && !endpoints.some((e) => e.name.toUpperCase() === "WEB")) continue;
      if (filters?.hasEndpoints === true && endpoints.length === 0) continue;

      // Endpoint substring
      if (filters?.mcpContains) {
        const ep = endpoints.find((e) => e.name.toUpperCase() === "MCP");
        if (!ep?.endpoint.includes(filters.mcpContains)) continue;
      }
      if (filters?.a2aContains) {
        const ep = endpoints.find((e) => e.name.toUpperCase() === "A2A");
        if (!ep?.endpoint.includes(filters.a2aContains)) continue;
      }
      if (filters?.ensContains) {
        const ep = endpoints.find((e) => e.name.toUpperCase() === "ENS");
        if (!ep?.endpoint.includes(filters.ensContains)) continue;
      }
      if (filters?.didContains) {
        const ep = endpoints.find((e) => e.name.toUpperCase() === "DID");
        if (!ep?.endpoint.includes(filters.didContains)) continue;
      }
      if (filters?.webContains) {
        const ep = endpoints.find((e) => e.name.toUpperCase() === "WEB");
        if (!ep?.endpoint.includes(filters.webContains)) continue;
      }

      // Wallet address
      if (filters?.walletAddress) {
        const walletEp = endpoints.find(
          (e) => e.name.toUpperCase() === "AGENTWALLET" || e.name.toUpperCase() === "WALLET",
        );
        if (!walletEp?.endpoint.includes(filters.walletAddress)) continue;
      }

      // Trust models
      if (filters?.supportedTrust?.length) {
        const trusts = regFile?.supportedTrust ?? [];
        if (
          !filters.supportedTrust.every((t) =>
            trusts.includes(t as "reputation" | "crypto-economic" | "tee-attestation"),
          )
        )
          continue;
      }

      // Capability arrays (ANY semantics - at least one match)
      if (filters?.mcpTools?.length) {
        const tools = endpoints.find((e) => e.name.toUpperCase() === "MCP")?.mcpTools ?? [];
        if (!filters.mcpTools.some((t) => tools.includes(t))) continue;
      }
      if (filters?.mcpPrompts?.length) {
        const prompts = endpoints.find((e) => e.name.toUpperCase() === "MCP")?.mcpPrompts ?? [];
        if (!filters.mcpPrompts.some((t) => prompts.includes(t))) continue;
      }
      if (filters?.mcpResources?.length) {
        const resources = endpoints.find((e) => e.name.toUpperCase() === "MCP")?.mcpResources ?? [];
        if (!filters.mcpResources.some((t) => resources.includes(t))) continue;
      }
      if (filters?.a2aSkills?.length) {
        const skills = endpoints.find((e) => e.name.toUpperCase() === "A2A")?.a2aSkills ?? [];
        if (!filters.a2aSkills.some((t) => skills.includes(t))) continue;
      }
      if (filters?.oasfSkills?.length) {
        const skills = endpoints.find((e) => e.name.toUpperCase() === "OASF")?.skills ?? [];
        if (!filters.oasfSkills.some((t) => skills.includes(t))) continue;
      }
      if (filters?.oasfDomains?.length) {
        const domains = endpoints.find((e) => e.name.toUpperCase() === "OASF")?.domains ?? [];
        if (!filters.oasfDomains.some((t) => domains.includes(t))) continue;
      }

      // Feedback nested filters
      if (filters?.feedback) {
        const fbStats = feedbackStatsMap?.get(identity.mint);
        const fb = filters.feedback;
        if (fb.hasFeedback === true && (!fbStats || fbStats.count === 0)) continue;
        if (fb.hasNoFeedback === true && fbStats && fbStats.count > 0) continue;
        if (fb.minValue !== undefined && (!fbStats || fbStats.averageValue < fb.minValue)) continue;
        if (fb.maxValue !== undefined && (!fbStats || fbStats.averageValue > fb.maxValue)) continue;
        if (fb.minCount !== undefined && (!fbStats || fbStats.count < fb.minCount)) continue;
        if (fb.maxCount !== undefined && (!fbStats || fbStats.count > fb.maxCount)) continue;
      }

      const stats = feedbackStatsMap?.get(identity.mint) ?? null;
      results.push(toAgentSummary(identity, this._chain, regFile, stats));
    }

    // Step 6: Sort
    const sortFields = options?.sort;
    if (sortFields?.length) {
      results.sort((a, b) => {
        for (const sortStr of sortFields) {
          const [field, dir] = sortStr.split(":");
          const mul = dir === "asc" ? 1 : -1;
          const aVal = (a as unknown as Record<string, unknown>)[field] ?? 0;
          const bVal = (b as unknown as Record<string, unknown>)[field] ?? 0;
          if (aVal !== bVal) return (aVal > bVal ? 1 : -1) * mul;
        }
        return 0;
      });
    }

    return results;
  }

  /**
   * Transfer agent ownership to a new Solana address.
   */
  async transferAgent(agentId: AgentId, newOwner: Address): Promise<{ signature: string }> {
    const identity = await this._resolveIdentity(agentId);
    const access = this._requireWriteAccess();

    if (access.type === "keypair") {
      return this._sati.transferAgent({
        payer: access.signer,
        owner: access.signer,
        mint: identity.mint,
        newOwner: solAddress(newOwner),
      });
    }

    // Sender path: build ATA creation + transfer instructions
    const ownerAddr = solAddress(access.sender.address);
    const [sourceAta] = await findAssociatedTokenAddress(identity.mint, ownerAddr);
    const [destAta] = await findAssociatedTokenAddress(identity.mint, solAddress(newOwner));

    const createAtaIx = getCreateAssociatedTokenIdempotentInstruction({
      payer: { address: ownerAddr } as KeyPairSigner,
      owner: solAddress(newOwner),
      mint: identity.mint,
      ata: destAta,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });

    const transferIx = getTransferInstruction({
      source: sourceAta,
      destination: destAta,
      authority: { address: ownerAddr } as KeyPairSigner,
      amount: 1n,
    });

    const signature = await access.sender.signAndSend([createAtaIx, transferIx]);
    return { signature };
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
   * Value/tags stored in content JSON.
   *
   * @param satiOptions - SATI-specific overrides (outcome, taskRef). When omitted,
   *   outcome defaults to Neutral and taskRef is random.
   */
  async giveFeedback(
    agentId: AgentId,
    value: number | string,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackFile?: FeedbackFileInput,
    satiOptions?: SatiFeedbackOptions,
  ): Promise<{ signature: string; feedback: Feedback }> {
    const sasConfig = this._requireSASConfig();
    const feedbackPublicSchema = sasConfig.schemas.feedbackPublic;
    if (!feedbackPublicSchema) {
      throw new Error("FeedbackPublic schema not deployed on this network");
    }

    const identity = await this._resolveIdentity(agentId);
    const access = this._requireWriteAccess();

    // Build content JSON
    const contentObj: Record<string, unknown> = {};
    if (value !== undefined) contentObj.score = typeof value === "string" ? Number.parseFloat(value) : value;
    if (tag1) contentObj.tags = tag2 ? [tag1, tag2] : [tag1];
    if (endpoint) contentObj.endpoint = endpoint;
    if (feedbackFile?.text) contentObj.m = feedbackFile.text;

    const content =
      Object.keys(contentObj).length > 0 ? new TextEncoder().encode(JSON.stringify(contentObj)) : new Uint8Array(0);
    const contentType = content.length > 0 ? ContentType.JSON : ContentType.None;

    const taskRef = satiOptions?.taskRef ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
    const outcome = satiOptions?.outcome ?? Outcome.Neutral;

    const numericValue = typeof value === "string" ? Number.parseFloat(value) : value;

    if (access.type === "keypair") {
      const signer = access.signer;
      // Serialize feedback data to build SIWS message
      const feedbackData: FeedbackData = {
        taskRef,
        agentMint: identity.mint,
        counterparty: signer.address,
        dataHash: zeroDataHash(),
        outcome,
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
        outcome,
        contentType,
        content,
        agentSignature: {
          pubkey: signer.address,
          signature: new Uint8Array(sig),
        },
        counterpartyMessage: messageBytes,
        lookupTableAddress: sasConfig.lookupTable,
      });

      const feedback = toFeedback({
        agentMint: identity.mint,
        chain: this._chain,
        reviewer: signer.address,
        feedbackIndex: 0,
        content: { value: numericValue, tag1, tag2, endpoint, text: feedbackFile?.text },
        txSignature: result.signature,
        outcome,
      });

      return { signature: result.signature, feedback };
    }

    // Sender path: Feedback requires Light Protocol compressed accounts,
    // which can't be expressed as simple instructions for signAndSend().
    // Use prepareFeedback() + submitPreparedFeedback() instead.
    throw new Error(
      "giveFeedback is not supported via transactionSender (browser wallet). " +
        "Use prepareFeedback() to get SIWS message bytes, have the wallet sign them, " +
        "then call submitPreparedFeedback() with a server-side KeyPairSigner to submit.",
    );
  }

  /**
   * Prepare a feedback submission for browser wallet signing.
   *
   * Returns SIWS message bytes that the counterparty wallet must sign.
   * Pass the result + signature to `submitPreparedFeedback()`.
   *
   * @param agentId - Agent to give feedback to
   * @param value - Numeric feedback value
   * @param tag1 - Optional first tag
   * @param tag2 - Optional second tag
   * @param opts - Optional: endpoint, text, counterparty address (defaults to transactionSender address)
   * @param satiOptions - SATI-specific overrides (outcome, taskRef)
   */
  async prepareFeedback(
    agentId: AgentId,
    value: number,
    tag1?: string,
    tag2?: string,
    opts?: { endpoint?: string; text?: string; counterparty?: string },
    satiOptions?: SatiFeedbackOptions,
  ): Promise<PreparedFeedback> {
    const sasConfig = this._requireSASConfig();
    const feedbackPublicSchema = sasConfig.schemas.feedbackPublic;
    if (!feedbackPublicSchema) {
      throw new Error("FeedbackPublic schema not deployed on this network");
    }

    const identity = await this._resolveIdentity(agentId);

    // Determine counterparty address
    const counterpartyAddr = opts?.counterparty ?? this._config.transactionSender?.address;
    if (!counterpartyAddr) {
      throw new Error("counterparty address required - provide via opts.counterparty or configure transactionSender");
    }

    // Build content JSON
    const contentObj: Record<string, unknown> = {};
    if (value !== undefined) contentObj.score = value;
    if (tag1) contentObj.tags = tag2 ? [tag1, tag2] : [tag1];
    if (opts?.endpoint) contentObj.endpoint = opts.endpoint;
    if (opts?.text) contentObj.m = opts.text;

    const content =
      Object.keys(contentObj).length > 0 ? new TextEncoder().encode(JSON.stringify(contentObj)) : new Uint8Array(0);
    const contentType = content.length > 0 ? ContentType.JSON : ContentType.None;

    const taskRef = satiOptions?.taskRef ?? globalThis.crypto.getRandomValues(new Uint8Array(32));
    const outcome = satiOptions?.outcome ?? Outcome.Neutral;

    // Serialize feedback data to build SIWS message
    const feedbackData: FeedbackData = {
      taskRef,
      agentMint: identity.mint,
      counterparty: solAddress(counterpartyAddr),
      dataHash: zeroDataHash(),
      outcome,
      contentType,
      content,
    };
    const serializedData = serializeFeedback(feedbackData);

    // Build SIWS message
    const { messageBytes } = buildCounterpartyMessage({
      schemaName: "FeedbackPublic",
      data: serializedData,
    });

    return {
      messageBytes,
      agentMint: identity.mint,
      counterparty: solAddress(counterpartyAddr),
      taskRef,
      dataHash: zeroDataHash(),
      outcome,
      contentType,
      content,
      sasSchema: feedbackPublicSchema,
      lookupTable: sasConfig.lookupTable,
      feedbackMeta: {
        value,
        tag1,
        tag2,
        endpoint: opts?.endpoint,
        text: opts?.text,
      },
    };
  }

  /**
   * Submit a prepared feedback using a server-side KeyPairSigner.
   *
   * The signer pays gas. The counterparty's SIWS signature proves consent.
   *
   * @param prepared - Result from `prepareFeedback()`
   * @param counterpartySignature - Counterparty wallet's signature of `prepared.messageBytes`
   */
  async submitPreparedFeedback(
    prepared: PreparedFeedback,
    counterpartySignature: Uint8Array,
  ): Promise<{ signature: string; feedback: Feedback }> {
    const signer = this._requireSigner();

    const result = await this._sati.createFeedback({
      payer: signer,
      sasSchema: prepared.sasSchema,
      taskRef: prepared.taskRef,
      agentMint: prepared.agentMint,
      counterparty: prepared.counterparty,
      dataHash: prepared.dataHash,
      outcome: prepared.outcome,
      contentType: prepared.contentType,
      content: prepared.content,
      agentSignature: {
        pubkey: prepared.counterparty,
        signature: new Uint8Array(counterpartySignature),
      },
      counterpartyMessage: prepared.messageBytes,
      lookupTableAddress: prepared.lookupTable,
    });

    const feedback = toFeedback({
      agentMint: prepared.agentMint,
      chain: this._chain,
      reviewer: prepared.counterparty,
      feedbackIndex: 0,
      content: prepared.feedbackMeta,
      txSignature: result.signature,
      outcome: prepared.outcome,
    });

    return { signature: result.signature, feedback };
  }

  /**
   * Search feedback with filters.
   *
   * Supports most agent0-sdk FeedbackSearchFilters. The `includeRevoked`
   * filter is a no-op on SATI (closed attestations are permanently deleted).
   */
  async searchFeedback(filters: FeedbackSearchFilters, options?: SatiFeedbackSearchOptions): Promise<Feedback[]> {
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

    // Fetch current slot for timestamp conversion (slotCreated -> Unix seconds)
    const currentSlot = await this._sati.getRpc().getSlot({ commitment: "confirmed" }).send();
    const nowSec = Math.floor(Date.now() / 1000);

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
      const capability = rawContent?.cap as string | undefined;
      const name = rawContent?.n as string | undefined;
      const skill = rawContent?.sk as string | undefined;
      const task = rawContent?.tsk as string | undefined;
      const proofOfPayment = rawContent?.pop as Record<string, unknown> | undefined;
      const fileURI = rawContent?.fileURI as string | undefined;

      // Client-side tag filtering
      if (filters.tags?.length) {
        const hasAll = filters.tags.every((t) => tags.includes(t));
        if (!hasAll) continue;
      }

      // Client-side value filtering
      if (options?.minValue !== undefined && (score === undefined || score < options.minValue)) continue;
      if (options?.maxValue !== undefined && (score === undefined || score > options.maxValue)) continue;

      // Client-side capability/skill/task/name filtering
      if (filters.capabilities?.length && (!capability || !filters.capabilities.includes(capability))) continue;
      if (filters.skills?.length && (!skill || !filters.skills.includes(skill))) continue;
      if (filters.tasks?.length && (!task || !filters.tasks.includes(task))) continue;
      if (filters.names?.length && (!name || !filters.names.includes(name))) continue;

      // Compute createdAt from slotCreated (~400ms per slot)
      const slotDiff = Number(BigInt(currentSlot) - item.raw.slotCreated);
      const createdAt = nowSec - Math.floor(slotDiff * 0.4);

      // Decode compressed account address for on-demand tx lookups
      const [compressedAddress] = getAddressDecoder().read(item.address, 0);

      const feedback = toFeedback({
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
          context: {
            satiCompressedAddress: compressedAddress,
            counterparty: item.data.counterparty,
            agentMint: item.data.agentMint,
          },
        },
        createdAt,
        outcome: item.data.outcome,
      });

      // Populate additional fields
      if (capability) feedback.capability = capability;
      if (name) feedback.name = name;
      if (skill) feedback.skill = skill;
      if (task) feedback.task = task;
      if (proofOfPayment) feedback.proofOfPayment = proofOfPayment;
      if (fileURI) feedback.fileURI = fileURI;

      feedbacks.push(feedback);
    }

    // Optionally populate txHash (expensive: 1 RPC call per feedback)
    if (options?.includeTxHash) {
      const photon = this._sati.getLightClient().getRpc();
      await Promise.all(
        feedbacks.map(async (fb) => {
          const addr = fb.context?.satiCompressedAddress as string | undefined;
          if (!addr) return;
          try {
            const sigs = await photon.getCompressionSignaturesForAddress(solAddress(addr), { limit: 1 });
            fb.txHash = sigs.items[0]?.signature;
          } catch {
            /* skip on error */
          }
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

  /**
   * Get a single feedback entry.
   *
   * Fetches feedbacks for the given agent + reviewer, then returns the one at feedbackIndex.
   */
  async getFeedback(agentId: AgentId, clientAddress: Address, feedbackIndex: number): Promise<Feedback> {
    const feedbacks = await this.searchFeedback({ agentId, reviewers: [clientAddress] });
    const fb = feedbacks[feedbackIndex];
    if (!fb) {
      throw new Error(`Feedback not found at index ${feedbackIndex} for agent ${agentId} reviewer ${clientAddress}`);
    }
    return fb;
  }

  /**
   * Look up the creation transaction signature for a compressed attestation.
   *
   * Use `feedback.context.satiCompressedAddress` from `searchFeedback()` results
   * as the `compressedAddress` parameter.
   *
   * @param compressedAddress - Base58 address of the compressed account
   * @returns Transaction signature or null if not found
   */
  async getCreationSignature(compressedAddress: string): Promise<string | null> {
    try {
      const photon = this._sati.getLightClient().getRpc();
      const result = await photon.getCompressionSignaturesForAddress(solAddress(compressedAddress), { limit: 1 });
      return result.items[0]?.signature ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Revoke (close) a previously submitted feedback.
   *
   * Closes the compressed attestation on-chain. The signer must be the
   * counterparty who originally submitted the feedback.
   *
   * Note: On SATI, revoked feedbacks are permanently deleted (Light Protocol
   * compressed accounts are closed). They cannot be recovered.
   */
  async revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<{ signature: string }> {
    const sasConfig = this._requireSASConfig();
    const signer = this._requireSigner();
    const identity = await this._resolveIdentity(agentId);

    const schema = sasConfig.schemas.feedbackPublic ?? sasConfig.schemas.feedback;
    const result = await this._sati.listFeedbacks({
      sasSchema: schema,
      agentMint: identity.mint,
      counterparty: signer.address,
    });

    const item = result.items[feedbackIndex];
    if (!item) {
      throw new Error(`Feedback not found at index ${feedbackIndex}`);
    }

    // Decode compressed account address bytes to base58 Address
    const [attestationAddress] = getAddressDecoder().read(item.address, 0);

    return this._sati.closeCompressedAttestation({
      payer: signer,
      counterparty: signer,
      sasSchema: item.attestation.sasSchema,
      attestationAddress,
      lookupTableAddress: sasConfig.lookupTable,
    });
  }

  // =========================================================================
  // Validations
  // =========================================================================

  /**
   * Search validation attestations for an agent.
   *
   * Validations are on-chain attestations from validators (TEE, zkML, re-execution, etc.)
   * that verify an agent's behavior. Unlike feedback, validations are typically automated.
   */
  async searchValidations(agentId: AgentId): Promise<ValidationResult[]> {
    const sasConfig = this._requireSASConfig();
    const validationSchema = sasConfig.schemas.validation;
    if (!validationSchema) {
      throw new Error("Validation schema not deployed on this network");
    }

    const identity = await this._resolveIdentity(agentId);

    const result = await this._sati.listValidations({
      sasSchema: validationSchema,
      agentMint: identity.mint,
    });

    // Fetch current slot for timestamp conversion
    const currentSlot = await this._sati.getRpc().getSlot({ commitment: "confirmed" }).send();
    const nowSec = Math.floor(Date.now() / 1000);

    return result.items.map((item) => {
      const slotDiff = Number(BigInt(currentSlot) - item.raw.slotCreated);
      const createdAt = nowSec - Math.floor(slotDiff * 0.4);
      const [compressedAddress] = getAddressDecoder().read(item.address, 0);

      return {
        outcome: item.data.outcome,
        agentMint: item.data.agentMint,
        counterparty: item.data.counterparty,
        createdAt,
        compressedAddress,
      };
    });
  }

  // =========================================================================
  // Config accessors
  // =========================================================================

  /** Get the feedback schema address for the current network. */
  get feedbackSchema(): string | undefined {
    return this._sasConfig?.schemas.feedback;
  }

  /** Get the feedbackPublic schema address for the current network. */
  get feedbackPublicSchema(): string | undefined {
    return this._sasConfig?.schemas.feedbackPublic;
  }

  /** Get the validation schema address for the current network. */
  get validationSchema(): string | undefined {
    return this._sasConfig?.schemas.validation;
  }

  /** Get the lookup table address for the current network. */
  get lookupTable(): string | undefined {
    return this._sasConfig?.lookupTable;
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

  private _requireSigner(): KeyPairSigner {
    if (!this._config.signer) {
      throw new Error(
        "This operation requires a KeyPairSigner. Initialize SatiSDK with a signer for server-side write operations.",
      );
    }
    return this._config.signer;
  }

  /** Returns either a KeyPairSigner or a TransactionSender, or throws if read-only. */
  private _requireWriteAccess(): WriteAccess {
    if (this._config.signer) return { type: "keypair", signer: this._config.signer };
    if (this._config.transactionSender) return { type: "sender", sender: this._config.transactionSender };
    throw new Error(
      "This operation requires a signer or transactionSender. Initialize SatiSDK with one for write operations.",
    );
  }

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
