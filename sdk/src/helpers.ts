/**
 * SATI SDK Helpers
 *
 * Browser-compatible utility functions for PDA derivation and constants.
 * For @solana/web3.js compatibility, import from "@sati/sdk/web3-compat".
 */

import {
  address,
  type Address,
  getProgramDerivedAddress,
  getAddressEncoder,
} from "@solana/kit";
import { SATI_REGISTRY_PROGRAM_ADDRESS } from "./generated";

// Token-2022 and Associated Token Program addresses
export const TOKEN_2022_PROGRAM_ADDRESS = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
);
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

// ============================================================
// PDA Derivation Helpers
// ============================================================

/**
 * Derive the Registry Config PDA
 *
 * Seeds: ["registry"]
 */
export async function findRegistryConfigPda(): Promise<
  readonly [Address, number]
> {
  const encoder = new TextEncoder();
  return getProgramDerivedAddress({
    programAddress: SATI_REGISTRY_PROGRAM_ADDRESS,
    seeds: [encoder.encode("registry")],
  });
}

/**
 * Derive the Group Mint PDA (SATI collection)
 *
 * Seeds: ["group_mint"]
 */
export async function findGroupMintPda(): Promise<readonly [Address, number]> {
  const encoder = new TextEncoder();
  return getProgramDerivedAddress({
    programAddress: SATI_REGISTRY_PROGRAM_ADDRESS,
    seeds: [encoder.encode("group_mint")],
  });
}

/**
 * Derive Associated Token Account address for Token-2022
 *
 * @param mint - Token mint address
 * @param owner - Token account owner
 */
export async function findAssociatedTokenAddress(
  mint: Address,
  owner: Address,
): Promise<readonly [Address, number]> {
  const addressEncoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      addressEncoder.encode(owner),
      addressEncoder.encode(TOKEN_2022_PROGRAM_ADDRESS),
      addressEncoder.encode(mint),
    ],
  });
}
