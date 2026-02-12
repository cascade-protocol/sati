/**
 * Transfer Agent - sati-sdk
 *
 * Demonstrates how to:
 * 1. Register a new agent
 * 2. Transfer ownership to another address
 * 3. Verify the new owner on-chain
 *
 * Requirements:
 * - KEYPAIR_PATH: funded Solana wallet
 *
 * Run: pnpm tsx examples/sati-sdk/transfer-agent.ts
 */

import { loadSigner, RPC_URL, NETWORK } from "../shared/_env.js";
import { Sati, createSatiUploader } from "@cascade-fyi/sati-sdk";
import { generateKeyPairSigner } from "@solana/kit";

async function main() {
  const signer = await loadSigner();

  const sati = new Sati({
    network: NETWORK,
    rpcUrl: RPC_URL,
  });

  const uploader = createSatiUploader();

  // 1. Register a fresh agent
  const builder = sati
    .createAgentBuilder("Transfer Example", "Agent created for transfer demo.", "https://example.com/img.png")
    .setActive(true);

  console.log("Registering agent...");
  const reg = await builder.register({ payer: signer, uploader });
  console.log(`Registered! Mint: ${reg.mint}`);

  // 2. Transfer to a new random address
  const newOwner = await generateKeyPairSigner();
  console.log(`\nTransferring to ${newOwner.address}...`);
  const transfer = await sati.transferAgent({
    payer: signer,
    owner: signer,
    mint: reg.mint,
    newOwner: newOwner.address,
  });
  console.log(`Transferred! Tx: ${transfer.signature}`);

  // 3. Verify new owner
  const currentOwner = await sati.getAgentOwner(reg.mint);
  console.log(`\nNew owner: ${currentOwner}`);

  const ok = currentOwner === newOwner.address;
  console.log(`Transfer successful: ${ok}`);
  if (!ok) {
    throw new Error(`Transfer verified but owner mismatch: expected ${newOwner.address}, got ${currentOwner}`);
  }
}

main().catch(console.error);
