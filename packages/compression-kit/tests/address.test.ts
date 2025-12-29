import { describe, it, expect } from "vitest";
import {
  deriveAddressSeed,
  deriveAddress,
  deriveAddressSeedV2,
  deriveAddressV2,
  getIndexOrAdd,
  packNewAddressParams,
  addressToBytes,
  bytesToAddress,
} from "../src/utils/address.js";
import { ADDRESS_TREE, ADDRESS_QUEUE, LIGHT_SYSTEM_PROGRAM } from "../src/constants.js";

describe("Address Derivation", () => {
  const testProgramId = LIGHT_SYSTEM_PROGRAM;
  const testSeed = new TextEncoder().encode("test-seed");

  describe("deriveAddressSeed", () => {
    it("should derive a 32-byte seed", () => {
      const seed = deriveAddressSeed([testSeed], testProgramId);
      expect(seed.length).toBe(32);
    });

    it("should produce different seeds for different inputs", () => {
      const seed1 = deriveAddressSeed([testSeed], testProgramId);
      const seed2 = deriveAddressSeed([new TextEncoder().encode("other")], testProgramId);
      expect(seed1).not.toEqual(seed2);
    });

    it("should produce deterministic results", () => {
      const seed1 = deriveAddressSeed([testSeed], testProgramId);
      const seed2 = deriveAddressSeed([testSeed], testProgramId);
      expect(seed1).toEqual(seed2);
    });
  });

  describe("deriveAddress", () => {
    it("should derive a valid address", () => {
      const seed = deriveAddressSeed([testSeed], testProgramId);
      const addr = deriveAddress(seed);
      expect(typeof addr).toBe("string");
      expect(addr.length).toBeGreaterThan(0);
    });

    it("should throw for invalid seed length", () => {
      expect(() => deriveAddress(new Uint8Array(31))).toThrow("Seed length must be 32 bytes");
      expect(() => deriveAddress(new Uint8Array(33))).toThrow("Seed length must be 32 bytes");
    });

    it("should produce deterministic results", () => {
      const seed = deriveAddressSeed([testSeed], testProgramId);
      const addr1 = deriveAddress(seed);
      const addr2 = deriveAddress(seed);
      expect(addr1).toBe(addr2);
    });
  });

  describe("deriveAddressSeedV2", () => {
    it("should derive a 32-byte seed", () => {
      const seed = deriveAddressSeedV2([testSeed]);
      expect(seed.length).toBe(32);
    });

    it("should differ from V1 seed derivation", () => {
      const seedV1 = deriveAddressSeed([testSeed], testProgramId);
      const seedV2 = deriveAddressSeedV2([testSeed]);
      expect(seedV1).not.toEqual(seedV2);
    });
  });

  describe("deriveAddressV2", () => {
    it("should derive a valid address", () => {
      const seed = deriveAddressSeedV2([testSeed]);
      const addr = deriveAddressV2(seed, ADDRESS_TREE, testProgramId);
      expect(typeof addr).toBe("string");
      expect(addr.length).toBeGreaterThan(0);
    });

    it("should throw for invalid seed length", () => {
      expect(() => deriveAddressV2(new Uint8Array(31), ADDRESS_TREE, testProgramId)).toThrow(
        "Address seed length must be 32 bytes",
      );
    });
  });

  describe("getIndexOrAdd", () => {
    it("should return existing index", () => {
      const addr1 = LIGHT_SYSTEM_PROGRAM;
      const addr2 = ADDRESS_TREE;
      const accounts = [addr1, addr2];
      const idx = getIndexOrAdd(accounts, addr1);
      expect(idx).toBe(0);
      expect(accounts.length).toBe(2);
    });

    it("should add new address and return new index", () => {
      const accounts = [LIGHT_SYSTEM_PROGRAM];
      const newAddr = ADDRESS_TREE;
      const idx = getIndexOrAdd(accounts, newAddr);
      expect(idx).toBe(1);
      expect(accounts.length).toBe(2);
      expect(accounts[1]).toBe(newAddr);
    });
  });

  describe("packNewAddressParams", () => {
    it("should pack address params with indices", () => {
      const seed = deriveAddressSeed([testSeed], testProgramId);
      const params = [
        {
          seed,
          addressMerkleTreeRootIndex: 0,
          addressMerkleTreePubkey: ADDRESS_TREE,
          addressQueuePubkey: ADDRESS_QUEUE,
        },
      ];

      const { newAddressParamsPacked, remainingAccounts } = packNewAddressParams(params, []);

      expect(newAddressParamsPacked.length).toBe(1);
      expect(newAddressParamsPacked[0].seed).toEqual(seed);
      expect(typeof newAddressParamsPacked[0].addressMerkleTreeAccountIndex).toBe("number");
      expect(typeof newAddressParamsPacked[0].addressQueueAccountIndex).toBe("number");
      expect(remainingAccounts.length).toBe(2);
    });
  });

  describe("addressToBytes / bytesToAddress", () => {
    it("should roundtrip correctly", () => {
      const original = LIGHT_SYSTEM_PROGRAM;
      const bytes = addressToBytes(original);
      expect(bytes.length).toBe(32);

      const restored = bytesToAddress(bytes);
      expect(restored).toBe(original);
    });

    it("bytesToAddress should throw for invalid length", () => {
      expect(() => bytesToAddress(new Uint8Array(31))).toThrow("Address must be 32 bytes");
      expect(() => bytesToAddress(new Uint8Array(33))).toThrow("Address must be 32 bytes");
    });
  });
});
