/**
 * Address Lookup Table Helpers for SATI Tests
 *
 * Creates and manages address lookup tables for transaction compression.
 * Light Protocol transactions exceed the 1232-byte limit without ALT compression.
 *
 * Uses @solana/web3.js for compatibility with Light test validator (no WebSocket).
 */

import {
  Connection,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  type Keypair,
} from "@solana/web3.js";
import { address, type Address } from "@solana/kit";
import type { SATI } from "../../src";

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
 *
 * @param sati - SATI client instance
 * @param payer - Transaction fee payer keypair (must have SOL)
 * @param rpcUrl - Optional RPC URL (defaults to localnet)
 * @returns Created lookup table address and signature
 *
 * @example
 * ```typescript
 * const { address: lookupTableAddress } = await createSatiLookupTable(sati, payerKeypair);
 *
 * // Use in createFeedback
 * await sati.createFeedback({ ...params, lookupTableAddress });
 * ```
 */
export async function createSatiLookupTable(
  sati: SATI,
  payer: Keypair,
  rpcUrl = "http://127.0.0.1:8899",
): Promise<CreateLookupTableResult> {
  const connection = new Connection(rpcUrl, "confirmed");

  // Get addresses to include in lookup table (do this first, before fetching slot)
  const light = await sati.getLightClient();
  const addresses = await light.getLookupTableAddresses();

  // Get current slot for lookup table creation
  const slot = await connection.getSlot("finalized");

  // Create lookup table instruction
  const [createIx, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: slot,
    });

  // Extend lookup table with addresses (max 30 per instruction)
  const extendInstructions = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    extendInstructions.push(
      AddressLookupTableProgram.extendLookupTable({
        lookupTable: lookupTableAddress,
        authority: payer.publicKey,
        payer: payer.publicKey,
        addresses: chunk,
      }),
    );
  }

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const messageV0 = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx, ...extendInstructions],
  }).compileToV0Message();

  const tx = new VersionedTransaction(messageV0);
  tx.sign([payer]);

  // Send and confirm with HTTP polling (no WebSocket needed)
  const signature = await connection.sendTransaction(tx);
  await confirmTransaction(connection, signature, lastValidBlockHeight);

  // Wait for lookup table to be active (needs 1 slot)
  await waitForLookupTableActive(connection, lookupTableAddress);

  return {
    address: address(lookupTableAddress.toBase58()),
    signature,
  };
}

/**
 * Confirm a transaction using HTTP polling.
 * More reliable than WebSocket subscriptions for local test validators.
 */
async function confirmTransaction(
  connection: Connection,
  signature: string,
  lastValidBlockHeight: number,
  maxAttempts = 30,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await connection.getSignatureStatuses([signature]);
    if (status.value[0]?.confirmationStatus === "confirmed") {
      return;
    }

    // Check if blockhash expired
    const currentHeight = await connection.getBlockHeight();
    if (currentHeight > lastValidBlockHeight) {
      throw new Error(`Transaction ${signature} expired`);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Transaction ${signature} confirmation timed out after ${maxAttempts} attempts`,
  );
}

/**
 * Wait for a lookup table to become active.
 *
 * Address lookup tables require one slot to become active after creation.
 * This function polls until the table is available.
 */
async function waitForLookupTableActive(
  connection: Connection,
  lookupTableAddress: import("@solana/web3.js").PublicKey,
  maxAttempts = 10,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const lutAccount =
        await connection.getAddressLookupTable(lookupTableAddress);
      if (lutAccount.value) {
        return; // Table is active
      }
    } catch {
      // Table not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Lookup table ${lookupTableAddress.toBase58()} did not become active after ${maxAttempts} attempts`,
  );
}
