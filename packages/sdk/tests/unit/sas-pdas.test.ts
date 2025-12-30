/**
 * Unit Tests for SAS PDA Derivation Helpers
 *
 * Tests the PDA derivation functions for SATI's SAS integration.
 * These are pure unit tests - no network required.
 *
 * Run: pnpm vitest run tests/unit/sas-pdas.test.ts
 */

import { describe, test, expect } from "vitest";
import { createTestKeypair } from "../helpers/signatures";
import {
  deriveSatiPda,
  deriveSatiProgramCredentialPda,
  deriveReputationSchemaPda,
  deriveReputationAttestationPda,
  SAS_PROGRAM_ADDRESS,
  REPUTATION_SCHEMA_NAME,
  REPUTATION_SCHEMA_VERSION,
} from "../../src/sas-pdas";
import { SATI_CREDENTIAL_NAME, deriveCredentialPda, deriveSchemaPda, deriveAttestationPda } from "../../src/sas";

// =============================================================================
// Test Utilities
// =============================================================================

function randomAddress() {
  return createTestKeypair().address;
}

function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

// =============================================================================
// Tests: Constants
// =============================================================================

describe("SAS PDA Constants", () => {
  test("SAS program address is valid base58", () => {
    expect(SAS_PROGRAM_ADDRESS).toBe("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
  });

  test("SATI credential name is correct", () => {
    expect(SATI_CREDENTIAL_NAME).toBe("SATI");
  });

  test("reputation schema constants are set", () => {
    expect(REPUTATION_SCHEMA_NAME).toBe("ReputationScore");
    expect(REPUTATION_SCHEMA_VERSION).toBe(1);
  });
});

// =============================================================================
// Tests: SATI PDA Derivation
// =============================================================================

describe("deriveSatiPda", () => {
  test("produces valid address and bump", async () => {
    const [pda, bump] = await deriveSatiPda();

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30); // Base58 address
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic", async () => {
    const [pda1, bump1] = await deriveSatiPda();
    const [pda2, bump2] = await deriveSatiPda();

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });
});

// =============================================================================
// Tests: SATI Credential PDA Derivation
// =============================================================================

