/**
 * Off-chain message signing utilities for SATI attestations.
 *
 * Creates human-readable messages for wallet signing that work with
 * Phantom, Backpack, and other Solana wallets.
 *
 * The signature is over the UTF-8 encoded message text, which is then
 * verified on-chain via Ed25519 precompile.
 */

import type { Outcome } from "./schemas";

/**
 * Outcome labels for human-readable message display.
 */
const OUTCOME_LABELS: Record<Outcome, string> = {
  0: "Negative",
  1: "Neutral",
  2: "Positive",
};

/**
 * Convert bytes to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Result of building a feedback signing message.
 */
export interface FeedbackSigningMessage {
  /** The UTF-8 encoded message bytes to be signed */
  messageBytes: Uint8Array;
  /** The human-readable message text */
  text: string;
}

/**
 * Build a human-readable message for feedback attestation signing.
 *
 * Creates a UTF-8 encoded message that Phantom and other wallets will
 * display and allow signing. The signature can be verified on-chain
 * via Ed25519 precompile against the same message bytes.
 *
 * @param feedbackHash - The 32-byte feedback hash computed by computeFeedbackHash
 * @param outcome - The feedback outcome (Negative=0, Neutral=1, Positive=2)
 * @returns The message text and its UTF-8 encoded bytes for signing
 *
 * @example
 * ```typescript
 * import { buildFeedbackSigningMessage, computeFeedbackHash } from "@cascade-fyi/sati-sdk";
 *
 * // Compute the feedback hash
 * const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);
 *
 * // Build the signing message
 * const { messageBytes } = buildFeedbackSigningMessage(feedbackHash, outcome);
 *
 * // Sign with wallet (Phantom will display the human-readable text)
 * const signature = await wallet.signMessage(messageBytes);
 * ```
 */
export function buildFeedbackSigningMessage(
  feedbackHash: Uint8Array,
  outcome: Outcome,
): FeedbackSigningMessage {
  if (feedbackHash.length !== 32) {
    throw new Error("feedbackHash must be 32 bytes");
  }
  if (outcome < 0 || outcome > 2) {
    throw new Error("outcome must be 0, 1, or 2");
  }

  const hexHash = bytesToHex(feedbackHash);
  const outcomeLabel = OUTCOME_LABELS[outcome];

  // Compact human-readable message that Phantom will display
  // Uses same domain format as hashes.ts for consistency
  const text = `SATI:feedback:v1
Outcome: ${outcomeLabel}
0x${hexHash}`;

  // Encode as UTF-8 bytes for signing
  const messageBytes = new TextEncoder().encode(text);

  return {
    messageBytes,
    text,
  };
}
