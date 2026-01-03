/**
 * SATI Client and Helpers for Dashboard
 *
 * Provides singleton client and utility functions for agent management.
 * Supports both devnet and mainnet based on user selection.
 */

import {
  Sati,
  SATI_PROGRAM_ADDRESS,
  type AgentIdentity,
  type ParsedAttestation,
  // Registration file helpers
  fetchRegistrationFile,
  getImageUrl,
  type RegistrationFile,
  loadDeployedConfig,
  // Content parsing
  parseFeedbackContent,
  ContentType,
  type FeedbackContent,
} from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";
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
 * Get deployed feedback schema addresses (always fresh for current network)
 */
function getFeedbackSchemas(): { feedback?: Address; feedbackPublic?: Address } {
  const deployedConfig = loadDeployedConfig(getCurrentNetwork());
  return {
    feedback: deployedConfig?.schemas?.feedback as Address | undefined,
    feedbackPublic: deployedConfig?.schemas?.feedbackPublic as Address | undefined,
  };
}

/**
 * Parsed feedback from SDK - re-exported for convenience
 */
export type ParsedFeedback = ParsedAttestation;

/**
 * List all feedbacks for a specific agent (by mint address).
 *
 * Note: The parameter is named tokenAccount for SAS wire format compatibility,
 * but it stores the agent's mint address, not an ATA.
 */
export async function listAgentFeedbacks(tokenAccount: Address): Promise<ParsedFeedback[]> {
  const sati = getSatiClient();
  const { feedback, feedbackPublic } = getFeedbackSchemas();
  const schemas = [feedback, feedbackPublic].filter(Boolean) as Address[];

  if (schemas.length === 0) {
    return [];
  }

  try {
    const allFeedbacks: ParsedFeedback[] = [];

    for (const sasSchema of schemas) {
      const result = await sati.listFeedbacks({ sasSchema, tokenAccount });
      allFeedbacks.push(...result.items);
    }

    return allFeedbacks;
  } catch (e) {
    console.error("Failed to list agent feedbacks:", e);
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

    return allFeedbacks;
  } catch (e) {
    console.error("Failed to list all feedbacks:", e);
    return [];
  }
}

/**
 * List feedbacks submitted by a specific counterparty
 */
export async function listFeedbacksByCounterparty(counterparty: Address): Promise<ParsedFeedback[]> {
  // Counterparty is in the schema data, filter client-side
  try {
    const allFeedbacks = await listAllFeedbacks();
    return allFeedbacks.filter((f) => f.data.counterparty === counterparty);
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
    const rpcUrl = getCurrentRpcUrl();
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "get-slot",
        method: "getSlot",
        params: [{ commitment: "confirmed" }],
      }),
    });
    const data = await response.json();
    return BigInt(data.result ?? 0);
  } catch {
    return 0n;
  }
}

// Re-export getSolscanUrl from network module
export { getSolscanUrl } from "./network";

/**
 * Helius getTransactionsForAddress response types
 */
interface HeliusTransaction {
  transaction: {
    message: {
      accountKeys: Array<{ pubkey: string; signer: boolean; writable: boolean } | string>;
    };
  };
}

interface HeliusResponse {
  result?: {
    data?: HeliusTransaction[];
  };
  error?: { message: string };
}

/**
 * List all agents registered in the SATI registry.
 *
 * Uses Helius getTransactionsForAddress to discover mints, then SDK's registry.load
 * for proper ownership resolution (owner = current token holder, not registrant).
 */
export async function listAllAgents(params?: { offset?: number; limit?: number }): Promise<ListAgentsResult> {
  const { offset = 0, limit = 20 } = params ?? {};

  const sati = getSatiClient();
  const rpcUrl = getCurrentRpcUrl();
  const stats = await sati.getRegistryStats();
  const groupMint = stats.groupMint;

  try {
    // Step 1: Discover mints via Helius getTransactionsForAddress
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "list-agents",
        method: "getTransactionsForAddress",
        params: [
          SATI_PROGRAM_ADDRESS,
          {
            transactionDetails: "full",
            encoding: "jsonParsed",
            limit: 100,
            sortOrder: "desc",
            filters: { status: "succeeded" },
          },
        ],
      }),
    });

    const data: HeliusResponse = await response.json();

    if (data.error) {
      console.warn("Helius getTransactionsForAddress error:", data.error.message);
      return { agents: [], totalAgents: stats.totalAgents };
    }

    const transactions = data.result?.data ?? [];

    if (transactions.length === 0) {
      return { agents: [], totalAgents: stats.totalAgents };
    }

    // Step 2: Extract agent mints from registerAgent transactions
    const agentMints: string[] = [];

    for (const tx of transactions) {
      if (!tx?.transaction?.message) continue;

      const accounts = tx.transaction.message.accountKeys;
      const pubkeys = accounts.map((acc) => (typeof acc === "object" && "pubkey" in acc ? acc.pubkey : String(acc)));

      // Check if this transaction involves the group mint (indicates registerAgent)
      if (!pubkeys.includes(groupMint)) continue;

      // Find the agent mint - it's the second signer (first is payer)
      const signerAccounts = accounts.filter((acc) => typeof acc === "object" && "signer" in acc && acc.signer);

      if (signerAccounts.length >= 2) {
        const agentMint =
          typeof signerAccounts[1] === "object" && "pubkey" in signerAccounts[1] ? signerAccounts[1].pubkey : null;

        // Skip if this is the groupMint itself (from initialize transaction)
        if (agentMint && agentMint !== groupMint && !agentMints.includes(agentMint)) {
          agentMints.push(agentMint);
        }
      }
    }

    if (agentMints.length === 0) {
      return { agents: [], totalAgents: stats.totalAgents };
    }

    // Step 3: Apply pagination
    const paginatedMints = agentMints.slice(offset, offset + limit);

    // Step 4: Load agents via SDK (handles owner lookup correctly)
    const agentPromises = paginatedMints.map((mint) => sati.loadAgent(mint as Address));
    const loadedAgents = await Promise.all(agentPromises);

    // Filter out nulls (failed loads)
    const agents = loadedAgents.filter((agent): agent is AgentIdentity => agent !== null);

    return {
      agents,
      totalAgents: stats.totalAgents,
    };
  } catch (error) {
    console.warn("Failed to fetch agents:", error);
    return { agents: [], totalAgents: stats.totalAgents };
  }
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
  return fetchRegistrationFile(uri);
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
export type { AgentIdentity, FeedbackContent };
export { ContentType };
