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
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { address, createKeyPairSignerFromBytes, type KeyPairSigner, type Address } from "@solana/kit";
import { Sati } from "../../src";
import { SignatureMode, StorageType } from "../../src/schemas";
import { createTestKeypair, type TestKeypair } from "./signatures";
import { createSatiLookupTable } from "./lookup-table";

// =============================================================================
// Configuration
// =============================================================================

const LOCALNET_RPC = "http://127.0.0.1:8899";
const LOCALNET_PHOTON = "http://127.0.0.1:8784";

// =============================================================================
// Types
// =============================================================================

export interface E2ETestContext {
  /** SATI SDK client */
  sati: Sati;

  /** Transaction fee payer (funded) */
  payer: KeyPairSigner;
  /** Raw payer keypair (for lookup table creation) */
  payerKp: Keypair;

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

  // Create connection for airdrops
  const connection = new Connection(rpcUrl, "confirmed");

  // Load local wallet as authority (matches registry initialization)
  const walletPath = path.join(homedir(), ".config/solana/id.json");
  const walletSecret = JSON.parse(readFileSync(walletPath, "utf-8"));
  const authorityKp = Keypair.fromSecretKey(Uint8Array.from(walletSecret));
  const authority = await createKeyPairSignerFromBytes(authorityKp.secretKey);

  // Create and fund payer
  const payerKp = Keypair.generate();
  const airdropSig = await connection.requestAirdrop(payerKp.publicKey, 10 * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(airdropSig, "confirmed");
  const payer = await createKeyPairSignerFromBytes(payerKp.secretKey);

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
    agentMint = address(Keypair.generate().publicKey.toBase58());
  }

  // Register schema
  let feedbackSchema: Address;
  if (!skipSchemaRegistration) {
    feedbackSchema = address(Keypair.generate().publicKey.toBase58());
    await sati.registerSchemaConfig({
      payer,
      authority,
      sasSchema: feedbackSchema,
      signatureMode: SignatureMode.DualSignature,
      storageType: StorageType.Compressed,
      closeable: true,
    });
  } else {
    feedbackSchema = address(Keypair.generate().publicKey.toBase58());
  }

  // Create lookup table
  let lookupTableAddress: Address;
  if (!skipLookupTable) {
    const { address: lutAddress } = await createSatiLookupTable(sati, payerKp);
    lookupTableAddress = lutAddress;
  } else {
    lookupTableAddress = address(Keypair.generate().publicKey.toBase58());
  }

  return {
    sati,
    payer,
    payerKp,
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
