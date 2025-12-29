import { describe, it, expect } from "vitest";
import {
  hashvToBn254FieldSizeBe,
  hashvToBn254FieldSizeBeWithBump,
  hashToBn254FieldSizeBe,
  hexToBytes,
  bytesToHex,
  toHex,
  toArray,
  mergeBytes,
  bytesEqual,
  padBytes,
  pushUniqueItems,
  bytesToDecimalString,
  validateBN254Hash,
  assertValidBN254Hash,
} from "../src/utils/conversion.js";
import { FIELD_SIZE } from "../src/constants.js";
import { bytesToBigIntBE } from "../src/state/bn254.js";

describe("Conversion Utilities", () => {
  describe("hashvToBn254FieldSizeBe", () => {
    it("should produce a 32-byte hash", () => {
      const input = new TextEncoder().encode("test");
      const hash = hashvToBn254FieldSizeBe([input]);
      expect(hash.length).toBe(32);
    });

    it("should zero the first byte for field compatibility", () => {
      const input = new TextEncoder().encode("test");
      const hash = hashvToBn254FieldSizeBe([input]);
      expect(hash[0]).toBe(0);
    });

    it("should produce deterministic results", () => {
      const input = new TextEncoder().encode("test");
      const hash1 = hashvToBn254FieldSizeBe([input]);
      const hash2 = hashvToBn254FieldSizeBe([input]);
      expect(hash1).toEqual(hash2);
    });

    it("should handle multiple inputs", () => {
      const input1 = new TextEncoder().encode("hello");
      const input2 = new TextEncoder().encode("world");
      const hash = hashvToBn254FieldSizeBe([input1, input2]);
      expect(hash.length).toBe(32);
    });
  });

  describe("hashvToBn254FieldSizeBeWithBump", () => {
    it("should produce a 32-byte hash", () => {
      const input = new TextEncoder().encode("test");
      const hash = hashvToBn254FieldSizeBeWithBump([input]);
      expect(hash.length).toBe(32);
    });

    it("should differ from non-bump version", () => {
      const input = new TextEncoder().encode("test");
      const hashWithBump = hashvToBn254FieldSizeBeWithBump([input]);
      const hashWithoutBump = hashvToBn254FieldSizeBe([input]);
      expect(hashWithBump).not.toEqual(hashWithoutBump);
    });
  });

  describe("hashToBn254FieldSizeBe", () => {
    it("should return hash and bump seed", () => {
      const input = new TextEncoder().encode("test");
      const result = hashToBn254FieldSizeBe(input);
      expect(result).not.toBeNull();
      if (result) {
        const [hash, bumpSeed] = result;
        expect(hash.length).toBe(32);
        expect(bumpSeed).toBeGreaterThanOrEqual(0);
        expect(bumpSeed).toBeLessThanOrEqual(255);
      }
    });

    it("should produce hash within field size", () => {
      const input = new TextEncoder().encode("test");
      const result = hashToBn254FieldSizeBe(input);
      expect(result).not.toBeNull();
      if (result) {
        const [hash] = result;
        const value = bytesToBigIntBE(hash);
        expect(value < FIELD_SIZE).toBe(true);
      }
    });
  });

  describe("hexToBytes", () => {
    it("should convert hex string to bytes", () => {
      expect(hexToBytes("ff")).toEqual(new Uint8Array([255]));
      expect(hexToBytes("0xff")).toEqual(new Uint8Array([255]));
      expect(hexToBytes("0102")).toEqual(new Uint8Array([1, 2]));
    });

    it("should throw for odd-length hex", () => {
      expect(() => hexToBytes("f")).toThrow("Invalid hex string length");
    });
  });

  describe("bytesToHex", () => {
    it("should convert bytes to hex without prefix", () => {
      expect(bytesToHex(new Uint8Array([255]))).toBe("ff");
      expect(bytesToHex(new Uint8Array([1, 2]))).toBe("0102");
    });
  });

  describe("toHex", () => {
    it("should convert bigint to hex with 0x prefix", () => {
      expect(toHex(255n)).toBe("0xff");
      expect(toHex(16n)).toBe("0x10");
    });
  });

  describe("toArray", () => {
    it("should wrap non-array in array", () => {
      expect(toArray(1)).toEqual([1]);
      expect(toArray("test")).toEqual(["test"]);
    });

    it("should return array as-is", () => {
      expect(toArray([1, 2])).toEqual([1, 2]);
    });
  });

  describe("mergeBytes", () => {
    it("should concatenate byte arrays", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([3, 4]);
      expect(mergeBytes([a, b])).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("should handle empty arrays", () => {
      expect(mergeBytes([])).toEqual(new Uint8Array(0));
    });
  });

  describe("bytesEqual", () => {
    it("should return true for equal arrays", () => {
      expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    });

    it("should return false for different arrays", () => {
      expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    });

    it("should return false for different lengths", () => {
      expect(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(false);
    });
  });

  describe("padBytes", () => {
    it("should right-pad with zeros", () => {
      const result = padBytes(new Uint8Array([1, 2]), 4);
      expect(result).toEqual(new Uint8Array([1, 2, 0, 0]));
    });

    it("should return original if already at length", () => {
      const original = new Uint8Array([1, 2, 3]);
      expect(padBytes(original, 3)).toBe(original);
    });

    it("should return original if longer than target", () => {
      const original = new Uint8Array([1, 2, 3, 4]);
      expect(padBytes(original, 2)).toBe(original);
    });
  });

  describe("pushUniqueItems", () => {
    it("should add unique items", () => {
      const target = [1, 2];
      pushUniqueItems([3, 4], target);
      expect(target).toEqual([1, 2, 3, 4]);
    });

    it("should skip duplicates", () => {
      const target = [1, 2];
      pushUniqueItems([2, 3], target);
      expect(target).toEqual([1, 2, 3]);
    });
  });

  describe("bytesToDecimalString", () => {
    it("should convert bytes to decimal string", () => {
      const bytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255]);
      expect(bytesToDecimalString(bytes)).toBe("255");
    });
  });

  describe("validateBN254Hash", () => {
    it("should return true for valid 32-byte hash within field", () => {
      const validHash = new Uint8Array(32);
      validHash[0] = 0;
      expect(validateBN254Hash(validHash)).toBe(true);
    });

    it("should return false for wrong length", () => {
      expect(validateBN254Hash(new Uint8Array(31))).toBe(false);
    });
  });

  describe("assertValidBN254Hash", () => {
    it("should not throw for valid hash", () => {
      const validHash = new Uint8Array(32);
      validHash[0] = 0;
      expect(() => assertValidBN254Hash(validHash)).not.toThrow();
    });

    it("should throw for invalid hash", () => {
      expect(() => assertValidBN254Hash(new Uint8Array(31))).toThrow();
    });
  });
});
