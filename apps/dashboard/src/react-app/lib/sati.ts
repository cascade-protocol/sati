/**
 * SATI Client and Helpers for Dashboard
 *
 * Provides singleton client and utility functions for agent management.
 * Supports both devnet and mainnet based on user selection.
 */

import {
  Sati,
  type AgentIdentity,
  type ParsedAttestation,
  type ParsedValidationAttestation,
  type ReputationScoreData,
  // Registration file helpers
  fetchRegistrationFile,
  getImageUrl,
  type RegistrationFile,
  // Content parsing
  parseFeedbackContent,
  parseReputationScoreContent,
  ContentType,
  type FeedbackContent,
} from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";
import bs58 from "bs58";
import { getNetwork, getRpcUrl } from "./network";

// Singleton Sati client instance with network tracking
let satiClient: Sati | null = null;
let clientNetwork: string | null = null;

/**
 * Get the current network (always fresh)
 */
function getCurrentNetwork() {
  return getNetwork();
}

/**
 * Get the current RPC URL (always fresh)
 */
function getCurrentRpcUrl() {
  return getRpcUrl(getCurrentNetwork());
}

/**
 * Get or create the Sati client singleton.
 * Automatically recreates if network has changed.
 */
export function getSatiClient(): Sati {
  const network = getCurrentNetwork();
  const rpcUrl = getCurrentRpcUrl();

  // Recreate client if network changed
  if (!satiClient || clientNetwork !== network) {
    satiClient = new Sati({
      network,
      rpcUrl,
      // Use same RPC for Photon queries (Helius RPC supports both)
      photonRpcUrl: rpcUrl,
    });
    clientNetwork = network;
  }
  return satiClient;
}

/**
 * Reset Sati client singleton (call when network changes)
 */
export function resetSatiClient(): void {
  satiClient = null;
  clientNetwork = null;
}

/**
 * Get the transaction signature that created a compressed account.
 * Uses Photon's getCompressionSignaturesForAddress API via the SDK's light client.
 *
 * @param accountAddress - The compressed account address (Uint8Array)
 * @returns The transaction signature or null if not found
 */
export async function getCreationSignature(accountAddress: Uint8Array): Promise<string | null> {
  try {
    const sati = getSatiClient();
    const photon = sati.getLightClient().getRpc();

    // Convert Uint8Array to base58 Address
    const addrStr = bs58.encode(accountAddress) as Address;

    const result = await photon.getCompressionSignaturesForAddress(addrStr, { limit: 1 });

    // First signature should be the creation tx
    return result.items[0]?.signature ?? null;
  } catch (e) {
    console.error("Failed to get creation signature:", e);
    return null;
  }
}

/**
 * Get deployed feedback schema addresses (always fresh for current network)
 */
export function getFeedbackSchemas(): { feedback?: Address; feedbackPublic?: Address } {
  const sati = getSatiClient();
  return {
    feedback: sati.feedbackSchema,
    feedbackPublic: sati.feedbackPublicSchema,
  };
}

/**
 * Get deployed validation schema address (always fresh for current network)
 */
export function getValidationSchema(): Address | undefined {
  return getSatiClient().validationSchema;
}

/**
 * Feedback schema type for display purposes
 */
export type FeedbackSchemaType = "verified" | "public" | "unknown";

/**
 * Get feedback schema type from attestation.
 * "verified" = DualSignature (Feedback schema) - requires both agent + counterparty signatures
 * "public" = CounterpartySigned (FeedbackPublic schema) - only counterparty signature
 */
export function getFeedbackSchemaType(feedback: ParsedFeedback): FeedbackSchemaType {
  const schemas = getFeedbackSchemas();
  const schemaAddr = feedback.attestation.sasSchema;
  if (schemaAddr === schemas.feedback) return "verified";
  if (schemaAddr === schemas.feedbackPublic) return "public";
  return "unknown";
}

