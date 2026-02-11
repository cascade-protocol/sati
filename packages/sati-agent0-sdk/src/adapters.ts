/**
 * Data format converters between SATI SDK types and agent0-sdk types.
 *
 * These functions bridge the gap between SATI's Solana-native data model
 * and agent0-sdk's EVM-centric interfaces.
 */

import type {
  AgentSummary,
  Feedback,
  FeedbackIdTuple,
  RegistrationFile as Agent0RegistrationFile,
  Endpoint as Agent0Endpoint,
} from "agent0-sdk";
import { EndpointType, TrustModel } from "agent0-sdk";
import type { AgentIdentity } from "@cascade-fyi/sati-sdk";
import type { RegistrationFile as SatiRegistrationFile, Endpoint as SatiEndpoint } from "@cascade-fyi/sati-sdk";

/** CAIP-2 chain references for Solana networks */
export const SOLANA_CAIP2_CHAINS: Record<string, string> = {
  mainnet: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  localnet: "solana:localnet",
};

/**
 * Format a SATI agent as a CAIP-2 compatible AgentId string.
 *
 * Format: `solana:<chainRef>:<mintAddress>`
 */
export function formatSatiAgentId(mint: string, chain: string): string {
  return `${chain}:${mint}`;
}

/**
 * Parse a SATI CAIP-2 AgentId back to a mint address.
 * Returns null if the agentId is not a Solana agent.
 *
 * Expected format: `solana:<chainRef>:<mintAddress>`
 */
export function parseSatiAgentId(agentId: string): string | null {
  if (!agentId.startsWith("solana:")) return null;
  const parts = agentId.split(":");
  if (parts.length !== 3) return null;
  return parts[2];
}

// ============================================================================
// Endpoint converters
// ============================================================================

const SATI_TO_AGENT0_TYPE: Record<string, EndpointType> = {
  MCP: EndpointType.MCP,
  A2A: EndpointType.A2A,
  ENS: EndpointType.ENS,
  DID: EndpointType.DID,
  AGENTWALLET: EndpointType.WALLET,
  WALLET: EndpointType.WALLET,
  OASF: EndpointType.OASF,
};

const AGENT0_TO_SATI_NAME: Record<string, string> = {
  [EndpointType.MCP]: "MCP",
  [EndpointType.A2A]: "A2A",
  [EndpointType.ENS]: "ENS",
  [EndpointType.DID]: "DID",
  [EndpointType.WALLET]: "agentWallet",
  [EndpointType.OASF]: "OASF",
};

/**
 * Convert SATI endpoints (ERC-8004 format) to agent0 endpoint format.
 */
export function toAgent0Endpoints(satiEndpoints: SatiEndpoint[]): Agent0Endpoint[] {
  return satiEndpoints.map((ep) => {
    const meta: Record<string, unknown> = {};
    if (ep.version) meta.version = ep.version;
    if (ep.mcpTools?.length) meta.mcpTools = ep.mcpTools;
    if (ep.mcpPrompts?.length) meta.mcpPrompts = ep.mcpPrompts;
    if (ep.mcpResources?.length) meta.mcpResources = ep.mcpResources;
    if (ep.a2aSkills?.length) meta.a2aSkills = ep.a2aSkills;
    if (ep.skills?.length) meta.skills = ep.skills;
    if (ep.domains?.length) meta.domains = ep.domains;
    return {
      type: SATI_TO_AGENT0_TYPE[ep.name.toUpperCase()] ?? (ep.name as EndpointType),
      value: ep.endpoint,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    };
  });
}

/**
 * Convert agent0 endpoints to SATI registration file endpoint format.
 */
