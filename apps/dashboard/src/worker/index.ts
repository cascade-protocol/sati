/**
 * SATI Dashboard Worker
 *
 * Serves the SPA and provides API endpoints for feedback attestations.
 * Implements x402 payment-gated feedback flow for demo agents using PayAI facilitator.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address, isAddress } from "@solana/kit";
import nacl from "tweetnacl";
import {
  computeInteractionHash,
  loadDeployedConfig,
  SATI,
  type Outcome,
} from "@cascade-fyi/sati-sdk";
import bs58 from "bs58";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

// =============================================================================
// Types
// =============================================================================

interface EchoEnv extends Env {
  // Agent signer private key (base58 encoded 64-byte secret key)
  // Used only for signing the echo response (blind signature)
  SATI_AGENT_SIGNER_KEY?: string;
  // Demo agent mint address
  DEMO_AGENT_MINT?: string;
  // Helius RPC URL for Light Protocol
  VITE_DEVNET_RPC?: string;
}

interface EchoRequest {
  // Parameters for computing interaction hash
  sasSchema: string;
  taskRef: string; // hex-encoded 32 bytes
  tokenAccount: string;
  dataHash: string; // hex-encoded 32 bytes
}

interface BuildFeedbackTxRequest {
  // Same params from echo
  sasSchema: string;
  taskRef: string; // hex-encoded 32 bytes
  tokenAccount: string;
  dataHash: string; // hex-encoded 32 bytes
  // Feedback-specific
  outcome: number; // 0=Negative, 1=Neutral, 2=Positive
  counterparty: string; // counterparty/payer address
  // Signatures (hex-encoded 64 bytes each)
  agentSignature: string;
  agentAddress: string;
  counterpartySignature: string;
}

// =============================================================================
// Constants
// =============================================================================

// x402.org facilitator for devnet (PayAI has load-balancing bug with feePayers)
const FACILITATOR_URL = "https://x402.org/facilitator";

// Solana Devnet CAIP-2 network identifier
const SOLANA_DEVNET_NETWORK =
  "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;

// Get deployed config (feedback schema + lookup table)
const deployedConfig = loadDeployedConfig("devnet");
const FEEDBACK_SCHEMA = deployedConfig?.schemas?.feedback;
const LOOKUP_TABLE = deployedConfig?.lookupTable;

// =============================================================================
// Helpers
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// =============================================================================
// Hono App Factory
// =============================================================================

/**
 * Creates the Hono app with x402 payment middleware.
 *
 * The payment middleware is configured dynamically based on the agent's address
 * which is derived from the SATI_AGENT_SIGNER_KEY environment variable.
 */
