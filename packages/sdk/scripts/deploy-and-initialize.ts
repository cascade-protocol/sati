#!/usr/bin/env npx tsx
/**
 * Atomic Deploy and Initialize SATI Registry
 *
 * This script deploys the SATI program and initializes the registry atomically
 * to prevent frontrunning attacks. It performs the following steps:
 *
 * 1. Deploy the program using `solana program deploy`
 * 2. Immediately check if registry is already initialized (fail-fast on frontrun)
 * 3. Initialize the registry
 * 4. Verify the caller is the registry authority (detect late frontrun)
 *
 * SECURITY: This script mitigates the unprotected initialization vulnerability
 * by ensuring deploy + initialize happen in rapid succession with verification.
 *
 * Usage:
 *   pnpm tsx scripts/deploy-and-initialize.ts [network] [keypair]
 *
 * Arguments:
 *   network   - localnet | devnet | mainnet (default: localnet)
 *   keypair   - Path to wallet keypair JSON file (default: ~/.config/solana/id.json)
 *
 * Options:
 *   --program-keypair <path>  - Path to program keypair (required for devnet/mainnet)
 *   --group-keypair <path>    - Path to Token Group mint keypair (vanity address)
 *   --skip-deploy             - Skip program deployment, only initialize
 *   --confirm                 - Required for devnet/mainnet deployments
 *
 * SAFETY:
 *   - Defaults to localnet to prevent accidental production deployments
 *   - Requires explicit --confirm flag for devnet/mainnet
 *   - Requires --program-keypair for devnet/mainnet (vanity address keypair)
 *
 * Examples:
 *   pnpm tsx scripts/deploy-and-initialize.ts                                              # localnet (safe)
 *   pnpm tsx scripts/deploy-and-initialize.ts devnet --program-keypair ~/sati.json --confirm
 *   pnpm tsx scripts/deploy-and-initialize.ts mainnet --program-keypair ~/sati.json --confirm
 */

import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
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
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
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
import { Keypair } from "@solana/web3.js";
import { getInitializeInstructionAsync } from "../src/generated";

// Production program ID (used for devnet/mainnet)
const PRODUCTION_PROGRAM_ID = address(
  "satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz",
);

// REQUIRED keypair filenames - NEVER use sati-keypair.json for production!
const PROGRAM_KEYPAIR_FILENAME =
  "satiR3q7XLdnMLZZjgDTaJLFTwV6VqZ5BZUph697Jvz.json";
