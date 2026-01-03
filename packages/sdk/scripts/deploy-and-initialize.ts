#!/usr/bin/env npx tsx
/**
 * Unified SATI Deployment Script
 *
 * Idempotent deployment that works across all environments:
 * - Fresh localnet
 * - Running localnet with deployed program
 * - Devnet (upgrade-only)
 * - Mainnet (upgrade-only)
 *
 * Phases:
 *   0. Build (anchor build for localnet, solana-verify for devnet/mainnet)
 *   1. Deploy/Upgrade Program + IDL
 *   2. Initialize Registry (skip if already initialized by us)
 *   3. Deploy SAS Schemas + Register SATI Schema Configs + Address Lookup Table
 *   4. Save config and finalize
 *
 * Usage:
 *   pnpm tsx scripts/deploy-and-initialize.ts [network] [keypair]
 *
 * Arguments:
 *   network   - localnet | devnet | mainnet (default: localnet)
 *   keypair   - Path to wallet keypair JSON file (default: ~/.config/solana/id.json)
 *
 * Options:
 *   --program-keypair <path>  - Path to program keypair (required for fresh deploy)
 *   --group-keypair <path>    - Path to Token Group mint keypair (vanity address)
 *   --skip-build              - Skip build step (use existing binary)
 *   --skip-deploy             - Skip program deployment, only initialize/configure
 *   --confirm                 - Required for devnet/mainnet deployments
 *
 * SAFETY:
 *   - Defaults to localnet to prevent accidental production deployments
 *   - Requires explicit --confirm flag for devnet/mainnet
 *   - Requires --program-keypair for fresh deploys (vanity address keypair)
 *
 * Examples:
 *   pnpm tsx scripts/deploy-and-initialize.ts                      # localnet (safe)
 *   pnpm tsx scripts/deploy-and-initialize.ts devnet --confirm     # devnet upgrade
 *   pnpm tsx scripts/deploy-and-initialize.ts mainnet --confirm    # mainnet upgrade
 */

import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  getProgramDerivedAddress,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  prependTransactionMessageInstructions,
  address,
  type KeyPairSigner,
  type Instruction,
  type Address,
} from "@solana/kit";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getInitializeGroupPointerInstruction,
  getInitializeMint2Instruction,
  getSetAuthorityInstruction,
  AuthorityType,
  getInitializeTokenGroupInstruction,
} from "@solana-program/token-2022";
import { getCreateAccountInstruction } from "@solana-program/system";
import { getMintLen, ExtensionType, TOKEN_GROUP_SIZE } from "@solana/spl-token";
import {
  getInitializeInstructionAsync,
  fetchRegistryConfig,
  getRegisterSchemaConfigInstructionAsync,
  fetchMaybeSchemaConfig,
} from "../src/generated";
import { findSchemaConfigPda } from "../src/helpers";
import { SCHEMA_CONFIGS, SignatureMode, StorageType } from "../src/schemas";
import {
  findAddressLookupTablePda,
  getCreateLookupTableInstruction,
  getExtendLookupTableInstruction,
  fetchAddressLookupTable,
} from "@solana-program/address-lookup-table";
import {
  deriveSatiCredentialPda,
  deriveSatiSchemaPda,
  getCreateSatiCredentialInstruction,
  getCreateSatiSchemaInstruction,
  SATI_SCHEMAS,
  fetchMaybeCredential,
  fetchMaybeSchema,
} from "../src/sas";
import type { DeployedSASConfig, SATISASConfig } from "../src/types";
import {
  LIGHT_SYSTEM_PROGRAM,
  ACCOUNT_COMPRESSION_PROGRAM,
  NOOP_PROGRAM,
  REGISTERED_PROGRAM_PDA,
  ADDRESS_TREE,
  ADDRESS_QUEUE,
  MERKLE_TREE_PUBKEY,
  NULLIFIER_QUEUE_PUBKEY,
} from "@cascade-fyi/compression-kit";

// Type aliases for sendAndConfirmTransactionFactory - avoids cluster brand mismatch
// when the script dynamically selects network (localnet/devnet/mainnet)
type SendAndConfirmConfig = Parameters<typeof sendAndConfirmTransactionFactory>[0];
type SendAndConfirmTx = Parameters<ReturnType<typeof sendAndConfirmTransactionFactory>>[0];

// Production program ID (used for devnet/mainnet)
const PRODUCTION_PROGRAM_ID = address("satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz");

// Production authority - only this keypair can deploy to devnet/mainnet
const PRODUCTION_AUTHORITY = "SQ2xxkJ6uEDHprYMNXPxS2AwyEtGGToZ7YC94icKH3Z";