describe("deriveSatiProgramCredentialPda", () => {
  test("produces valid address and bump", async () => {
    const [pda, bump] = await deriveSatiProgramCredentialPda();

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic", async () => {
    const [pda1, bump1] = await deriveSatiProgramCredentialPda();
    const [pda2, bump2] = await deriveSatiProgramCredentialPda();

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("differs from sati PDA", async () => {
    const [satiPda] = await deriveSatiPda();
    const [credentialPda] = await deriveSatiProgramCredentialPda();

    expect(credentialPda).not.toBe(satiPda);
  });
});

// =============================================================================
// Tests: Reputation Schema PDA Derivation
// =============================================================================

describe("deriveReputationSchemaPda", () => {
  test("produces valid address and bump", async () => {
    const [pda, bump] = await deriveReputationSchemaPda();

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic", async () => {
    const [pda1, bump1] = await deriveReputationSchemaPda();
    const [pda2, bump2] = await deriveReputationSchemaPda();

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("differs from credential PDA", async () => {
    const [credentialPda] = await deriveSatiProgramCredentialPda();
    const [schemaPda] = await deriveReputationSchemaPda();

    expect(schemaPda).not.toBe(credentialPda);
  });
});

// =============================================================================
// Tests: Reputation Attestation PDA Derivation
// =============================================================================

describe("deriveReputationAttestationPda", () => {
  test("produces valid address and bump", async () => {
    const nonce = randomBytes32();
    const [pda, bump] = await deriveReputationAttestationPda(nonce);

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic with same nonce", async () => {
    const nonce = randomBytes32();
    const [pda1, bump1] = await deriveReputationAttestationPda(nonce);
    const [pda2, bump2] = await deriveReputationAttestationPda(nonce);

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("different nonces produce different PDAs", async () => {
    const nonce1 = randomBytes32();
    const nonce2 = randomBytes32();

    const [pda1] = await deriveReputationAttestationPda(nonce1);
    const [pda2] = await deriveReputationAttestationPda(nonce2);

    expect(pda1).not.toBe(pda2);
  });

  test("rejects nonce with wrong length", async () => {
    const shortNonce = new Uint8Array(16);
    const longNonce = new Uint8Array(64);

    await expect(deriveReputationAttestationPda(shortNonce)).rejects.toThrow("Nonce must be 32 bytes");
    await expect(deriveReputationAttestationPda(longNonce)).rejects.toThrow("Nonce must be 32 bytes");
  });
});

// =============================================================================
// Tests: Generic SAS PDA Derivation (from sas-lib)
// =============================================================================

describe("deriveCredentialPda (from sas-lib)", () => {
  test("produces valid address and bump", async () => {
    const authority = randomAddress();
    const [pda, bump] = await deriveCredentialPda({
      authority,
      name: "TestCredential",
    });

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic with same inputs", async () => {
    const authority = randomAddress();
    const name = "TestCredential";

    const [pda1, bump1] = await deriveCredentialPda({ authority, name });
    const [pda2, bump2] = await deriveCredentialPda({ authority, name });

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("different authorities produce different PDAs", async () => {
    const authority1 = randomAddress();
    const authority2 = randomAddress();
    const name = "TestCredential";

    const [pda1] = await deriveCredentialPda({ authority: authority1, name });
    const [pda2] = await deriveCredentialPda({ authority: authority2, name });

    expect(pda1).not.toBe(pda2);
  });

  test("different names produce different PDAs", async () => {
    const authority = randomAddress();

    const [pda1] = await deriveCredentialPda({
      authority,
      name: "Credential1",
    });
    const [pda2] = await deriveCredentialPda({
      authority,
      name: "Credential2",
    });

    expect(pda1).not.toBe(pda2);
  });
});

describe("deriveSchemaPda (from sas-lib)", () => {
  test("produces valid address and bump", async () => {
    const credential = randomAddress();
    const [pda, bump] = await deriveSchemaPda({
      credential,
      name: "TestSchema",
      version: 1,
    });

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic with same inputs", async () => {
    const credential = randomAddress();
    const name = "TestSchema";
    const version = 1;

    const [pda1, bump1] = await deriveSchemaPda({ credential, name, version });
    const [pda2, bump2] = await deriveSchemaPda({ credential, name, version });

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("different versions produce different PDAs", async () => {
    const credential = randomAddress();
    const name = "TestSchema";

    const [pda1] = await deriveSchemaPda({ credential, name, version: 1 });
    const [pda2] = await deriveSchemaPda({ credential, name, version: 2 });

    expect(pda1).not.toBe(pda2);
  });

  test("different names produce different PDAs", async () => {
    const credential = randomAddress();

    const [pda1] = await deriveSchemaPda({
      credential,
      name: "Schema1",
      version: 1,
    });
    const [pda2] = await deriveSchemaPda({
      credential,
      name: "Schema2",
      version: 1,
    });

    expect(pda1).not.toBe(pda2);
  });
});

describe("deriveAttestationPda (from sas-lib)", () => {
  test("produces valid address and bump", async () => {
    const credential = randomAddress();
    const schema = randomAddress();
    const nonce = randomAddress(); // sas-lib uses Address, not Uint8Array

    const [pda, bump] = await deriveAttestationPda({
      credential,
      schema,
      nonce,
    });

    expect(typeof pda).toBe("string");
    expect(pda.length).toBeGreaterThan(30);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  test("is deterministic with same inputs", async () => {
    const credential = randomAddress();
    const schema = randomAddress();
    const nonce = randomAddress();

    const [pda1, bump1] = await deriveAttestationPda({
      credential,
      schema,
      nonce,
    });
    const [pda2, bump2] = await deriveAttestationPda({
      credential,
      schema,
      nonce,
    });

    expect(pda1).toBe(pda2);
    expect(bump1).toBe(bump2);
  });

  test("different nonces produce different PDAs", async () => {
    const credential = randomAddress();
    const schema = randomAddress();
    const nonce1 = randomAddress();
    const nonce2 = randomAddress();

    const [pda1] = await deriveAttestationPda({
      credential,
      schema,
      nonce: nonce1,
    });
    const [pda2] = await deriveAttestationPda({
      credential,
      schema,
      nonce: nonce2,
    });

    expect(pda1).not.toBe(pda2);
  });
});
