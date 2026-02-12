/**
 * Solana transaction handle - pattern-compatible with agent0-sdk's TransactionHandle.
 *
 * Key differences from agent0-sdk's TransactionHandle:
 * - `hash` is a base58 Solana signature (not EVM hex)
 * - `waitMined()`/`waitConfirmed()` resolve immediately since Solana's
 *   `sendAndConfirmTransaction` already waits for confirmation
 */

/**
 * Solana transaction receipt.
 */
export interface SolanaReceipt {
  /** Transaction signature (base58) */
  signature: string;
}

/**
 * Result from awaiting a Solana transaction.
 */
export interface SolanaTransactionResult<T> {
  receipt: SolanaReceipt;
  result: T;
}

/**
 * Solana-compatible transaction handle.
 *
 * Mirrors agent0-sdk's `TransactionHandle<T>` API shape:
 * - `.hash` - transaction identifier
 * - `.waitMined()` - await confirmation and get result
 * - `.waitConfirmed()` - alias for waitMined
 *
 * On Solana, transactions are already confirmed when the SDK returns,
 * so both methods resolve immediately with the pre-computed result.
 *
 * @example
 * ```typescript
 * const handle = await sdk.giveFeedback(agentId, 85, "quality");
 * const { result } = await handle.waitMined();
 * console.log(result.value); // 85
 * console.log(handle.hash);  // base58 signature
 * ```
 */
export class SolanaTransactionHandle<T> {
  /** Transaction signature (base58). Named `hash` for agent0-sdk compatibility. */
  readonly hash: string;

  constructor(
    signature: string,
    private readonly _result: T,
  ) {
    this.hash = signature;
  }

  /** Resolves immediately - Solana txs are confirmed before the SDK returns. */
  async waitMined(): Promise<SolanaTransactionResult<T>> {
    return { receipt: { signature: this.hash }, result: this._result };
  }

  /** Alias for waitMined. */
  async waitConfirmed(): Promise<SolanaTransactionResult<T>> {
    return this.waitMined();
  }
}
