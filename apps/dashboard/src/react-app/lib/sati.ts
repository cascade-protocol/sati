/**
 * SATI Client and Helpers for Dashboard
 *
 * Provides singleton client and utility functions for agent management.
 * Supports both devnet and mainnet based on user selection.
 */

import {
  SATI,
  SATI_PROGRAM_ADDRESS,
  type AgentIdentity,
  // Registration file helpers
  fetchRegistrationFile,
  getImageUrl,
  type RegistrationFile,
  // Schema types and deserialization
  deserializeFeedback,
  type FeedbackData,
  DataType,
  COMPRESSED_OFFSETS,
  loadDeployedConfig,
} from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";
import { createHelius, type HeliusClient } from "helius-sdk";
import bs58 from "bs58";
import { getNetwork, getRpcUrl } from "./network";

// Read network once at module load (will be consistent until page reload)
const currentNetwork = getNetwork();
const RPC_URL = getRpcUrl(currentNetwork);

// Singleton SATI client instance
let satiClient: SATI | null = null;

/**
 * Get or create the SATI client singleton
 */
export function getSatiClient(): SATI {
  if (!satiClient) {
    satiClient = new SATI({
      network: currentNetwork,
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

// =============================================================================
// Helius Client for ZK Compression (Photon) Queries
// =============================================================================

// Helius API key from env var
const HELIUS_API_KEY = import.meta.env.VITE_HELIUS_API_KEY as
  | string
  | undefined;

// Singleton Helius client instance
let heliusClient: HeliusClient | null = null;

/**
 * Get or create the Helius client singleton for ZK compression queries
 */
export function getHeliusClient(): HeliusClient | null {
  if (!HELIUS_API_KEY) {
    console.warn(
      "VITE_HELIUS_API_KEY not set - ZK compression queries disabled",
    );
    return null;
  }
  if (!heliusClient) {
    // Helius SDK uses "mainnet-beta" for mainnet
    const heliusNetwork =
      currentNetwork === "mainnet" ? "mainnet-beta" : "devnet";
    heliusClient = createHelius({
      apiKey: HELIUS_API_KEY,
      network: heliusNetwork as "devnet" | "mainnet",
    });
  }
  return heliusClient;
}

// Get deployed feedback schema addresses (both DualSignature and SingleSigner)
const deployedConfig = loadDeployedConfig(currentNetwork);
const FEEDBACK_SCHEMA = deployedConfig?.schemas?.feedback;
const FEEDBACK_PUBLIC_SCHEMA = deployedConfig?.schemas?.feedbackPublic;

/**
 * Parsed feedback attestation from ZK compression
 */
export interface ParsedFeedback {
  /** Compressed account hash (identifier) */
  hash: string;
  /** Compressed account address */
  address?: string;
  /** Slot when created */
  slotCreated: number;
  /** Decoded feedback data */
  feedback: FeedbackData;
}

/**
 * Convert Address to base58-encoded bytes for memcmp filter
 */
function addressToBase58Bytes(address: Address): string {
  return address; // Address is already base58
}

/**
 * Parse a compressed account into a ParsedFeedback
 */
function parseCompressedFeedback(account: {
  hash: string;
  address?: string;
  slotCreated: number;
  data?: { data: string; discriminator: number };
}): ParsedFeedback | null {
  try {
    if (!account.data?.data) return null;

    // Decode base64 data
    const binaryString = atob(account.data.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Data layout (no discriminator prefix - Light Protocol separates it):
    //   - bytes 0-31:  sasSchema (32 bytes)
    //   - bytes 32-63: tokenAccount (32 bytes)
    //   - byte 64:     dataType (1 byte)
    //   - bytes 65-68: schemaData length (4 bytes, little-endian u32)
    //   - bytes 69+:   schemaData
    const dataTypeOffset = COMPRESSED_OFFSETS.DATA_TYPE; // 64
    const dataType = bytes[dataTypeOffset];

    if (dataType !== DataType.Feedback) {
      return null; // Not a feedback attestation
    }

    // Schema data Vec<u8>: 4-byte length prefix at offset 65
    const schemaDataLenOffset = 65;
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const schemaDataLen = view.getUint32(schemaDataLenOffset, true);
    const schemaData = bytes.slice(
      schemaDataLenOffset + 4,
      schemaDataLenOffset + 4 + schemaDataLen,
    );

    const feedback = deserializeFeedback(schemaData);

    return {
      hash: account.hash,
      address: account.address,
      slotCreated: account.slotCreated,
      feedback,
    };
  } catch (e) {
    console.error("Failed to parse compressed feedback:", e);
    return null;
  }
}

/**
 * List all feedbacks for a specific agent (by token account)
 * Queries both Feedback (DualSignature) and FeedbackPublic (SingleSigner) schemas
 */
export async function listAgentFeedbacks(
  tokenAccount: Address,
): Promise<ParsedFeedback[]> {
  const helius = getHeliusClient();
  if (!helius) {
    return [];
  }

  const schemas = [FEEDBACK_SCHEMA, FEEDBACK_PUBLIC_SCHEMA].filter(
    Boolean,
  ) as Address[];
  if (schemas.length === 0) {
    return [];
  }

  try {
    const feedbacks: ParsedFeedback[] = [];

    // Query each schema
    for (const schema of schemas) {
      const response = await helius.zk.getCompressedAccountsByOwner({
        owner: SATI_PROGRAM_ADDRESS,
        filters: [
          {
            memcmp: {
              offset: COMPRESSED_OFFSETS.SAS_SCHEMA,
              bytes: addressToBase58Bytes(schema),
            },
          },
          {
            memcmp: {
              offset: COMPRESSED_OFFSETS.TOKEN_ACCOUNT,
              bytes: addressToBase58Bytes(tokenAccount),
            },
          },
          {
            memcmp: {
              offset: COMPRESSED_OFFSETS.DATA_TYPE,
              bytes: bs58.encode(new Uint8Array([DataType.Feedback])),
            },
          },
        ],
      });

      for (const account of response.value.items) {
        const parsed = parseCompressedFeedback(account);
        if (parsed) {
          feedbacks.push(parsed);
        }
      }
    }

    return feedbacks;
  } catch (e) {
    console.error("Failed to list agent feedbacks:", e);
    return [];
  }
}

/**
 * List all feedbacks globally (by schema)
 * Queries both Feedback (DualSignature) and FeedbackPublic (SingleSigner) schemas
 */
export async function listAllFeedbacks(): Promise<ParsedFeedback[]> {
  const helius = getHeliusClient();
  if (!helius) {
    return [];
  }

  const schemas = [FEEDBACK_SCHEMA, FEEDBACK_PUBLIC_SCHEMA].filter(
    Boolean,
  ) as Address[];
  if (schemas.length === 0) {
    return [];
  }

  try {
    const feedbacks: ParsedFeedback[] = [];

    for (const schema of schemas) {
      const response = await helius.zk.getCompressedAccountsByOwner({
        owner: SATI_PROGRAM_ADDRESS,
        filters: [
          {
            memcmp: {
              offset: COMPRESSED_OFFSETS.SAS_SCHEMA,
              bytes: addressToBase58Bytes(schema),
            },
          },
          {
            memcmp: {
              offset: COMPRESSED_OFFSETS.DATA_TYPE,
              bytes: bs58.encode(new Uint8Array([DataType.Feedback])),
            },
          },
        ],
      });

      for (const account of response.value.items) {
        const parsed = parseCompressedFeedback(account);
        if (parsed) {
          feedbacks.push(parsed);
        }
      }
    }

    return feedbacks;
  } catch (e) {
    console.error("Failed to list all feedbacks:", e);
    return [];
  }
}

/**
 * List feedbacks submitted by a specific counterparty
 */
export async function listFeedbacksByCounterparty(
  counterparty: Address,
): Promise<ParsedFeedback[]> {
  // Note: counterparty is in the schema data, not at a fixed offset in the compressed account
  // We need to filter by schema first, then filter client-side by counterparty
  try {
    const allFeedbacks = await listAllFeedbacks();
    return allFeedbacks.filter((f) => f.feedback.counterparty === counterparty);
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

// Re-export getSolscanUrl from network module
export { getSolscanUrl } from "./network";

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
