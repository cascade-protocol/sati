/**
 * Ed25519 Instruction Builder Unit Tests
 *
 * Tests the Ed25519 precompile instruction builder utilities.
 * Pure unit tests - no network required.
 *
 * Run: pnpm vitest run tests/unit/ed25519.test.ts
 */

import { describe, test, expect } from "vitest";
import {
  createEd25519Instruction,
  createBatchEd25519Instruction,
  ED25519_PROGRAM_ADDRESS,
  type Ed25519SignatureParams,
} from "../../src/ed25519";

describe("Ed25519 Instruction Builder", () => {
  describe("createEd25519Instruction", () => {
    test("builds valid instruction structure", () => {
      const params: Ed25519SignatureParams = {
        publicKey: new Uint8Array(32).fill(1),
        signature: new Uint8Array(64).fill(2),
        message: new Uint8Array(100).fill(3),
      };

      const ix = createEd25519Instruction(params);

      expect(ix.programAddress).toBe(ED25519_PROGRAM_ADDRESS);
      expect(ix.accounts).toHaveLength(0);
      // header(2) + offsets(14) + pubkey(32) + sig(64) + msg(100) = 212
      expect(ix.data.length).toBe(212);
    });

    test("sets correct header values", () => {
      const params: Ed25519SignatureParams = {
        publicKey: new Uint8Array(32),
        signature: new Uint8Array(64),
        message: new Uint8Array(50),
      };

      const ix = createEd25519Instruction(params);

      expect(ix.data[0]).toBe(1); // num_signatures
      expect(ix.data[1]).toBe(0); // padding
    });

    test("encodes offsets correctly", () => {
      const params: Ed25519SignatureParams = {
        publicKey: new Uint8Array(32).fill(0xaa),
        signature: new Uint8Array(64).fill(0xbb),
        message: new Uint8Array(10).fill(0xcc),
      };

      const ix = createEd25519Instruction(params);
      const view = new DataView(
        ix.data.buffer,
        ix.data.byteOffset,
        ix.data.byteLength,
      );

      // Offsets start at byte 2
      // Data starts at byte 16 (2 header + 14 offsets)
      const dataStart = 16;
      const publicKeyOffset = dataStart; // 16
      const signatureOffset = publicKeyOffset + 32; // 48
      const messageOffset = signatureOffset + 64; // 112

      // signature_offset (bytes 2-3)
      expect(view.getUint16(2, true)).toBe(signatureOffset);
      // signature_instruction_index (bytes 4-5) = 0xFFFF
      expect(view.getUint16(4, true)).toBe(0xffff);
      // public_key_offset (bytes 6-7)
      expect(view.getUint16(6, true)).toBe(publicKeyOffset);
      // public_key_instruction_index (bytes 8-9) = 0xFFFF
      expect(view.getUint16(8, true)).toBe(0xffff);
      // message_data_offset (bytes 10-11)
      expect(view.getUint16(10, true)).toBe(messageOffset);
      // message_data_size (bytes 12-13)
      expect(view.getUint16(12, true)).toBe(10);
      // message_instruction_index (bytes 14-15) = 0xFFFF
      expect(view.getUint16(14, true)).toBe(0xffff);
    });

    test("places data at correct offsets", () => {
      const publicKey = new Uint8Array(32).fill(0xaa);
      const signature = new Uint8Array(64).fill(0xbb);
      const message = new Uint8Array(10).fill(0xcc);

      const ix = createEd25519Instruction({ publicKey, signature, message });

      // Data starts at byte 16
      // Public key at 16-47
      expect(ix.data.slice(16, 48)).toEqual(publicKey);
      // Signature at 48-111
      expect(ix.data.slice(48, 112)).toEqual(signature);
      // Message at 112-121
      expect(ix.data.slice(112, 122)).toEqual(message);
    });

    test("rejects invalid public key length", () => {
      expect(() =>
        createEd25519Instruction({
          publicKey: new Uint8Array(31), // wrong size
          signature: new Uint8Array(64),
          message: new Uint8Array(10),
        }),
      ).toThrow("32 bytes");
    });

    test("rejects invalid signature length", () => {
      expect(() =>
        createEd25519Instruction({
          publicKey: new Uint8Array(32),
          signature: new Uint8Array(63), // wrong size
          message: new Uint8Array(10),
        }),
      ).toThrow("64 bytes");
    });

    test("handles empty message", () => {
      const ix = createEd25519Instruction({
        publicKey: new Uint8Array(32),
        signature: new Uint8Array(64),
        message: new Uint8Array(0),
      });

      // header(2) + offsets(14) + pubkey(32) + sig(64) + msg(0) = 112
      expect(ix.data.length).toBe(112);
    });

    test("handles large message", () => {
      const largeMessage = new Uint8Array(10000).fill(0x42);
      const ix = createEd25519Instruction({
        publicKey: new Uint8Array(32),
        signature: new Uint8Array(64),
        message: largeMessage,
      });

      // header(2) + offsets(14) + pubkey(32) + sig(64) + msg(10000) = 10112
      expect(ix.data.length).toBe(10112);
    });
  });

  describe("createBatchEd25519Instruction", () => {
    test("handles single signature", () => {
      const sigs: Ed25519SignatureParams[] = [
        {
          publicKey: new Uint8Array(32).fill(1),
          signature: new Uint8Array(64).fill(2),
          message: new Uint8Array(50).fill(3),
        },
      ];

      const ix = createBatchEd25519Instruction(sigs);

      expect(ix.data[0]).toBe(1); // num_signatures
      expect(ix.programAddress).toBe(ED25519_PROGRAM_ADDRESS);
    });

    test("handles multiple signatures", () => {
      const sigs: Ed25519SignatureParams[] = [
        {
          publicKey: new Uint8Array(32).fill(1),
          signature: new Uint8Array(64).fill(2),
          message: new Uint8Array(50).fill(3),
        },
        {
          publicKey: new Uint8Array(32).fill(4),
          signature: new Uint8Array(64).fill(5),
          message: new Uint8Array(50).fill(6),
        },
      ];

      const ix = createBatchEd25519Instruction(sigs);

      expect(ix.data[0]).toBe(2); // num_signatures
      // header(2) + offsets(14*2) + data((32+64+50)*2) = 2 + 28 + 292 = 322
      expect(ix.data.length).toBe(322);
    });

    test("places all signatures correctly", () => {
      const sig1: Ed25519SignatureParams = {
        publicKey: new Uint8Array(32).fill(0x11),
        signature: new Uint8Array(64).fill(0x22),
        message: new Uint8Array(20).fill(0x33),
      };
      const sig2: Ed25519SignatureParams = {
        publicKey: new Uint8Array(32).fill(0x44),
        signature: new Uint8Array(64).fill(0x55),
        message: new Uint8Array(20).fill(0x66),
      };

      const ix = createBatchEd25519Instruction([sig1, sig2]);

      // Data starts after header(2) + offsets(14*2) = 30
      const dataStart = 30;

      // First signature data
      const pk1Start = dataStart;
      const sig1Start = pk1Start + 32;
      const msg1Start = sig1Start + 64;

      expect(ix.data.slice(pk1Start, pk1Start + 32)).toEqual(sig1.publicKey);
      expect(ix.data.slice(sig1Start, sig1Start + 64)).toEqual(sig1.signature);
      expect(ix.data.slice(msg1Start, msg1Start + 20)).toEqual(sig1.message);

      // Second signature data
      const pk2Start = msg1Start + 20;
      const sig2Start = pk2Start + 32;
      const msg2Start = sig2Start + 64;

      expect(ix.data.slice(pk2Start, pk2Start + 32)).toEqual(sig2.publicKey);
      expect(ix.data.slice(sig2Start, sig2Start + 64)).toEqual(sig2.signature);
      expect(ix.data.slice(msg2Start, msg2Start + 20)).toEqual(sig2.message);
    });

    test("rejects empty array", () => {
      expect(() => createBatchEd25519Instruction([])).toThrow("At least one");
    });

    test("validates all signatures", () => {
      const invalidSigs: Ed25519SignatureParams[] = [
        {
          publicKey: new Uint8Array(32),
          signature: new Uint8Array(64),
          message: new Uint8Array(10),
        },
        {
          publicKey: new Uint8Array(31), // Invalid!
          signature: new Uint8Array(64),
          message: new Uint8Array(10),
        },
      ];

      expect(() => createBatchEd25519Instruction(invalidSigs)).toThrow(
        "32 bytes",
      );
    });

    test("handles varying message sizes", () => {
      const sigs: Ed25519SignatureParams[] = [
        {
          publicKey: new Uint8Array(32),
          signature: new Uint8Array(64),
          message: new Uint8Array(10),
        },
        {
          publicKey: new Uint8Array(32),
          signature: new Uint8Array(64),
          message: new Uint8Array(100),
        },
        {
          publicKey: new Uint8Array(32),
          signature: new Uint8Array(64),
          message: new Uint8Array(5),
        },
      ];

      const ix = createBatchEd25519Instruction(sigs);

      expect(ix.data[0]).toBe(3); // num_signatures
      // header(2) + offsets(14*3) + data((32+64+10) + (32+64+100) + (32+64+5))
      // = 2 + 42 + 106 + 196 + 101 = 447
      expect(ix.data.length).toBe(447);
    });
  });

  describe("ED25519_PROGRAM_ADDRESS", () => {
    test("is the correct Ed25519 precompile address", () => {
      expect(ED25519_PROGRAM_ADDRESS).toBe(
        "Ed25519SigVerify111111111111111111111111111",
      );
    });
  });
});
