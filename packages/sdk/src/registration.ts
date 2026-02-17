/**
 * SATI Registration File
 *
 * Helpers for building, fetching, validating, and working with ERC-8004 + Phantom
 * compatible registration files.
 *
 * @example
 * ```typescript
 * import {
 *   buildRegistrationFile,
 *   fetchRegistrationFile,
 *   validateRegistrationFile,
 *   parseRegistrationFile,
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
 * // Validate untrusted data
 * const result = validateRegistrationFile(untrustedData);
 * if (!result.ok) console.error(result.errors);
 *
 * // Parse untrusted data (returns null if invalid)
 * const parsed = parseRegistrationFile(untrustedData);
 *
 * // Fetch from URI
 * const metadata = await fetchRegistrationFile(uri);
 * const imageUrl = getImageUrl(metadata);
 * ```
 */

import * as z from "zod";
import { SATI_PROGRAM_ADDRESS } from "./generated/programs/sati.js";

// ============================================================================
// Constants
// ============================================================================

/** ERC-8004 registration file type identifier */
export const ERC8004_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;

// ============================================================================
// Zod Schemas
// ============================================================================

/** Zod schema for a property file entry (Phantom/Metaplex wallet display) */
export const PropertyFileSchema = z.object({
  uri: z.url(),
  type: z.string(),
});

/** Zod schema for properties object (wallet compatibility) */
export const PropertiesSchema = z.object({
  files: z.array(PropertyFileSchema).min(1),
  category: z.enum(["image", "video", "audio"]).optional(),
});

/** Zod schema for a service definition entry in the ERC-8004 services array */
export const ServiceDefinitionSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  version: z.string().optional(),
  mcpTools: z.array(z.string()).optional(),
  mcpPrompts: z.array(z.string()).optional(),
  mcpResources: z.array(z.string()).optional(),
  a2aSkills: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  domains: z.array(z.string()).optional(),
});

/** Zod schema for a cross-chain registration entry */
export const RegistrationEntrySchema = z.object({
  agentId: z.union([z.string(), z.number()]),
  agentRegistry: z.string(),
});

/** Zod schema for supported trust mechanisms */
export const TrustMechanismSchema = z.enum(["reputation", "crypto-economic", "tee-attestation"]);

/** Zod schema for a complete ERC-8004 registration file */
export const RegistrationFileSchema = z.object({
  type: z.literal(ERC8004_TYPE),
  name: z.string().min(1),
  description: z.string().min(1),
  image: z.url(),
  properties: PropertiesSchema,
  external_url: z.url().optional(),
  services: z.array(ServiceDefinitionSchema).optional(),
  registrations: z.array(RegistrationEntrySchema).optional(),
  supportedTrust: z.array(TrustMechanismSchema).optional(),
  active: z.boolean().optional().default(true),
  x402Support: z.boolean().optional(),
});

// ============================================================================
// TypeScript Types
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

/** Service definition entry in the ERC-8004 services array */
export interface ServiceDefinition {
  name: string;
  endpoint: string;
  version?: string;
  mcpTools?: string[];
  mcpPrompts?: string[];
  mcpResources?: string[];
  a2aSkills?: string[];
  skills?: string[];
  domains?: string[];
}

/** @deprecated Use ServiceDefinition instead */
export type Endpoint = ServiceDefinition;

/** Cross-chain registration entry (ERC-8004) */
export interface RegistrationEntry {
  agentId: string | number;
  agentRegistry: string;
}

/** Trust mechanism type */
export type TrustMechanism = "reputation" | "crypto-economic" | "tee-attestation";

/** Valid trust model values */
export const VALID_TRUST_MODELS: readonly TrustMechanism[] = ["reputation", "crypto-economic", "tee-attestation"];

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
  /** Service definitions (A2A, MCP, agentWallet) - ERC-8004 "services" array */
  services?: ServiceDefinition[];
  /** Cross-chain registration entries */
  registrations?: RegistrationEntry[];
  /** Supported trust mechanisms */
  supportedTrust?: TrustMechanism[];
  /** Agent operational status */
  active?: boolean;
  /** Accepts x402 payments */
  x402Support?: boolean;
}

/** Input parameters for buildRegistrationFile */
export interface RegistrationFileParams {
  name: string;
  description: string;
  image: string;
  imageMimeType?: string;
  externalUrl?: string;
  services?: ServiceDefinition[];
  registrations?: RegistrationEntry[];
  supportedTrust?: TrustMechanism[];
  active?: boolean;
  x402Support?: boolean;
}