function createApp(env: EchoEnv) {
  const app = new Hono<{ Bindings: EchoEnv }>();

  app.use("/*", cors());

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

  // Demo agents list endpoint
  app.get("/api/demo-agents", (c) => {
    const demoAgentMint = env.DEMO_AGENT_MINT;

    if (!demoAgentMint) {
      return c.json({ agents: [] });
    }

    return c.json({
      agents: [
        {
          mint: demoAgentMint,
          name: "sati-test-signer",
          echoEnabled: true,
        },
      ],
    });
  });

  // Get agent address for payment routing
  let agentAddress: string | undefined;
  let agentSignerBytes: Uint8Array | undefined;

  if (env.SATI_AGENT_SIGNER_KEY) {
    try {
      agentSignerBytes = bs58.decode(env.SATI_AGENT_SIGNER_KEY);
      // Extract public key (last 32 bytes of 64-byte secret key)
      const publicKey = agentSignerBytes.slice(32);
      agentAddress = bs58.encode(publicKey);
    } catch (e) {
      console.error("Failed to decode agent signer key:", e);
    }
  }

  // Only set up payment middleware if agent is configured
  if (agentAddress) {
    // Create facilitator client
    const facilitatorClient = new HTTPFacilitatorClient({
      url: FACILITATOR_URL,
    });

    // Create x402 resource server with SVM scheme
    const resourceServer = new x402ResourceServer(facilitatorClient).register(
      SOLANA_DEVNET_NETWORK,
      new ExactSvmScheme(),
    );

    // Apply payment middleware to /api/echo
    app.use(
      "/api/echo",
      paymentMiddleware(
        {
          "POST /api/echo": {
            accepts: {
              scheme: "exact",
              network: SOLANA_DEVNET_NETWORK,
              price: "$0.01",
              payTo: agentAddress,
              extra: {
                feedbackSchema: FEEDBACK_SCHEMA,
                demoAgentMint: env.DEMO_AGENT_MINT,
              },
            },
            description: "SATI Echo - Agent signature for feedback attestation",
            mimeType: "application/json",
          },
        },
        resourceServer,
      ),
    );
  }

  // Echo endpoint - the actual handler (payment is verified by middleware)
  app.post("/api/echo", async (c) => {
    // If we get here, payment has been verified by middleware

    if (!agentSignerBytes || !agentAddress) {
      return c.json(
        { error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" },
        500,
      );
    }

    // Parse request body
    let body: EchoRequest;
    try {
      body = await c.req.json<EchoRequest>();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    // Validate required fields
    if (
      !body.sasSchema ||
      !body.taskRef ||
      !body.tokenAccount ||
      !body.dataHash
    ) {
      return c.json(
        {
          error:
            "Missing required fields: sasSchema, taskRef, tokenAccount, dataHash",
        },
        400,
      );
    }

    // Validate Solana addresses
    if (!isAddress(body.sasSchema)) {
      return c.json({ error: "Invalid sasSchema address" }, 400);
    }
    if (!isAddress(body.tokenAccount)) {
      return c.json({ error: "Invalid tokenAccount address" }, 400);
    }

    // Validate hex field lengths
    const taskRefBytes = hexToBytes(body.taskRef);
    const dataHashBytes = hexToBytes(body.dataHash);

    if (taskRefBytes.length !== 32) {
      return c.json({ error: "taskRef must be 32 bytes (64 hex chars)" }, 400);
    }
    if (dataHashBytes.length !== 32) {
      return c.json({ error: "dataHash must be 32 bytes (64 hex chars)" }, 400);
    }

    // Compute and sign the interaction hash
    const interactionHash = computeInteractionHash(
      body.sasSchema as Address,
      taskRefBytes,
      body.tokenAccount as Address,
      dataHashBytes,
    );

    // Sign the interaction hash with agent's private key
    const signature = nacl.sign.detached(interactionHash, agentSignerBytes);

    // Return the agent's signature
    return c.json({
      success: true,
      data: {
        agentAddress,
        interactionHash: bytesToHex(interactionHash),
        signature: bytesToHex(signature),
        signatureBase58: bs58.encode(signature),
      },
    });
  });

  // =============================================================================
  // POST /api/build-feedback-tx - Build unsigned feedback transaction
  // =============================================================================
  //
  // Builds the feedback attestation transaction server-side (needs Light Protocol)
  // and returns it for the browser wallet to sign and submit.
  //
  app.post("/api/build-feedback-tx", async (c) => {
    // Parse request body
    let body: BuildFeedbackTxRequest;
    try {
      body = await c.req.json<BuildFeedbackTxRequest>();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    // Validate required fields (counterpartySignature optional for SingleSigner schemas)
    if (
      !body.sasSchema ||
      !body.taskRef ||
      !body.tokenAccount ||
      !body.dataHash ||
      body.outcome === undefined ||
      !body.counterparty ||
      !body.agentSignature ||
      !body.agentAddress
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Validate addresses
    if (!isAddress(body.sasSchema)) {
      return c.json({ error: "Invalid sasSchema address" }, 400);
    }
    if (!isAddress(body.tokenAccount)) {
      return c.json({ error: "Invalid tokenAccount address" }, 400);
    }
    if (!isAddress(body.counterparty)) {
      return c.json({ error: "Invalid counterparty address" }, 400);
    }
    if (!isAddress(body.agentAddress)) {
      return c.json({ error: "Invalid agentAddress" }, 400);
    }

    // Validate hex field lengths
    const taskRefBytes = hexToBytes(body.taskRef);
    const dataHashBytes = hexToBytes(body.dataHash);
    const agentSigBytes = hexToBytes(body.agentSignature);

    if (taskRefBytes.length !== 32) {
      return c.json({ error: "taskRef must be 32 bytes" }, 400);
    }
    if (dataHashBytes.length !== 32) {
      return c.json({ error: "dataHash must be 32 bytes" }, 400);
    }
    if (agentSigBytes.length !== 64) {
      return c.json({ error: "agentSignature must be 64 bytes" }, 400);
    }

    // Validate counterparty signature if provided (optional for SingleSigner schemas)
    let counterpartySigBytes: Uint8Array | undefined;
    if (body.counterpartySignature) {
      counterpartySigBytes = hexToBytes(body.counterpartySignature);
      if (counterpartySigBytes.length !== 64) {
        return c.json({ error: "counterpartySignature must be 64 bytes" }, 400);
      }
    }

    // Validate outcome
    if (body.outcome < 0 || body.outcome > 2) {
      return c.json({ error: "outcome must be 0, 1, or 2" }, 400);
    }

    try {
      // Initialize SATI client with Helius RPC for Light Protocol
      const sati = new SATI({
        network: "devnet",
        rpcUrl: env.VITE_DEVNET_RPC,
        photonRpcUrl: env.VITE_DEVNET_RPC,
      });

      // Build the transaction (server-side Light Protocol calls)
      // Use Light Protocol's devnet ALT to reduce transaction size
      const result = await sati.buildFeedbackTransaction({
        payer: body.counterparty as Address, // counterparty is the payer
        sasSchema: body.sasSchema as Address,
        taskRef: taskRefBytes,
        tokenAccount: body.tokenAccount as Address,
        counterparty: body.counterparty as Address,
        dataHash: dataHashBytes,
        outcome: body.outcome as Outcome,
        agentSignature: {
          pubkey: body.agentAddress as Address,
          signature: agentSigBytes,
        },
        // Only include counterpartySignature for DualSignature schemas
        ...(counterpartySigBytes && {
          counterpartySignature: {
            pubkey: body.counterparty as Address,
            signature: counterpartySigBytes,
          },
        }),
        lookupTableAddress: LOOKUP_TABLE as Address,
      });

      return c.json({
        success: true,
        data: {
          attestationAddress: result.attestationAddress,
          messageBytes: result.messageBytes,
          signers: result.signers,
          blockhash: result.blockhash,
          lastValidBlockHeight: result.lastValidBlockHeight.toString(),
        },
      });
    } catch (error) {
      console.error("Failed to build feedback transaction:", error);
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to build transaction",
        },
        500,
      );
    }
  });

  return app;
}

// =============================================================================
// Worker Export
// =============================================================================

export default {
  async fetch(request: Request, env: EchoEnv, ctx: ExecutionContext) {
    const app = createApp(env);
    return app.fetch(request, env, ctx);
  },
};
