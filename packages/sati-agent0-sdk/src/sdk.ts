/**
 * Main SDK class for the SATI Agent0 adapter.
 *
 * Provides agent0-sdk compatible method signatures backed by SATI's
 * Solana infrastructure for agent identity, reputation, and attestation.
 */

import {
  Sati,
  fetchRegistrationFile as fetchSatiRegistrationFile,
  buildRegistrationFile as buildSatiRegistrationFile,
  Outcome,
  ContentType,
  FeedbackCache,
  findAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ADDRESS,
  type AgentIdentity,
  type FeedbackData,
  type RegistrationFile as SatiRegistrationFile,
  type SATISASConfig,
} from "@cascade-fyi/sati-sdk";
import { address as solAddress, getAddressDecoder } from "@solana/kit";
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
  SatiAgent0Config,
  SatiSearchOptions,
  SatiFeedbackSearchOptions,
  WriteAccess,
  PreparedFeedback,
  ValidationResult,
  SatiWarning,
} from "./types.js";
import type { KeyPairSigner, TransactionSigner } from "@solana/kit";
import { SatiAgent } from "./agent.js";
import { SOLANA_CAIP2_CHAINS, parseSatiAgentId, toAgentSummary, toFeedback } from "./adapters.js";
import { SolanaTransactionHandle } from "./transaction-handle.js";
import {
  SatiError,
  AgentNotFoundError,
  InvalidAgentIdError,
  ReadOnlyError,
  SignerRequiredError,
  SchemaNotDeployedError,
  UnsupportedOperationError,
} from "./errors.js";

/**
 * SATI Agent0 SDK - agent0-sdk compatible interface backed by Solana.
 *
 * Method signatures follow agent0-sdk's `SDK` class pattern. Write operations
 * return `SolanaTransactionHandle<T>` (compatible with agent0-sdk's
 * `TransactionHandle<T>` via `.hash`, `.waitMined()`, `.waitConfirmed()`).
 *
 * @example
 * ```typescript
 * import { SatiAgent0 } from "@cascade-fyi/sati-agent0-sdk";
 * import { generateKeyPairSigner } from "@solana/kit";
 *
 * const signer = await generateKeyPairSigner();
 * const sdk = new SatiAgent0({
 *   network: "devnet",
 *   signer,
 * });
 *
 * const agent = sdk.createAgent("MyAgent", "An AI assistant");
 * ```
 */
export class SatiAgent0 {
  private readonly _config: SatiAgent0Config;
  private readonly _sati: Sati;
  private readonly _chain: string;
  private readonly _feedbackCache = new FeedbackCache();

  constructor(config: SatiAgent0Config) {
    this._config = config;
    this._sati = new Sati({
      network: config.network,
      rpcUrl: config.rpcUrl,
      photonRpcUrl: config.photonRpcUrl,
      // Agent0 SatiWarning.code is a narrower union than sati-sdk's string
      onWarning: config.onWarning as
        | ((w: { code: string; message: string; context?: string; cause?: unknown }) => void)
        | undefined,
    });
    this._chain = SOLANA_CAIP2_CHAINS[config.network] ?? `solana:${config.network}`;
  }