// ============================================================================
// Validation
// ============================================================================

/** A single validation issue with field path, message, and severity */
export interface ValidationError {
  field: string;
  message: string;
  severity: "error" | "warning";
}

/** Result of validating a registration file */
export interface ValidationResult {
  /** True if no errors (warnings are allowed) */
  ok: boolean;
  /** Structural errors that make the file invalid */
  errors: ValidationError[];
  /** Best-practice warnings (file is still valid) */
  warnings: ValidationError[];
}

/**
 * Validate an ERC-8004 registration file.
 *
 * Returns structural errors (from Zod schema) and best-practice warnings
 * (name length, description length, MCP/A2A URL validity).
 */
export function validateRegistrationFile(data: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationError[] = [];

  const result = RegistrationFileSchema.safeParse(data);

  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push({
        field: issue.path.join(".") || "root",
        message: issue.message,
        severity: "error",
      });
    }
    return { ok: false, errors, warnings };
  }

  // Best-practice warnings on structurally valid data
  const file = result.data;

  if (file.name.length > 32) {
    warnings.push({
      field: "name",
      message: "Should be 32 characters or less (recommended)",
      severity: "warning",
    });
  }

  if (file.description.length < 10) {
    warnings.push({
      field: "description",
      message: "Should be at least 10 characters (explain what your agent does)",
      severity: "warning",
    });
  }

  if (file.services) {
    for (let i = 0; i < file.services.length; i++) {
      const svc = file.services[i];
      if (svc.name === "MCP" || svc.name === "A2A") {
        try {
          new URL(svc.endpoint);
        } catch {
          warnings.push({
            field: `services[${i}].endpoint`,
            message: `Should be a valid URL for ${svc.name} services`,
            severity: "warning",
          });
        }
      }
    }
  }

  return { ok: true, errors, warnings };
}

/**
 * Assert that data is a valid ERC-8004 registration file.
 * Throws with detailed error messages if invalid.
 */
export function assertRegistrationFile(data: unknown): asserts data is RegistrationFile {
  const result = validateRegistrationFile(data);
  if (!result.ok) {
    const message = result.errors.map((e) => `  ${e.field}: ${e.message}`).join("\n");
    throw new Error(`Invalid ERC-8004 registration file:\n${message}`);
  }
}

/**
 * Parse untrusted data as a registration file.
 * Returns the typed object on success, null on failure.
 */
export function parseRegistrationFile(data: unknown): RegistrationFile | null {
  const result = RegistrationFileSchema.safeParse(data);
  return result.success ? result.data : null;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize a registration file from known variant shapes to spec-compliant format.
 *
 * Handles known divergences:
 * - `endpoints` array -> `services` (agent0-sdk convention)
 * - Endpoint entries with `type`/`value` -> `name`/`endpoint` (agent0-sdk format)
 * - `x402support` (lowercase s) -> `x402Support` (spec uses capital S)
 * - `trustModels` -> `supportedTrust` (agent0-sdk convention)
 *
 * Returns a new object (no mutation). Does NOT validate.
 * Use `parseRegistrationFile(normalizeRegistrationFile(data))` for the full pipeline.
 */
export function normalizeRegistrationFile(data: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...data };

  // endpoints -> services (agent0-sdk uses "endpoints" instead of "services")
  if ("endpoints" in normalized && !("services" in normalized)) {
    const endpoints = normalized.endpoints;
    if (Array.isArray(endpoints)) {
      normalized.services = endpoints.map((ep: Record<string, unknown>) => {
        // agent0-sdk uses type/value, spec uses name/endpoint
        if ("type" in ep && "value" in ep && !("name" in ep) && !("endpoint" in ep)) {
          const { type: name, value: endpoint, meta, ...rest } = ep;
          return {
            name,
            endpoint,
            ...rest,
            ...(meta && typeof meta === "object" ? meta : {}),
          };
        }
        return ep;
      });
    }
    delete normalized.endpoints;
  }

  // x402support -> x402Support (agent0-sdk uses lowercase s)
  if ("x402support" in normalized && !("x402Support" in normalized)) {
    normalized.x402Support = normalized.x402support;
    delete normalized.x402support;
  }

  // trustModels -> supportedTrust (agent0-sdk uses "trustModels")
  if ("trustModels" in normalized && !("supportedTrust" in normalized)) {
    normalized.supportedTrust = normalized.trustModels;
    delete normalized.trustModels;
  }

  return normalized;
}

