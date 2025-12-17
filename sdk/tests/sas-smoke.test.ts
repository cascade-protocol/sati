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
async function loadKeypair() {
  const keypairPath = join(process.env.HOME || "~", ".config/solana/id.json");
  const keypairData = readFileSync(keypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  return createKeyPairSignerFromBytes(secretKey);
}

describe("SAS Smoke Tests (Devnet)", () => {
  let sati: SATI;
  let testConfig: SATISASConfig | null;

  beforeAll(() => {
    testConfig = loadTestConfig();
    sati = new SATI({ network: "devnet" });
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

    test("setupSASSchemas is idempotent", async () => {
      const keypair = await loadKeypair();

      // Deploy test schemas (should already exist)
      const result = await sati.setupSASSchemas({
        payer: keypair,
        authority: keypair,
        testMode: true,
      });

      // Should succeed
      expect(result.success).toBe(true);

      // All components should already exist
      expect(result.credential.existed).toBe(true);
      expect(result.credential.deployed).toBe(false);

      for (const schema of result.schemas) {
        expect(schema.existed).toBe(true);
        expect(schema.deployed).toBe(false);
      }

      // No new transactions should be needed
      expect(result.signatures).toHaveLength(0);
    }, 30000); // 30s timeout for network call
  });

  describe("Schema Verification", () => {
    test("can verify deployed schemas", async () => {
      if (!testConfig) {
        console.log("Skipping: test config not found");
        return;
      }

      // Set the test config
      sati.setSASConfig(testConfig);
      const config = sati.getSASConfig();

      expect(config).not.toBeNull();
      expect(config?.credential).toBe(testConfig.credential);
    });
  });

  describe("PDA Derivation", () => {
    test("credential PDA is deterministic", async () => {
      const keypair = await loadKeypair();

      // Derive credential PDA twice with same authority
      const result1 = await sati.setupSASSchemas({
        payer: keypair,
        authority: keypair,
        testMode: true,
      });

      const result2 = await sati.setupSASSchemas({
        payer: keypair,
        authority: keypair,
        testMode: true,
      });

      // Should get same addresses
      expect(result1.credential.address).toBe(result2.credential.address);
      expect(result1.config.schemas.feedback).toBe(
        result2.config.schemas.feedback,
      );
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