// REQUIRED keypair filenames - NEVER use sati-keypair.json for production!
const PROGRAM_KEYPAIR_FILENAME = "satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz.json";
const GROUP_KEYPAIR_FILENAME = "satiGGZR9LCqKPvBzsKTB9fMdfjd9pmmWw5E5aCGXzv.json";

// Network RPC endpoints
const RPC_ENDPOINTS: Record<string, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

const WSS_ENDPOINTS: Record<string, string> = {
  localnet: "ws://127.0.0.1:8900",
  devnet: "wss://api.devnet.solana.com",
  mainnet: "wss://api.mainnet-beta.solana.com",
};

class FrontrunningDetectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontrunningDetectedError";
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let network: "localnet" | "devnet" | "mainnet" = "localnet";
  let keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");
  let programKeypairPath: string | undefined;
  let groupKeypairPath: string | undefined;
  let skipBuild = false;
  let skipDeploy = false;
  let confirmed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "localnet" || arg === "devnet" || arg === "mainnet") {
      network = arg;
    } else if (arg === "--skip-build") {
      skipBuild = true;
    } else if (arg === "--skip-deploy") {
      skipDeploy = true;
    } else if (arg === "--confirm") {
      confirmed = true;
    } else if (arg === "--program-keypair") {
      const nextArg = args[++i];
      if (!nextArg) {
        console.error("Error: --program-keypair requires a path argument");
        process.exit(1);
      }
      programKeypairPath = nextArg.startsWith("~") ? nextArg.replace("~", os.homedir()) : nextArg;
    } else if (arg === "--group-keypair") {
      const nextArg = args[++i];
      if (!nextArg) {
        console.error("Error: --group-keypair requires a path argument");
        process.exit(1);
      }
      groupKeypairPath = nextArg.startsWith("~") ? nextArg.replace("~", os.homedir()) : nextArg;
    } else if (!arg.startsWith("--")) {
      keypairPath = arg.startsWith("~") ? arg.replace("~", os.homedir()) : arg;
    }
  }

  // SAFETY: Require explicit confirmation for non-localnet deployments
  if (network !== "localnet" && !confirmed) {
    console.error("=".repeat(60));
    console.error("SAFETY CHECK FAILED");
    console.error("=".repeat(60));
    console.error(`You are trying to deploy to ${network.toUpperCase()}.`);
    console.error("This could corrupt an existing production deployment!");
    console.error("");
    console.error("If you are SURE you want to proceed, add --confirm flag:");
    console.error(`  pnpm tsx scripts/deploy-and-initialize.ts ${network} --program-keypair <path> --confirm`);
    console.error("=".repeat(60));
    process.exit(1);
  }

  // SAFETY: Require program keypair for non-localnet deployments (vanity address)
  if (network !== "localnet" && !programKeypairPath && !skipDeploy) {
    console.error("=".repeat(60));
    console.error("MISSING PROGRAM KEYPAIR");
    console.error("=".repeat(60));
    console.error(`Deploying to ${network.toUpperCase()} requires the vanity program keypair.`);
    console.error("");
    console.error("Provide the keypair file with --program-keypair:");
    console.error(
      `  pnpm tsx scripts/deploy-and-initialize.ts ${network} --program-keypair ~/path/to/sati-keypair.json --confirm`,
    );
    console.error("=".repeat(60));
    process.exit(1);
  }

  return {
    network,
    keypairPath,
    programKeypairPath,
    groupKeypairPath,
    skipBuild,
    skipDeploy,
  };
}

// Load keypair from file
async function loadKeypair(keypairPath: string): Promise<KeyPairSigner> {
  const keypairData = readFileSync(keypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  return createKeyPairSignerFromBytes(secretKey);
}

// Get program ID from keypair file
// For devnet/mainnet, validates it matches the expected production ID
async function getProgramId(network: string, programKeypairPath: string): Promise<Address> {
  const keypairData = readFileSync(programKeypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  const signer = await createKeyPairSignerFromBytes(secretKey);
  const derivedId = signer.address;

  // For devnet/mainnet, validate the keypair produces the expected vanity address
  if (network !== "localnet" && derivedId !== PRODUCTION_PROGRAM_ID) {
    console.error("=".repeat(60));
    console.error("PROGRAM ID MISMATCH");
    console.error("=".repeat(60));
    console.error(`Expected: ${PRODUCTION_PROGRAM_ID}`);
    console.error(`Got:      ${derivedId}`);
    console.error("");
    console.error("The provided --program-keypair does not match the expected vanity address.");
    console.error("=".repeat(60));
    process.exit(1);
  }

  return derivedId;
}

// Derive registry PDA for a given program ID
async function deriveRegistryPda(programId: Address): Promise<Address> {
  // Encode "registry" as UTF-8 bytes (matches Rust b"registry")
  const registrySeed = new TextEncoder().encode("registry");
  const [pda] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [registrySeed],
  });
  return pda;
}

