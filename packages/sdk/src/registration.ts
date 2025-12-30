/**
 * SATI Registration File
 *
 * Helpers for building, fetching, and working with ERC-8004 + Phantom
 * compatible registration files.
 *
 * @example
 * ```typescript
 * import {
 *   buildRegistrationFile,
 *   fetchRegistrationFile,
 *   getImageUrl,
 * } from "@cascade-fyi/sati-sdk";
 *
 * // Build a registration file
 * const file = buildRegistrationFile({
 *   name: "MyAgent",
 *   description: "AI assistant",
 *   image: "https://example.com/avatar.png",
 * });
 *
 * // Fetch from URI
 * const metadata = await fetchRegistrationFile(uri);
 * const imageUrl = getImageUrl(metadata);
 * ```
 */

import * as z from "zod";

// ============================================================================
// INTERNAL: Zod Schemas (not exported)
// ============================================================================

const PropertyFileSchema = z.object({
  uri: z.url(),
  type: z.string(),
});

const PropertiesSchema = z.object({
  files: z.array(PropertyFileSchema).min(1),
  category: z.enum(["image", "video", "audio"]).optional(),
});

const EndpointSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  version: z.string().optional(),
});

const RegistrationEntrySchema = z.object({
  agentId: z.union([z.string(), z.number()]),
  agentRegistry: z.string(),
});

const TrustMechanismSchema = z.enum(["reputation", "crypto-economic", "tee-attestation"]);

const RegistrationFileSchema = z.object({
  type: z.literal("https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.url(),
  properties: PropertiesSchema,
  external_url: z.url().optional(),
  endpoints: z.array(EndpointSchema).optional(),
  registrations: z.array(RegistrationEntrySchema).optional(),
  supportedTrust: z.array(TrustMechanismSchema).optional(),
  active: z.boolean().optional().default(true),
  x402support: z.boolean().optional(),
});

// ============================================================================
// PUBLIC: TypeScript Types
// ============================================================================

/** File entry for Phantom/Metaplex wallet display */
export interface PropertyFile {
  uri: string;
  type: string;
}

/** Properties object for wallet compatibility */
export interface Properties {
  files: PropertyFile[];
  category?: "image" | "video" | "audio";
}

/** Service endpoint (ERC-8004) */
export interface Endpoint {
  name: string;
  endpoint: string;
  version?: string;
}

/** Cross-chain registration entry (ERC-8004) */
export interface RegistrationEntry {
  agentId: string | number;
  agentRegistry: string;
}

/** Trust mechanism type */
export type TrustMechanism = "reputation" | "crypto-economic" | "tee-attestation";

/**
 * Registration file schema (ERC-8004 + Phantom compatible)
 *
 * This is the off-chain JSON document referenced by the on-chain `uri` field.
 */
export interface RegistrationFile {
  /** Schema type identifier */
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Primary image URL */
  image: string;
  /** Properties for wallet display (required for Phantom) */
  properties: Properties;
  /** Project website URL */
  external_url?: string;
  /** Service endpoints (A2A, MCP, agentWallet) */
  endpoints?: Endpoint[];
  /** Cross-chain registration entries */
  registrations?: RegistrationEntry[];
  /** Supported trust mechanisms */
  supportedTrust?: TrustMechanism[];
  /** Agent operational status */
  active?: boolean;
  /** Accepts x402 payments */
  x402support?: boolean;
}

/** Input parameters for buildRegistrationFile */
export interface RegistrationFileParams {
  name: string;
  description: string;
  image: string;
  imageMimeType?: string;
  externalUrl?: string;
  endpoints?: Endpoint[];
  registrations?: RegistrationEntry[];
  supportedTrust?: TrustMechanism[];
  active?: boolean;
  x402support?: boolean;
}

// ============================================================================
// PUBLIC: Helper Functions
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Infer MIME type from image URL extension.
 * Returns "image/png" as default if unrecognized.
 */
export function inferMimeType(url: string): string {
  const ext = url.split(".").pop()?.toLowerCase().split("?")[0];
  return MIME_TYPES[ext ?? ""] ?? "image/png";
}

/**
 * Build a registration file from parameters.
 *
 * Automatically:
 * - Sets the ERC-8004 type identifier
 * - Generates properties.files from image URL
 * - Infers MIME type from extension
 * - Sets active to true by default
 *
 * @throws Error if required fields are missing or invalid
 */
export function buildRegistrationFile(params: RegistrationFileParams): RegistrationFile {
  const mimeType = params.imageMimeType ?? inferMimeType(params.image);

  const file = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const,
    name: params.name,
    description: params.description,
    image: params.image,
    properties: {
      files: [{ uri: params.image, type: mimeType }],
      category: "image" as const,
    },
    ...(params.externalUrl && { external_url: params.externalUrl }),
    ...(params.endpoints?.length && { endpoints: params.endpoints }),
    ...(params.registrations?.length && {
      registrations: params.registrations,
    }),
    ...(params.supportedTrust?.length && {
      supportedTrust: params.supportedTrust,
    }),
    active: params.active ?? true,
    ...(params.x402support !== undefined && {
      x402support: params.x402support,
    }),
  };

  // Validate with Zod (throws on error)
  return RegistrationFileSchema.parse(file);
}

