/**
 * User-facing error messages.
 *
 * Separated for reusability and potential i18n.
 * Follows the same pattern as cascade-splits/splits-sdk.
 */

export function duplicateAttestationMessage(): string {
  return "You've already submitted feedback for this interaction. Each interaction can only be attested once.";
}

export function walletRejectedMessage(): string {
  return "Transaction was rejected by your wallet.";
}

export function walletDisconnectedMessage(): string {
  return "Wallet disconnected. Please reconnect and try again.";
}

export function networkErrorMessage(): string {
  return "Network error. Please check your connection and try again.";
}

export function transactionExpiredMessage(): string {
  return "Transaction expired. Please try again.";
}

export function transactionFailedMessage(detail?: string): string {
  return detail ? `Transaction failed: ${detail}` : "Transaction failed. Please try again.";
}
