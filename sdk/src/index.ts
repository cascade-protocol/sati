/**
 * SATI SDK - Solana Agent Trust Infrastructure
 *
 * TypeScript SDK for interacting with SATI v2:
 * - Registry: Agent identity registration via Token-2022 NFT
 * - SAS Schemas: Reputation and validation attestation schemas
 * - Client: High-level SATI class for convenient interaction
 *
 * @packageDocumentation
 */

// Generated Codama client (instructions, accounts, types, errors)
export * from "./generated";

// SAS schema definitions for reputation and validation
export * from "./schemas";

// SAS integration helpers
export * from "./sas";

// Utility helpers and PDA derivation
export * from "./helpers";

// Type definitions
export * from "./types";

// High-level client
export { SATI } from "./client";

// Re-export types for convenience
export type { Address } from "@solana/kit";
export { address } from "@solana/kit";
