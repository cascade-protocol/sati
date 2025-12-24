/**
 * Deployed Config Unit Tests
 *
 * Tests the deployed configuration loading and validation utilities.
 * These are unit tests for config file parsing - no network required.
 *
 * Run: pnpm vitest run tests/unit/deployed-config.test.ts
 */

import { describe, test, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SATI } from "../../src";
import type { DeployedSASConfig, SATISASConfig } from "../../src/types";

// Load devnet test config
function loadTestConfig(): SATISASConfig | null {
  const configPath = join(__dirname, "../../src/deployed/devnet-test.json");
  if (!existsSync(configPath)) {
    return null;
  }
  const config = JSON.parse(
    readFileSync(configPath, "utf-8"),
  ) as DeployedSASConfig;
  return config.config;
}

describe("Deployed Config Structure", () => {
  let testConfig: SATISASConfig | null;

  beforeAll(() => {
    testConfig = loadTestConfig();
  });

  describe("Test Schema Config", () => {
    test("test schemas config has required fields", () => {
      expect(testConfig).not.toBeNull();
      if (!testConfig) return;

      // Verify all schema addresses are present
      expect(testConfig.credential).toBeDefined();
      expect(testConfig.schemas.feedbackAuth).toBeDefined();
      expect(testConfig.schemas.feedback).toBeDefined();
      expect(testConfig.schemas.feedbackResponse).toBeDefined();
      expect(testConfig.schemas.validationRequest).toBeDefined();
      expect(testConfig.schemas.validationResponse).toBeDefined();
      expect(testConfig.schemas.certification).toBeDefined();
    });
  });
});

describe("Config Loading Utilities", () => {
  test("loadDeployedConfig returns null for missing networks", async () => {
    const { loadDeployedConfig } = await import("../../src/deployed");

    // localnet should not have deployed config
    const config = loadDeployedConfig("localnet");
    expect(config).toBeNull();
  });

  test("hasDeployedConfig correctly reports status", async () => {
    const { hasDeployedConfig } = await import("../../src/deployed");

    // localnet should not have deployed config
    expect(hasDeployedConfig("localnet")).toBe(false);
  });

  test("SATI client initializes for all networks", () => {
    expect(() => new SATI({ network: "mainnet" })).not.toThrow();
    expect(() => new SATI({ network: "devnet" })).not.toThrow();
    expect(() => new SATI({ network: "localnet" })).not.toThrow();
  });
});
