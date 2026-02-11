/**
 * SATI-specific configuration types for the agent0 adapter.
 *
 * All agent0-compatible types (AgentSummary, Feedback, RegistrationFile, etc.)
 * are imported directly from `agent0-sdk` - we do not redefine them here.
 */

import type { KeyPairSigner } from "@solana/kit";

/**
 * Configuration for the SATI Agent0 adapter SDK.
 *
 * Maps agent0-sdk's SDKConfig concept to SATI's Solana infrastructure.
 */
export interface SatiSDKConfig {
  /** SATI network to connect to */
  network: "mainnet" | "devnet" | "localnet";
  /** Solana signer (Ed25519 keypair) for write operations */
  signer: KeyPairSigner;
  /** Custom RPC URL (overrides network default) */
  rpcUrl?: string;
  /** Pinata JWT for IPFS uploads (required for registerIPFS) */
  pinataJwt?: string;
}
