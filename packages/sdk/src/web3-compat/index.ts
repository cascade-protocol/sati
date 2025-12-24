/**
 * Web3.js compatibility layer for SATI SDK
 *
 * Bridge functions to convert between @solana/kit and @solana/web3.js types.
 * Use this module when integrating with Anchor or legacy web3.js code.
 *
 * IMPORTANT: This module uses Node.js Buffer and is NOT browser-compatible.
 * For browser usage, use the main SDK exports which are @solana/kit native.
 */

// biome-ignore-all lint/style/noRestrictedGlobals: Buffer is required for @solana/web3.js TransactionInstruction type compatibility

import { address, type Address } from "@solana/kit";
import {
  PublicKey,
  TransactionInstruction,
  type PublicKeyInitData,
} from "@solana/web3.js";

/**
 * Convert @solana/web3.js PublicKey to @solana/kit Address
 *
 * Use this when calling @solana-program/token functions that expect Address type
 */
export function toAddress<TAddress extends string = string>(
  input: PublicKey | PublicKeyInitData,
): Address<TAddress> {
  const pubkey = input instanceof PublicKey ? input : new PublicKey(input);
  return address(pubkey.toBase58()) as Address<TAddress>;
}

/**
 * Convert @solana/kit Address to @solana/web3.js PublicKey
 *
 * Use this when passing Kit results to Anchor .accounts() or instructions
 */
export function toPublicKey(input: Address | PublicKeyInitData): PublicKey {
  if (input instanceof PublicKey) {
    return input;
  }
  return new PublicKey(input);
}

/**
 * Convert @solana/kit instruction to @solana/web3.js TransactionInstruction
 *
 * Account role mapping (from @solana/kit):
 * - Role 0: Read-only
 * - Role 1: Writable
 * - Role 2: Read-only Signer
 * - Role 3: Writable Signer
 */
export function toWeb3Instruction(kitInstruction: {
  accounts?: Array<{ address: Address; role: number }>;
  programAddress: Address;
  data: Uint8Array;
}): TransactionInstruction {
  const keys =
    kitInstruction.accounts?.map((acc) => ({
      pubkey: toPublicKey(acc.address),
      isSigner: acc.role === 2 || acc.role === 3,
      isWritable: acc.role === 1 || acc.role === 3,
    })) ?? [];

  return new TransactionInstruction({
    keys,
    programId: toPublicKey(kitInstruction.programAddress),
    data: kitInstruction.data
      ? Buffer.from(kitInstruction.data)
      : Buffer.alloc(0),
  });
}

/**
 * @deprecated Use toWeb3Instruction instead
 */
export const kitInstructionToAnchor = toWeb3Instruction;
