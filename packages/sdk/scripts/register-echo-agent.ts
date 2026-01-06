/**
 * Register Echo Demo Agent on Devnet
 *
 * 1. Registers agent NFT with deployer as owner
 * 2. Transfers NFT to agent signer address (from SATI_AGENT_SIGNER_KEY)
 */

import { createKeyPairSignerFromBytes, address, type Address } from "@solana/kit";
import { Sati } from "../src/index";
import bs58 from "bs58";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  // Load deployer keypair
  const deployerKeyPath = path.join(os.homedir(), ".cascadepay-mainnet/deployer.json");
  const deployerKeyData = JSON.parse(fs.readFileSync(deployerKeyPath, "utf-8"));
  const deployer = await createKeyPairSignerFromBytes(new Uint8Array(deployerKeyData));
  console.log("Deployer:", deployer.address);

  // Target owner (derived from SATI_AGENT_SIGNER_KEY)
  const signerKey = "jjn1RbZnP8q1E1ys1J3qCG5U5EYfSUeNTAx5vQWTZofnevzoohDRPdCBNpRF6Y7DRNUCofRwevhW2mcWFrdmLWL";
  const signerBytes = bs58.decode(signerKey);
  const targetOwner = address(bs58.encode(signerBytes.slice(32)));
  console.log("Target owner:", targetOwner);

  // Setup Sati client (devnet via Helius)
  const heliusKey = "dcefb6d9-a6e8-4679-8b60-b9555a56b3cf";
  const rpcUrl = `https://devnet.helius-rpc.com/?api-key=${heliusKey}`;
  const wsUrl = `wss://devnet.helius-rpc.com/?api-key=${heliusKey}`;

  const sati = new Sati({
    network: "devnet",
    rpcUrl,
    wsUrl,
    photonRpcUrl: rpcUrl,
  });

  // Step 1: Register agent (deployer is initial owner)
  console.log("\n1. Registering agent...");
  const {
    mint,
    memberNumber,
    signature: regSig,
  } = await sati.registerAgent({
    payer: deployer,
    name: "Echo Demo Agent",
    uri: "https://sati.fyi/agents/echo-demo.json",
    additionalMetadata: [{ key: "description", value: "Demo agent for x402 echo endpoint testing" }],
    nonTransferable: false,
  });
  console.log("   Mint:", mint);
  console.log("   Member #:", memberNumber);
  console.log("   Tx:", regSig);

  // Step 2: Transfer to target owner
  console.log("\n2. Transferring to agent signer...");
  const { signature: transferSig } = await sati.transferAgent({
    payer: deployer,
    owner: deployer, // deployer is current owner after registration
    mint: mint as Address,
    newOwner: targetOwner,
  });
  console.log("   Tx:", transferSig);

  console.log("\n✅ Done! Add to apps/dashboard/.env:");
  console.log(`DEMO_AGENT_MINT_DEVNET=${mint}`);
}

main().catch(console.error);
