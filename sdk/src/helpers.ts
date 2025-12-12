import {
  address,
  type Address,
  getProgramDerivedAddress,
  getAddressEncoder,
} from "@solana/kit";
import * as anchor from "@coral-xyz/anchor";
import { SATI_REGISTRY_PROGRAM_ADDRESS } from "./generated";

// Token-2022 and Associated Token Program addresses
export const TOKEN_2022_PROGRAM_ADDRESS = address(
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
);
export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/**
 * Convert Anchor PublicKey to @solana/kit Address
 *
 * Use this when calling @solana-program/token functions that expect Address type
 */
export function toAddress(pubkey: anchor.web3.PublicKey): Address {
  return address(pubkey.toBase58());
}

/**
 * Convert @solana/kit Address to Anchor PublicKey
 *
 * Use this when passing Kit results to Anchor .accounts() or instructions
 */
export function toPublicKey(addr: Address): anchor.web3.PublicKey {
  return new anchor.web3.PublicKey(addr);
}

/**
 * Convert @solana/kit instruction to Anchor TransactionInstruction
 *
 * Account role mapping:
 * - Role 0: Read-only
 * - Role 1: Writable
 * - Role 2: Signer
 * - Role 3: Writable + Signer
 */
export function kitInstructionToAnchor(
  kitInstruction: {
    accounts: Array<{ address: Address; role: number }>;
    programAddress: Address;
    data: Uint8Array;
  }
): anchor.web3.TransactionInstruction {
  return new anchor.web3.TransactionInstruction({
    keys: kitInstruction.accounts.map((acc) => ({
      pubkey: toPublicKey(acc.address),
      isSigner: acc.role === 2 || acc.role === 3,
      isWritable: acc.role === 1 || acc.role === 3,
    })),
    programId: toPublicKey(kitInstruction.programAddress),
    data: Buffer.from(kitInstruction.data),
  });
}

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
  owner: Address
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
