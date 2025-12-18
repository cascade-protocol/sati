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

// NOTE: There is intentionally NO findGroupMintPda() function.
//
// The group_mint in SATI is NOT a PDA - it's a pre-created Token-2022 mint
// with GroupPointer extension that gets stored in the registry_config account
// during initialization.
//
// To get the actual group_mint address, you MUST fetch the registry_config:
//
//   const [registryConfigAddress] = await findRegistryConfigPda();
//   const registryConfig = await fetchRegistryConfig(rpc, registryConfigAddress);
//   const groupMint = registryConfig.data.groupMint;

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