export function fromAgent0Endpoints(agent0Endpoints: Agent0Endpoint[]): SatiEndpoint[] {
  return agent0Endpoints.map((ep) => {
    const result: SatiEndpoint = {
      name: AGENT0_TO_SATI_NAME[ep.type] ?? ep.type,
      endpoint: ep.value,
      version: ep.meta?.version as string | undefined,
    };
    if (ep.meta?.mcpTools) result.mcpTools = ep.meta.mcpTools as string[];
    if (ep.meta?.mcpPrompts) result.mcpPrompts = ep.meta.mcpPrompts as string[];
    if (ep.meta?.mcpResources) result.mcpResources = ep.meta.mcpResources as string[];
    if (ep.meta?.a2aSkills) result.a2aSkills = ep.meta.a2aSkills as string[];
    if (ep.meta?.skills) result.skills = ep.meta.skills as string[];
    if (ep.meta?.domains) result.domains = ep.meta.domains as string[];
    return result;
  });
}

// ============================================================================
// AgentSummary converter
// ============================================================================

/**
 * Convert a SATI AgentIdentity + optional registration file to agent0 AgentSummary.
 *
 * @param identity - On-chain agent identity
 * @param chain - CAIP-2 chain reference (e.g. "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp")
 * @param regFile - Off-chain registration file (optional)
 * @param feedbackStats - Pre-computed feedback stats (optional, from includeFeedbackStats)
 */
export function toAgentSummary(
  identity: AgentIdentity,
  chain: string,
  regFile?: SatiRegistrationFile | null,
  feedbackStats?: { count: number; averageValue: number } | null,
): AgentSummary {
  const endpoints = regFile?.endpoints ?? [];

  const mcpEp = endpoints.find((e) => e.name.toUpperCase() === "MCP");
  const a2aEp = endpoints.find((e) => e.name.toUpperCase() === "A2A");
  const oasfEp = endpoints.find((e) => e.name.toUpperCase() === "OASF");
  const ensEp = endpoints.find((e) => e.name.toUpperCase() === "ENS");
  const didEp = endpoints.find((e) => e.name.toUpperCase() === "DID");
  const walletEp = endpoints.find((e) => e.name.toUpperCase() === "AGENTWALLET" || e.name.toUpperCase() === "WALLET");
  const webEp = endpoints.find((e) => e.name.toUpperCase() === "WEB");

  return {
    chainId: 0,
    agentId: formatSatiAgentId(identity.mint, chain),
    name: identity.name,
    image: regFile?.image,
    description: regFile?.description ?? "",
    owners: [identity.owner],
    operators: [],
    mcp: mcpEp?.endpoint,
    a2a: a2aEp?.endpoint,
    web: webEp?.endpoint,
    ens: ensEp?.endpoint,
    did: didEp?.endpoint,
    walletAddress: walletEp?.endpoint,
    supportedTrusts: regFile?.supportedTrust ?? [],
    mcpTools: mcpEp?.mcpTools ?? [],
    mcpPrompts: mcpEp?.mcpPrompts ?? [],
    mcpResources: mcpEp?.mcpResources ?? [],
    a2aSkills: a2aEp?.a2aSkills ?? [],
    oasfSkills: oasfEp?.skills ?? [],
    oasfDomains: oasfEp?.domains ?? [],
    active: regFile?.active ?? true,
    x402support: regFile?.x402support ?? false,
    agentURI: identity.uri,
    agentURIType: identity.uri ? detectURIType(identity.uri) : undefined,
    feedbackCount: feedbackStats?.count,
    averageValue: feedbackStats?.averageValue,
    extras: {},
  };
}

/** Detect URI type from prefix. */
function detectURIType(uri: string): string {
  if (uri.startsWith("ipfs://") || uri.includes("/ipfs/")) return "ipfs";
  if (uri.startsWith("ar://") || uri.includes("arweave.net")) return "arweave";
  if (uri.startsWith("https://") || uri.startsWith("http://")) return "https";
  return "unknown";
}

// ============================================================================
// RegistrationFile converters
// ============================================================================

/**
 * Convert a SATI registration file to agent0 RegistrationFile format.
 *
 * @param satiFile - SATI registration file
 * @param identity - On-chain agent identity (optional)
 * @param chain - CAIP-2 chain reference (required when identity is provided)
 */
