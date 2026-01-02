/**
 * Unit Tests for SATI SDK Helpers
 *
 * Tests the PDA derivation functions and constants from helpers.ts.
 * These are pure unit tests - no network required.
 *
 * Run: pnpm vitest run tests/unit/helpers.test.ts
 */

import { describe, test, expect } from "vitest";
import { type Address, getAddressDecoder } from "@solana/kit";
import {
  findRegistryConfigPda,
  findSchemaConfigPda,
  findAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
} from "../../src/helpers";

// =============================================================================
// Test Utilities
// =============================================================================

const addressDecoder = getAddressDecoder();

function randomAddress(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return addressDecoder.decode(bytes) as Address;
}

// =============================================================================
// Tests: Constants
// =============================================================================

describe("SATI Helper Constants", () => {
  test("TOKEN_2022_PROGRAM_ADDRESS is correct", () => {
    expect(TOKEN_2022_PROGRAM_ADDRESS).toBe("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
  });

  test("ASSOCIATED_TOKEN_PROGRAM_ADDRESS is correct", () => {
    expect(ASSOCIATED_TOKEN_PROGRAM_ADDRESS).toBe("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  });
});

// =============================================================================
// Tests: Registry Config PDA Derivation
// =============================================================================

describe("findRegistryConfigPda", () => {
  test("produces valid address and bump", async () => {
    const [pda, bump] = await findRegistryConfigPda();

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30); // Base58 address
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic", async () => {
    const [pda1, bump1] = await findRegistryConfigPda();
    const [pda2, bump2] = await findRegistryConfigPda();

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });
});

// =============================================================================
// Tests: Schema Config PDA Derivation
// =============================================================================

describe("findSchemaConfigPda", () => {
  test("produces valid address and bump", async () => {
    const sasSchema = randomAddress();
    const [pda, bump] = await findSchemaConfigPda(sasSchema);

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic with same schema", async () => {
    const sasSchema = randomAddress();
    const [pda1, bump1] = await findSchemaConfigPda(sasSchema);
    const [pda2, bump2] = await findSchemaConfigPda(sasSchema);

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("different schemas produce different PDAs", async () => {
    const schema1 = randomAddress();
    const schema2 = randomAddress();

    const [pda1] = await findSchemaConfigPda(schema1);
    const [pda2] = await findSchemaConfigPda(schema2);

    expect(pda1).not.toBe(pda2);
  });

  test("differs from registry config PDA", async () => {
    const sasSchema = randomAddress();
    const [registryPda] = await findRegistryConfigPda();
    const [schemaPda] = await findSchemaConfigPda(sasSchema);

    expect(schemaPda).not.toBe(registryPda);
  });
});

// =============================================================================
// Tests: Associated Token Address Derivation
// =============================================================================

describe("findAssociatedTokenAddress", () => {
  test("produces valid address and bump", async () => {
    const mint = randomAddress();
    const owner = randomAddress();
    const [ata, bump] = await findAssociatedTokenAddress(mint, owner);

    expect(typeof ata).toBe("string");
    expect(ata.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic with same inputs", async () => {
    const mint = randomAddress();
    const owner = randomAddress();

    const [ata1, bump1] = await findAssociatedTokenAddress(mint, owner);
    const [ata2, bump2] = await findAssociatedTokenAddress(mint, owner);

    expect(ata1).toBe(ata2);
    expect(bump1).toBe(bump2);
  });

  test("different mints produce different ATAs", async () => {
    const mint1 = randomAddress();
    const mint2 = randomAddress();
    const owner = randomAddress();

    const [ata1] = await findAssociatedTokenAddress(mint1, owner);
    const [ata2] = await findAssociatedTokenAddress(mint2, owner);

    expect(ata1).not.toBe(ata2);
  });

  test("different owners produce different ATAs", async () => {
    const mint = randomAddress();
    const owner1 = randomAddress();
    const owner2 = randomAddress();

    const [ata1] = await findAssociatedTokenAddress(mint, owner1);
    const [ata2] = await findAssociatedTokenAddress(mint, owner2);

    expect(ata1).not.toBe(ata2);
  });

  test("ATA differs from registry and schema PDAs", async () => {
    const mint = randomAddress();
    const owner = randomAddress();

    const [registryPda] = await findRegistryConfigPda();
    const [schemaPda] = await findSchemaConfigPda(mint);
    const [ata] = await findAssociatedTokenAddress(mint, owner);

    expect(ata).not.toBe(registryPda);
    expect(ata).not.toBe(schemaPda);
  });
});
