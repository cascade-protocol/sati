/**
 * Transaction error handling utilities.
 *
 * Converts raw Solana/Light Protocol errors into structured results
 * with user-friendly messages.
 *
 * Follows the same pattern as cascade-splits/splits-sdk.
 */

import {
  duplicateAttestationMessage,
  walletRejectedMessage,
  walletDisconnectedMessage,
  networkErrorMessage,
  transactionExpiredMessage,
  transactionFailedMessage,
} from "./messages.js";

/** Reason why a transaction failed */
export type FailedReason =
  | "duplicate_attestation"
  | "wallet_rejected"
  | "wallet_disconnected"
  | "network_error"
  | "transaction_expired"
  | "program_error";

/** Result when a transaction fails */
export interface FailedResult {
  status: "failed";
  reason: FailedReason;
  message: string;
  error?: Error;
}

/** Check if error is Light Protocol duplicate leaf (9002 / 0x232a) */
function isDuplicateLeafError(error: unknown): boolean {
  const str = String(error);
  return str.includes("9002") || str.includes("0x232a");
}

/** Check if error is wallet rejection */
function isWalletRejectedError(error: unknown): boolean {
  const str = String(error);
  return str.includes("User rejected") || str.includes("user rejected") || str.includes("rejected the request");
}

/** Check if error is wallet disconnected */
function isWalletDisconnectedError(error: unknown): boolean {
  const str = String(error);
  return str.includes("disconnected") || str.includes("not connected");
}

/** Check if error is network related */
function isNetworkError(error: unknown): boolean {
  const str = String(error);
  return (
    str.includes("network") || str.includes("fetch") || str.includes("ECONNREFUSED") || str.includes("Failed to fetch")
  );
}

/** Check if error is transaction expiration */
function isTransactionExpiredError(error: unknown): boolean {
  const str = String(error);
  return str.includes("expired") || str.includes("blockhash not found");
}

/**
 * Convert a raw transaction error into a structured FailedResult.
 *
 * Use this when catching errors from transaction submission or RPC calls.
 * Returns a result object with a user-friendly message and typed reason.
 *
 * @example
 * ```typescript
 * try {
 *   await sati.createFeedback(...);
 * } catch (error) {
 *   const result = handleTransactionError(error);
 *   if (result.reason === "duplicate_attestation") {
 *     // Show "already submitted" message
 *   }
 *   toast.error(result.message);
 * }
 * ```
 */
export function handleTransactionError(error: unknown): FailedResult {
  const wrappedError = error instanceof Error ? error : new Error(String(error));

  // Check specific error types in order of likelihood
  if (isDuplicateLeafError(error)) {
    return {
      status: "failed",
      reason: "duplicate_attestation",
      message: duplicateAttestationMessage(),
      error: wrappedError,
    };
  }

  if (isWalletRejectedError(error)) {
    return {
      status: "failed",
      reason: "wallet_rejected",
      message: walletRejectedMessage(),
      error: wrappedError,
    };
  }

  if (isWalletDisconnectedError(error)) {
    return {
      status: "failed",
      reason: "wallet_disconnected",
      message: walletDisconnectedMessage(),
      error: wrappedError,
    };
  }

  if (isNetworkError(error)) {
    return {
      status: "failed",
      reason: "network_error",
      message: networkErrorMessage(),
      error: wrappedError,
    };
  }

  if (isTransactionExpiredError(error)) {
    return {
      status: "failed",
      reason: "transaction_expired",
      message: transactionExpiredMessage(),
      error: wrappedError,
    };
  }

  // Default: generic program error
  return {
    status: "failed",
    reason: "program_error",
    message: transactionFailedMessage(wrappedError.message),
    error: wrappedError,
  };
}