/**
 * Fetch and parse a registration file from URI.
 *
 * - Returns null on network errors or invalid URIs
 * - Validates structure, logs warnings for non-conforming files
 * - Never throws
 */
export async function fetchRegistrationFile(uri: string): Promise<RegistrationFile | null> {
  if (!uri) return null;

  // Convert IPFS/Arweave URIs to gateway URLs
  let url = uri;
  if (uri.startsWith("ipfs://")) {
    url = `https://ipfs.io/ipfs/${uri.slice(7)}`;
  } else if (uri.startsWith("ar://")) {
    url = `https://arweave.net/${uri.slice(5)}`;
  } else if (!uri.startsWith("http://") && !uri.startsWith("https://")) {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`[SATI] Failed to fetch metadata from ${url}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = RegistrationFileSchema.safeParse(data);

    if (!result.success) {
      // Log validation issues but return data anyway for backwards compatibility
      console.warn(`[SATI] Registration file validation issues:`, result.error.issues);
      return data as RegistrationFile;
    }

    return result.data;
  } catch (error) {
    console.warn(`[SATI] Failed to fetch metadata from ${uri}:`, error);
    return null;
  }
}

/**
 * Extract image URL from a registration file.
 *
 * Prefers properties.files (Phantom format), falls back to image field.
 * Handles IPFS/Arweave URI conversion.
 */
export function getImageUrl(file: RegistrationFile | null | undefined): string | null {
  if (!file) return null;

  // Prefer properties.files (Phantom format)
  const fileUri = file.properties?.files?.[0]?.uri;
  const uri = fileUri ?? file.image;

  if (!uri) return null;

  // Convert protocol URIs to gateway URLs
  if (uri.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${uri.slice(7)}`;
  }
  if (uri.startsWith("ar://")) {
    return `https://arweave.net/${uri.slice(5)}`;
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    return uri;
  }

  return null;
}

/**
 * Serialize a registration file to JSON string.
 */
export function stringifyRegistrationFile(file: RegistrationFile, space = 2): string {
  return JSON.stringify(file, null, space);
}

// ============================================================================
// SATI Registration Helpers
// ============================================================================

/** CAIP-2 chain identifier for Solana mainnet */
export const SATI_CHAIN_ID = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** SATI program ID */
export const SATI_PROGRAM_ID = "satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz";

/**
 * Build a registrations[] entry for linking a SATI agent to an off-chain registration file.
 *
 * @param agentMint - SATI agent mint address
 * @returns RegistrationEntry for the registrations[] array
 *
 * @example
 * ```typescript
 * const entry = buildSatiRegistrationEntry("AgentMint...");
 * // { agentId: "AgentMint...", agentRegistry: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiR3q7..." }
 * ```
 */
export function buildSatiRegistrationEntry(agentMint: string): RegistrationEntry {
  return {
    agentId: agentMint,
    agentRegistry: `${SATI_CHAIN_ID}:${SATI_PROGRAM_ID}`,
  };
}

/**
 * Check if a registration file contains a SATI registration.
 *
 * @param file - Registration file to check
 * @returns true if file contains at least one SATI registration
 */
export function hasSatiRegistration(file: RegistrationFile): boolean {
  return (
    file.registrations?.some((r) => typeof r.agentRegistry === "string" && r.agentRegistry.startsWith(SATI_CHAIN_ID)) ??
    false
  );
}

/**
 * Find SATI agent IDs from a registration file.
 *
 * @param file - Registration file to search
 * @returns Array of SATI agent mint addresses
 */
export function getSatiAgentIds(file: RegistrationFile): string[] {
  return (
    file.registrations
      ?.filter((r) => typeof r.agentRegistry === "string" && r.agentRegistry.startsWith(SATI_CHAIN_ID))
      .map((r) => String(r.agentId)) ?? []
  );
}
