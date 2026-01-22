/**
 * SATI SDK Error Types
 *
 * Follows the same pattern as cascade-splits/splits-sdk for consistency.
 */

/** All possible SDK error codes */
export type SatiErrorCode =
  | "DUPLICATE_ATTESTATION"
  | "AGENT_NOT_FOUND"
  | "SCHEMA_NOT_FOUND"
  | "INVALID_SIGNATURE"
  | "TRANSACTION_FAILED"
  | "WALLET_REJECTED"
  | "WALLET_DISCONNECTED"
  | "NETWORK_ERROR"
  | "TRANSACTION_EXPIRED";

/** Base class for all SATI SDK errors */
export class SatiError extends Error {
  constructor(
    message: string,
    public readonly code: SatiErrorCode,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SatiError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when attempting to create an attestation that already exists.
 * This occurs when the same (schema, agent, taskRef, dataHash) combination
 * is submitted twice.
 *
 * Light Protocol error: 9002 (0x232a)
 */
export class DuplicateAttestationError extends SatiError {
  constructor(options?: ErrorOptions) {
    super("An attestation with these parameters already exists", "DUPLICATE_ATTESTATION", options);
    this.name = "DuplicateAttestationError";
  }
}

/** Agent mint is not a registered SATI agent */
export class AgentNotFoundError extends SatiError {
  constructor(
    public readonly agentMint: string,
    options?: ErrorOptions,
  ) {
    super(`Agent not found: ${agentMint}`, "AGENT_NOT_FOUND", options);
    this.name = "AgentNotFoundError";
  }
}

/** Schema not found or not initialized */
export class SchemaNotFoundError extends SatiError {
  constructor(
    public readonly schema: string,
    options?: ErrorOptions,
  ) {
    super(`Schema not found: ${schema}`, "SCHEMA_NOT_FOUND", options);
    this.name = "SchemaNotFoundError";
  }
}

// Light Protocol error codes
export const LIGHT_ERROR_CODES = {
  DUPLICATE_LEAF: 9002, // 0x232a
} as const;