// Get the program binary path and REQUIRED vanity keypair paths
// IMPORTANT: For devnet/mainnet, we ALWAYS use the vanity keypairs
function getProgramPaths(): {
  binaryPath: string;
  programKeypairPath: string;
  groupKeypairPath: string;
} {
  // Use process.cwd() for monorepo compatibility - run from packages/sdk
  const workspaceRoot = path.join(process.cwd(), "..", "..");
  const binaryPath = path.join(workspaceRoot, "target", "deploy", "sati.so");

  // ALWAYS use vanity keypairs - NEVER sati-keypair.json!
  const programKeypairPath = path.join(workspaceRoot, "target", "deploy", PROGRAM_KEYPAIR_FILENAME);
  const groupKeypairPath = path.join(workspaceRoot, "target", "deploy", GROUP_KEYPAIR_FILENAME);

  if (!existsSync(binaryPath)) {
    throw new Error(`Program binary not found at ${binaryPath}. Run 'solana-verify build --library-name sati' first.`);
  }

  return { binaryPath, programKeypairPath, groupKeypairPath };
}

// Check if program is already deployed
function checkProgramExists(network: string, programId: Address): boolean {
  const rpcUrl = RPC_ENDPOINTS[network];
  try {
    const result = execSync(`solana program show ${programId} --url ${rpcUrl}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.includes("Program Id:");
  } catch {
    return false;
  }
}

// Build the program
function buildProgram(network: string, workspaceRoot: string): void {
  console.log("\n--- PHASE 0: Build ---");

  if (network !== "localnet") {
    console.log("Building verified build for production...");
    execSync("solana-verify build --library-name sati", {
      stdio: "inherit",
      cwd: workspaceRoot,
    });
  } else {
    console.log("Building for localnet...");
    execSync("anchor build", {
      stdio: "inherit",
      cwd: workspaceRoot,
    });
  }
  console.log("Build complete");
}

// Deploy or upgrade the program using solana CLI
// Also handles IDL init/upgrade
function deployOrUpgradeProgram(
  network: string,
  walletKeypairPath: string,
  binaryPath: string,
  programKeypairPath: string,
  programId: Address,
  workspaceRoot: string,
): { deployed: boolean; upgraded: boolean } {
  console.log("\n--- PHASE 1: Deploy/Upgrade Program + IDL ---");
  console.log(`Binary: ${binaryPath}`);
  console.log(`Program ID: ${programId}`);

  const rpcUrl = RPC_ENDPOINTS[network];
  const programExists = checkProgramExists(network, programId);

  if (programExists) {
    console.log("Program exists, upgrading...");
    // For upgrades, use program address instead of keypair
    try {
      execSync(
        `solana program deploy ${binaryPath} ` +
          `--program-id ${programId} ` +
          `--keypair ${walletKeypairPath} ` +
          `--url ${rpcUrl}`,
        { stdio: "inherit" },
      );
      console.log("Program upgraded successfully");

      // Upgrade IDL (skip for localnet - not needed)
      if (network !== "localnet") {
        const idlPath = path.join(workspaceRoot, "target", "idl", "sati.json");
        if (existsSync(idlPath)) {
          console.log("Upgrading IDL...");
          try {
            execSync(
              `anchor idl upgrade --filepath ${idlPath} ${programId} ` +
                `--provider.cluster ${rpcUrl} ` +
                `--provider.wallet ${walletKeypairPath}`,
              { stdio: "inherit", cwd: workspaceRoot },
            );
            console.log("IDL upgraded successfully");
          } catch (idlError) {
            console.warn("IDL upgrade failed (may not exist yet):", idlError);
            // Try init instead
            console.log("Trying IDL init...");
            execSync(
              `anchor idl init --filepath ${idlPath} ${programId} ` +
                `--provider.cluster ${rpcUrl} ` +
                `--provider.wallet ${walletKeypairPath}`,
              { stdio: "inherit", cwd: workspaceRoot },
            );
            console.log("IDL initialized successfully");
          }
        }
      } else {
        console.log("Skipping IDL upload (not needed for localnet)");
      }

      return { deployed: false, upgraded: true };
    } catch (error) {
      throw new Error(`Failed to upgrade program: ${error}`);
    }
  } else {
    console.log("Program not deployed, deploying fresh...");
    try {
      execSync(
        `solana program deploy ${binaryPath} ` +
          `--program-id ${programKeypairPath} ` +
          `--keypair ${walletKeypairPath} ` +
          `--url ${rpcUrl}`,
        { stdio: "inherit" },
      );
      console.log("Program deployed successfully");

      // Initialize IDL (skip for localnet - not needed)
      if (network !== "localnet") {
        const idlPath = path.join(workspaceRoot, "target", "idl", "sati.json");
        if (existsSync(idlPath)) {
          console.log("Initializing IDL...");
          execSync(
            `anchor idl init --filepath ${idlPath} ${programId} ` +
              `--provider.cluster ${rpcUrl} ` +
              `--provider.wallet ${walletKeypairPath}`,
            { stdio: "inherit", cwd: workspaceRoot },
          );
          console.log("IDL initialized successfully");
        }
      } else {
        console.log("Skipping IDL upload (not needed for localnet)");
      }

      return { deployed: true, upgraded: false };
    } catch (error) {
      throw new Error(`Failed to deploy program: ${error}`);
    }
  }
}

// Deploy SAS credential and schemas (idempotent)
async function deploySASSchemas(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  authority: KeyPairSigner,
): Promise<SATISASConfig> {
  console.log("\n--- PHASE 3: Deploy SAS Schemas ---");

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  } as SendAndConfirmConfig);

  // Derive credential PDA
  const [credentialPda] = await deriveSatiCredentialPda(authority.address);
  console.log(`Credential PDA: ${credentialPda}`);

  // Check if credential exists
  const existingCredential = await fetchMaybeCredential(rpc, credentialPda);

  if (existingCredential) {
    console.log("Credential already exists, skipping creation...");
  } else {
    console.log("Creating credential...");
    const credentialIx = getCreateSatiCredentialInstruction({
      payer: authority,
      authority,
      credentialPda,
      authorizedSigners: [], // No additional signers needed
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(authority.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions([credentialIx], msg),
    );
    const signedTx = await signTransactionMessageWithSigners(tx);
    await sendAndConfirm(signedTx as SignedBlockhashTransaction, { commitment: "confirmed" });
    console.log("Credential created");
  }

  // Deploy each schema
  const schemaAddresses: Record<string, Address> = {};
  const schemaEntries = Object.entries(SATI_SCHEMAS) as [
    keyof typeof SATI_SCHEMAS,
    (typeof SATI_SCHEMAS)[keyof typeof SATI_SCHEMAS],
  ][];

  for (const [key, schema] of schemaEntries) {
    const [schemaPda] = await deriveSatiSchemaPda(credentialPda, schema.name, 1);
    schemaAddresses[key] = schemaPda;
    console.log(`${schema.name}: ${schemaPda}`);

    const existingSchema = await fetchMaybeSchema(rpc, schemaPda);
    if (existingSchema) {
      console.log(`  (already exists)`);
      continue;
    }

    console.log(`  Creating...`);
    const schemaIx = getCreateSatiSchemaInstruction({
      payer: authority,
      authority,
      credentialPda,
      schemaPda,
      schema,
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(authority.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions([schemaIx], msg),
    );
    const signedTx = await signTransactionMessageWithSigners(tx);
    await sendAndConfirm(signedTx as SignedBlockhashTransaction, { commitment: "confirmed" });
    console.log(`  Created`);
  }

  return {
    credential: credentialPda,
    schemas: {
      feedback: schemaAddresses.feedback,
      feedbackPublic: schemaAddresses.feedbackPublic,
      validation: schemaAddresses.validation,
      reputationScore: schemaAddresses.reputationScore,
    },
  };
}

// Register SATI SchemaConfig accounts for each SAS schema (idempotent)
// This links SAS schemas to the SATI program with configuration (signatureMode, storageType, closeable)
async function registerSchemaConfigs(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  authority: KeyPairSigner,
  sasSchemas: Record<string, Address>,
): Promise<void> {
  console.log("\n--- Registering SATI Schema Configs ---");

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  } as SendAndConfirmConfig);

  // Map SAS schema keys to SCHEMA_CONFIGS keys
  const schemaMapping: Record<string, keyof typeof SCHEMA_CONFIGS> = {
    feedback: "Feedback",
    feedbackPublic: "FeedbackPublic",
    validation: "Validation",
    reputationScore: "ReputationScore",
  };

  for (const [key, sasSchema] of Object.entries(sasSchemas)) {
    const configKey = schemaMapping[key];
    if (!configKey) {
      console.log(`  ${key}: skipped (no config defined)`);
      continue;
    }

    const config = SCHEMA_CONFIGS[configKey];
    const [schemaConfigPda] = await findSchemaConfigPda(sasSchema);
    console.log(`${configKey}: ${schemaConfigPda}`);

    // Check if already registered
    const existingConfig = await fetchMaybeSchemaConfig(rpc, schemaConfigPda);
    if (existingConfig.exists) {
      console.log(`  (already registered)`);
      continue;
    }

    console.log(
      `  Registering with mode=${SignatureMode[config.signatureMode]}, storage=${StorageType[config.storageType]}, closeable=${config.closeable}...`,
    );

    const registerIx = await getRegisterSchemaConfigInstructionAsync({
      payer: authority,
      authority,
      sasSchema,
      schemaConfig: schemaConfigPda,
      signatureMode: config.signatureMode,
      storageType: config.storageType,
      closeable: config.closeable,
      name: config.name, // Schema name for SIWS messages (e.g., "FeedbackV1", "ValidationV1")
    });

    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
    const tx = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(authority.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions([registerIx], msg),
    );
    const signedTx = await signTransactionMessageWithSigners(tx);
    await sendAndConfirm(signedTx as SendAndConfirmTx, { commitment: "confirmed" });
    console.log(`  Registered`);
  }
}

// Check if existing ALT has all required addresses
async function checkExistingAlt(
  rpc: ReturnType<typeof createSolanaRpc>,
  existingAltAddress: Address | undefined,
  requiredAddresses: Address[],
): Promise<{ valid: boolean; existingAddresses: Address[] }> {
  if (!existingAltAddress) {
    return { valid: false, existingAddresses: [] };
  }

  try {
    const lut = await fetchAddressLookupTable(rpc, existingAltAddress);
    if (!lut || !lut.data.addresses) {
      return { valid: false, existingAddresses: [] };
    }

    const existingSet = new Set(lut.data.addresses.map((a) => a.toString()));
    const missingAddresses = requiredAddresses.filter((a) => !existingSet.has(a.toString()));

    if (missingAddresses.length === 0) {
      return { valid: true, existingAddresses: lut.data.addresses };
    }

    console.log(`  Existing ALT missing ${missingAddresses.length} addresses:`);
    for (const addr of missingAddresses) {
      console.log(`    - ${addr}`);
    }
    return { valid: false, existingAddresses: lut.data.addresses };
  } catch {
    return { valid: false, existingAddresses: [] };
  }
}

// Create or reuse existing Address Lookup Table (idempotent)
async function getOrCreateLookupTable(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  authority: KeyPairSigner,
  addresses: Address[],
  existingAltAddress?: Address,
): Promise<Address> {
  console.log("\n--- Address Lookup Table ---");
  console.log(`Required addresses: ${addresses.length}`);

  // Check if existing ALT is valid
  if (existingAltAddress) {
    console.log(`Checking existing ALT: ${existingAltAddress}`);
    const { valid, existingAddresses } = await checkExistingAlt(rpc, existingAltAddress, addresses);
    if (valid) {
      console.log(`  ALT is valid with ${existingAddresses.length} addresses - reusing`);
      return existingAltAddress;
    }
    console.log("  ALT needs to be recreated");
  }

  console.log("Creating new Address Lookup Table...");

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  } as SendAndConfirmConfig);

  // Get current slot for ALT derivation
  const slot = await rpc.getSlot({ commitment: "finalized" }).send();

  // Derive lookup table PDA
  const [lookupTableAddress, bump] = await findAddressLookupTablePda({
    authority: authority.address,
    recentSlot: slot,
  });

  console.log(`New ALT Address: ${lookupTableAddress}`);

  // Build instructions
  const instructions: Instruction[] = [];

  // Create lookup table
  instructions.push(
    getCreateLookupTableInstruction({
      address: [lookupTableAddress, bump],
      authority,
      payer: authority,
      recentSlot: slot,
    }),
  );

  // Extend with addresses (max 30 per instruction)
  for (let i = 0; i < addresses.length; i += 30) {
    const chunk = addresses.slice(i, i + 30);
    instructions.push(
      getExtendLookupTableInstruction({
        address: lookupTableAddress,
        authority,
        payer: authority,
        addresses: chunk,
      }),
    );
  }

  // Build and send transaction
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const tx = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(authority.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg),
  );

  const signedTx = await signTransactionMessageWithSigners(tx);
  const signature = getSignatureFromTransaction(signedTx);
  await sendAndConfirm(signedTx as SignedBlockhashTransaction, { commitment: "confirmed" });
  console.log(`Transaction: ${signature}`);

  // Wait for ALT to be active
  console.log("Waiting for lookup table activation...");
  for (let i = 0; i < 20; i++) {
    try {
      const lut = await fetchAddressLookupTable(rpc, lookupTableAddress);
      if (lut) {
        console.log("Lookup table active");
        break;
      }
    } catch {
      // Table not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return lookupTableAddress;
}

// Load existing deployed config (if any)
function loadExistingConfig(network: string): DeployedSASConfig | null {
  const configPath = path.join(__dirname, "..", "src", "deployed", `${network}.json`);
  if (!existsSync(configPath)) {
    return null;
  }
  try {
    const data = readFileSync(configPath, "utf-8");
    return JSON.parse(data) as DeployedSASConfig;
  } catch {
    return null;
  }
}

// Save deployed config to JSON file
function saveDeployedConfig(network: string, authority: Address, config: SATISASConfig): string {
  const deployedDir = path.join(__dirname, "..", "src", "deployed");
  mkdirSync(deployedDir, { recursive: true });

  const deployedConfig: DeployedSASConfig = {
    network: network as "devnet" | "mainnet" | "localnet",
    authority,
    deployedAt: new Date().toISOString(),
    config,
  };

  const configPath = path.join(deployedDir, `${network}.json`);
  writeFileSync(configPath, `${JSON.stringify(deployedConfig, null, 2)}\n`);
  console.log(`Config saved to: ${configPath}`);
  return configPath;
}

// Type helper for signed transactions
type SignedBlockhashTransaction = Awaited<ReturnType<typeof signTransactionMessageWithSigners>> & {
  lifetimeConstraint: { lastValidBlockHeight: bigint; blockhash: string };
};

async function main() {
  const {
    network,
    keypairPath: walletKeypairPath,
    programKeypairPath: providedProgramKeypair,
    groupKeypairPath: providedGroupKeypair,
    skipBuild,
    skipDeploy,
  } = parseArgs();

  // Get workspace root for build commands
  const workspaceRoot = path.join(process.cwd(), "..", "..");

  // Get paths - defaults to vanity keypairs (NEVER sati-keypair.json!)
  const {
    binaryPath,
    programKeypairPath: defaultProgramKeypairPath,
    groupKeypairPath: defaultGroupKeypairPath,
  } = getProgramPaths();

  // Use provided keypairs or default to vanity keypairs
  const programKeypairPath = providedProgramKeypair ?? defaultProgramKeypairPath;
  const groupKeypairPath = providedGroupKeypair ?? defaultGroupKeypairPath;

  // Validate program keypair exists
  if (!existsSync(programKeypairPath)) {
    throw new Error(
      `Program keypair not found at ${programKeypairPath}.\n` + `Expected vanity keypair: ${PROGRAM_KEYPAIR_FILENAME}`,
    );
  }

  // Validate group keypair exists
  if (!existsSync(groupKeypairPath)) {
    throw new Error(
      `Group keypair not found at ${groupKeypairPath}.\n` + `Expected vanity keypair: ${GROUP_KEYPAIR_FILENAME}`,
    );
  }

  console.log("=".repeat(60));
  console.log("SATI Registry: Atomic Deploy and Initialize");
  console.log("=".repeat(60));
  console.log(`Network:         ${network.toUpperCase()}`);
  console.log(`Wallet Keypair:  ${walletKeypairPath}`);
  console.log(`Program Keypair: ${programKeypairPath}`);
  console.log(`Group Keypair:   ${groupKeypairPath}`);
  console.log(`Skip Deploy:     ${skipDeploy}`);
  if (network === "localnet") {
    console.log("\n[SAFE MODE] Running on localnet - no production risk");
  }
  console.log("=".repeat(60));

  // PHASE 0: Build (if not skipped)
  if (!skipBuild) {
    buildProgram(network, workspaceRoot);
  } else {
    console.log("\n--- Skipping build (--skip-build flag) ---");
  }

  const programId = await getProgramId(network, programKeypairPath);
  console.log(`\nProgram ID: ${programId}`);

  // Derive registry PDA
  const registryPda = await deriveRegistryPda(programId);
  console.log(`Registry PDA: ${registryPda}`);

  // Load wallet keypair
  console.log("\nLoading keypair...");
  const authority = await loadKeypair(walletKeypairPath);
  console.log(`Authority: ${authority.address}`);

  // Verify production authority for devnet/mainnet
  if (network !== "localnet" && authority.address !== PRODUCTION_AUTHORITY) {
    console.error("");
    console.error("=".repeat(60));
    console.error("AUTHORITY MISMATCH");
    console.error("=".repeat(60));
    console.error(`Expected: ${PRODUCTION_AUTHORITY}`);
    console.error(`Got:      ${authority.address}`);
    console.error("");
    console.error("Only the production authority can deploy to devnet/mainnet.");
    console.error("=".repeat(60));
    process.exit(1);
  }

  // Setup RPC
  const rpcUrl = RPC_ENDPOINTS[network];
  const wssUrl = WSS_ENDPOINTS[network];
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wssUrl);

  // PHASE 1: Deploy/Upgrade program + IDL (if not skipping)
  if (!skipDeploy) {
    const { deployed, upgraded } = deployOrUpgradeProgram(
      network,
      walletKeypairPath,
      binaryPath,
      programKeypairPath,
      programId,
      workspaceRoot,
    );
    // Wait for deployment to propagate to RPC
    if (deployed || upgraded) {
      console.log("Waiting for deployment to propagate...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } else {
    console.log("\n--- Skipping deployment (--skip-deploy flag) ---");
  }

  // PHASE 2: Initialize Registry (idempotent)
  console.log("\n--- PHASE 2: Initialize Registry ---");

  // Check if registry already exists using fetchRegistryConfig
  let registryInitialized = false;
  // Definite assignment: always set in either the existing-registry or fresh-init branch
  let groupMintAddress!: Address;

  try {
    const existingRegistry = await fetchRegistryConfig(rpc, registryPda);
    if (existingRegistry) {
      // Registry exists - check if we're the authority
      if (existingRegistry.data.authority === authority.address) {
        console.log("Registry already initialized by this authority - skipping");
        console.log(`  Authority: ${existingRegistry.data.authority}`);
        console.log(`  Group Mint: ${existingRegistry.data.groupMint}`);
        groupMintAddress = existingRegistry.data.groupMint;
        registryInitialized = true;
      } else {
        // Different authority - frontrunning or misconfiguration
        throw new FrontrunningDetectedError(
          `Registry initialized by different authority: ${existingRegistry.data.authority}`,
        );
      }
    }
  } catch (error) {
    if (error instanceof FrontrunningDetectedError) {
      throw error;
    }
    // fetchRegistryConfig throws if account doesn't exist - that's expected for fresh deploy
    console.log("Registry not initialized - proceeding with initialization...");
  }

  if (!registryInitialized) {
    // Load group mint keypair (MUST use vanity keypair)
    const groupMint = await loadKeypair(groupKeypairPath);
    console.log(`Group Mint: ${groupMint.address}`);

    // Calculate mint account size
    // - Allocate only GroupPointer initially (InitializeGroup will reallocate for TokenGroup)
    // - Fund with enough lamports for final size (GroupPointer + TokenGroup + buffer)
    const mintLen = getMintLen([ExtensionType.GroupPointer]);
    const finalSize = mintLen + TOKEN_GROUP_SIZE + 64; // extra buffer for TLV overhead
    const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(finalSize)).send();

    // Build instructions
    const instructions: Instruction[] = [];

    // 1. Create mint account with GroupPointer space (InitializeGroup reallocates)
    instructions.push(
      getCreateAccountInstruction({
        payer: authority,
        newAccount: groupMint,
        lamports,
        space: mintLen,
        programAddress: TOKEN_2022_PROGRAM_ADDRESS,
      }),
    );

    // 2. Initialize GroupPointer extension
    instructions.push(
      getInitializeGroupPointerInstruction({
        mint: groupMint.address,
        authority: registryPda,
        groupAddress: groupMint.address,
      }),
    );

    // 3. Initialize mint
    instructions.push(
      getInitializeMint2Instruction({
        mint: groupMint.address,
        decimals: 0,
        mintAuthority: authority.address,
        freezeAuthority: null,
      }),
    );

    // 4. Initialize TokenGroup extension
    instructions.push(
      getInitializeTokenGroupInstruction({
        group: groupMint.address,
        mint: groupMint.address,
        mintAuthority: authority,
        updateAuthority: registryPda,
        maxSize: BigInt("18446744073709551615"), // u64::MAX
      }),
    );

    // 5. Transfer mint authority to registry PDA
    instructions.push(
      getSetAuthorityInstruction({
        owned: groupMint.address,
        owner: authority,
        authorityType: AuthorityType.MintTokens,
        newAuthority: registryPda,
      }),
    );

    // 6. Initialize SATI registry (using SDK with dynamic program ID)
    const initializeIx = await getInitializeInstructionAsync(
      {
        authority,
        registryConfig: registryPda,
        groupMint: groupMint.address,
      },
      { programAddress: programId },
    );
    instructions.push(initializeIx);

    // Get latest blockhash
    const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

    // Build transaction
    let txMessage = pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(authority.address, msg),
      (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
      (msg) => appendTransactionMessageInstructions(instructions, msg),
    );

    // Add compute budget
    txMessage = prependTransactionMessageInstructions(
      [
        getSetComputeUnitLimitInstruction({ units: 400000 }),
        getSetComputeUnitPriceInstruction({ microLamports: 100000n }),
      ],
      txMessage,
    );

    // Sign and send
    console.log("Signing and sending transaction...");
    const signedTx = await signTransactionMessageWithSigners(txMessage);
    const signature = getSignatureFromTransaction(signedTx);

    const sendAndConfirm = sendAndConfirmTransactionFactory({
      rpc,
      rpcSubscriptions,
    } as SendAndConfirmConfig);
    await sendAndConfirm(signedTx as SendAndConfirmTx, {
      commitment: "confirmed",
    });

    console.log(`Registry initialized: ${signature}`);
    groupMintAddress = groupMint.address;
  }

  // PHASE 3: Deploy SAS Schemas + Register Schema Configs + Address Lookup Table
  const sasConfig = await deploySASSchemas(rpc, rpcSubscriptions, authority);

  // Register schema configs in SATI program (links SAS schemas to SATI)
  await registerSchemaConfigs(rpc, rpcSubscriptions, authority, sasConfig.schemas);

  // Collect addresses for the lookup table
  // Must include all addresses used in Light Protocol transactions for compression

  // Solana system programs
  const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
  const ED25519_PROGRAM = address("Ed25519SigVerify111111111111111111111111111");
  const INSTRUCTIONS_SYSVAR = address("Sysvar1nstructions1111111111111111111111111");
  const COMPUTE_BUDGET_PROGRAM = address("ComputeBudget111111111111111111111111111111");

  // Derive event authority PDA
  const [eventAuthority] = await getProgramDerivedAddress({
    programAddress: programId,
    seeds: [new TextEncoder().encode("__event_authority")],
  });

  // Derive schema config PDAs - these are what transactions actually reference!
  // NOTE: Schema ADDRESSES are NOT needed in ALT - only schema CONFIG PDAs are used
  const [feedbackConfigPda] = await findSchemaConfigPda(sasConfig.schemas.feedback);
  const [validationConfigPda] = await findSchemaConfigPda(sasConfig.schemas.validation);
  const [reputationScoreConfigPda] = await findSchemaConfigPda(sasConfig.schemas.reputationScore);

  const altAddresses: Address[] = [
    // Light Protocol core programs
    LIGHT_SYSTEM_PROGRAM,
    ACCOUNT_COMPRESSION_PROGRAM,
    NOOP_PROGRAM,
    REGISTERED_PROGRAM_PDA,

    // Light Protocol state trees (devnet)
    ADDRESS_TREE,
    ADDRESS_QUEUE,
    MERKLE_TREE_PUBKEY,
    NULLIFIER_QUEUE_PUBKEY,

    // SATI program and PDAs
    programId,
    eventAuthority,
    registryPda,
    groupMintAddress,

    // Schema config PDAs (CRITICAL: transactions reference these, not schema addresses!)
    feedbackConfigPda,
    validationConfigPda,
    reputationScoreConfigPda,

    // Solana system programs
    SYSTEM_PROGRAM,
    ED25519_PROGRAM,
    INSTRUCTIONS_SYSVAR,
    COMPUTE_BUDGET_PROGRAM,
    TOKEN_2022_PROGRAM_ADDRESS,
  ];
  if (sasConfig.schemas.feedbackPublic) {
    const [feedbackPublicConfigPda] = await findSchemaConfigPda(sasConfig.schemas.feedbackPublic);
    altAddresses.push(feedbackPublicConfigPda);
  }
  console.log(`\nRequired addresses for lookup table: ${altAddresses.length}`);

  // Load existing config to check if ALT can be reused
  const existingConfig = loadExistingConfig(network);
  const existingAltAddress = existingConfig?.config.lookupTable
    ? address(existingConfig.config.lookupTable)
    : undefined;

  // Create or reuse lookup table
  const lookupTableAddress = await getOrCreateLookupTable(
    rpc,
    rpcSubscriptions,
    authority,
    altAddresses,
    existingAltAddress,
  );
  sasConfig.lookupTable = lookupTableAddress;

  // PHASE 4: Finalize - Save config
  console.log("\n--- PHASE 4: Finalize ---");
  const configPath = saveDeployedConfig(network, authority.address, sasConfig);

  // Final output
  console.log(`\n${"=".repeat(60)}`);
  console.log("SUCCESS: SATI deployment complete!");
  console.log("=".repeat(60));
  console.log(`Network:      ${network.toUpperCase()}`);
  console.log(`Program:      ${programId}`);
  console.log(`Registry:     ${registryPda}`);
  console.log(`Group Mint:   ${groupMintAddress}`);
  console.log(`Authority:    ${authority.address}`);
  console.log("");
  console.log("SAS Configuration:");
  console.log(`  Credential:       ${sasConfig.credential}`);
  console.log(`  Feedback:         ${sasConfig.schemas.feedback}`);
  console.log(`  FeedbackPublic:   ${sasConfig.schemas.feedbackPublic ?? "N/A"}`);
  console.log(`  Validation:       ${sasConfig.schemas.validation}`);
  console.log(`  ReputationScore:  ${sasConfig.schemas.reputationScore}`);
  console.log(`  Lookup Table:     ${sasConfig.lookupTable}`);
  console.log("");
  console.log(`Config saved to: ${configPath}`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  if (error instanceof FrontrunningDetectedError) {
    console.error("\n!!! SECURITY ALERT !!!");
    console.error(error.message);
    console.error("ACTION REQUIRED: Investigate whether this was a malicious frontrun.");
    process.exit(2);
  }
  console.error("Deployment failed:", error);
  process.exit(1);
});
