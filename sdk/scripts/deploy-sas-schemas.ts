#!/usr/bin/env npx tsx
/**
 * Deploy SATI SAS Schemas
 *
 * Deploys SATI credential and schemas to a Solana network.
 * Safe to run multiple times - only deploys missing components.
 *
 * Usage:
 *   pnpm tsx scripts/deploy-sas-schemas.ts [network] [keypair] [--test]
 *
 * Arguments:
 *   network   - devnet | mainnet | localnet (default: devnet)
 *   keypair   - Path to keypair JSON file (default: ~/.config/solana/id.json)
 *   --test    - Deploy test schemas (v0) instead of production schemas
 *
 * Examples:
 *   # Deploy to devnet with default keypair
 *   pnpm tsx scripts/deploy-sas-schemas.ts devnet
 *
 *   # Deploy test schemas to devnet
 *   pnpm tsx scripts/deploy-sas-schemas.ts devnet ~/.config/solana/id.json --test
 *
 *   # Deploy to mainnet
 *   pnpm tsx scripts/deploy-sas-schemas.ts mainnet ./mainnet-deployer.json
 */

import path from "node:path";
import os from "node:os";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { SATI } from "../src";
import type { DeployedSASConfig } from "../src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let network: "devnet" | "mainnet" | "localnet" = "devnet";
  let keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  let testMode = false;

  for (const arg of args) {
    if (arg === "--test") {
      testMode = true;
    } else if (arg === "devnet" || arg === "mainnet" || arg === "localnet") {
      network = arg;
    } else if (!arg.startsWith("--")) {
      keypairPath = arg.startsWith("~") ? arg.replace("~", os.homedir()) : arg;
    }
  }

  return { network, keypairPath, testMode };
}

// Load keypair from file
async function loadKeypair(keypairPath: string) {
  try {
    const keypairData = readFileSync(keypairPath, "utf-8");
    const secretKey = Uint8Array.from(JSON.parse(keypairData));
    return createKeyPairSignerFromBytes(secretKey);
  } catch (error) {
    throw new Error(`Failed to load keypair from ${keypairPath}: ${error}`);
  }
}

// Save deployed config
function saveDeployedConfig(
  network: string,
  config: DeployedSASConfig,
  testMode: boolean,
) {
  const deployedDir = path.join(__dirname, "..", "src", "deployed");
  mkdirSync(deployedDir, { recursive: true });

  const filename = testMode ? `${network}-test.json` : `${network}.json`;
  const configPath = path.join(deployedDir, filename);

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return configPath;
}

async function main() {
  const { network, keypairPath, testMode } = parseArgs();

  console.log("=".repeat(60));
  console.log("SATI SAS Schema Deployment");
  console.log("=".repeat(60));
  console.log(`Network:    ${network}`);
  console.log(`Keypair:    ${keypairPath}`);
  console.log(`Mode:       ${testMode ? "TEST (v0 schemas)" : "PRODUCTION"}`);
  console.log("=".repeat(60));

  // Load keypair
  console.log("\nLoading keypair...");
  const keypair = await loadKeypair(keypairPath);
  console.log(`Authority:  ${keypair.address}`);

  // Initialize SATI client
  const sati = new SATI({ network });

  // Deploy schemas
  console.log("\nDeploying SAS schemas...");
  console.log("(This may take a moment...)\n");

  const result = await sati.setupSASSchemas({
    payer: keypair,
    authority: keypair,
    testMode,
  });

  // Print results
  console.log("=".repeat(60));
  console.log("Deployment Result");
  console.log("=".repeat(60));
  console.log(`Success:    ${result.success ? "YES" : "NO"}`);
  console.log("");

  // Credential status
  console.log("Credential:");
  console.log(`  Address:  ${result.credential.address}`);
  console.log(`  Existed:  ${result.credential.existed}`);
  console.log(`  Deployed: ${result.credential.deployed}`);
  console.log("");

  // Schema statuses
  console.log("Schemas:");
  for (const schema of result.schemas) {
    const status = schema.existed
      ? "(existed)"
      : schema.deployed
        ? "(deployed)"
        : "(failed)";
    console.log(`  ${schema.name}: ${schema.address} ${status}`);
  }
  console.log("");

  // Transaction signatures
  if (result.signatures.length > 0) {
    console.log("Transactions:");
    for (const sig of result.signatures) {
      const explorerUrl =
        network === "mainnet"
          ? `https://explorer.solana.com/tx/${sig}`
          : `https://explorer.solana.com/tx/${sig}?cluster=${network}`;
      console.log(`  ${sig}`);
      console.log(`  ${explorerUrl}`);
    }
  } else {
    console.log("No transactions needed - all components already deployed.");
  }

  // Save config if successful
  if (result.success) {
    const deployedConfig: DeployedSASConfig = {
      network,
      authority: keypair.address,
      deployedAt: new Date().toISOString(),
      config: result.config,
    };

    const configPath = saveDeployedConfig(network, deployedConfig, testMode);
    console.log("");
    console.log(`Config saved to: ${configPath}`);
    console.log("");
    console.log(
      "To use these schemas, the config will be auto-loaded when creating a SATI client:",
    );
    console.log(`  const sati = new SATI({ network: "${network}" });`);
  }

  console.log("");
  console.log("=".repeat(60));

  // Exit with error code if failed
  if (!result.success) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
