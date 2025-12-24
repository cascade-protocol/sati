/**
 * Integration Tests for Light Protocol Client
 *
 * These tests verify the LightClient works with a real Photon RPC endpoint.
 * Tests are skipped if no Photon endpoint is available.
 *
 * Run with local test validator: light test-validator
 * Or set HELIUS_API_KEY for devnet testing
 */

import { describe, test, expect, beforeAll, beforeEach } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { address } from "@solana/kit";
import {
  LightClient,
  createLightClient,
  getPhotonRpcUrl,
} from "../../src/light";
import { SATI_PROGRAM_ADDRESS } from "../../src/generated/programs/sati";

// =============================================================================
// Test Configuration
// =============================================================================

const LOCAL_PHOTON_URL = "http://127.0.0.1:8899";

/**
 * Check if local test validator is available
 */
async function isLocalValidatorAvailable(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_PHOTON_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getHealth",
      }),
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// =============================================================================
// Test Utilities
// =============================================================================

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// =============================================================================
// Tests: createLightClient Factory
// =============================================================================

describe("createLightClient Factory", () => {
  let localAvailable: boolean;

  beforeAll(async () => {
    localAvailable = await isLocalValidatorAvailable();
  });

  test.skipIf(() => !localAvailable)("creates client with default config", async () => {
    // Only works if local validator is running
    const client = await createLightClient();
    expect(client).toBeInstanceOf(LightClient);
  });
});

// =============================================================================
// Tests: getPhotonRpcUrl
// =============================================================================

describe("getPhotonRpcUrl", () => {
  test("returns localnet URL without API key", () => {
    const localUrl = getPhotonRpcUrl("localnet");
    expect(localUrl).toContain("127.0.0.1");
  });

  test("returns mainnet URL with API key", () => {
    const mainnetUrl = getPhotonRpcUrl("mainnet", "test-api-key");
    expect(mainnetUrl).toContain("mainnet");
    expect(mainnetUrl).toContain("test-api-key");
  });

  test("returns devnet URL with API key", () => {
    const devnetUrl = getPhotonRpcUrl("devnet", "test-api-key");
    expect(devnetUrl).toContain("devnet");
    expect(devnetUrl).toContain("test-api-key");
  });

  test("throws for devnet without API key", () => {
    expect(() => getPhotonRpcUrl("devnet")).toThrow("API key required");
  });

  test("throws for mainnet without API key", () => {
    expect(() => getPhotonRpcUrl("mainnet")).toThrow("API key required");
  });
});

// =============================================================================
// Tests: LightClient (requires running validator)
// =============================================================================

describe("LightClient with Local Validator", () => {
  let localAvailable: boolean;
  let client: LightClient;

  beforeAll(async () => {
    localAvailable = await isLocalValidatorAvailable();
  });

  beforeEach(() => {
    if (localAvailable) {
      client = new LightClient(LOCAL_PHOTON_URL, new PublicKey(SATI_PROGRAM_ADDRESS));
    }
  });

  test.skipIf(() => !localAvailable)("deriveAttestationAddress is deterministic", async () => {
    const seed1 = randomBytes(32);
    const seed2 = randomBytes(32);
    const seed3 = randomBytes(32);

    const result1 = await client.deriveAttestationAddress([seed1, seed2, seed3]);
    const result2 = await client.deriveAttestationAddress([seed1, seed2, seed3]);

    expect(result1.address.toBase58()).toEqual(result2.address.toBase58());
  });

  test.skipIf(() => !localAvailable)("deriveAttestationAddress produces different addresses for different seeds", async () => {
    const seed1 = randomBytes(32);
    const seed2 = randomBytes(32);
    const seed3a = randomBytes(32);
    const seed3b = randomBytes(32);

    const result1 = await client.deriveAttestationAddress([seed1, seed2, seed3a]);
    const result2 = await client.deriveAttestationAddress([seed1, seed2, seed3b]);

    expect(result1.address.toBase58()).not.toEqual(result2.address.toBase58());
  });

  test.skipIf(() => !localAvailable)("getOutputStateTreeIndex returns valid index", () => {
    const index = client.getOutputStateTreeIndex();
    expect(typeof index).toBe("number");
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(256);
  });

  test.skipIf(() => !localAvailable)("queryAttestations returns empty for non-existent accounts", async () => {
    const tokenAccount = address(Keypair.generate().publicKey.toBase58());
    const result = await client.queryAttestations({
      tokenAccount,
    });

    expect(result.items).toEqual([]);
    expect(result.cursor).toBeUndefined();
  });

  test.skipIf(() => !localAvailable)("queryAttestations with sasSchema filter", async () => {
    const sasSchema = address(Keypair.generate().publicKey.toBase58());
    const result = await client.queryAttestations({
      sasSchema,
    });

    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });

  test.skipIf(() => !localAvailable)("queryAttestations with dataType filter", async () => {
    const result = await client.queryAttestations({
      dataType: 0, // Feedback
    });

    expect(result).toHaveProperty("items");
    expect(Array.isArray(result.items)).toBe(true);
  });

  test.skipIf(() => !localAvailable)("queryAttestations with pagination", async () => {
    const result = await client.queryAttestations({
      limit: 10,
    });

    expect(result).toHaveProperty("items");
    expect(result.items.length).toBeLessThanOrEqual(10);
  });
});

// =============================================================================
// Tests: LightClient Constructor Validation
// =============================================================================

describe("LightClient Constructor", () => {
  test("throws for invalid RPC URL format", () => {
    // Light SDK's createRpc validates the URL
    expect(() => new LightClient("invalid-url")).toThrow();
  });
});
