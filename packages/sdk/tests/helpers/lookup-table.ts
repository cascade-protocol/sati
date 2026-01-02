/**
 * Address Lookup Table Helpers for SATI Tests
 *
 * Creates and manages address lookup tables for transaction compression.
 * Light Protocol transactions exceed the 1232-byte limit without ALT compression.
 *
 * @solana/kit native implementation.
 */

import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstruction,
  getExtendLookupTableInstruction,
  fetchAddressLookupTable,
} from "@solana-program/address-lookup-table";
import type { Sati } from "../../src";

// =============================================================================
// Types
// =============================================================================

export interface CreateLookupTableResult {
  /** Address of the created lookup table */
  address: Address;
  /** Transaction signature */
  signature: string;
}

// =============================================================================
// Lookup Table Creation
// =============================================================================

/** Agent ATA info for lookup table creation */
export interface AgentAtaInfo {
  /** Token mint address (agent identity) */
  mint: Address;
  /** Token account owner (agent signer) */
  owner: Address;
}

/**
 * Create an address lookup table for SATI transactions.
 *
 * This helper creates a lookup table containing all the static addresses
 * needed for Light Protocol compressed attestation transactions:
 * - Light Protocol system accounts
 * - SATI program
 * - Address tree accounts
 * - State tree accounts
 * - Ed25519 program
 * - System program
 * - SchemaConfig PDAs for provided schemas (CRITICAL for tx size!)
 * - Agent ATAs for provided agents (CRITICAL for tx size!)
 *
 * @param sati - SATI client instance
 * @param payer - Transaction fee payer signer (must have SOL)
 * @param schemaAddresses - Schema addresses to include their schemaConfigPdas (saves 32 bytes each)
 * @param agentAtas - Agent ATA info to include in lookup table (saves 32 bytes each)
 * @param rpcUrl - Optional RPC URL (defaults to localnet)
 * @returns Created lookup table address and signature
 *
 * @example
 * ```typescript
 * // Include schema PDAs and agent ATAs for transaction compression
 * const { address: lookupTableAddress } = await createSatiLookupTable(
 *   sati,
 *   payerSigner,
 *   [feedbackSchema],
 *   [{ mint: agentMint, owner: agentOwner }]
 * );
 *
 * // Use in createFeedback
 * await sati.createFeedback({ ...params, lookupTableAddress });
 * ```
 */
export async function createSatiLookupTable(
  sati: Sati,
  payer: KeyPairSigner,
  schemaAddresses: Address[] = [],
  agentAtas: AgentAtaInfo[] = [],
  rpcUrl = "http://127.0.0.1:8899",
  wsUrl = "ws://127.0.0.1:8900",
): Promise<CreateLookupTableResult> {
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);

  // Get addresses to include in lookup table (do this first, before fetching slot)
  // Includes Light Protocol addresses, SATI program/PDAs, Token-2022, and schema PDAs
  const light = await sati.getLightClient();
  const addresses = await light.getLookupTableAddresses(schemaAddresses, agentAtas);

  // Get current slot for lookup table creation
  const slot = await rpc.getSlot({ commitment: "finalized" }).send();

  // Derive lookup table PDA
  const [lookupTableAddress, bump] = await findAddressLookupTablePda({
    authority: payer.address,
    recentSlot: slot,
  });

  // Create lookup table instruction
  const createLutIx = getCreateLookupTableInstruction({
    address: [lookupTableAddress, bump],
    authority: payer,
    payer,
    recentSlot: slot,
  });

  // Build extend instructions (max 30 addresses per instruction)
  const extendIxs: ReturnType<typeof getExtendLookupTableInstruction>[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    extendIxs.push(
      getExtendLookupTableInstruction({
        address: lookupTableAddress,
        authority: payer,
        payer,
        addresses: chunk,
      }),
    );
  }

  const instructions = [createLutIx, ...extendIxs] as const;

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build transaction
  const txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(payer.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg),
  );

  // Sign transaction
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const signature = getSignatureFromTransaction(signedTx);

  // Send and confirm using factory (handles encoding correctly)
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  // Type assertion for transaction with blockhash lifetime
  type SignedBlockhashTransaction = typeof signedTx & {
    lifetimeConstraint: { lastValidBlockHeight: bigint; blockhash: string };
  };

  await sendAndConfirm(signedTx as SignedBlockhashTransaction, {
    commitment: "confirmed",
  });

  // Wait for lookup table to be active (needs 1 slot)
  await waitForLookupTableActive(rpc, lookupTableAddress);

  return {
    address: lookupTableAddress,
    signature,
  };
}

/**
 * Wait for a lookup table to become active.
 *
 * Address lookup tables require one slot to become active after creation.
 * This function polls until the table is available.
 */
async function waitForLookupTableActive(
  rpc: Parameters<typeof fetchAddressLookupTable>[0],
  lookupTableAddress: Address,
  maxAttempts = 10,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const lutAccount = await fetchAddressLookupTable(rpc, lookupTableAddress);
      if (lutAccount) {
        return; // Table is active
      }
    } catch {
      // Table not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Lookup table ${lookupTableAddress} did not become active after ${maxAttempts} attempts`);
}
