/**
 * Off-chain message signing utilities for SATI attestations.
 *
 * Creates human-readable messages for wallet signing that work with
 * Phantom, Backpack, and other Solana wallets.
 *
 * The signature is over the UTF-8 encoded message text, which is then
 * verified on-chain via Ed25519 precompile.
 *
 * ## Signature Model (v2 Universal Layout)
 * - Agent signs: 32-byte interaction_hash (blind commitment)
 * - Counterparty signs: Human-readable SIWS message (~300 bytes)
 *
 * ## Message Format (SIWS-Inspired)
 * Counterparty messages follow Sign-In With Solana (SIWS) patterns:
 * ```
 * SATI {schema_name}
 *
 * Agent: {token_account}
 * Task: {task_ref}
 * Outcome: {Negative|Neutral|Positive}
 * Details: {content}
 *
 * Sign to create this attestation.
 * ```
 */

import type { Address } from "@solana/kit";
import { type Outcome, OFFSETS, ContentType, getOutcomeLabel } from "./schemas";

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

// Base58 alphabet for encoding
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode bytes to base58 string.
 */
function bytesToBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Count leading zeros
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }

  // Convert to big integer
  let num = BigInt(0);
  for (const b of bytes) {
    num = num * BigInt(256) + BigInt(b);
  }

  // Convert to base58
  let result = "";
  while (num > 0) {
    const remainder = Number(num % BigInt(58));
    result = BASE58_ALPHABET[remainder] + result;
    num = num / BigInt(58);
  }

  // Add leading '1's for each leading zero byte
  return "1".repeat(leadingZeros) + result;
}

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

// ============================================================================
// Counterparty Message Builder (v2 Universal Layout)
// ============================================================================

/**
 * Parameters for building a counterparty signing message.
 */
export interface CounterpartyMessageParams {
  /** Schema name (e.g., "Feedback", "Validation") */
  schemaName: string;
  /** The universal layout data bytes (130+ bytes) */
  data: Uint8Array;
}

/**
 * Build a human-readable SIWS message for counterparty signing.
 *
 * Creates a UTF-8 encoded message (~300 bytes) that Phantom and other wallets
 * will display and allow signing. The signature can be verified on-chain
 * via Ed25519 precompile against the same message bytes.
 *
 * ## Message Format
 * ```
 * SATI {schema_name}
 *
 * Agent: {token_account}
 * Task: {task_ref}
 * Outcome: {Negative|Neutral|Positive}
 * Details: {content}
 *
 * Sign to create this attestation.
 * ```
 *
 * @param params - Parameters containing schema name and data bytes
 * @returns SigningMessage with messageBytes and human-readable text
 *
 * @example
 * ```typescript
 * import { buildCounterpartyMessage, serializeFeedback } from "@cascade-fyi/sati-sdk";
 *
 * // Build attestation data
 * const data = serializeFeedback({
 *   taskRef: new Uint8Array(32),
 *   tokenAccount: agentMint,
 *   counterparty: clientAddress,
 *   outcome: Outcome.Positive,
 *   dataHash: dataHash,
 *   contentType: ContentType.JSON,
 *   content: new TextEncoder().encode('{"score": 95, "tags": ["fast"]}'),
 * });
 *
 * // Build counterparty message
 * const { messageBytes, text } = buildCounterpartyMessage({
 *   schemaName: "Feedback",
 *   data,
 * });
 *
 * // Sign with wallet (Phantom will display the human-readable text)
 * const signature = await wallet.signMessage(messageBytes);
 *
 * // Pass messageBytes to the createAttestation instruction as counterparty_message
 * ```
 */
export function buildCounterpartyMessage(params: CounterpartyMessageParams): SigningMessage {
  const { schemaName, data } = params;

  if (data.length < OFFSETS.CONTENT) {
    throw new Error(`Data too small (minimum ${OFFSETS.CONTENT} bytes, got ${data.length})`);
  }

  // Extract fields from universal layout
  const taskRef = data.slice(OFFSETS.TASK_REF, OFFSETS.TOKEN_ACCOUNT);
  const tokenAccount = data.slice(OFFSETS.TOKEN_ACCOUNT, OFFSETS.COUNTERPARTY);
  const outcome = data[OFFSETS.OUTCOME] as Outcome;
  const contentType = data[OFFSETS.CONTENT_TYPE] as ContentType;
  const content = data.slice(OFFSETS.CONTENT);

  // Validate outcome
  if (outcome > 2) {
    throw new Error(`Invalid outcome value: ${outcome} (must be 0, 1, or 2)`);
  }

  // Format addresses as base58
  const tokenAccountB58 = bytesToBase58(tokenAccount);
  const taskRefB58 = bytesToBase58(taskRef);

  // Decode content for display
  const outcomeLabel = getOutcomeLabel(outcome);
  const detailsText = decodeContentForDisplay(content, contentType);

  // Build SIWS-style message
  const text = `SATI ${schemaName}

Agent: ${tokenAccountB58}
Task: ${taskRefB58}
Outcome: ${outcomeLabel}
Details: ${detailsText}

Sign to create this attestation.`;

  return {
    messageBytes: new TextEncoder().encode(text),
    text,
  };
}

/**
 * Decode content bytes for human-readable display.
 */
function decodeContentForDisplay(content: Uint8Array, contentType: ContentType): string {
  if (content.length === 0) {
    return "(none)";
  }

  switch (contentType) {
    case ContentType.None:
      return "(none)";
    case ContentType.JSON:
    case ContentType.UTF8:
      try {
        return new TextDecoder().decode(content);
      } catch {
        return `(${content.length} bytes)`;
      }
    case ContentType.IPFS:
      return `ipfs://${bytesToBase58(content)}`;
    case ContentType.Arweave:
      return `ar://${bytesToBase58(content)}`;
    case ContentType.Encrypted:
      return "(encrypted)";
    default:
      return `(${content.length} bytes)`;
  }
}

// ============================================================================
// Legacy Message Builders (deprecated, but kept for backward compatibility)
// ============================================================================

/**
 * Parameters for building a feedback signing message (SIWS-style).
 * @deprecated Use buildCounterpartyMessage instead
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
 * @deprecated Use buildCounterpartyMessage instead. This function uses the legacy
 * hash-based signing format which has been replaced by SIWS messages in v2.
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
