/**
 * Integration Tests for Light Protocol Client
 *
 * Tests that don't require a running validator test URL generation and validation.
 * Tests requiring a validator are in tests/e2e/.
 *
 * Run: pnpm test:unit
 */

import { describe, test, expect } from "vitest";
import { getPhotonRpcUrl } from "../../src/light";

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