/** Sort attestations by createdAt descending (newest first) */
function sortByCreatedAtDesc<T extends { createdAt?: number }>(items: T[]): T[] {
  return items.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/**
 * Parsed feedback from SDK - re-exported for convenience
 */
export type ParsedFeedback = ParsedAttestation;

/**
 * List all feedbacks for a specific agent (by mint address).
 */
export async function listAgentFeedbacks(agentMint: Address): Promise<ParsedFeedback[]> {
  const sati = getSatiClient();
  const { feedback, feedbackPublic } = getFeedbackSchemas();
  const schemas = [feedback, feedbackPublic].filter(Boolean) as Address[];

  if (schemas.length === 0) {
    return [];
  }

  try {
    const allFeedbacks: ParsedFeedback[] = [];

    for (const sasSchema of schemas) {
      const result = await sati.listFeedbacks({ sasSchema, agentMint });
      allFeedbacks.push(...result.items);
    }

    return sortByCreatedAtDesc(allFeedbacks);
  } catch (e) {
    console.error("Failed to list agent feedbacks:", e);
    return [];
  }
}

/**
 * List all validation attestations for a specific agent.
 */
export async function listAgentValidations(agentMint: Address): Promise<ParsedValidationAttestation[]> {
  const sati = getSatiClient();
  const validationSchema = getValidationSchema();

  if (!validationSchema) {
    return [];
  }

  try {
    const result = await sati.listValidations({ sasSchema: validationSchema, agentMint });
    return sortByCreatedAtDesc(result.items);
  } catch (e) {
    console.error("Failed to list agent validations:", e);
    return [];
  }
}

/**
 * List all feedbacks globally (by schema)
 * Uses SDK's listFeedbacks with Photon RPC
 */
export async function listAllFeedbacks(): Promise<ParsedFeedback[]> {
  const sati = getSatiClient();
  const { feedback, feedbackPublic } = getFeedbackSchemas();
  const schemas = [feedback, feedbackPublic].filter(Boolean) as Address[];

  if (schemas.length === 0) {
    return [];
  }

  try {
    const allFeedbacks: ParsedFeedback[] = [];

    for (const sasSchema of schemas) {
      const result = await sati.listFeedbacks({ sasSchema });
      allFeedbacks.push(...result.items);
    }

    return sortByCreatedAtDesc(allFeedbacks);
  } catch (e) {
    console.error("Failed to list all feedbacks:", e);
    return [];
  }
}

/**
 * List feedbacks submitted by a specific counterparty
 */
export async function listFeedbacksByCounterparty(counterparty: Address): Promise<ParsedFeedback[]> {
  const sati = getSatiClient();
  const { feedback, feedbackPublic } = getFeedbackSchemas();
  const schemas = [feedback, feedbackPublic].filter(Boolean) as Address[];
  if (schemas.length === 0) return [];

  try {
    const all: ParsedFeedback[] = [];
    for (const sasSchema of schemas) {
      const result = await sati.listFeedbacks({ sasSchema, counterparty });
      all.push(...result.items);
    }
    return sortByCreatedAtDesc(all);
  } catch (e) {
    console.error("Failed to list feedbacks by counterparty:", e);
    return [];
  }
}

/**
 * Result from listAgentsByOwner including registry stats
 */
export interface ListAgentsResult {
  agents: AgentIdentity[];
  totalAgents: bigint;
}

/**
 * List agents owned by a specific wallet.
 *
 * Delegates to SDK's registry.listByOwner for Token-2022 parsing.
 * Also returns totalAgents from registry stats.
 */
export async function listAgentsByOwner(owner: Address): Promise<ListAgentsResult> {
  const sati = getSatiClient();
  const [agents, stats] = await Promise.all([sati.listAgentsByOwner(owner), sati.getRegistryStats()]);
  return { agents, totalAgents: stats.totalAgents };
}

/**
 * Truncate an address for display
 */
export function truncateAddress(addr: string | null | undefined, startLen = 4, endLen = 4): string {
  if (!addr) return "—";
  if (addr.length <= startLen + endLen + 3) return addr;
  return `${addr.slice(0, startLen)}...${addr.slice(-endLen)}`;
}

/**
 * Format member number for display
 */
export function formatMemberNumber(num: bigint): string {
  return `#${num.toLocaleString()}`;
}

// Slot time constants
const SLOT_TIME_MS = 400; // ~400ms per slot on Solana

/**
 * Format slot as relative time (e.g., "2m ago", "3h ago")
 * Uses current slot to calculate approximate time difference.
 */
export function formatSlotTime(slot: bigint, currentSlot: bigint): string {
  if (slot <= 0n || currentSlot <= 0n) return "—";

  const slotDiff = currentSlot - slot;
  if (slotDiff < 0n) return "just now";

  const msAgo = Number(slotDiff) * SLOT_TIME_MS;
  const secondsAgo = Math.floor(msAgo / 1000);
  const minutesAgo = Math.floor(secondsAgo / 60);
  const hoursAgo = Math.floor(minutesAgo / 60);
  const daysAgo = Math.floor(hoursAgo / 24);

  if (daysAgo > 0) return `${daysAgo}d ago`;
  if (hoursAgo > 0) return `${hoursAgo}h ago`;
  if (minutesAgo > 0) return `${minutesAgo}m ago`;
  if (secondsAgo > 0) return `${secondsAgo}s ago`;
  return "just now";
}

/**
 * Fetch current slot from RPC
 */
export async function getCurrentSlot(): Promise<bigint> {
  try {
    const sati = getSatiClient();
    const rpc = sati.getRpc();
    const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
    return slot;
  } catch {
    return 0n;
  }
}

/**
 * List reputation scores for a specific agent.
 */
export async function listAgentReputationScores(agentMint: Address): Promise<ReputationScoreData[]> {
  const sati = getSatiClient();
  const reputationSchema = sati.reputationScoreSchema;

  if (!reputationSchema) {
    return [];
  }

  try {
    return await sati.listReputationScores(agentMint, reputationSchema);
  } catch (e) {
    console.error("Failed to list agent reputation scores:", e);
    return [];
  }
}

// Re-export getSolscanUrl from network module
export { getSolscanUrl } from "./network";

/**
 * List all agents registered in the SATI registry.
 * Uses SDK's AgentIndex-based enumeration for reliable discovery.
 */
export async function listAllAgents(params?: { offset?: number; limit?: number }): Promise<ListAgentsResult> {
  const sati = getSatiClient();
  return sati.listAllAgents(params);
}

/**
 * Agent metadata type (re-exported from SDK)
 *
 * Uses SDK's RegistrationFile which is ERC-8004 + Phantom compatible.
 * The SDK handles validation, IPFS/Arweave URI conversion, and image extraction.
 */
export type AgentMetadata = RegistrationFile;

/**
 * Fetch agent metadata from URI.
 *
 * Uses SDK's fetchRegistrationFile which:
 * - Handles IPFS/Arweave URI conversion
 * - Validates against ERC-8004 schema
 * - Returns null on network errors or invalid URIs (never throws)
 */
export async function fetchAgentMetadata(uri: string): Promise<AgentMetadata | null> {
  return fetchRegistrationFile(uri, { strict: true });
}

/**
 * Get image URL from agent metadata.
 *
 * Uses SDK's getImageUrl which:
 * - Prefers properties.files (Phantom format)
 * - Falls back to image field
 * - Handles IPFS/Arweave URI conversion
 */
export function getAgentImageUrl(metadata: AgentMetadata | null): string | null {
  return getImageUrl(metadata);
}

/**
 * Parse feedback content from attestation data.
 * Returns null if content is empty or not JSON.
 */
export function parseFeedback(data: { content: Uint8Array; contentType: number }): FeedbackContent | null {
  return parseFeedbackContent(data.content, data.contentType as ContentType);
}

// Re-export types and content parsing utilities
export type { AgentIdentity, FeedbackContent, ReputationScoreData };
export { ContentType, parseReputationScoreContent };
