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
import {
  createKeyPairSignerFromBytes,
  type Address,
  address,
} from "@solana/kit";
import {
  Connection,
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { SATI } from "../src";
import type { DeployedSASConfig } from "../src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root
import "dotenv/config";

// Get RPC URL for network (uses Helius from .env, falls back to public endpoints)
function getRpcUrl(network: string): string {
  if (network === "devnet") {
    return process.env.VITE_DEVNET_RPC || "https://api.devnet.solana.com";
  }
  if (network === "mainnet") {
    return (
      process.env.VITE_MAINNET_RPC || "https://api.mainnet-beta.solana.com"
    );
  }
  return "http://127.0.0.1:8899"; // localnet
}

// Production authority - only this keypair can deploy to devnet/mainnet
const PRODUCTION_AUTHORITY = "SQ2xxkJ6uEDHprYMNXPxS2AwyEtGGToZ7YC94icKH3Z";

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

// Create Address Lookup Table for SATI transactions
async function createAddressLookupTable(
  sati: SATI,
  keypairPath: string,
  network: string,
): Promise<Address> {
  const rpcUrl = getRpcUrl(network);
  const connection = new Connection(rpcUrl, "confirmed");

  // Load keypair as web3.js Keypair for signing
  const keypairData = readFileSync(keypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  const payer = Keypair.fromSecretKey(secretKey);

  // Get addresses from Light client (cast to web3.js PublicKey[] for ALT creation)
  const light = await sati.getLightClient();
  const addresses =
    (await light.getLookupTableAddresses()) as unknown as import("@solana/web3.js").PublicKey[];
  console.log(`  Including ${addresses.length} addresses`);

  // Get current slot
  const slot = await connection.getSlot("finalized");

  // Create lookup table
  const [createIx, lookupTableAddress] =
    AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: slot,
    });

  // Extend with addresses (max 30 per instruction)
  const extendInstructions = [];
  for (let i = 0; i < addresses.length; i += 30) {
    extendInstructions.push(
      AddressLookupTableProgram.extendLookupTable({
        lookupTable: lookupTableAddress,
        authority: payer.publicKey,
        payer: payer.publicKey,
        addresses: addresses.slice(i, i + 30),
      }),
    );
  }

  // Build and send transaction
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();

  const tx = new VersionedTransaction(
    new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: [createIx, ...extendInstructions],
    }).compileToV0Message(),
  );
  tx.sign([payer]);

  const signature = await connection.sendTransaction(tx);
  console.log(`  Transaction: ${signature}`);

  // Wait for confirmation
  for (let i = 0; i < 30; i++) {
    const status = await connection.getSignatureStatuses([signature]);
    if (status.value[0]?.confirmationStatus === "confirmed") break;
    if ((await connection.getBlockHeight()) > lastValidBlockHeight) {
      throw new Error("Transaction expired");
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  // Wait for ALT to be active
  console.log("  Waiting for lookup table activation...");
  for (let i = 0; i < 20; i++) {
    const lut = await connection.getAddressLookupTable(lookupTableAddress);
    if (lut.value) break;
    await new Promise((r) => setTimeout(r, 500));
  }

  return address(lookupTableAddress.toBase58());
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

  // Verify production authority for devnet/mainnet
  if (network !== "localnet" && keypair.address !== PRODUCTION_AUTHORITY) {
    console.error("");
    console.error("=".repeat(60));
    console.error("AUTHORITY MISMATCH");
    console.error("=".repeat(60));
    console.error(`Expected: ${PRODUCTION_AUTHORITY}`);
    console.error(`Got:      ${keypair.address}`);
    console.error("");
    console.error(
      "Only the production authority can deploy to devnet/mainnet.",
    );
    console.error(
      "Use --test flag for test deployments with different authority.",
    );
    console.error("=".repeat(60));
    process.exit(1);
  }

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
    // Create Address Lookup Table for transaction compression
    console.log("Address Lookup Table:");
    const lookupTable = await createAddressLookupTable(
      sati,
      keypairPath,
      network,
    );
    console.log(`  Address: ${lookupTable}`);
    console.log("");

    const deployedConfig: DeployedSASConfig = {
      network,
      authority: keypair.address,
      deployedAt: new Date().toISOString(),
      config: {
        ...result.config,
        lookupTable,
      },
    };

    const configPath = saveDeployedConfig(network, deployedConfig, testMode);
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