  /** Get the SATI network. */
  get network(): SatiAgent0Config["network"] {
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
    return this._sati.deployedConfig;
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
    return SatiAgent.fromIdentity(this, identity, fallback);
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
   *
   * Use `options.limit` and `options.offset` for pagination.
   */
  async searchAgents(filters?: SearchFilters, options?: SatiSearchOptions): Promise<AgentSummary[]> {
    const limit = options?.limit ?? 100;
    const offset = options?.offset;

    // Step 1: Fetch agents - use listAgentsByOwner when filtering by owners
    let agents: AgentIdentity[];
    if (filters?.owners?.length) {
      const ownerResults = await Promise.all(filters.owners.map((o) => this._sati.listAgentsByOwner(solAddress(o))));
      agents = ownerResults.flat();
    } else {
      const result = await this._sati.listAllAgents({ limit, offset });
      agents = result.agents;
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

    // Step 4: Apply cheap filters FIRST (before feedback stats)
    const cheapFiltered: { identity: AgentIdentity; regFile: SatiRegistrationFile | null }[] = [];
    for (let i = 0; i < agents.length; i++) {
      const identity = agents[i];
      const regFile = regFiles[i];
      const services = regFile?.services ?? [];

      if (filters?.hasRegistrationFile === true && !regFile) continue;
      if (filters?.hasRegistrationFile === false && regFile) continue;
      if (filters?.description) {
        if (!regFile?.description?.toLowerCase().includes(filters.description.toLowerCase())) continue;
      }
      if (filters?.active !== undefined && (regFile?.active ?? true) !== filters.active) continue;
      if (filters?.x402support !== undefined && (regFile?.x402Support ?? false) !== filters.x402support) continue;
      if (filters?.hasMCP && !services.some((e) => e.name.toUpperCase() === "MCP")) continue;
      if (filters?.hasA2A && !services.some((e) => e.name.toUpperCase() === "A2A")) continue;
      if (filters?.hasOASF && !services.some((e) => e.name.toUpperCase() === "OASF")) continue;
      if (filters?.hasWeb && !services.some((e) => e.name.toUpperCase() === "WEB")) continue;
      if (filters?.hasEndpoints === true && services.length === 0) continue;
      if (filters?.mcpContains) {
        const ep = services.find((e) => e.name.toUpperCase() === "MCP");
        if (!ep?.endpoint.includes(filters.mcpContains)) continue;
      }
      if (filters?.a2aContains) {
        const ep = services.find((e) => e.name.toUpperCase() === "A2A");
        if (!ep?.endpoint.includes(filters.a2aContains)) continue;
      }
      if (filters?.ensContains) {
        const ep = services.find((e) => e.name.toUpperCase() === "ENS");
        if (!ep?.endpoint.includes(filters.ensContains)) continue;
      }
      if (filters?.didContains) {
        const ep = services.find((e) => e.name.toUpperCase() === "DID");
        if (!ep?.endpoint.includes(filters.didContains)) continue;
      }
      if (filters?.webContains) {
        const ep = services.find((e) => e.name.toUpperCase() === "WEB");
        if (!ep?.endpoint.includes(filters.webContains)) continue;
      }
      if (filters?.walletAddress) {
        const walletEp = services.find(
          (e) => e.name.toUpperCase() === "AGENTWALLET" || e.name.toUpperCase() === "WALLET",
        );
        if (!walletEp?.endpoint.includes(filters.walletAddress)) continue;
      }
      if (filters?.supportedTrust?.length) {
        const trusts = regFile?.supportedTrust ?? [];
        if (
          !filters.supportedTrust.every((t) =>
            trusts.includes(t as "reputation" | "crypto-economic" | "tee-attestation"),
          )
        )
          continue;
      }
      if (filters?.mcpTools?.length) {
        const tools = services.find((e) => e.name.toUpperCase() === "MCP")?.mcpTools ?? [];
        if (!filters.mcpTools.some((t) => tools.includes(t))) continue;
      }
      if (filters?.mcpPrompts?.length) {
        const prompts = services.find((e) => e.name.toUpperCase() === "MCP")?.mcpPrompts ?? [];
        if (!filters.mcpPrompts.some((t) => prompts.includes(t))) continue;
      }
      if (filters?.mcpResources?.length) {
        const resources = services.find((e) => e.name.toUpperCase() === "MCP")?.mcpResources ?? [];
        if (!filters.mcpResources.some((t) => resources.includes(t))) continue;
      }
      if (filters?.a2aSkills?.length) {
        const skills = services.find((e) => e.name.toUpperCase() === "A2A")?.a2aSkills ?? [];
        if (!filters.a2aSkills.some((t) => skills.includes(t))) continue;
      }
      if (filters?.oasfSkills?.length) {
        const skills = services.find((e) => e.name.toUpperCase() === "OASF")?.skills ?? [];
        if (!filters.oasfSkills.some((t) => skills.includes(t))) continue;
      }
      if (filters?.oasfDomains?.length) {
        const domains = services.find((e) => e.name.toUpperCase() === "OASF")?.domains ?? [];
        if (!filters.oasfDomains.some((t) => domains.includes(t))) continue;
      }

      cheapFiltered.push({ identity, regFile });
    }

    // Step 5: Fetch feedback stats ONLY for agents that passed cheap filters (lazy)
    const wantFeedbackStats = !!(options?.includeFeedbackStats || filters?.feedback);
    let feedbackStatsMap: Map<string, { count: number; averageValue: number }> | null = null;

    if (wantFeedbackStats && this._sati.deployedConfig && cheapFiltered.length > 0) {
      feedbackStatsMap = new Map();
      await Promise.all(
        cheapFiltered.map(async ({ identity }) => {
          try {
            const summary = await this._sati.getReputationSummary(identity.mint);
            feedbackStatsMap?.set(identity.mint, { count: summary.count, averageValue: summary.averageValue });
          } catch (error) {
            this._warn({
              code: "RPC_ERROR",
              message: "Failed to fetch feedback stats",
              context: identity.mint,
              cause: error,
            });
          }
        }),
      );
    }

    // Step 6: Apply feedback filters and build results
    const results: AgentSummary[] = [];
    for (const { identity, regFile } of cheapFiltered) {
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

    // Step 7: Sort
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
  async transferAgent(
    agentId: AgentId,
    newOwner: Address,
  ): Promise<SolanaTransactionHandle<{ txHash: string; from: string; to: string; agentId: AgentId }>> {
    const identity = await this._resolveIdentity(agentId);
    const access = this._requireWriteAccess("transferAgent");

    if (access.type === "keypair") {
      const result = await this._sati.transferAgent({
        payer: access.signer,
        owner: access.signer,
        mint: identity.mint,
        newOwner: solAddress(newOwner),
      });
      return new SolanaTransactionHandle(result.signature, {
        txHash: result.signature,
        from: access.signer.address,
        to: newOwner,
        agentId,
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
      agentId,
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
   * Value/tags stored in content JSON.
   *
   * SATI-specific fields (`outcome`, `taskRef`) can be passed via `feedbackFile`:
   * - `feedbackFile.outcome` - Attestation outcome (default: Neutral)
   * - `feedbackFile.taskRef` - Deterministic 32-byte task reference (default: random)
   */
  async giveFeedback(
    agentId: AgentId,
    value: number | string,
    tag1?: string,
    tag2?: string,
    endpoint?: string,
    feedbackFile?: FeedbackFileInput,
  ): Promise<SolanaTransactionHandle<Feedback>> {
    const identity = await this._resolveIdentity(agentId);
    const access = this._requireWriteAccess("giveFeedback");

    // Validate and parse value
    const numericValue = typeof value === "string" ? Number.parseFloat(value) : value;
    if (!Number.isFinite(numericValue)) {
      throw new SatiError("INVALID_VALUE", `Feedback value must be a finite number, got: ${value}`);
    }

    if (access.type === "keypair") {
      const signer = access.signer;

      // Delegate content building, SIWS signing, and on-chain creation to Sati
      const outcome = (feedbackFile?.outcome as Outcome | undefined) ?? Outcome.Neutral;

      const result = await this._sati.giveFeedback({
        payer: signer,
        agentMint: identity.mint,
        value: numericValue,
        valueDecimals: 0,
        tag1,
        tag2,
        endpoint,
        message: feedbackFile?.text,
        outcome,
        taskRef: feedbackFile?.taskRef as Uint8Array | undefined,
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

      this._feedbackCache.invalidate();
      return new SolanaTransactionHandle(result.signature, feedback);
    }

    // Sender path: Feedback requires Light Protocol compressed accounts,
    // which can't be expressed as simple instructions for signAndSend().
    // Use prepareFeedback() + submitPreparedFeedback() instead.
    throw new UnsupportedOperationError(
      "giveFeedback via transactionSender (browser wallet). " +
        "Use prepareFeedback() + submitPreparedFeedback() instead",
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
   * @param opts - Optional: endpoint, text, counterparty address, outcome, taskRef
   */
  async prepareFeedback(
    agentId: AgentId,
    value: number,
    tag1?: string,
    tag2?: string,
    opts?: {
      endpoint?: string;
      text?: string;
      counterparty?: string;
      outcome?: Outcome;
      taskRef?: Uint8Array;
    },
  ): Promise<PreparedFeedback> {
    const identity = await this._resolveIdentity(agentId);

    // Determine counterparty address
    const counterpartyAddr = opts?.counterparty ?? this._config.transactionSender?.address;
    if (!counterpartyAddr) {
      throw new ReadOnlyError(
        "prepareFeedback (counterparty address required - provide via opts.counterparty or configure transactionSender)",
      );
    }

    if (!Number.isFinite(value)) {
      throw new SatiError("INVALID_VALUE", `Feedback value must be a finite number, got: ${value}`);
    }

    // Delegate content building and SIWS message construction to Sati
    const prepared = await this._sati.prepareFeedback({
      agentMint: identity.mint,
      counterparty: solAddress(counterpartyAddr),
      value,
      valueDecimals: 0,
      tag1,
      tag2,
      endpoint: opts?.endpoint,
      message: opts?.text,
      outcome: opts?.outcome,
      taskRef: opts?.taskRef,
    });

    return {
      messageBytes: prepared.messageBytes,
      agentMint: prepared.agentMint,
      counterparty: prepared.counterparty,
      taskRef: prepared.taskRef,
      dataHash: prepared.dataHash,
      outcome: prepared.outcome,
      contentType: prepared.contentType,
      content: prepared.content,
      sasSchema: prepared.sasSchema,
      lookupTable: prepared.lookupTable,
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
  ): Promise<SolanaTransactionHandle<Feedback>> {
    const signer = this._requireSigner("submitPreparedFeedback");

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

    this._feedbackCache.invalidate();
    return new SolanaTransactionHandle(result.signature, feedback);
  }

  /**
   * Search feedback with filters.
   *
   * Supports most agent0-sdk FeedbackSearchFilters. The `includeRevoked`
   * filter is a no-op on SATI (closed attestations are permanently deleted).
   *
   * Note: `createdAt` timestamps are approximate - derived from Solana slot
   * numbers using ~400ms/slot estimate. May drift by minutes for recent or
   * hours for older attestations. For exact timestamps, use
   * `getCreationSignature()` + Solana's `getBlockTime()`.
   */
  async searchFeedback(filters: FeedbackSearchFilters, options?: SatiFeedbackSearchOptions): Promise<Feedback[]> {
    const deployedConfig = this._requireDeployedConfig();

    // Build SATI attestation filter
    const satiFilter: Record<string, unknown> = {
      sasSchema: deployedConfig.schemas.feedbackPublic ?? deployedConfig.schemas.feedback,
    };

    // Resolve agentId to agentMint (use agentId or first of agents[])
    let knownIdentity: AgentIdentity | null = null;
    const targetAgentId = filters.agentId ?? filters.agents?.[0];
    if (targetAgentId) {
      knownIdentity = await this._resolveIdentity(targetAgentId);
      satiFilter.agentMint = knownIdentity.mint;
    }

    // Pass first reviewer to RPC filter (even though underlying queryAttestations
    // doesn't apply it, future versions may). We apply client-side filtering below.
    if (filters.reviewers?.length) {
      satiFilter.counterparty = solAddress(filters.reviewers[0]);
    }

    // Build sets for client-side filtering (underlying RPC only filters by sasSchema + agentMint)
    const reviewerSet = filters.reviewers?.length ? new Set(filters.reviewers) : null;
    const agentMintSet =
      filters.agents?.length && filters.agents.length > 1
        ? new Set(
            await Promise.all(
              filters.agents.map(async (id) => {
                const identity = await this._resolveIdentity(id);
                return identity.mint as string;
              }),
            ),
          )
        : null;

    // Check cache
    const schema = satiFilter.sasSchema as string;
    const agentMint = satiFilter.agentMint as string | undefined;
    const cacheKey = FeedbackCache.cacheKey(schema, agentMint);
    const cached = this._feedbackCache.get<{
      items: {
        data: FeedbackData;
        attestation: { sasSchema: string };
        raw: { slotCreated: bigint };
        address: Uint8Array;
      }[];
    }>(cacheKey);
    const result = cached ?? (await this._sati.listFeedbacks(satiFilter));
    if (!cached) this._feedbackCache.set(cacheKey, result);

    // Fetch current slot for timestamp conversion (slotCreated -> Unix seconds)
    const currentSlot = await this._sati.getRpc().getSlot({ commitment: "confirmed" }).send();
    const nowSec = Math.floor(Date.now() / 1000);

    const feedbacks: Feedback[] = [];
    for (let i = 0; i < result.items.length; i++) {
      const item = result.items[i];

      // Client-side counterparty/agent filtering
      if (reviewerSet && !reviewerSet.has(item.data.counterparty)) continue;
      if (agentMintSet && !agentMintSet.has(item.data.agentMint)) continue;

      // Parse content JSON (safe - malformed content returns null)
      const rawContent = this._parseContentJson(item.data.content, item.data.contentType);

      const value = rawContent?.value as number | undefined;
      const tag1 = rawContent?.tag1 as string | undefined;
      const tag2 = rawContent?.tag2 as string | undefined;
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
        const tags = [tag1, tag2].filter(Boolean);
        const hasAll = filters.tags.every((t) => tags.includes(t));
        if (!hasAll) continue;
      }

      // Client-side value filtering
      if (options?.minValue !== undefined && (value === undefined || value < options.minValue)) continue;
      if (options?.maxValue !== undefined && (value === undefined || value > options.maxValue)) continue;

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
          value,
          tag1,
          tag2,
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
          } catch (error) {
            this._warn({
              code: "SIGNATURE_LOOKUP_FAILED",
              message: "Failed to fetch tx signature",
              context: addr,
              cause: error,
            });
          }
        }),
      );
    }

    return feedbacks;
  }

  /**
   * Append response to feedback.
   *
   * @throws UnsupportedOperationError - Not supported on SATI.
   */
  async appendResponse(
    _agentId: AgentId,
    _clientAddress: Address,
    _feedbackIndex: number,
    _response: { uri: URI; hash: string },
  ): Promise<never> {
    throw new UnsupportedOperationError("appendResponse");
  }

  /**
   * Get reputation summary for an agent.
   *
   * Computes average value from all FeedbackPublic attestations,
   * optionally filtered by tag1.
   */
  async getReputationSummary(
    agentId: AgentId,
    tag1?: string,
    tag2?: string,
  ): Promise<{ count: number; averageValue: number }> {
    const identity = await this._resolveIdentity(agentId);
    const summary = await this._sati.getReputationSummary(identity.mint, tag1, tag2);
    return { count: summary.count, averageValue: summary.averageValue };
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
      throw new AgentNotFoundError(`Feedback at index ${feedbackIndex} for agent ${agentId} reviewer ${clientAddress}`);
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
    } catch (error) {
      this._warn({
        code: "RPC_ERROR",
        message: "Failed to fetch creation signature",
        context: compressedAddress,
        cause: error,
      });
      return null;
    }
  }

  /** Revoke feedback by passing the Feedback object from searchFeedback. */
  revokeFeedback(feedback: Feedback): Promise<SolanaTransactionHandle<Feedback>>;
  /** @deprecated Use the Feedback object overload for stable addressing. */
  revokeFeedback(agentId: AgentId, feedbackIndex: number): Promise<SolanaTransactionHandle<Feedback>>;
  /**
   * Revoke (close) a previously submitted feedback.
   *
   * Closes the compressed attestation on-chain. The signer must be the
   * counterparty who originally submitted the feedback.
   *
   * Note: On SATI, revoked feedbacks are permanently deleted (Light Protocol
   * compressed accounts are closed). They cannot be recovered.
   *
   * Preferred: pass the Feedback object from `searchFeedback()` directly.
   * The object carries `context.satiCompressedAddress` for stable addressing.
   */
  async revokeFeedback(
    feedbackOrAgentId: Feedback | AgentId,
    feedbackIndex?: number,
  ): Promise<SolanaTransactionHandle<Feedback>> {
    const deployedConfig = this._requireDeployedConfig();
    const signer = this._requireSigner("revokeFeedback");

    // Feedback object path - delegate to Sati.revokeFeedback()
    if (typeof feedbackOrAgentId === "object" && "id" in feedbackOrAgentId) {
      const fb = feedbackOrAgentId as Feedback;
      const addr = fb.context?.satiCompressedAddress as string | undefined;
      if (!addr) {
        throw new InvalidAgentIdError(
          "Feedback missing context.satiCompressedAddress - use searchFeedback() to get addressable Feedback objects",
        );
      }

      const result = await this._sati.revokeFeedback({
        payer: signer,
        attestationAddress: solAddress(addr),
      });

      this._feedbackCache.invalidate();
      const revokedFb = { ...fb, isRevoked: true };
      return new SolanaTransactionHandle(result.signature, revokedFb);
    }

    // Legacy index path
    const agentId = feedbackOrAgentId as AgentId;
    const idx = feedbackIndex as number;
    const identity = await this._resolveIdentity(agentId);
    const schema = deployedConfig.schemas.feedbackPublic ?? deployedConfig.schemas.feedback;
    const queryResult = await this._sati.listFeedbacks({
      sasSchema: schema,
      agentMint: identity.mint,
      counterparty: signer.address,
    });

    const item = queryResult.items[idx];
    if (!item) {
      throw new AgentNotFoundError(`Feedback not found at index ${idx}`);
    }

    const [attestationAddress] = getAddressDecoder().read(item.address, 0);

    const closeResult = await this._sati.closeCompressedAttestation({
      payer: signer,
      counterparty: signer,
      sasSchema: item.attestation.sasSchema,
      attestationAddress,
      lookupTableAddress: deployedConfig.lookupTable,
    });

    const rawContent = this._parseContentJson(item.data.content, item.data.contentType);
    const feedback = toFeedback({
      agentMint: item.data.agentMint,
      chain: this._chain,
      reviewer: item.data.counterparty,
      feedbackIndex: idx,
      content: {
        value: rawContent?.value as number | undefined,
        tag1: rawContent?.tag1 as string | undefined,
        tag2: rawContent?.tag2 as string | undefined,
      },
      txSignature: closeResult.signature,
      outcome: item.data.outcome,
    });
    feedback.isRevoked = true;

    this._feedbackCache.invalidate();
    return new SolanaTransactionHandle(closeResult.signature, feedback);
  }

  /**
   * Revoke (close) a feedback by its compressed account address.
   *
   * Lower-level alternative to `revokeFeedback(feedback)`.
   * Get the address from `feedback.context.satiCompressedAddress`.
   *
   * @param compressedAddress - Base58 compressed account address
   */
  async revokeFeedbackByAddress(compressedAddress: string): Promise<SolanaTransactionHandle<{ signature: string }>> {
    const signer = this._requireSigner("revokeFeedbackByAddress");
    const result = await this._sati.revokeFeedback({
      payer: signer,
      attestationAddress: solAddress(compressedAddress),
    });

    this._feedbackCache.invalidate();
    return new SolanaTransactionHandle(result.signature, { signature: result.signature });
  }

  // =========================================================================
  // Validations
  // =========================================================================

  /**
   * Search validation attestations for an agent.
   *
   * Validations are on-chain attestations from validators (TEE, zkML, re-execution, etc.)
   * that verify an agent's behavior. Unlike feedback, validations are typically automated.
   *
   * Note: `createdAt` timestamps are approximate - derived from Solana slot
   * numbers using ~400ms/slot estimate. May drift by minutes for recent or
   * hours for older attestations. For exact timestamps, use
   * `getCreationSignature()` + Solana's `getBlockTime()`.
   */
  async searchValidations(agentId: AgentId): Promise<ValidationResult[]> {
    const identity = await this._resolveIdentity(agentId);
    const results = await this._sati.searchValidations(identity.mint);
    return results.map((v) => ({
      outcome: v.outcome,
      agentMint: v.agentMint as string,
      counterparty: v.counterparty as string,
      createdAt: v.createdAt,
      compressedAddress: v.compressedAddress as string,
    }));
  }

  // =========================================================================
  // Config accessors
  // =========================================================================

  /** Get the feedback schema address for the current network. */
  get feedbackSchema(): string | undefined {
    return this._sati.feedbackSchema;
  }

  /** Get the feedbackPublic schema address for the current network. */
  get feedbackPublicSchema(): string | undefined {
    return this._sati.feedbackPublicSchema;
  }

  /** Get the validation schema address for the current network. */
  get validationSchema(): string | undefined {
    return this._sati.validationSchema;
  }

  /** Get the lookup table address for the current network. */
  get lookupTable(): string | undefined {
    return this._sati.lookupTable;
  }

  // =========================================================================
  // Internal accessors (used by SatiAgent)
  // =========================================================================

  /** @internal */
  get config(): SatiAgent0Config {
    return this._config;
  }

  // =========================================================================
  // Private helpers
  // =========================================================================

  /** Safely parse JSON content from an attestation. Returns null on invalid JSON. */
  private _parseContentJson(content: Uint8Array, contentType: number): Record<string, unknown> | null {
    if (contentType !== ContentType.JSON || content.length === 0) return null;
    try {
      return JSON.parse(new TextDecoder().decode(content)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  /** Fire a non-fatal warning via the optional onWarning callback. */
  private _warn(warning: SatiWarning): void {
    this._config.onWarning?.(warning);
  }

  private _requireSigner(operation?: string): KeyPairSigner {
    if (!this._config.signer) {
      throw new SignerRequiredError(operation);
    }
    return this._config.signer;
  }

  /** Returns either a KeyPairSigner or a TransactionSender, or throws if read-only. */
  private _requireWriteAccess(operation?: string): WriteAccess {
    if (this._config.signer) return { type: "keypair", signer: this._config.signer };
    if (this._config.transactionSender) return { type: "sender", sender: this._config.transactionSender };
    throw new ReadOnlyError(operation);
  }

  private _requireDeployedConfig(): SATISASConfig {
    const config = this._sati.deployedConfig;
    if (!config) {
      throw new SchemaNotDeployedError("SAS", this._config.network);
    }
    return config;
  }

  private async _resolveIdentity(agentId: AgentId): Promise<AgentIdentity> {
    const mint = parseSatiAgentId(agentId);
    if (mint === null) {
      throw new InvalidAgentIdError(agentId);
    }

    const identity = await this._sati.loadAgent(solAddress(mint));
    if (!identity) {
      throw new AgentNotFoundError(agentId);
    }

    return identity;
  }
}