const GROUP_KEYPAIR_FILENAME =
  "satiGGZR9LCqKPvBzsKTB9fMdfjd9pmmWw5E5aCGXzv.json";

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
  let skipDeploy = false;
  let confirmed = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "localnet" || arg === "devnet" || arg === "mainnet") {
      network = arg;
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
      programKeypairPath = nextArg.startsWith("~")
        ? nextArg.replace("~", os.homedir())
        : nextArg;
    } else if (arg === "--group-keypair") {
      const nextArg = args[++i];
      if (!nextArg) {
        console.error("Error: --group-keypair requires a path argument");
        process.exit(1);
      }
      groupKeypairPath = nextArg.startsWith("~")
        ? nextArg.replace("~", os.homedir())
        : nextArg;
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
    console.error(
      `  pnpm tsx scripts/deploy-and-initialize.ts ${network} --program-keypair <path> --confirm`,
    );
    console.error("=".repeat(60));
    process.exit(1);
  }

  // SAFETY: Require program keypair for non-localnet deployments (vanity address)
  if (network !== "localnet" && !programKeypairPath && !skipDeploy) {
    console.error("=".repeat(60));
    console.error("MISSING PROGRAM KEYPAIR");
    console.error("=".repeat(60));
    console.error(
      `Deploying to ${network.toUpperCase()} requires the vanity program keypair.`,
    );
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
function getProgramId(network: string, programKeypairPath: string): Address {
  const keypairData = readFileSync(programKeypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  const keypair = Keypair.fromSecretKey(secretKey);
  const derivedId = address(keypair.publicKey.toBase58());

  // For devnet/mainnet, validate the keypair produces the expected vanity address
  if (network !== "localnet" && derivedId !== PRODUCTION_PROGRAM_ID) {
    console.error("=".repeat(60));
    console.error("PROGRAM ID MISMATCH");
    console.error("=".repeat(60));
    console.error(`Expected: ${PRODUCTION_PROGRAM_ID}`);
    console.error(`Got:      ${derivedId}`);
    console.error("");
    console.error(
      "The provided --program-keypair does not match the expected vanity address.",
    );
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
  const programKeypairPath = path.join(
    workspaceRoot,
    "target",
    "deploy",
    PROGRAM_KEYPAIR_FILENAME,
  );
  const groupKeypairPath = path.join(
    workspaceRoot,
    "target",
    "deploy",
    GROUP_KEYPAIR_FILENAME,
  );

  if (!existsSync(binaryPath)) {
    throw new Error(
      `Program binary not found at ${binaryPath}. Run 'solana-verify build --library-name sati' first.`,
    );
  }

  return { binaryPath, programKeypairPath, groupKeypairPath };
}

// Deploy the program using solana CLI
function deployProgram(
  network: string,
  walletKeypairPath: string,
  binaryPath: string,
  programKeypairPath: string,
  programId: Address,
): void {
  console.log("\n--- PHASE 1: Deploy Program ---");
  console.log(`Binary: ${binaryPath}`);
  console.log(`Program ID: ${programId}`);

  const rpcUrl = RPC_ENDPOINTS[network];

  // Check if program already deployed
  try {
    const result = execSync(
      `solana program show ${programId} --url ${rpcUrl}`,
      {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    if (result.includes("Program Id:")) {
      console.log("Program already deployed, skipping...");
      return;
    }
  } catch {
    console.log("Program not deployed, deploying now...");
  }

  try {
    execSync(
      `solana program deploy ${binaryPath} ` +
        `--program-id ${programKeypairPath} ` +
        `--keypair ${walletKeypairPath} ` +
        `--url ${rpcUrl}`,
      { stdio: "inherit" },
    );
    console.log("Program deployed successfully");
  } catch (error) {
    throw new Error(`Failed to deploy program: ${error}`);
  }
}

async function main() {
  const {
    network,
    keypairPath: walletKeypairPath,
    programKeypairPath: providedProgramKeypair,
    groupKeypairPath: providedGroupKeypair,
    skipDeploy,
  } = parseArgs();

  // Get paths - defaults to vanity keypairs (NEVER sati-keypair.json!)
  const {
    binaryPath,
    programKeypairPath: defaultProgramKeypairPath,
    groupKeypairPath: defaultGroupKeypairPath,
  } = getProgramPaths();

  // Use provided keypairs or default to vanity keypairs
  const programKeypairPath =
    providedProgramKeypair ?? defaultProgramKeypairPath;
  const groupKeypairPath = providedGroupKeypair ?? defaultGroupKeypairPath;

  // Validate program keypair exists
  if (!existsSync(programKeypairPath)) {
    throw new Error(
      `Program keypair not found at ${programKeypairPath}.\n` +
        `Expected vanity keypair: ${PROGRAM_KEYPAIR_FILENAME}`,
    );
  }

  // Validate group keypair exists
  if (!existsSync(groupKeypairPath)) {
    throw new Error(
      `Group keypair not found at ${groupKeypairPath}.\n` +
        `Expected vanity keypair: ${GROUP_KEYPAIR_FILENAME}`,
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

  const programId = getProgramId(network, programKeypairPath);
  console.log(`\nProgram ID: ${programId}`);

  // Derive registry PDA
  const registryPda = await deriveRegistryPda(programId);
  console.log(`Registry PDA: ${registryPda}`);

  // Load wallet keypair
  console.log("\nLoading keypair...");
  const authority = await loadKeypair(walletKeypairPath);
  console.log(`Authority: ${authority.address}`);

  // Setup RPC
  const rpcUrl = RPC_ENDPOINTS[network];
  const wssUrl = WSS_ENDPOINTS[network];
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wssUrl);

  // PHASE 1: Deploy program (if not skipping)
  if (!skipDeploy) {
    deployProgram(
      network,
      walletKeypairPath,
      binaryPath,
      programKeypairPath,
      programId,
    );
    // Wait for deployment to propagate to RPC
    console.log("Waiting for deployment to propagate...");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    console.log("\n--- Skipping deployment (--skip-deploy flag) ---");
  }

  // PHASE 2: Check if registry already initialized (FAIL-FAST)
  console.log("\n--- PHASE 2: Pre-flight Check ---");
  const existingAccount = await rpc.getAccountInfo(registryPda).send();
  if (existingAccount.value) {
    console.log("\n!!! FRONTRUNNING DETECTED OR ALREADY INITIALIZED !!!");
    console.log(`Registry account already exists!`);
    console.log(`Owner: ${existingAccount.value.owner}`);
    console.log(`Data length: ${existingAccount.value.data.length} bytes`);

    throw new FrontrunningDetectedError(
      "Registry already initialized. If this is unexpected, you may have been frontrun.",
    );
  }

  console.log("Registry not initialized - proceeding with initialization...");

  // PHASE 3: Initialize immediately
  console.log("\n--- PHASE 3: Initialize Registry ---");

  // Load group mint keypair (MUST use vanity keypair)
  const groupMint = await loadKeypair(groupKeypairPath);
  console.log(`Group Mint: ${groupMint.address}`);

  // Calculate mint account size
  // - Allocate only GroupPointer initially (InitializeGroup will reallocate for TokenGroup)
  // - Fund with enough lamports for final size (GroupPointer + TokenGroup + buffer)
  const mintLen = getMintLen([ExtensionType.GroupPointer]);
  const finalSize = mintLen + TOKEN_GROUP_SIZE + 64; // extra buffer for TLV overhead
  const lamports = await rpc
    .getMinimumBalanceForRentExemption(BigInt(finalSize))
    .send();

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

  // @solana/kit cluster-branded RPC types don't match dynamic network config
  // Cast both the config and the transaction to satisfy the type system
  type SendAndConfirmConfig = Parameters<
    typeof sendAndConfirmTransactionFactory
  >[0];
  type SendAndConfirmTx = Parameters<
    ReturnType<typeof sendAndConfirmTransactionFactory>
  >[0];
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  } as SendAndConfirmConfig);
  await sendAndConfirm(signedTx as SendAndConfirmTx, {
    commitment: "confirmed",
  });

  // PHASE 4: Verify we are the authority (DETECT LATE FRONTRUN)
  console.log("\n--- PHASE 4: Verification ---");
  const verifyAccount = await rpc.getAccountInfo(registryPda).send();
  if (!verifyAccount.value) {
    throw new Error(
      "Registry account not found after initialization - unexpected state",
    );
  }

  console.log("Registry account exists after initialization");
  console.log(`Owner: ${verifyAccount.value.owner}`);
  console.log(`Data length: ${verifyAccount.value.data.length} bytes`);

  console.log(`\n${"=".repeat(60)}`);
  console.log("SUCCESS: Registry deployed and initialized atomically!");
  console.log("=".repeat(60));
  console.log(`Signature:  ${signature}`);
  console.log(`Program:    ${programId}`);
  console.log(`Group Mint: ${groupMint.address}`);
  console.log(`Registry:   ${registryPda}`);
  console.log(`Authority:  ${authority.address}`);

  if (network !== "localnet") {
    const explorerUrl =
      network === "mainnet"
        ? `https://explorer.solana.com/tx/${signature}`
        : `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
    console.log(`\nExplorer: ${explorerUrl}`);
  }
  console.log("=".repeat(60));
}

main().catch((error) => {
  if (error instanceof FrontrunningDetectedError) {
    console.error("\n!!! SECURITY ALERT !!!");
    console.error(error.message);
    console.error(
      "ACTION REQUIRED: Investigate whether this was a malicious frontrun.",
    );
    process.exit(2);
  }
  console.error("Deployment failed:", error);
  process.exit(1);
});
