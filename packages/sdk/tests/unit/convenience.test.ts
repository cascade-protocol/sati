/**
 * Sati Convenience Layer Unit Tests
 *
 * Tests config accessors and createAgentBuilder on the Sati class.
 * These work offline using deployed config JSON files.
 *
 * Note: The convenience query/write methods (giveFeedback, searchFeedback,
 * getReputationSummary, etc.) require RPC and are covered by E2E tests.
 *
 * Run: pnpm vitest run tests/unit/convenience.test.ts
 */

import { describe, it, expect } from "vitest";
import { Sati } from "../../src/client";
import type { SatiWarning } from "../../src/types";

/**
 * Create a Sati instance for unit testing.
 *
 * Uses devnet config so deployed config accessors return real addresses.
 * The constructor creates RPC clients but we never call RPC methods in these tests.
 */
function createTestSati(opts?: { onWarning?: (w: SatiWarning) => void }) {
  return new Sati({
    network: "devnet",
    ...opts,
  });
}

describe("Sati config accessors", () => {
  it("deployedConfig should return config for the network", () => {
    const sati = createTestSati();
    const config = sati.deployedConfig;
    expect(config).not.toBeNull();
    expect(config?.schemas.feedbackPublic).toBeDefined();
    expect(config?.schemas.feedback).toBeDefined();
    expect(config?.schemas.validation).toBeDefined();
    expect(config?.lookupTable).toBeDefined();
  });

  it("feedbackPublicSchema should return an address", () => {
    const sati = createTestSati();
    expect(typeof sati.feedbackPublicSchema).toBe("string");
    expect(sati.feedbackPublicSchema?.length).toBeGreaterThan(0);
  });

  it("feedbackSchema should return an address", () => {
    const sati = createTestSati();
    expect(typeof sati.feedbackSchema).toBe("string");
    expect(sati.feedbackSchema?.length).toBeGreaterThan(0);
  });

  it("validationSchema should return an address", () => {
    const sati = createTestSati();
    expect(typeof sati.validationSchema).toBe("string");
    expect(sati.validationSchema?.length).toBeGreaterThan(0);
  });

  it("lookupTable should return an address", () => {
    const sati = createTestSati();
    expect(typeof sati.lookupTable).toBe("string");
    expect(sati.lookupTable?.length).toBeGreaterThan(0);
  });

  it("all schema addresses should be different", () => {
    const sati = createTestSati();
    const addresses = new Set([sati.feedbackPublicSchema, sati.feedbackSchema, sati.validationSchema]);
    expect(addresses.size).toBe(3);
  });
});

describe("Sati.createAgentBuilder", () => {
  it("should return a SatiAgentBuilder with correct initial params", () => {
    const sati = createTestSati();
    const builder = sati.createAgentBuilder("TestAgent", "A test agent", "https://img.example.com/a.png");

    expect(builder.params.name).toBe("TestAgent");
    expect(builder.params.description).toBe("A test agent");
    expect(builder.params.image).toBe("https://img.example.com/a.png");
    expect(builder.params.active).toBe(true);
  });
});

describe("Sati onWarning callback", () => {
  it("should accept an onWarning callback without error", () => {
    const warnings: SatiWarning[] = [];
    const sati = createTestSati({
      onWarning: (w) => warnings.push(w),
    });
    // Just verify construction succeeds - actual warnings are triggered by RPC methods
    expect(sati).toBeDefined();
  });
});