export function toAgent0RegistrationFile(
  satiFile: SatiRegistrationFile,
  identity?: AgentIdentity,
  chain?: string,
): Agent0RegistrationFile {
  const endpoints = toAgent0Endpoints(satiFile.endpoints ?? []);
  const trustModels: (TrustModel | string)[] = (satiFile.supportedTrust ?? []).map((t) => {
    if (t === "reputation") return TrustModel.REPUTATION;
    if (t === "crypto-economic") return TrustModel.CRYPTO_ECONOMIC;
    if (t === "tee-attestation") return TrustModel.TEE_ATTESTATION;
    return t;
  });

  return {
    agentId: identity && chain ? formatSatiAgentId(identity.mint, chain) : undefined,
    agentURI: identity?.uri,
    name: satiFile.name,
    description: satiFile.description,
    image: satiFile.image,
    endpoints,
    trustModels,
    owners: identity ? [identity.owner] : [],
    operators: [],
    active: satiFile.active ?? true,
    x402support: satiFile.x402support ?? false,
    metadata: {},
    updatedAt: Math.floor(Date.now() / 1000),
  };
}

/**
 * Convert agent0 RegistrationFile back to SATI registration file params.
 */
export function fromAgent0RegistrationFile(agent0File: Agent0RegistrationFile): Omit<
  SatiRegistrationFile,
  "type" | "properties"
> & {
  name: string;
  description: string;
  image: string;
} {
  const endpoints = fromAgent0Endpoints(agent0File.endpoints);
  const supportedTrust = agent0File.trustModels
    .map((t) => {
      if (t === TrustModel.REPUTATION) return "reputation" as const;
      if (t === TrustModel.CRYPTO_ECONOMIC) return "crypto-economic" as const;
      if (t === TrustModel.TEE_ATTESTATION) return "tee-attestation" as const;
      return null;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return {
    name: agent0File.name,
    description: agent0File.description,
    image: agent0File.image ?? "",
    endpoints,
    supportedTrust,
    active: agent0File.active,
    x402support: agent0File.x402support,
  };
}

// ============================================================================
// Feedback converter
// ============================================================================

/**
 * Convert SATI feedback attestation data to agent0 Feedback format.
 *
 * SATI stores feedback as compressed attestations with:
 * - outcome (always Neutral for FeedbackPublicV1)
 * - content JSON with value, tag1, tag2, endpoint
 *
 * agent0-sdk expects the Feedback interface with value, tags, endpoint, etc.
 */
export function toFeedback(opts: {
  agentMint: string;
  chain: string;
  reviewer: string;
  feedbackIndex: number;
  content: {
    value?: number;
    tag1?: string;
    tag2?: string;
    endpoint?: string;
    text?: string;
    context?: Record<string, unknown>;
  };
  txSignature?: string;
  createdAt?: number;
  /** SATI on-chain outcome (0=Negative, 1=Neutral, 2=Positive) */
  outcome?: number;
}): Feedback {
  const agentId = formatSatiAgentId(opts.agentMint, opts.chain);
  const tags: string[] = [];
  if (opts.content.tag1) tags.push(opts.content.tag1);
  if (opts.content.tag2) tags.push(opts.content.tag2);

  const id: FeedbackIdTuple = [agentId, opts.reviewer, opts.feedbackIndex];

  const context: Record<string, unknown> = { ...opts.content.context };
  if (opts.outcome !== undefined) {
    context.outcome = opts.outcome;
  }

  return {
    id,
    agentId,
    reviewer: opts.reviewer,
    txHash: opts.txSignature,
    value: opts.content.value,
    tags,
    endpoint: opts.content.endpoint,
    text: opts.content.text,
    context: Object.keys(context).length > 0 ? context : opts.content.context,
    createdAt: opts.createdAt ?? Math.floor(Date.now() / 1000),
    answers: [],
    isRevoked: false,
  };
}
