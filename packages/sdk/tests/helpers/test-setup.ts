/**
 * Shared E2E Test Setup
 *
 * Centralizes all test initialization logic in one place:
 * - SATI client configuration
 * - Keypair generation and funding
 * - Agent registration
 * - Schema registration
 * - Lookup table creation
 *
 * Usage:
 * ```typescript
 * import { setupE2ETest, type E2ETestContext } from "../helpers";
 *
 * let ctx: E2ETestContext;
 *
 * beforeAll(async () => {
 *   ctx = await setupE2ETest();
 * }, 60000);
 * ```
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import {
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  type KeyPairSigner,
  type Address,
} from "@solana/kit";
import { Sati } from "../../src";
import { SignatureMode, StorageType } from "../../src/schemas";
import { createTestKeypair, type TestKeypair } from "./signatures";
import { createSatiLookupTable } from "./lookup-table";

// =============================================================================
// Configuration
// =============================================================================

const LOCALNET_RPC = "http://127.0.0.1:8899";
const LOCALNET_PHOTON = "http://127.0.0.1:8784";
const LAMPORTS_PER_SOL = 1_000_000_000n;

// =============================================================================
// Types
// =============================================================================

export interface E2ETestContext {
  /** SATI SDK client */
  sati: Sati;

  /** Transaction fee payer (funded) */
  payer: KeyPairSigner;

  /** Registry authority (local wallet) */
  authority: KeyPairSigner;

  /** Agent owner signer */
  agentOwner: KeyPairSigner;
  /** Agent owner keypair for Ed25519 signing (owns the agent NFT) */
  agentOwnerKeypair: TestKeypair;
  /** Registered agent's mint address (identity) */
  agentMint: Address;

  /** Counterparty signer */
  counterparty: KeyPairSigner;
  /** Counterparty keypair for Ed25519 signing */
  counterpartyKeypair: TestKeypair;

  /** Validator keypair for Ed25519 signing */
  validatorKeypair: TestKeypair;

  /** Provider keypair for Ed25519 signing (ReputationScore) */
  providerKeypair: TestKeypair;

  /** SAS schema for Feedback attestations */
  feedbackSchema: Address;

  /** Address lookup table for transaction compression */
  lookupTableAddress: Address;
}

export interface SetupOptions {
  /** Skip agent registration (default: false) */
  skipAgentRegistration?: boolean;
  /** Skip schema registration (default: false) */
  skipSchemaRegistration?: boolean;
  /** Skip lookup table creation (default: false) */
  skipLookupTable?: boolean;
  /** Custom RPC URL */
  rpcUrl?: string;
  /** Custom Photon URL */
  photonRpcUrl?: string;
}

// =============================================================================
// Setup Function
// =============================================================================

/**
 * Set up a complete E2E test environment.
 *
 * Creates and funds keypairs, registers an agent, registers schemas,
 * and creates an address lookup table for transaction compression.
 */
export async function setupE2ETest(options: SetupOptions = {}): Promise<E2ETestContext> {
  const {
    skipAgentRegistration = false,
    skipSchemaRegistration = false,
    skipLookupTable = false,
    rpcUrl = LOCALNET_RPC,
    photonRpcUrl = LOCALNET_PHOTON,
  } = options;

  // Initialize SDK
  const sati = new Sati({ network: "localnet", photonRpcUrl });

  // Create RPC client for airdrops
  const rpc = createSolanaRpc(rpcUrl);

  // Load local wallet as authority (matches registry initialization)
  const walletPath = path.join(homedir(), ".config/solana/id.json");
  const walletSecret = JSON.parse(readFileSync(walletPath, "utf-8"));
  const authority = await createKeyPairSignerFromBytes(Uint8Array.from(walletSecret));

  // Create and fund payer
  const payer = await generateKeyPairSigner();
  const airdropSig = await rpc.requestAirdrop(payer.address, 10n * LAMPORTS_PER_SOL).send();

  // Wait for airdrop confirmation
  await waitForConfirmation(rpc, airdropSig);

  // Create test keypairs for Ed25519 signing
  // agentOwnerKeypair is the NFT owner - use this for signing attestations
  const agentOwnerKeypair = createTestKeypair(1);
  const counterpartyKeypair = createTestKeypair(2);
  const validatorKeypair = createTestKeypair(3);
  const providerKeypair = createTestKeypair(4);

  // Create signers from keypairs
  const agentOwner = await createKeyPairSignerFromBytes(agentOwnerKeypair.secretKey);
  const counterparty = await createKeyPairSignerFromBytes(counterpartyKeypair.secretKey);

  // Register agent
  let agentMint: Address;
  if (!skipAgentRegistration) {
    const name = `TestAgent-${Date.now()}`;
    const result = await sati.registerAgent({
      payer,
      owner: agentOwner.address,
      name,
      uri: "https://example.com/test-agent.json",
    });
    agentMint = result.mint;
  } else {
    const dummySigner = await generateKeyPairSigner();
    agentMint = dummySigner.address;
  }

  // Register schema
  let feedbackSchema: Address;
  if (!skipSchemaRegistration) {
    const schemaSigner = await generateKeyPairSigner();
    feedbackSchema = schemaSigner.address;
    await sati.registerSchemaConfig({
      payer,
      authority,
      sasSchema: feedbackSchema,
      signatureMode: SignatureMode.DualSignature,
      storageType: StorageType.Compressed,
      closeable: true,
    });
  } else {
    const dummySigner = await generateKeyPairSigner();
    feedbackSchema = dummySigner.address;
  }

  // Create lookup table
  let lookupTableAddress: Address;
  if (!skipLookupTable) {
    const { address: lutAddress } = await createSatiLookupTable(sati, payer);
    lookupTableAddress = lutAddress;
  } else {
    const dummySigner = await generateKeyPairSigner();
    lookupTableAddress = dummySigner.address;
  }

  return {
    sati,
    payer,
    authority,
    agentOwner,
    agentOwnerKeypair,
    agentMint,
    counterparty,
    counterpartyKeypair,
    validatorKeypair,
    providerKeypair,
    feedbackSchema,
    lookupTableAddress,
  };
}

/**
 * Wait for a transaction to be confirmed.
 */
async function waitForConfirmation(
  rpc: ReturnType<typeof createSolanaRpc>,
  signature: string,
  maxAttempts = 30,
  delayMs = 500,
): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const status = await rpc
      .getSignatureStatuses([signature as Parameters<typeof rpc.getSignatureStatuses>[0][0]])
      .send();
    if (status.value[0]?.confirmationStatus === "confirmed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Transaction ${signature} confirmation timed out after ${maxAttempts} attempts`);
}
