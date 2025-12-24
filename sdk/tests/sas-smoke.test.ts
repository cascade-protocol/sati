/**
 * SAS Attestation Smoke Tests
 *
 * Tests SAS schema deployment and attestation flows against devnet.
 * Uses test schemas (v0) deployed via deploy-sas-schemas.ts --test
 *
 * Run: pnpm test sas-smoke
 * Prerequisites: Deploy test schemas first with `pnpm tsx scripts/deploy-sas-schemas.ts devnet --test`
 */

import { describe, test, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { SATI } from "../src";
import type { DeployedSASConfig, SATISASConfig } from "../src/types";

// Load devnet test config
function loadTestConfig(): SATISASConfig | null {
  const configPath = join(__dirname, "../src/deployed/devnet-test.json");
  if (!existsSync(configPath)) {
    return null;
  }
  const config = JSON.parse(
    readFileSync(configPath, "utf-8"),
  ) as DeployedSASConfig;
  return config.config;
}

// Load keypair from standard Solana CLI path
async function _loadKeypair() {
  const keypairPath = join(process.env.HOME || "~", ".config/solana/id.json");
  const keypairData = readFileSync(keypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  return createKeyPairSignerFromBytes(secretKey);
}

describe("SAS Smoke Tests (Devnet)", () => {
  let _sati: SATI;
  let testConfig: SATISASConfig | null;

  beforeAll(() => {
    testConfig = loadTestConfig();
    _sati = new SATI({ network: "devnet" });
  });

  describe("Test Schema Deployment", () => {
    test("test schemas are deployed", () => {
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

    test.skip("setupSASSchemas is idempotent (TODO: update for new unified program)", async () => {
      // This test used old setupSASSchemas API which has been removed
      // in the unified program refactor. SAS schemas are now managed
      // externally via sas-lib.
      expect(true).toBe(true);
    }, 30000); // 30s timeout for network call
  });

  describe("Schema Verification", () => {
    test.skip("can verify deployed schemas (TODO: update for new unified program)", async () => {
      // This test used old setSASConfig/getSASConfig API which has been removed
      // in the unified program refactor.
      expect(true).toBe(true);
    });
  });

  describe("PDA Derivation", () => {
    test.skip("credential PDA is deterministic (TODO: update for new unified program)", async () => {
      // This test used old setupSASSchemas API which has been removed
      // in the unified program refactor.
      expect(true).toBe(true);
    }, 30000);
  });
});

describe("SAS Config Loading", () => {
  test("loadDeployedConfig returns null for missing networks", async () => {
    const { loadDeployedConfig } = await import("../src/deployed");

    // localnet should not have deployed config
    const config = loadDeployedConfig("localnet");
    expect(config).toBeNull();
  });

  test("hasDeployedConfig correctly reports status", async () => {
    const { hasDeployedConfig } = await import("../src/deployed");

    // localnet should not have deployed config
    expect(hasDeployedConfig("localnet")).toBe(false);
  });
});
