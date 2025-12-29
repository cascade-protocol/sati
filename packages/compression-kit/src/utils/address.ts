/**
 * Address derivation utilities for Light Protocol.
 *
 * Light Protocol uses a custom address derivation scheme that produces
 * addresses within the BN254 field for ZK circuit compatibility.
 */

import { address, type Address, getAddressEncoder } from "@solana/kit";
import bs58 from "bs58";
import { defaultTestStateTreeAccounts } from "../constants.js";
import {
  hashvToBn254FieldSizeBe,
  hashvToBn254FieldSizeBeWithBump,
  hashToBn254FieldSizeBe,
  mergeBytes,
} from "./conversion.js";
import type { NewAddressParams, NewAddressParamsPacked } from "../state/types.js";

// =============================================================================
// Address Derivation
// =============================================================================

/**
 * Derive an address seed from seeds and program ID.
 *
 * This combines the program ID with user-provided seeds and hashes
 * them to produce a 32-byte seed suitable for address derivation.
 *
 * @param seeds - User-provided seed bytes
 * @param programId - The program ID that "owns" this address
 * @returns 32-byte address seed
 */
export function deriveAddressSeed(seeds: Uint8Array[], programId: Address): Uint8Array {
  const encoder = getAddressEncoder();
  const programIdBytes = Uint8Array.from(encoder.encode(programId));
  const combinedSeeds: Uint8Array[] = [programIdBytes, ...seeds];
  return hashvToBn254FieldSizeBe(combinedSeeds);
}

/**
 * Derive a compressed account address from a seed and address tree.
 *
 * @param seed - 32-byte seed (typically from deriveAddressSeed)
 * @param addressMerkleTreePubkey - The address tree to derive from
 * @returns Derived address as a Solana Address
 *
 * @example
 * ```typescript
 * import { deriveAddressSeed, deriveAddress } from '@cascade-fyi/compression-kit';
 * import { address } from '@solana/kit';
 *
 * const programId = address('YourProgramId...');
 * const seed = deriveAddressSeed([new TextEncoder().encode('my-seed')], programId);
 * const compressedAddress = deriveAddress(seed);
 * ```
 */
export function deriveAddress(seed: Uint8Array, addressMerkleTreePubkey?: Address): Address {
  if (seed.length !== 32) {
    throw new Error("Seed length must be 32 bytes");
  }

  const treePubkey = addressMerkleTreePubkey ?? defaultTestStateTreeAccounts().addressTree;
  const encoder = getAddressEncoder();
  const treeBytes = Uint8Array.from(encoder.encode(treePubkey));

  const combined = mergeBytes([treeBytes, seed]);
  const hashResult = hashToBn254FieldSizeBe(combined);

  if (hashResult === null) {
    throw new Error("DeriveAddressError: Failed to find valid bump seed");
  }

  const [hash] = hashResult;
  return address(bs58.encode(hash));
}

/**
 * Derive address seed using V2 method (no program ID in combined seeds).
 *
 * @param seeds - Seeds to hash together
 * @returns 32-byte address seed
 */
export function deriveAddressSeedV2(seeds: Uint8Array[]): Uint8Array {
  return hashvToBn254FieldSizeBeWithBump(seeds);
}

/**
 * Derive address using V2 method (matches Rust derive_address_from_seed).
 *
 * @param addressSeed - 32-byte address seed
 * @param addressMerkleTreePubkey - Address tree pubkey
 * @param programId - Program ID
 * @returns Derived address
 */
export function deriveAddressV2(
  addressSeed: Uint8Array,
  addressMerkleTreePubkey: Address,
  programId: Address,
): Address {
  if (addressSeed.length !== 32) {
    throw new Error("Address seed length must be 32 bytes");
  }

  const encoder = getAddressEncoder();
  const merkleTreeBytes = Uint8Array.from(encoder.encode(addressMerkleTreePubkey));
  const programIdBytes = Uint8Array.from(encoder.encode(programId));

  // Match Rust: hash [seed, merkle_tree_pubkey, program_id]
  const combined: Uint8Array[] = [addressSeed, merkleTreeBytes, programIdBytes];
  const hash = hashvToBn254FieldSizeBeWithBump(combined);

  return address(bs58.encode(hash));
}

// =============================================================================
// Address Packing for Instructions
// =============================================================================

/**
 * Get the index of an address in an array, adding it if not present.
 */
export function getIndexOrAdd(accounts: Address[], pubkey: Address): number {
  const existingIndex = accounts.indexOf(pubkey);
  if (existingIndex !== -1) {
    return existingIndex;
  }
  accounts.push(pubkey);
  return accounts.length - 1;
}

/**
 * Pack new address params for instruction data.
 *
 * Converts NewAddressParams to NewAddressParamsPacked by replacing
 * pubkeys with their indices in the remaining accounts array.
 *
 * @param newAddressParams - Array of new address parameters
 * @param remainingAccounts - Existing remaining accounts (will be modified)
 * @returns Packed params and updated remaining accounts
 */
export function packNewAddressParams(
  newAddressParams: NewAddressParams[],
  remainingAccounts: Address[],
): {
  newAddressParamsPacked: NewAddressParamsPacked[];
  remainingAccounts: Address[];
} {
  const accounts = [...remainingAccounts];

  const newAddressParamsPacked: NewAddressParamsPacked[] = newAddressParams.map((params) => ({
    seed: params.seed,
    addressMerkleTreeRootIndex: params.addressMerkleTreeRootIndex,
    addressMerkleTreeAccountIndex: 0, // Will be assigned below
    addressQueueAccountIndex: 0, // Will be assigned below
  }));

  // Assign tree indices
  for (let i = 0; i < newAddressParams.length; i++) {
    newAddressParamsPacked[i].addressMerkleTreeAccountIndex = getIndexOrAdd(
      accounts,
      newAddressParams[i].addressMerkleTreePubkey,
    );
  }

  // Assign queue indices
  for (let i = 0; i < newAddressParams.length; i++) {
    newAddressParamsPacked[i].addressQueueAccountIndex = getIndexOrAdd(
      accounts,
      newAddressParams[i].addressQueuePubkey,
    );
  }

  return { newAddressParamsPacked, remainingAccounts: accounts };
}

// =============================================================================
// Address Utilities
// =============================================================================

/**
 * Convert an address to bytes.
 */
export function addressToBytes(addr: Address): Uint8Array {
  const encoder = getAddressEncoder();
  return Uint8Array.from(encoder.encode(addr));
}

/**
 * Convert bytes to an address.
 *
 * Note: This performs base58 encoding on the bytes. The bytes should
 * be a valid 32-byte representation of an address.
 */
export function bytesToAddress(bytes: Uint8Array): Address {
  if (bytes.length !== 32) {
    throw new Error("Address must be 32 bytes");
  }
  return address(bs58.encode(bytes));
}
