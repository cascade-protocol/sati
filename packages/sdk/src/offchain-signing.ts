/**
 * Off-chain message signing utilities for SATI attestations.
 *
 * Creates human-readable messages for wallet signing that work with
 * Phantom, Backpack, and other Solana wallets.
 *
 * The signature is over the UTF-8 encoded message text, which is then
 * verified on-chain via Ed25519 precompile.
 *
 * ## Identity Model
 * The NFT **OWNER** signs these messages (not the mint). The hash includes
 * the mint address for identity binding, but authorization is verified
 * via ATA ownership on-chain.
 *
 * ## Message Format (SIWS-Inspired)
 * Messages follow Sign-In With Solana (SIWS) patterns with CAIP-10 agent
 * identifiers for cross-chain compatibility.
 */

import type { Address } from "@solana/kit";
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
 * Solana network type for CAIP-2 chain references.
 */
export type SolanaNetwork = "mainnet" | "devnet" | "localnet";

/**
 * CAIP-2 chain references for Solana networks.
 * These are the first 32 characters of each network's genesis block hash (base58).
 *
 * @see https://namespaces.chainagnostic.org/solana/caip2
 */
export const SOLANA_CHAIN_REFS: Record<SolanaNetwork, string> = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  localnet: "localnet",
} as const;

/**
 * Default domain for SATI attestation messages.
 */
const SATI_DOMAIN = "sati.fyi";

/**
 * Format an address as CAIP-10 identifier.
 *
 * @param address - Solana address (base58)
 * @param network - Solana network (defaults to mainnet)
 * @returns CAIP-10 formatted string: `solana:{chain_ref}:{address}`
 *
 * @example
 * ```typescript
 * formatCaip10("7S3P4HxJpyy...", "mainnet")
 * // => "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:7S3P4HxJpyy..."
 * ```
 */
export function formatCaip10(address: Address, network: SolanaNetwork = "mainnet"): string {
  return `solana:${SOLANA_CHAIN_REFS[network]}:${address}`;
}

/**
 * Convert bytes to hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Result of building a signing message.
 */
export interface SigningMessage {
  /** The UTF-8 encoded message bytes to be signed */
  messageBytes: Uint8Array;
  /** The human-readable message text */
  text: string;
}

/**
 * @deprecated Use SigningMessage instead
 */
export type FeedbackSigningMessage = SigningMessage;

/**
 * Parameters for building a feedback signing message (SIWS-style).
 */
export interface FeedbackSigningParams {
  /** The 32-byte feedback hash computed by computeFeedbackHash */
  feedbackHash: Uint8Array;
  /** The feedback outcome (Negative=0, Neutral=1, Positive=2) */
  outcome: Outcome;
  /** The signer's wallet address (NFT owner) */
  ownerAddress: Address;
  /** The agent's mint address (for CAIP-10 identifier) */
  agentMint: Address;
  /** Solana network for CAIP-2 chain reference (defaults to mainnet) */
  network?: SolanaNetwork;
}

/**
 * Build a human-readable message for feedback attestation signing.
 *
 * Creates a UTF-8 encoded message that Phantom and other wallets will
 * display and allow signing. The signature can be verified on-chain
 * via Ed25519 precompile against the same message bytes.
 *
 * ## SIWS-Style Format (recommended)
 * Pass a FeedbackSigningParams object to get the full SIWS-style message
 * with CAIP-10 agent identifier:
 *
 * ```
 * sati.fyi wants you to attest with your Solana account:
 * {owner_address}
 *
 * Attestation: Feedback
 * Agent: solana:{chain_ref}:{agent_mint}
 * Outcome: Positive
 * Hash: 0x{hash}
 * ```
 *
 * ## Legacy Format (deprecated)
 * Pass (feedbackHash, outcome) directly for the compact format:
 *
 * ```
 * SATI:feedback:v1
 * Outcome: Positive
 * 0x{hash}
 * ```
 *
 * @example
 * ```typescript
 * import { buildFeedbackSigningMessage, computeFeedbackHash } from "@cascade-fyi/sati-sdk";
 *
 * // Compute the feedback hash
 * const feedbackHash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);
 *
 * // SIWS-style (recommended)
 * const { messageBytes } = buildFeedbackSigningMessage({
 *   feedbackHash,
 *   outcome,
 *   ownerAddress: wallet.publicKey,
 *   agentMint: tokenAccount,
 *   network: "mainnet",
 * });
 *
 * // Sign with wallet (Phantom will display the human-readable text)
 * const signature = await wallet.signMessage(messageBytes);
 * ```
 */
export function buildFeedbackSigningMessage(params: FeedbackSigningParams): SigningMessage;
/**
 * @deprecated Use the params object signature instead for SIWS-style messages
 */
export function buildFeedbackSigningMessage(feedbackHash: Uint8Array, outcome: Outcome): SigningMessage;
export function buildFeedbackSigningMessage(
  paramsOrHash: FeedbackSigningParams | Uint8Array,
  outcomeArg?: Outcome,
): SigningMessage {
  // Handle legacy signature: (feedbackHash, outcome)
  if (paramsOrHash instanceof Uint8Array) {
    const feedbackHash = paramsOrHash;
    const outcome = outcomeArg as Outcome;

    if (feedbackHash.length !== 32) {
      throw new Error("feedbackHash must be 32 bytes");
    }
    if (outcome < 0 || outcome > 2) {
      throw new Error("outcome must be 0, 1, or 2");
    }

    const hexHash = bytesToHex(feedbackHash);
    const outcomeLabel = OUTCOME_LABELS[outcome];

    // Legacy compact format
    const text = `SATI:feedback:v1
Outcome: ${outcomeLabel}
0x${hexHash}`;

    return {
      messageBytes: new TextEncoder().encode(text),
      text,
    };
  }

  // SIWS-style params signature
  const { feedbackHash, outcome, ownerAddress, agentMint, network = "mainnet" } = paramsOrHash;

  if (feedbackHash.length !== 32) {
    throw new Error("feedbackHash must be 32 bytes");
  }
  if (outcome < 0 || outcome > 2) {
    throw new Error("outcome must be 0, 1, or 2");
  }

  const hexHash = bytesToHex(feedbackHash);
  const outcomeLabel = OUTCOME_LABELS[outcome];
  const agentCaip10 = formatCaip10(agentMint, network);

  // SIWS-inspired human-readable message
  const text = `${SATI_DOMAIN} wants you to attest with your Solana account:
${ownerAddress}

Attestation: Feedback
Agent: ${agentCaip10}
Outcome: ${outcomeLabel}
Hash: 0x${hexHash}`;

  return {
    messageBytes: new TextEncoder().encode(text),
    text,
  };
}
