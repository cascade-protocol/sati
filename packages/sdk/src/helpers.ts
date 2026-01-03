/**
 * SATI SDK Helpers
 *
 * Browser-compatible utility functions for PDA derivation and constants.
 */

import { address, type Address, getProgramDerivedAddress, getAddressEncoder } from "@solana/kit";
import { SATI_PROGRAM_ADDRESS } from "./generated";

// Token-2022 and Associated Token Program addresses
export const TOKEN_2022_PROGRAM_ADDRESS = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// ============================================================
// PDA Derivation Helpers
// ============================================================

/**
 * Derive the Registry Config PDA
 *
 * Seeds: ["registry"]
 */
export async function findRegistryConfigPda(): Promise<readonly [Address, number]> {
  const encoder = new TextEncoder();
  return getProgramDerivedAddress({
    programAddress: SATI_PROGRAM_ADDRESS,
    seeds: [encoder.encode("registry")],
  });
}

/**
 * Derive the Schema Config PDA for a SAS schema
 *
 * Seeds: ["schema_config", sas_schema]
 *
 * @param sasSchema - The SAS (Solana Attestation Service) schema address
 */
export async function findSchemaConfigPda(sasSchema: Address): Promise<readonly [Address, number]> {
  const encoder = new TextEncoder();
  const addressEncoder = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: SATI_PROGRAM_ADDRESS,
    seeds: [encoder.encode("schema_config"), addressEncoder.encode(sasSchema)],
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
export async function findAssociatedTokenAddress(mint: Address, owner: Address): Promise<readonly [Address, number]> {
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

/**
 * Derive the Agent Index PDA for enumeration
 *
 * Seeds: ["agent_index", member_number.to_le_bytes()]
 *
 * Agent Index PDAs allow enumeration of all registered agents.
 * Each agent has a sequential member_number assigned at registration.
 *
 * @param memberNumber - The agent's member number (1-indexed)
 * @returns PDA address and bump
 */
export async function findAgentIndexPda(memberNumber: bigint): Promise<readonly [Address, number]> {
  const encoder = new TextEncoder();
  // Convert memberNumber to little-endian u64 bytes
  const memberBytes = new Uint8Array(8);
  const view = new DataView(memberBytes.buffer);
  view.setBigUint64(0, memberNumber, true); // true = little-endian

  return getProgramDerivedAddress({
    programAddress: SATI_PROGRAM_ADDRESS,
    seeds: [encoder.encode("agent_index"), memberBytes],
  });
}
