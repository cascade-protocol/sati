/**
 * Ed25519 Precompile Instruction Builder
 *
 * Creates Ed25519 signature verification instructions for Solana's
 * native Ed25519SigVerify precompile program.
 *
 * Uses @solana/kit primitives - no legacy web3.js dependency.
 *
 * @see https://solana.com/docs/core/programs#ed25519-program
 */

import { address, type Address, type Instruction } from "@solana/kit";

// Ed25519 precompile program address
export const ED25519_PROGRAM_ADDRESS: Address = address(
  "Ed25519SigVerify111111111111111111111111111",
);

/**
 * Parameters for creating an Ed25519 verification instruction
 */
export interface Ed25519SignatureParams {
  /** 32-byte Ed25519 public key */
  publicKey: Uint8Array;
  /** Message that was signed */
  message: Uint8Array;
  /** 64-byte Ed25519 signature */
  signature: Uint8Array;
}

/**
 * Ed25519SignatureOffsets struct layout (14 bytes per signature)
 *
 * Layout:
 * - signature_offset: u16
 * - signature_instruction_index: u16
 * - public_key_offset: u16
 * - public_key_instruction_index: u16
 * - message_data_offset: u16
 * - message_data_size: u16
 * - message_instruction_index: u16
 */
const OFFSETS_SIZE = 14; // 7 x u16

/**
 * Create an Ed25519 signature verification instruction.
 *
 * This instruction must be included in the transaction before any
 * instruction that requires Ed25519 signature verification via
 * instruction introspection.
 *
 * @param params - Signature verification parameters
 * @returns Instruction for Ed25519SigVerify program
 */
export function createEd25519Instruction(
  params: Ed25519SignatureParams,
): Instruction {
  const { publicKey, message, signature } = params;

  if (publicKey.length !== 32) {
    throw new Error("Ed25519 public key must be 32 bytes");
  }
  if (signature.length !== 64) {
    throw new Error("Ed25519 signature must be 64 bytes");
  }

  // Instruction data layout:
  // - num_signatures: u8
  // - padding: u8
  // - offsets: Ed25519SignatureOffsets (14 bytes)
  // - public_key: 32 bytes
  // - signature: 64 bytes
  // - message: variable bytes

  const numSignatures = 1;
  const headerSize = 2; // num_signatures + padding
  const offsetsStart = headerSize;
  const dataStart = headerSize + OFFSETS_SIZE;

  // Data layout after header + offsets
  const publicKeyOffset = dataStart;
  const signatureOffset = publicKeyOffset + 32;
  const messageOffset = signatureOffset + 64;

  const totalSize = messageOffset + message.length;
  const data = new Uint8Array(totalSize);

  // Header
  data[0] = numSignatures;
  data[1] = 0; // padding

  // Write offsets (little-endian u16 values)
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = offsetsStart;

  // signature_offset
  view.setUint16(offset, signatureOffset, true);
  offset += 2;
  // signature_instruction_index (0xFFFF = same instruction)
  view.setUint16(offset, 0xffff, true);
  offset += 2;
  // public_key_offset
  view.setUint16(offset, publicKeyOffset, true);
  offset += 2;
  // public_key_instruction_index (0xFFFF = same instruction)
  view.setUint16(offset, 0xffff, true);
  offset += 2;
  // message_data_offset
  view.setUint16(offset, messageOffset, true);
  offset += 2;
  // message_data_size
  view.setUint16(offset, message.length, true);
  offset += 2;
  // message_instruction_index (0xFFFF = same instruction)
  view.setUint16(offset, 0xffff, true);

  // Write actual data
  data.set(publicKey, publicKeyOffset);
  data.set(signature, signatureOffset);
  data.set(message, messageOffset);

  return {
    programAddress: ED25519_PROGRAM_ADDRESS,
    accounts: [],
    data,
  };
}

/**
 * Create a single Ed25519 instruction that verifies multiple signatures.
 *
 * This is more efficient than creating separate instructions as it:
 * - Saves ~100 bytes per additional signature (no duplicate program address)
 * - Reduces transaction size for Light Protocol integration
 *
 * @param signatures - Array of signature verification parameters
 * @returns Single Ed25519 instruction verifying all signatures
 */
export function createBatchEd25519Instruction(
  signatures: Ed25519SignatureParams[],
): Instruction {
  if (signatures.length === 0) {
    throw new Error("At least one signature is required");
  }

  // Validate all inputs
  for (const sig of signatures) {
    if (sig.publicKey.length !== 32) {
      throw new Error("Ed25519 public key must be 32 bytes");
    }
    if (sig.signature.length !== 64) {
      throw new Error("Ed25519 signature must be 64 bytes");
    }
  }

  const numSignatures = signatures.length;
  const headerSize = 2; // num_signatures + padding

  // Calculate total size for all signatures and their offsets
  // Each signature needs: 14 bytes for offsets, 32 bytes pubkey, 64 bytes sig, variable message
  let totalDataSize = headerSize;
  totalDataSize += numSignatures * OFFSETS_SIZE; // All offsets

  // Calculate data offset (after header and all offsets)
  const dataStart = totalDataSize;

  // Now add space for actual data (pubkeys, signatures, messages)
  for (const sig of signatures) {
    totalDataSize += 32 + 64 + sig.message.length;
  }

  const data = new Uint8Array(totalDataSize);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Header
  data[0] = numSignatures;
  data[1] = 0; // padding

  // Track current data write position
  let currentDataOffset = dataStart;
  let offsetWritePos = headerSize;

  // Write each signature's offsets and data
  for (const sig of signatures) {
    const publicKeyOffset = currentDataOffset;
    const signatureOffset = publicKeyOffset + 32;
    const messageOffset = signatureOffset + 64;

    // Write offsets (little-endian u16 values)
    view.setUint16(offsetWritePos, signatureOffset, true);
    offsetWritePos += 2;
    view.setUint16(offsetWritePos, 0xffff, true); // signature_instruction_index
    offsetWritePos += 2;
    view.setUint16(offsetWritePos, publicKeyOffset, true);
    offsetWritePos += 2;
    view.setUint16(offsetWritePos, 0xffff, true); // public_key_instruction_index
    offsetWritePos += 2;
    view.setUint16(offsetWritePos, messageOffset, true);
    offsetWritePos += 2;
    view.setUint16(offsetWritePos, sig.message.length, true);
    offsetWritePos += 2;
    view.setUint16(offsetWritePos, 0xffff, true); // message_instruction_index
    offsetWritePos += 2;

    // Write actual data
    data.set(sig.publicKey, publicKeyOffset);
    data.set(sig.signature, signatureOffset);
    data.set(sig.message, messageOffset);

    currentDataOffset = messageOffset + sig.message.length;
  }

  return {
    programAddress: ED25519_PROGRAM_ADDRESS,
    accounts: [],
    data,
  };
}
