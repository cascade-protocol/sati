/**
 * SATI Client and Helpers for Dashboard
 *
 * Provides singleton client and utility functions for agent management.
 * Currently restricted to devnet only (mainnet will be enabled after deployment).
 */

import {
  SATI,
  SATI_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  type AgentIdentity,
} from "@cascade-fyi/sati-sdk";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

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
 * Efficiently list agents owned by a specific wallet.
 *
 * Uses getTokenAccountsByOwner + batch getMultipleAccounts for optimal performance.
 * 1. Fetches all Token-2022 token accounts for owner (1 RPC call)
 * 2. Gets registry config for group mint (1 RPC call)
 * 3. Batch fetches all potential NFT mints (1 RPC call)
 * 4. Filters to agents with correct group membership
 *
 * Also returns totalAgents from registry stats (no extra RPC call).
 */
export async function listAgentsByOwner(
  rpc: Rpc<SolanaRpcApi>,
  owner: Address,
): Promise<ListAgentsResult> {
  // Parallel fetch: token accounts + registry stats (for group mint)
  const [tokenAccountsResult, stats] = await Promise.all([
    rpc
      .getTokenAccountsByOwner(
        owner,
        { programId: TOKEN_2022_PROGRAM_ADDRESS },
        { encoding: "jsonParsed" },
      )
      .send(),
    getSatiClient().getRegistryStats(),
  ]);

  const groupMint = stats.groupMint;

  // Collect potential NFT mints (amount=1, decimals=0)
  const potentialMints: Address[] = [];

  for (const { account } of tokenAccountsResult.value) {
    const parsed = account.data as {
      parsed?: {
        info?: {
          mint?: string;
          tokenAmount?: { amount: string; decimals: number };
        };
      };
    };

    const info = parsed.parsed?.info;
    if (!info?.mint || !info?.tokenAmount) continue;

    // NFTs have amount=1 and decimals=0
    if (info.tokenAmount.amount !== "1" || info.tokenAmount.decimals !== 0) {
      continue;
    }

    potentialMints.push(info.mint as Address);
  }

  if (potentialMints.length === 0) {
    return { agents: [], totalAgents: stats.totalAgents };
  }

  // Batch fetch all potential mint accounts
  const mintAccountsResult = await rpc
    .getMultipleAccounts(potentialMints, { encoding: "jsonParsed" })
    .send();

  const agents: AgentIdentity[] = [];

  for (let i = 0; i < potentialMints.length; i++) {
    const mintAccount = mintAccountsResult.value[i];
    if (!mintAccount) continue;

    const parsed = mintAccount.data as {
      parsed?: {
        info?: {
          extensions?: Array<{
            extension: string;
            state: Record<string, unknown>;
          }>;
        };
      };
    };

    const extensions = parsed.parsed?.info?.extensions;
    if (!extensions) continue;

    // Find TokenGroupMember extension
    const groupMemberExt = extensions.find(
      (ext) => ext.extension === "tokenGroupMember",
    );
    if (!groupMemberExt) continue;

    // Verify it belongs to the SATI registry group
    const memberState = groupMemberExt.state as {
      group?: string;
      memberNumber?: number;
    };
    if (memberState.group !== groupMint) continue;

    // Find TokenMetadata extension
    const metadataExt = extensions.find(
      (ext) => ext.extension === "tokenMetadata",
    );
    if (!metadataExt) continue;

    const metadataState = metadataExt.state as {
      name?: string;
      symbol?: string;
      uri?: string;
      additionalMetadata?: Array<[string, string]>;
    };

    // Check for NonTransferable extension
    const nonTransferableExt = extensions.find(
      (ext) => ext.extension === "nonTransferable",
    );

    // Build additional metadata record
    const additionalMetadata: Record<string, string> = {};
    if (metadataState.additionalMetadata) {
      for (const [key, value] of metadataState.additionalMetadata) {
        additionalMetadata[key] = value;
      }
    }

    // Construct agent identity directly from parsed data
    agents.push({
      mint: potentialMints[i],
      owner, // We already know the owner
      name: metadataState.name ?? "Unknown",
      symbol: metadataState.symbol ?? "SATI",
      uri: metadataState.uri ?? "",
      memberNumber: BigInt(memberState.memberNumber ?? 0),
      additionalMetadata,
      nonTransferable: !!nonTransferableExt,
    });
  }

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
 * Agent metadata from the URI (JSON file on IPFS)
 */
export interface AgentMetadata {
  name: string;
  symbol: string;
  description?: string;
  image?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
}

/**
 * Convert metadata URI to a fetchable URL.
 * - Arweave URLs (https://arweave.net/...) pass through as-is
 * - IPFS URLs are no longer supported (legacy)
 */
export function ipfsToGatewayUrl(uri: string): string {
  // Guard against undefined/invalid URIs
  if (!uri || uri === "undefined" || uri.includes("undefined")) {
    return "";
  }

  // Arweave URLs pass through as-is
  if (uri.startsWith("https://arweave.net/")) {
    return uri;
  }

  // Return as-is for other URLs (http/https)
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }

  // IPFS URLs no longer supported
  return "";
}

/**
 * Fetch agent metadata from URI
 */
export async function fetchAgentMetadata(
  uri: string,
): Promise<AgentMetadata | null> {
  if (!uri) return null;

  try {
    const url = ipfsToGatewayUrl(uri);
    if (!url) return null; // Invalid or unsupported URI
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Failed to fetch metadata from ${url}: ${response.status}`);
      return null;
    }
    return response.json();
  } catch (error) {
    console.warn(`Failed to fetch metadata from ${uri}:`, error);
    return null;
  }
}

/**
 * Get image URL from agent metadata
 * Handles Arweave URLs (passes through as-is)
 */
export function getAgentImageUrl(
  metadata: AgentMetadata | null,
): string | null {
  if (!metadata?.image) return null;
  const url = ipfsToGatewayUrl(metadata.image);
  return url || null;
}

// Re-export types
export type { AgentIdentity };
