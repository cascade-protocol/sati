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
} from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";
import { getNetwork, getRpcUrl } from "./network";

// Read network once at module load (will be consistent until page reload)
const currentNetwork = getNetwork();
const RPC_URL = getRpcUrl(currentNetwork);

// Singleton Sati client instance
let satiClient: Sati | null = null;

/**
 * Get or create the Sati client singleton
 */
export function getSatiClient(): Sati {
  if (!satiClient) {
    satiClient = new Sati({
      network: currentNetwork,
      rpcUrl: RPC_URL,
      // Use same RPC for Photon queries (Helius RPC supports both)
      photonRpcUrl: RPC_URL,
    });
  }
  return satiClient;
}

/**
 * Reset Sati client singleton (call when network changes)
 */
export function resetSatiClient(): void {
  satiClient = null;
}

// Get deployed feedback schema addresses
const deployedConfig = loadDeployedConfig(currentNetwork);
const FEEDBACK_SCHEMA = deployedConfig?.schemas?.feedback as Address | undefined;
const FEEDBACK_PUBLIC_SCHEMA = deployedConfig?.schemas?.feedbackPublic as Address | undefined;

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
  const schemas = [FEEDBACK_SCHEMA, FEEDBACK_PUBLIC_SCHEMA].filter(Boolean) as Address[];

  if (schemas.length === 0) {
    return [];
  }

  try {
    const allFeedbacks: ParsedFeedback[] = [];

    for (const sasSchema of schemas) {
      const feedbacks = await sati.listFeedbacks({ sasSchema, tokenAccount });
      allFeedbacks.push(...feedbacks);
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
  const schemas = [FEEDBACK_SCHEMA, FEEDBACK_PUBLIC_SCHEMA].filter(Boolean) as Address[];

  if (schemas.length === 0) {
    return [];
  }

  try {
    const allFeedbacks: ParsedFeedback[] = [];

    for (const sasSchema of schemas) {
      const feedbacks = await sati.listFeedbacks({ sasSchema });
      allFeedbacks.push(...feedbacks);
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
  const stats = await sati.getRegistryStats();
  const groupMint = stats.groupMint;

  try {
    // Step 1: Discover mints via Helius getTransactionsForAddress
    const response = await fetch(RPC_URL, {
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

// Re-export types
export type { AgentIdentity };
