import { describe, it, expect } from "vitest";
import {
  createBN254,
  isBN254,
  assertIsBN254,
  bn254FromBytes,
  bn254ToBytes,
  encodeBN254toBase58,
  encodeBN254toHex,
  bn254ToDecimalString,
  bytesToBigIntBE,
  bytesToBigIntLE,
  bigIntToBytesBE,
  bigIntToBytesLE,
  bn254Add,
  bn254Sub,
  bn254Mul,
  isSmallerThanFieldSize,
} from "../src/state/bn254.js";
import { FIELD_SIZE } from "../src/constants.js";

describe("BN254", () => {
  describe("isBN254", () => {
    it("should return true for valid field elements", () => {
      expect(isBN254(0n)).toBe(true);
      expect(isBN254(1n)).toBe(true);
      expect(isBN254(FIELD_SIZE - 1n)).toBe(true);
    });

    it("should return false for values outside field", () => {
      expect(isBN254(-1n)).toBe(false);
      expect(isBN254(FIELD_SIZE)).toBe(false);
      expect(isBN254(FIELD_SIZE + 1n)).toBe(false);
    });
  });

  describe("assertIsBN254", () => {
    it("should not throw for valid field elements", () => {
      expect(() => assertIsBN254(0n)).not.toThrow();
      expect(() => assertIsBN254(FIELD_SIZE - 1n)).not.toThrow();
    });

    it("should throw for values outside field", () => {
      expect(() => assertIsBN254(FIELD_SIZE)).toThrow();
      expect(() => assertIsBN254(FIELD_SIZE + 1n)).toThrow();
    });
  });

  describe("createBN254", () => {
    it("should create from bigint", () => {
      expect(createBN254(123n)).toBe(123n);
    });

    it("should create from number", () => {
      expect(createBN254(456)).toBe(456n);
    });

    it("should create from decimal string", () => {
      expect(createBN254("789")).toBe(789n);
    });

    it("should create from hex string", () => {
      expect(createBN254("ff", "hex")).toBe(255n);
      expect(createBN254("0xff", "hex")).toBe(255n);
      expect(createBN254("ff", 16)).toBe(255n);
    });

    it("should create from base58 string", () => {
      const result = createBN254("2", "base58");
      expect(typeof result).toBe("bigint");
    });

    it("should create from Uint8Array", () => {
      const bytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 1]);
      expect(createBN254(bytes)).toBe(1n);
    });

    it("should throw for values exceeding field size", () => {
      expect(() => createBN254(FIELD_SIZE)).toThrow();
    });
  });

  describe("bn254FromBytes", () => {
    it("should convert 32 bytes to BN254", () => {
      const bytes = new Uint8Array(32);
      bytes[31] = 42;
      expect(bn254FromBytes(bytes)).toBe(42n);
    });

    it("should throw for non-32 byte arrays", () => {
      expect(() => bn254FromBytes(new Uint8Array(31))).toThrow();
      expect(() => bn254FromBytes(new Uint8Array(33))).toThrow();
    });
  });

  describe("bn254ToBytes", () => {
    it("should convert BN254 to 32 bytes", () => {
      const bytes = bn254ToBytes(42n);
      expect(bytes.length).toBe(32);
      expect(bytes[31]).toBe(42);
    });
  });

  describe("encodeBN254toBase58", () => {
    it("should encode to base58", () => {
      const result = encodeBN254toBase58(0n);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("encodeBN254toHex", () => {
    it("should encode to hex with 0x prefix", () => {
      expect(encodeBN254toHex(255n)).toBe("0x00000000000000000000000000000000000000000000000000000000000000ff");
    });

    it("should pad to 64 characters", () => {
      const hex = encodeBN254toHex(1n);
      expect(hex.length).toBe(66); // 0x + 64 chars
    });
  });

  describe("bn254ToDecimalString", () => {
    it("should convert to decimal string", () => {
      expect(bn254ToDecimalString(12345n)).toBe("12345");
    });
  });

  describe("byte conversion utilities", () => {
    it("bytesToBigIntBE should convert big-endian", () => {
      const bytes = new Uint8Array([1, 0]);
      expect(bytesToBigIntBE(bytes)).toBe(256n);
    });

    it("bytesToBigIntLE should convert little-endian", () => {
      const bytes = new Uint8Array([0, 1]);
      expect(bytesToBigIntLE(bytes)).toBe(256n);
    });

    it("bigIntToBytesBE should produce big-endian bytes", () => {
      const bytes = bigIntToBytesBE(256n, 2);
      expect(bytes).toEqual(new Uint8Array([1, 0]));
    });

    it("bigIntToBytesLE should produce little-endian bytes", () => {
      const bytes = bigIntToBytesLE(256n, 2);
      expect(bytes).toEqual(new Uint8Array([0, 1]));
    });

    it("roundtrip should preserve value", () => {
      const original = 123456789n;
      const beBytes = bigIntToBytesBE(original, 8);
      const leBytes = bigIntToBytesLE(original, 8);

      expect(bytesToBigIntBE(beBytes)).toBe(original);
      expect(bytesToBigIntLE(leBytes)).toBe(original);
    });
  });

  describe("field arithmetic", () => {
    it("bn254Add should add with modular reduction", () => {
      expect(bn254Add(1n, 2n)).toBe(3n);
      expect(bn254Add(FIELD_SIZE - 1n, 1n)).toBe(0n);
    });

    it("bn254Sub should subtract with modular reduction", () => {
      expect(bn254Sub(3n, 1n)).toBe(2n);
      expect(bn254Sub(0n, 1n)).toBe(FIELD_SIZE - 1n);
    });

    it("bn254Mul should multiply with modular reduction", () => {
      expect(bn254Mul(2n, 3n)).toBe(6n);
    });
  });

  describe("isSmallerThanFieldSize", () => {
    it("should return true for valid hashes", () => {
      const validHash = new Uint8Array(32);
      validHash[0] = 0;
      expect(isSmallerThanFieldSize(validHash)).toBe(true);
    });

    it("should return false for values at field size boundary", () => {
      const atFieldSize = bigIntToBytesBE(FIELD_SIZE, 32);
      expect(isSmallerThanFieldSize(atFieldSize)).toBe(false);
    });
  });
});
