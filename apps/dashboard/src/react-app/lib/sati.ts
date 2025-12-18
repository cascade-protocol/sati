/**
 * SATI Client and Helpers for Dashboard
 *
 * Provides singleton client and utility functions for agent management.
 */

import {
  SATI,
  TOKEN_2022_PROGRAM_ADDRESS,
  type AgentIdentity,
} from "@cascade-fyi/sati-sdk";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  createHeliusEager,
  type HeliusClientEager,
} from "helius-sdk/rpc/eager";

// Singleton SATI client instance
let satiClient: SATI | null = null;
let heliusClient: HeliusClientEager | null = null;

/**
 * Get or create the SATI client singleton
 */
export function getSatiClient(): SATI {
  if (!satiClient) {
    const network = (import.meta.env.VITE_SOLANA_NETWORK ?? "mainnet") as
      | "mainnet"
      | "devnet"
      | "localnet";
    const rpcUrl =
      import.meta.env.VITE_MAINNET_RPC ||
      import.meta.env.VITE_DEVNET_RPC ||
      undefined;

    satiClient = new SATI({
      network,
      rpcUrl,
    });
  }
  return satiClient;
}

/**
 * Get or create the Helius client singleton
 * Extracts API key from RPC URL
 */
function getHeliusClient(): HeliusClientEager | null {
  if (heliusClient) return heliusClient;

  const rpcUrl = import.meta.env.VITE_MAINNET_RPC;
  if (!rpcUrl) return null;

  // Extract API key from Helius RPC URL
  const match = rpcUrl.match(/api-key=([a-zA-Z0-9-]+)/);
  if (!match) return null;

  heliusClient = createHeliusEager({ apiKey: match[1] });
  return heliusClient;
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
  addr: string,
  startLen = 4,
  endLen = 4,
): string {
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
  type: "account" | "tx" = "account",
): string {
  const network = import.meta.env.VITE_SOLANA_NETWORK ?? "mainnet";
  const cluster = network === "mainnet" ? "" : `?cluster=${network}`;
  return `https://solscan.io/${type}/${address}${cluster}`;
}

// Constants for transaction parsing
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SATI_PROGRAM = "satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF";

/**
 * List all agents registered in the SATI registry.
 *
 * Uses Helius getTransactionsForAddress to scan program transactions,
 * then extracts agent mints from registerAgent transactions.
 * No storage needed - always fresh from chain.
 */
export async function listAllAgents(
  _rpc: Rpc<SolanaRpcApi>,
  params?: { offset?: number; limit?: number },
): Promise<ListAgentsResult> {
  const { offset = 0, limit = 20 } = params ?? {};

  // Get registry stats
  const stats = await getSatiClient().getRegistryStats();
  const groupMint = stats.groupMint;

  const rpcUrl = import.meta.env.VITE_MAINNET_RPC;
  if (!rpcUrl) {
    console.error("VITE_MAINNET_RPC not configured");
    return { agents: [], totalAgents: stats.totalAgents };
  }

  try {
    // Step 1: Get all program transactions
    const txResponse = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "scan-agents",
        method: "getTransactionsForAddress",
        params: [
          SATI_PROGRAM,
          {
            transactionDetails: "full",
            encoding: "jsonParsed",
            maxSupportedTransactionVersion: 0,
            sortOrder: "desc", // Newest first
            limit: 100,
            filters: { status: "succeeded" },
          },
        ],
      }),
    });

    const txData = await txResponse.json();
    if (txData.error) {
      console.error("getTransactionsForAddress error:", txData.error);
      return { agents: [], totalAgents: stats.totalAgents };
    }

    // Step 2: Extract agent mints from registerAgent transactions
    // registerAgent txs have: Token-2022, ATA program, group mint, and agent mint
    const agentMints: string[] = [];

    for (const tx of txData.result?.data || []) {
      const accounts = tx.transaction?.message?.accountKeys || [];
      const pubkeys = accounts.map(
        (acc: { pubkey: string } | string) =>
          typeof acc === "object" ? acc.pubkey : acc,
      );

      // Check if this is a registerAgent transaction
      const hasToken2022 = pubkeys.includes(TOKEN_2022_PROGRAM);
      const hasATA = pubkeys.includes(ATA_PROGRAM);
      const hasGroupMint = pubkeys.includes(groupMint);

      if (hasToken2022 && hasATA && hasGroupMint) {
        // Find the agent mint - it's a writable account that's not:
        // - The group mint
        // - A system program
        // - The payer (first signer)
        for (const acc of accounts) {
          const pubkey = typeof acc === "object" ? acc.pubkey : acc;
          const isWritable = typeof acc === "object" ? acc.writable : false;

          if (
            isWritable &&
            pubkey !== groupMint &&
            !pubkey.startsWith("1111") &&
            !pubkey.startsWith("Token") &&
            !pubkey.startsWith("sati") &&
            !pubkey.startsWith("Sysvar") &&
            !pubkey.startsWith("AToken") &&
            !pubkey.startsWith("Compute") &&
            pubkey.length === 44 // Valid base58 Solana address length
          ) {
            // Check if it's not already in the list and not the payer
            const isFirstSigner =
              accounts[0] &&
              (typeof accounts[0] === "object"
                ? accounts[0].pubkey
                : accounts[0]) === pubkey;

            if (!isFirstSigner && !agentMints.includes(pubkey)) {
              // Verify it's actually a mint by checking it's not the ATA
              // Agent mint appears before the ATA in the accounts
              agentMints.push(pubkey);
              break; // Only one agent mint per transaction
            }
          }
        }
      }
    }

    if (agentMints.length === 0) {
      return { agents: [], totalAgents: stats.totalAgents };
    }

    // Step 3: Get asset details for all mints in one batch call
    const helius = getHeliusClient();
    if (!helius) {
      console.error("Helius client not configured");
      return { agents: [], totalAgents: stats.totalAgents };
    }

    const assets = await helius.getAssetBatch({
      ids: agentMints.slice(offset, offset + limit),
    });

    // Step 4: Convert to AgentIdentity
    const agents: AgentIdentity[] = assets
      .filter((asset) => asset && asset.id)
      .map((asset, index) => {
        // Helius SDK types don't include token_group_member, but it's in the response
        const mintExtensions = asset.mint_extensions as
          | { token_group_member?: { member_number?: number } }
          | undefined;
        const memberNumber = mintExtensions?.token_group_member?.member_number;
        return {
          mint: asset.id as Address,
          owner: (asset.ownership?.owner ?? "") as Address,
          name: asset.content?.metadata?.name ?? "Unknown",
          symbol: asset.content?.metadata?.symbol ?? "SATI",
          uri: asset.content?.json_uri ?? "",
          memberNumber: memberNumber ? BigInt(memberNumber) : BigInt(index + 1),
          additionalMetadata: {},
          nonTransferable: true,
        };
      });

    return {
      agents,
      totalAgents: stats.totalAgents,
    };
  } catch (error) {
    console.error("Failed to fetch agents:", error);
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
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

/**
 * Get image URL from agent metadata
 * Handles Arweave URLs (passes through as-is)
 */
export function getAgentImageUrl(metadata: AgentMetadata | null): string | null {
  if (!metadata?.image) return null;
  const url = ipfsToGatewayUrl(metadata.image);
  return url || null;
}

// Re-export types
export type { AgentIdentity };
