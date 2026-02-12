/**
 * Typed error classes for the SATI Agent0 SDK.
 *
 * All errors extend `SatiError` which carries a `code` string for
 * programmatic matching. Use `instanceof` for typed catch handling.
 */

/**
 * Base error for all SATI SDK errors.
 */
export class SatiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SatiError";
  }
}

/**
 * Agent not found on-chain.
 */
export class AgentNotFoundError extends SatiError {
  constructor(agentId: string) {
    super("AGENT_NOT_FOUND", `Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

/**
 * SDK is in read-only mode (no signer or transactionSender configured).
 */
export class ReadOnlyError extends SatiError {
  constructor(operation?: string) {
    const msg = operation
      ? `${operation} requires a signer or transactionSender. Initialize SatiSDK with one for write operations.`
      : "This operation requires a signer or transactionSender. Initialize SatiSDK with one for write operations.";
    super("READ_ONLY", msg);
    this.name = "ReadOnlyError";
  }
}

/**
 * Operation requires a KeyPairSigner specifically (not just any write access).
 */
export class SignerRequiredError extends SatiError {
  constructor(operation?: string) {
    const msg = operation
      ? `${operation} requires a KeyPairSigner. Initialize SatiSDK with a signer for server-side write operations.`
      : "This operation requires a KeyPairSigner. Initialize SatiSDK with a signer for server-side write operations.";
    super("SIGNER_REQUIRED", msg);
    this.name = "SignerRequiredError";
  }
}

/**
 * Required SAS schema is not deployed on the configured network.
 */
export class SchemaNotDeployedError extends SatiError {
  constructor(schema: string, network?: string) {
    const msg = network
      ? `${schema} schema not deployed on ${network}. Deploy schemas first.`
      : `${schema} schema not deployed on this network. Deploy schemas first.`;
    super("SCHEMA_NOT_DEPLOYED", msg);
    this.name = "SchemaNotDeployedError";
  }
}

/**
 * Invalid SATI agent ID format. Expected `solana:<chainRef>:<mintAddress>`.
 */
export class InvalidAgentIdError extends SatiError {
  constructor(agentId: string) {
    super("INVALID_AGENT_ID", `Invalid SATI agent ID: ${agentId}. Expected format: solana:<chainRef>:<mintAddress>`);
    this.name = "InvalidAgentIdError";
  }
}

/**
 * Operation is not supported on SATI.
 */
export class UnsupportedOperationError extends SatiError {
  constructor(operation: string) {
    super("UNSUPPORTED_OPERATION", `${operation} is not supported on SATI`);
    this.name = "UnsupportedOperationError";
  }
}
