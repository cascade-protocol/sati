/**
 * SAS PDA Derivation Helpers
 *
 * Functions for deriving Program Derived Addresses for the
 * Solana Attestation Service (SAS) integration with SATI.
 */

import { type Address, type ProgramDerivedAddressBump, getProgramDerivedAddress, getAddressEncoder } from "@solana/kit";

import { SATI_PROGRAM_ADDRESS } from "./generated";

// SATI credential name (duplicated here to avoid importing sas.ts which pulls in sas-lib)
const SATI_CREDENTIAL_NAME = "SATI";

// SAS Program Address (mainnet/devnet)
export const SAS_PROGRAM_ADDRESS: Address = "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG" as Address;

// Seeds for SAS PDA derivation
export const CREDENTIAL_SEED = "credential";
export const SCHEMA_SEED = "schema";
export const ATTESTATION_SEED = "attestation";
export const SATI_ATTESTATION_SEED = "sati_attestation";

// SATI-specific constants (SATI_CREDENTIAL_NAME imported from sas.ts)
export const REPUTATION_SCHEMA_NAME = "ReputationScore";
export const REPUTATION_SCHEMA_VERSION = 1;

/**
 * Derive the SATI authority PDA.
 *
 * This PDA is used as the authority for the SATI credential in SAS.
 * Seeds: ["sati_attestation"]
 *
 * @returns [address, bump] tuple
 */
export async function deriveSatiPda(): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  return getProgramDerivedAddress({
    programAddress: SATI_PROGRAM_ADDRESS,
    seeds: [SATI_ATTESTATION_SEED],
  });
}

/**
 * Derive the SATI credential PDA in SAS using SATI program PDA as authority.
 *
 * This is SATI-specific: authority is always the SATI program PDA.
 * For generic credential derivation with custom authority, use
 * `deriveSatiCredentialPda(authority)` from sas.ts.
 *
 * Seeds: ["credential", sati_pda, "SATI"]
 *
 * @returns [address, bump] tuple
 */
export async function deriveSatiProgramCredentialPda(): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  const [satiPda] = await deriveSatiPda();
  const addressEncoder = getAddressEncoder();

  return getProgramDerivedAddress({
    programAddress: SAS_PROGRAM_ADDRESS,
    seeds: [CREDENTIAL_SEED, new Uint8Array(addressEncoder.encode(satiPda)), SATI_CREDENTIAL_NAME],
  });
}

/**
 * Derive the ReputationScore schema PDA in SAS.
 *
 * Seeds: ["schema", credential, "ReputationScore", version]
 *
 * @returns [address, bump] tuple
 */
export async function deriveReputationSchemaPda(): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  const [credential] = await deriveSatiProgramCredentialPda();
  const addressEncoder = getAddressEncoder();
  const versionSeed = Uint8Array.from([REPUTATION_SCHEMA_VERSION]);

  return getProgramDerivedAddress({
    programAddress: SAS_PROGRAM_ADDRESS,
    seeds: [SCHEMA_SEED, new Uint8Array(addressEncoder.encode(credential)), REPUTATION_SCHEMA_NAME, versionSeed],
  });
}

/**
 * Derive a ReputationScore attestation PDA in SAS.
 *
 * The nonce is computed from (provider, tokenAccount) to ensure
 * one score per (provider, agent) pair.
 *
 * Seeds: ["attestation", credential, schema, nonce_as_address]
 *
 * @param nonce - 32-byte nonce (computed via computeReputationNonce)
 * @returns [address, bump] tuple
 */
export async function deriveReputationAttestationPda(
  nonce: Uint8Array,
): Promise<readonly [Address, ProgramDerivedAddressBump]> {
  if (nonce.length !== 32) {
    throw new Error("Nonce must be 32 bytes");
  }

  const [credential] = await deriveSatiProgramCredentialPda();
  const [schema] = await deriveReputationSchemaPda();
  const addressEncoder = getAddressEncoder();

  return getProgramDerivedAddress({
    programAddress: SAS_PROGRAM_ADDRESS,
    seeds: [
      ATTESTATION_SEED,
      new Uint8Array(addressEncoder.encode(credential)),
      new Uint8Array(addressEncoder.encode(schema)),
      nonce,
    ],
  });
}

// NOTE: Generic SAS PDA derivation functions (deriveCredentialPda, deriveSchemaPda,
// deriveAttestationPda) are available via the re-exports in sas.ts from sas-lib.
// This file only contains SATI-specific derivation helpers.
