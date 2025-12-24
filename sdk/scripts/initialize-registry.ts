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
  address,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  generateKeyPairSigner,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  getSignatureFromTransaction,
  sendAndConfirmTransactionFactory,
  prependTransactionMessageInstructions,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  getCreateLookupTableInstructionAsync,
  getExtendLookupTableInstruction,
  findAddressLookupTablePda,
} from "@solana-program/address-lookup-table";
import {
  TOKEN_2022_PROGRAM_ADDRESS,
  getInitializeGroupPointerInstruction,
  getInitializeMint2Instruction,
  getSetAuthorityInstruction,
  AuthorityType,
  getInitializeTokenGroupInstruction,
} from "@solana-program/token-2022";
import { getCreateAccountInstruction } from "@solana-program/system";
import { getInitializeInstruction, SATI_PROGRAM_ADDRESS } from "../src/generated";
import { findRegistryConfigPda } from "../src/helpers";
// Use @solana/spl-token for proper Token-2022 extension size calculation
import { getMintLen, ExtensionType } from "@solana/spl-token";
// Light Protocol addresses for ALT
import {
  defaultStaticAccounts,
  getDefaultAddressTreeInfo,
} from "@lightprotocol/stateless.js";

// Network RPC endpoints
const RPC_ENDPOINTS: Record<string, string> = {
  localhost: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
  mainnet: "https://api.mainnet-beta.solana.com",
};

const WSS_ENDPOINTS: Record<string, string> = {
  localhost: "ws://127.0.0.1:8900",
  devnet: "wss://api.devnet.solana.com",
  mainnet: "wss://api.mainnet-beta.solana.com",
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  let network: "localhost" | "devnet" | "mainnet" = "devnet";
  let keypairPath = path.join(os.homedir(), ".config", "solana", "id.json");

  for (const arg of args) {
    if (arg === "localhost" || arg === "devnet" || arg === "mainnet") {
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

  // Derive registry PDA
  const [registryPda] = await findRegistryConfigPda();
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
  const lamports = await rpc
    .getMinimumBalanceForRentExemption(BigInt(totalSizeForRent))
    .send();
  console.log(`Mint account space: ${mintLen} bytes (GroupPointer only)`);
  console.log(
    `Rent covers: ${totalSizeForRent} bytes (includes TokenGroup + TLV)`,
  );
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

  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });
  await sendAndConfirm(signedTx, { commitment: "confirmed" });

  console.log(`\n${"=".repeat(60)}`);
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

  // Create Address Lookup Table for transaction compression
  console.log("\n" + "=".repeat(60));
  console.log("Creating Address Lookup Table...");
  console.log("=".repeat(60));

  const lookupTableAddress = await createSatiLookupTable(
    rpc,
    rpcSubscriptions,
    authority,
  );

  console.log(`\n${"=".repeat(60)}`);
  console.log("✅ Lookup Table created successfully!");
  console.log("=".repeat(60));
  console.log(`Lookup Table: ${lookupTableAddress}`);
  console.log("=".repeat(60));
}

/**
 * Create an Address Lookup Table containing all addresses needed for
 * SATI compressed attestation transactions.
 *
 * This reduces transaction size by ~300 bytes, enabling Light Protocol
 * transactions to fit within Solana's 1232-byte limit.
 */
async function createSatiLookupTable(
  rpc: ReturnType<typeof createSolanaRpc>,
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>,
  authority: KeyPairSigner,
): Promise<Address> {
  const sendAndConfirm = sendAndConfirmTransactionFactory({
    rpc,
    rpcSubscriptions,
  });

  // Collect all addresses needed for SATI transactions
  const addresses: Address[] = [];

  // 1. Light Protocol static accounts
  const staticAccounts = defaultStaticAccounts();
  for (const pk of staticAccounts) {
    addresses.push(address(pk.toBase58()));
  }

  // 2. SATI program
  addresses.push(SATI_PROGRAM_ADDRESS);

  // 3. Address tree accounts (default shared trees)
  const addressTreeInfo = getDefaultAddressTreeInfo();
  addresses.push(address(addressTreeInfo.tree.toBase58()));
  addresses.push(address(addressTreeInfo.queue.toBase58()));

  // 4. Ed25519 program for signature verification
  addresses.push(address("Ed25519SigVerify111111111111111111111111111"));

  // 5. System program
  addresses.push(address("11111111111111111111111111111111"));

  // 6. Instructions sysvar
  addresses.push(address("Sysvar1nstructions1111111111111111111111111"));

  // Remove duplicates
  const uniqueAddresses = [...new Set(addresses)];

  console.log(`Including ${uniqueAddresses.length} addresses in lookup table`);

  // Get current slot for lookup table creation
  const { value: slot } = await rpc.getSlot().send();

  // Create lookup table instruction
  const createIx = await getCreateLookupTableInstructionAsync({
    authority,
    recentSlot: slot,
  });

  // Derive lookup table address
  const [lookupTableAddress] = await findAddressLookupTablePda({
    authority: authority.address,
    recentSlot: slot,
  });

  // Extend lookup table with addresses (max 30 per instruction)
  const extendInstructions = [];
  for (let i = 0; i < uniqueAddresses.length; i += 30) {
    const chunk = uniqueAddresses.slice(i, i + 30);
    extendInstructions.push(
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
    (msg) =>
      appendTransactionMessageInstructions(
        [createIx, ...extendInstructions],
        msg,
      ),
  );

  const signedTx = await signTransactionMessageWithSigners(tx);
  await sendAndConfirm(signedTx, { commitment: "confirmed" });

  // Wait for lookup table to be active (needs 1 slot)
  console.log("Waiting for lookup table to become active...");
  await waitForLookupTableActive(rpc, lookupTableAddress);

  return lookupTableAddress;
}

/**
 * Wait for a lookup table to become active.
 * Address lookup tables require one slot to become active after creation.
 */
async function waitForLookupTableActive(
  rpc: ReturnType<typeof createSolanaRpc>,
  lookupTableAddress: Address,
  maxAttempts = 10,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { value } = await rpc
        .getAccountInfo(lookupTableAddress, { encoding: "base64" })
        .send();
      if (value && value.data) {
        return;
      }
    } catch {
      // Table not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `Lookup table ${lookupTableAddress} did not become active after ${maxAttempts} attempts`,
  );
}

main().catch((error) => {
  console.error("Initialization failed:", error);
  process.exit(1);
});