// ============================================================================
// Helper Functions
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
    type: ERC8004_TYPE,
    name: params.name,
    description: params.description,
    image: params.image,
    properties: {
      files: [{ uri: params.image, type: mimeType }],
      category: "image" as const,
    },
    ...(params.externalUrl && { external_url: params.externalUrl }),
    ...(params.services?.length && { services: params.services }),
    ...(params.registrations?.length && {
      registrations: params.registrations,
    }),
    ...(params.supportedTrust?.length && {
      supportedTrust: params.supportedTrust,
    }),
    active: params.active ?? true,
    ...(params.x402Support !== undefined && {
      x402Support: params.x402Support,
    }),
  };

  // Validate with Zod (throws on error)
  return RegistrationFileSchema.parse(file);
}

/**
 * Fetch and parse a registration file from URI.
 *
 * By default (tolerant mode):
 * - Returns raw data typed as RegistrationFile for non-conforming files
 * - Never throws, never logs to console
 *
 * With `opts.strict`:
 * - Returns null if the data fails Zod validation (no unsafe cast)
 */
export async function fetchRegistrationFile(
  uri: string,
  opts?: { strict?: boolean },
): Promise<RegistrationFile | null> {
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
      return null;
    }

    const data = await response.json();
    const result = RegistrationFileSchema.safeParse(data);

    if (!result.success) {
      if (opts?.strict) return null;
      // Tolerant mode: return raw data for backwards compatibility
      return data as RegistrationFile;
    }

    return result.data;
  } catch {
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

/** CAIP-2 chain identifier for Solana devnet */
export const SATI_CHAIN_ID_DEVNET = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";

/** CAIP-2 chain identifiers by network */
export const SATI_CHAIN_IDS = {
  mainnet: SATI_CHAIN_ID,
  devnet: SATI_CHAIN_ID_DEVNET,
} as const;

/** SATI program ID */
export const SATI_PROGRAM_ID = "satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe";

/**
 * Build a registrations[] entry for linking a SATI agent to an off-chain registration file.
 *
 * @param agentMint - SATI agent mint address
 * @param network - Network to use (defaults to "mainnet")
 * @returns RegistrationEntry for the registrations[] array
 *
 * @example
 * ```typescript
 * const entry = buildSatiRegistrationEntry("AgentMint...");
 * // { agentId: "AgentMint...", agentRegistry: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiRkxE..." }
 *
 * const devnetEntry = buildSatiRegistrationEntry("AgentMint...", "devnet");
 * // { agentId: "AgentMint...", agentRegistry: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:satiRkxE..." }
 * ```
 */
export function buildSatiRegistrationEntry(
  agentMint: string,
  network: "mainnet" | "devnet" = "mainnet",
): RegistrationEntry {
  const chainId = SATI_CHAIN_IDS[network];
  return {
    agentId: agentMint,
    agentRegistry: `${chainId}:${SATI_PROGRAM_ID}`,
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
    file.registrations?.some((r) => typeof r.agentRegistry === "string" && isSatiAgentRegistry(r.agentRegistry)) ??
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
      ?.filter((r) => typeof r.agentRegistry === "string" && isSatiAgentRegistry(r.agentRegistry))
      .map((r) => String(r.agentId)) ?? []
  );
}

// ============================================================================
// CAIP Format Validation
// ============================================================================

/**
 * Validate a CAIP-10 agent registry string format.
 * Expected format: `{namespace}:{chainReference}:{registryAddress}`
 *
 * @example
 * ```typescript
 * isValidAgentRegistry("eip155:1:0x742...") // true
 * isValidAgentRegistry("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiRkxE...") // true
 * isValidAgentRegistry("invalid") // false
 * ```
 */
export function isValidAgentRegistry(registry: string): boolean {
  if (typeof registry !== "string") return false;
  const parts = registry.split(":");
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

/**
 * Check if an agent registry string is a SATI registry (any network).
 *
 * @example
 * ```typescript
 * isSatiAgentRegistry("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:satiRkxE...") // true (mainnet)
 * isSatiAgentRegistry("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:satiRkxE...") // true (devnet)
 * isSatiAgentRegistry("eip155:1:0x742...") // false
 * ```
 */
export function isSatiAgentRegistry(registry: string): boolean {
  if (!isValidAgentRegistry(registry)) return false;
  if (!registry.startsWith(SATI_CHAIN_ID) && !registry.startsWith(SATI_CHAIN_ID_DEVNET)) return false;
  const programAddress = registry.split(":")[2];
  return programAddress === SATI_PROGRAM_ADDRESS;
}
