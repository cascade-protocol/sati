#!/usr/bin/env npx tsx
/**
 * Initialize SATI Registry
 *
 * Creates the Token-2022 group mint with required extensions and
 * initializes the SATI registry on the specified network.
 *
 * Usage:
 *   pnpm tsx scripts/initialize-registry.ts [network] [keypair]
 *
 * Arguments:
 *   network   - devnet | mainnet (default: devnet)
 *   keypair   - Path to keypair JSON file (default: ~/.config/solana/id.json)
 *
 * Examples:
 *   pnpm tsx scripts/initialize-registry.ts mainnet ~/.config/solana/deployer.json
 */

import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  getAddressEncoder,
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
  type Address,
  type IInstruction,
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
  findAssociatedTokenPda,
  getInitializeTokenGroupInstruction,
} from "@solana-program/token-2022";
import { getCreateAccountInstruction } from "@solana-program/system";
import { getInitializeInstruction } from "../src/generated";
// Use @solana/spl-token for proper Token-2022 extension size calculation
import { getMintLen, ExtensionType } from "@solana/spl-token";

const PROGRAM_ID = address("satiFVb9MDmfR4ZfRedyKPLGLCg3saQ7Wbxtx9AEeeF");

// Network RPC endpoints
const RPC_ENDPOINTS: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

const WSS_ENDPOINTS: Record<string, string> = {
  devnet: "wss://api.devnet.solana.com",
  mainnet: "wss://api.mainnet-beta.solana.com",
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let network: "devnet" | "mainnet" = "devnet";
  let keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");

  for (const arg of args) {
    if (arg === "devnet" || arg === "mainnet") {
      network = arg;
    } else if (!arg.startsWith("--")) {
      keypairPath = arg.startsWith("~") ? arg.replace("~", os.homedir()) : arg;
    }
  }

  return { network, keypairPath };
}

// Load keypair from file
async function loadKeypair(keypairPath: string): Promise<KeyPairSigner> {
  const keypairData = readFileSync(keypairPath, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(keypairData));
  return createKeyPairSignerFromBytes(secretKey);
}

// Derive registry config PDA
async function getRegistryConfigPda(): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PROGRAM_ID,
    seeds: [getAddressEncoder().encode(address("registry")).slice(0, 8)],
  });
  return pda;
}

async function main() {
  const { network, keypairPath } = parseArgs();

  console.log("=".repeat(60));
  console.log("SATI Registry Initialization");
  console.log("=".repeat(60));
  console.log(`Network:    ${network}`);
  console.log(`Keypair:    ${keypairPath}`);
  console.log("=".repeat(60));

  // Load keypair
  console.log("\nLoading keypair...");
  const authority = await loadKeypair(keypairPath);
  console.log(`Authority:  ${authority.address}`);

  // Setup RPC
  const rpcUrl = RPC_ENDPOINTS[network];
  const wssUrl = WSS_ENDPOINTS[network];
  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wssUrl);

  // Check if registry already exists
  const registryPda = address("5tMXnDjqVsvQoem8tZ74nAMU1KYntUSTNEnMDoGFjnij");
  console.log(`\nRegistry PDA: ${registryPda}`);

  const existingAccount = await rpc.getAccountInfo(registryPda).send();
  if (existingAccount.value) {
    console.log("\n⚠️  Registry already initialized!");
    console.log(`   Owner: ${existingAccount.value.owner}`);
    console.log(`   Data length: ${existingAccount.value.data.length} bytes`);
    process.exit(0);
  }

  console.log("\nRegistry not initialized. Proceeding with initialization...");

  // Generate group mint keypair
  const groupMint = await generateKeyPairSigner();
  console.log(`Group Mint: ${groupMint.address}`);

  // Calculate mint account size using proper Token-2022 extension utilities
  // We only allocate space for GroupPointer - TokenGroup will be added via reallocation
  // But we fund with enough lamports for both extensions (includes TLV overhead)
  const mintLen = getMintLen([ExtensionType.GroupPointer]);
  const totalSizeForRent = getMintLen([
    ExtensionType.GroupPointer,
    ExtensionType.TokenGroup,
  ]);
  const lamports = await rpc.getMinimumBalanceForRentExemption(BigInt(totalSizeForRent)).send();
  console.log(`Mint account space: ${mintLen} bytes (GroupPointer only)`);
  console.log(`Rent covers: ${totalSizeForRent} bytes (includes TokenGroup + TLV)`);
  console.log(`Rent: ${Number(lamports) / 1e9} SOL`);

  // Build instructions
  const instructions: IInstruction[] = [];

  // 1. Create mint account
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
      authority: registryPda, // Registry PDA will be the group pointer authority
      groupAddress: groupMint.address, // Group address = mint itself
    }),
  );

  // 3. Initialize mint (0 decimals, authority as initial mint authority)
  instructions.push(
    getInitializeMint2Instruction({
      mint: groupMint.address,
      decimals: 0,
      mintAuthority: authority.address, // Temporary, will transfer to registry
      freezeAuthority: null,
    }),
  );

  // 4. Initialize TokenGroup extension
  instructions.push(
    getInitializeTokenGroupInstruction({
      group: groupMint.address,
      mint: groupMint.address,
      mintAuthority: authority, // Current mint authority signs
      updateAuthority: registryPda, // Registry PDA will be update authority
      maxSize: BigInt("18446744073709551615"), // u64::MAX = unlimited
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

  // 6. Initialize SATI registry
  instructions.push(
    getInitializeInstruction({
      authority,
      groupMint: groupMint.address,
      registryConfig: registryPda,
    }),
  );

  // Get latest blockhash
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  // Build transaction
  let txMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(authority.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions(instructions, msg),
  );

  // Add compute budget instructions (use fixed values for reliability)
  txMessage = prependTransactionMessageInstructions(
    [
      getSetComputeUnitLimitInstruction({ units: 400000 }),
      getSetComputeUnitPriceInstruction({ microLamports: 100000n }), // Priority fee
    ],
    txMessage,
  );

  // Sign and send
  console.log("\nSigning and sending transaction...");
  const signedTx = await signTransactionMessageWithSigners(txMessage);
  const signature = getSignatureFromTransaction(signedTx);

  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signedTx, { commitment: "confirmed" });

  console.log("\n" + "=".repeat(60));
  console.log("✅ Registry initialized successfully!");
  console.log("=".repeat(60));
  console.log(`Signature:  ${signature}`);
  console.log(`Group Mint: ${groupMint.address}`);
  console.log(`Registry:   ${registryPda}`);
  console.log(`Authority:  ${authority.address}`);

  const explorerUrl =
    network === "mainnet"
      ? `https://explorer.solana.com/tx/${signature}`
      : `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
  console.log(`\nExplorer: ${explorerUrl}`);
  console.log("=".repeat(60));
}

main().catch((error) => {
  console.error("Initialization failed:", error);
  process.exit(1);
});
