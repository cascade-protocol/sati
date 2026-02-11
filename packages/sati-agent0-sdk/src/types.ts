/**
 * SATI-specific configuration types for the agent0 adapter.
 *
 * All agent0-compatible types (AgentSummary, Feedback, RegistrationFile, etc.)
 * are imported directly from `agent0-sdk` - we do not redefine them here.
 */

import type { KeyPairSigner, Instruction, Address as SolAddress } from "@solana/kit";
import type { SearchOptions, FeedbackSearchOptions } from "agent0-sdk";
import type { Outcome, ContentType } from "@cascade-fyi/sati-sdk";

/**
 * Generic transaction sender for browser wallets.
 *
 * Implement this interface to plug any Solana wallet (Phantom, Solflare, etc.)
 * into the SDK. The dashboard wraps `solanaClient.helpers.transaction.prepareAndSend()`
 * to implement this.
 *
 * @example
 * ```typescript
 * const sender: SatiTransactionSender = {
 *   address: session.account.address,
 *   async signAndSend(instructions, additionalSigners) {
 *     const sig = await solanaClient.helpers.transaction.prepareAndSend({
 *       authority: session,
 *       instructions,
 *       signers: additionalSigners,
 *       commitment: "confirmed",
 *     });
 *     return sig.toString();
 *   },
 * };
 * ```
 */
export interface SatiTransactionSender {
  /** Wallet's public address */
  readonly address: string;
  /**
   * Sign and send a transaction built from the given instructions.
   * @param instructions - Instructions to include in the transaction
   * @param additionalSigners - Extra keypairs that must also sign (e.g. new mint keypair for registration)
   * @returns Transaction signature string
   */
  signAndSend(instructions: Instruction[], additionalSigners?: KeyPairSigner[]): Promise<string>;
  /**
   * Sign an arbitrary message (for SIWS off-chain signing in feedback flows).
   * Optional - if not provided, direct `giveFeedback()` via sender throws.
   * Use `prepareFeedback()` / `submitPreparedFeedback()` as an alternative.
   */
  signMessage?(message: Uint8Array): Promise<Uint8Array>;
}

/**
 * Discriminated union returned by `_requireWriteAccess()`.
 */
export type WriteAccess =
  | { type: "keypair"; signer: KeyPairSigner }
  | { type: "sender"; sender: SatiTransactionSender };

/**
 * Configuration for the SATI Agent0 adapter SDK.
 *
 * Maps agent0-sdk's SDKConfig concept to SATI's Solana infrastructure.
 * Provide `signer` for headless/server mode, `transactionSender` for browser
 * wallet mode, or omit both for read-only mode.
 */
export interface SatiSDKConfig {
  /** SATI network to connect to */
  network: "mainnet" | "devnet" | "localnet";
  /** Solana keypair signer for headless/server write operations. */
  signer?: KeyPairSigner;
  /** Browser wallet transaction sender for client-side write operations. */
  transactionSender?: SatiTransactionSender;
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Pinata JWT for IPFS uploads (required for registerIPFS) */
  pinataJwt?: string;
  /** Optional callback for non-fatal warnings (RPC failures, transient errors). */
  onWarning?: (warning: SatiWarning) => void;
}

/**
 * Extended search options with SATI-specific features.
 */
export interface SatiSearchOptions extends SearchOptions {
  /**
   * Fetch feedbackCount + averageValue per agent.
   * Slower (extra RPC calls per agent) but enables feedback-based filtering and sorting.
   * Automatically enabled when `filters.feedback` is set.
   */
  includeFeedbackStats?: boolean;
}

/**
 * Extended feedback search options with SATI-specific features.
 */
export interface SatiFeedbackSearchOptions extends FeedbackSearchOptions {
  /**
   * Populate `txHash` on each Feedback result.
   * Expensive: 1 Photon RPC call per feedback. Off by default.
   */
  includeTxHash?: boolean;
}

/**
 * Prepared feedback data from `prepareFeedback()`.
 *
 * Contains everything needed for the browser wallet to sign (messageBytes)
 * and for `submitPreparedFeedback()` to build and submit the transaction.
 */
export interface PreparedFeedback {
  /** SIWS message bytes for the counterparty wallet to sign */
  messageBytes: Uint8Array;
  /** Agent mint address */
  agentMint: SolAddress;
  /** Counterparty (wallet) address */
  counterparty: SolAddress;
  /** Random task reference (32 bytes) */
  taskRef: Uint8Array;
  /** Zero data hash (32 bytes) */
  dataHash: Uint8Array;
  /** Outcome enum value */
  outcome: Outcome;
  /** Content type */
  contentType: ContentType;
  /** Serialized content bytes */
  content: Uint8Array;
  /** SAS schema address */
  sasSchema: SolAddress;
  /** Lookup table address */
  lookupTable?: SolAddress;
  /** Content metadata for building agent0 Feedback response */
  feedbackMeta: {
    value?: number;
    tag1?: string;
    tag2?: string;
    endpoint?: string;
    text?: string;
  };
}

/**
 * SATI-specific options for feedback creation.
 *
 * These extend agent0-sdk's `giveFeedback` / `prepareFeedback` with fields
 * that have no agent0 equivalent (outcome, deterministic task reference).
 *
 * When omitted, defaults match the original behavior:
 * - `outcome` defaults to `Neutral`
 * - `taskRef` defaults to random 32 bytes
 *
 * @example Governance attestation
 * ```typescript
 * import { Outcome } from "@cascade-fyi/sati-agent0-sdk";
 *
 * await sdk.giveFeedback(agentId, 85, "governance", "defi", undefined, {
 *   text: "Proposal increases emissions by 20%, net positive for growth",
 * }, {
 *   outcome: Outcome.Positive,   // For
 *   taskRef: proposalHashBytes,   // deterministic per proposal
 * });
 * ```
 */
export interface SatiFeedbackOptions {
  /** Attestation outcome. Default: Neutral. For governance: Negative=Against, Neutral=Abstain, Positive=For */
  outcome?: Outcome;
  /** Deterministic 32-byte task reference. Default: cryptographically random */
  taskRef?: Uint8Array;
}

/**
 * Non-fatal warning from SDK operations.
 *
 * Reported via `SatiSDKConfig.onWarning` callback. Parse errors on untrusted
 * on-chain data are silently skipped (noise). RPC/infrastructure errors are
 * reported so consumers can wire into telemetry (Sentry, PostHog, etc.).
 */
export interface SatiWarning {
  code: "PARSE_ERROR" | "RPC_ERROR" | "SIGNATURE_LOOKUP_FAILED";
  message: string;
  context?: string;
  cause?: unknown;
}

/**
 * Validation attestation result from `searchValidations()`.
 */
export interface ValidationResult {
  /** On-chain outcome (0=Negative, 2=Positive) */
  outcome: number;
  /** Agent mint address */
  agentMint: string;
  /** Validator/counterparty address */
  counterparty: string;
  /** Unix timestamp (computed from slot) */
  createdAt: number;
  /** Compressed account address (for tx lookup) */
  compressedAddress: string;
}
