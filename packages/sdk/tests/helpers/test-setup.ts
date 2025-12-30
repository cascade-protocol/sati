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
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  generateKeyPairSigner,
  lamports,
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

/** Extract seed from TestKeypair, throwing if not available (random keypairs have no seed) */
function requireSeed(keypair: TestKeypair, name: string): Uint8Array {
  if (!keypair.seed) {
    throw new Error(
      `${name} was created without a seed - use createTestKeypair(seedNumber) for deterministic keypairs`,
    );
  }
  return keypair.seed;
}

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

/**
 * Lightweight test context for signature-only tests (no RPC required).
 * Use this for unit tests that only verify signature creation/verification.
 */
export interface SignatureTestContext {
  /** Agent keypair for signing */
  agentKeypair: TestKeypair;
  /** Counterparty keypair for dual signatures */
  counterpartyKeypair: TestKeypair;
  /** Validator keypair for validation attestations */
  validatorKeypair: TestKeypair;
  /** Provider keypair for reputation attestations */
  providerKeypair: TestKeypair;
  /** SAS schema address */
  sasSchema: Address;
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
  // Solana CLI wallets store 64-byte keypairs (32-byte seed + 32-byte pubkey)
  const walletPath = path.join(homedir(), ".config/solana/id.json");
  const walletSecret = JSON.parse(readFileSync(walletPath, "utf-8"));
  const authority = await createKeyPairSignerFromPrivateKeyBytes(Uint8Array.from(walletSecret).slice(0, 32));

  // Create and fund payer
  const payer = await generateKeyPairSigner();
  const airdropSig = await rpc.requestAirdrop(payer.address, lamports(10_000_000_000n)).send();

  // Wait for airdrop confirmation
  await waitForConfirmation(rpc, airdropSig);

  // Create test keypairs for Ed25519 signing
  // agentOwnerKeypair is the NFT owner - use this for signing attestations
  const agentOwnerKeypair = await createTestKeypair(1);
  const counterpartyKeypair = await createTestKeypair(2);
  const validatorKeypair = await createTestKeypair(3);
  const providerKeypair = await createTestKeypair(4);

  // Create signers from keypairs (using 32-byte seed)
  const agentOwner = await createKeyPairSignerFromPrivateKeyBytes(requireSeed(agentOwnerKeypair, "agentOwner"));
  const counterparty = await createKeyPairSignerFromPrivateKeyBytes(requireSeed(counterpartyKeypair, "counterparty"));

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
 * Set up a lightweight test context for signature-only tests.
 *
 * Creates keypairs for signature testing without any RPC operations.
 * Use this for unit tests that don't need on-chain submission.
 *
 * @param baseSeed - Optional base seed for deterministic keypair generation
 */
export async function setupSignatureTest(baseSeed = 100): Promise<SignatureTestContext> {
  const [agentKeypair, counterpartyKeypair, validatorKeypair, providerKeypair, schemaKeypair] = await Promise.all([
    createTestKeypair(baseSeed),
    createTestKeypair(baseSeed + 1),
    createTestKeypair(baseSeed + 2),
    createTestKeypair(baseSeed + 3),
    createTestKeypair(baseSeed + 4),
  ]);

  return {
    agentKeypair,
    counterpartyKeypair,
    validatorKeypair,
    providerKeypair,
    sasSchema: schemaKeypair.address,
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
