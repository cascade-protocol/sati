/**
 * SATI Client and Helpers for Dashboard
 *
 * Provides singleton client and utility functions for agent management.
 * Currently restricted to devnet only (mainnet will be enabled after deployment).
 */

import {
  SATI,
  SATI_PROGRAM_ADDRESS,
  type AgentIdentity,
  // Registration file helpers
  fetchRegistrationFile,
  getImageUrl,
  type RegistrationFile,
} from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";

// RPC URL from env var or fallback to public devnet
// Currently restricted to devnet only (mainnet will be enabled after deployment)
const RPC_URL =
  import.meta.env.VITE_DEVNET_RPC ?? "https://api.devnet.solana.com";

// Singleton SATI client instance
let satiClient: SATI | null = null;

/**
 * Get or create the SATI client singleton
 */
export function getSatiClient(): SATI {
  if (!satiClient) {
    satiClient = new SATI({
      network: "devnet",
      rpcUrl: RPC_URL,
    });
  }
  return satiClient;
}

/**
 * Reset SATI client singleton (call when network changes)
 */
export function resetSatiClient(): void {
  satiClient = null;
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
 * Delegates to SDK's listAgentsByOwner for Token-2022 parsing.
 * Also returns totalAgents from registry stats.
 */
export async function listAgentsByOwner(
  owner: Address,
): Promise<ListAgentsResult> {
  const sati = getSatiClient();
  const [agents, stats] = await Promise.all([
    sati.listAgentsByOwner(owner),
    sati.getRegistryStats(),
  ]);
  return { agents, totalAgents: stats.totalAgents };
}

/**
 * Truncate an address for display
 */
export function truncateAddress(
  addr: string | null | undefined,
  startLen = 4,
  endLen = 4,
): string {
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

/**
 * Get Solscan URL for an address
 */
export function getSolscanUrl(
  address: string,
  type: "account" | "token" | "tx" = "account",
): string {
  // Currently only devnet is supported
  // TODO: Add mainnet support (remove cluster param) after mainnet deployment
  return `https://solscan.io/${type}/${address}?cluster=devnet`;
}

/**
 * Helius getTransactionsForAddress response types
 */
interface HeliusTransaction {
  transaction: {
    message: {
      accountKeys: Array<
        { pubkey: string; signer: boolean; writable: boolean } | string
      >;
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
 * Uses Helius getTransactionsForAddress to discover mints, then SDK's loadAgent
 * for proper ownership resolution (owner = current token holder, not registrant).
 */
export async function listAllAgents(params?: {
  offset?: number;
  limit?: number;
}): Promise<ListAgentsResult> {
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
      console.warn(
        "Helius getTransactionsForAddress error:",
        data.error.message,
      );
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
      const pubkeys = accounts.map((acc) =>
        typeof acc === "object" && "pubkey" in acc ? acc.pubkey : String(acc),
      );

      // Check if this transaction involves the group mint (indicates registerAgent)
      if (!pubkeys.includes(groupMint)) continue;

      // Find the agent mint - it's the second signer (first is payer)
      const signerAccounts = accounts.filter(
        (acc) => typeof acc === "object" && "signer" in acc && acc.signer,
      );

      if (signerAccounts.length >= 2) {
        const agentMint =
          typeof signerAccounts[1] === "object" && "pubkey" in signerAccounts[1]
            ? signerAccounts[1].pubkey
            : null;

        // Skip if this is the groupMint itself (from initialize transaction)
        if (
          agentMint &&
          agentMint !== groupMint &&
          !agentMints.includes(agentMint)
        ) {
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
    const agentPromises = paginatedMints.map((mint) =>
      sati.loadAgent(mint as Address),
    );
    const loadedAgents = await Promise.all(agentPromises);

    // Filter out nulls (failed loads)
    const agents = loadedAgents.filter(
      (agent): agent is AgentIdentity => agent !== null,
    );

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
export async function fetchAgentMetadata(
  uri: string,
): Promise<AgentMetadata | null> {
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
export function getAgentImageUrl(
  metadata: AgentMetadata | null,
): string | null {
  return getImageUrl(metadata);
}

// Re-export types
export type { AgentIdentity };
