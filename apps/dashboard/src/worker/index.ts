/**
 * SATI Dashboard Worker
 *
 * Serves the SPA and provides API endpoints for feedback attestations.
 * Implements x402 payment-gated feedback flow for demo agents using PayAI facilitator.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { type Address, isAddress, createKeyPairFromBytes, createKeyPairSignerFromBytes, signBytes } from "@solana/kit";
import {
  computeInteractionHash,
  loadDeployedConfig,
  Sati,
  type Outcome,
  MAX_SINGLE_SIGNATURE_CONTENT_SIZE,
} from "@cascade-fyi/sati-sdk";
import bs58 from "bs58";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { parse } from "../env";

// =============================================================================
// Types
// =============================================================================

interface WorkerBindings extends Record<string, unknown> {
  VITE_HELIUS_API_KEY?: string;
  SATI_AGENT_SIGNER_KEY?: string;
  DEMO_AGENT_MINT_DEVNET?: string;
  DEMO_AGENT_MINT_MAINNET?: string;
}

interface EchoRequest {
  // Parameters for computing interaction hash
  sasSchema: string;
  taskRef: string; // hex-encoded 32 bytes
  agentMint: string;
  dataHash: string; // hex-encoded 32 bytes
}

interface BuildFeedbackTxRequest {
  // Network to submit on
  network: "devnet" | "mainnet";
  // Same params from echo
  sasSchema: string;
  taskRef: string; // hex-encoded 32 bytes
  agentMint: string;
  dataHash: string; // hex-encoded 32 bytes
  // Feedback-specific
  outcome: number; // 0=Negative, 1=Neutral, 2=Positive
  counterparty: string; // counterparty/payer address
  // Signatures (hex-encoded 64 bytes each)
  agentSignature: string;
  agentAddress: string;
  counterpartySignature?: string; // Optional for DualSignature schemas
  // For CounterpartySigned mode (FeedbackPublic): SIWS message bytes user signed
  counterpartyMessage?: string; // hex-encoded - triggers server-paid submission
  // Optional content (JSON string with tags/score/message)
  content?: string;
  contentType?: number; // ContentType enum (1 = JSON)
}

// =============================================================================
// Constants
// =============================================================================

// x402.org facilitator for devnet (PayAI has load-balancing bug with feePayers)
const FACILITATOR_URL = "https://x402.org/facilitator";

// Solana Devnet CAIP-2 network identifier (used for x402 echo demo)
const SOLANA_DEVNET_NETWORK = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1" as const;

// Helper to get deployed config for a network
function getNetworkConfig(network: "devnet" | "mainnet") {
  const config = loadDeployedConfig(network);
  return {
    feedbackSchema: config?.schemas?.feedback,
    feedbackPublicSchema: config?.schemas?.feedbackPublic,
    lookupTable: config?.lookupTable,
  };
}

// =============================================================================
// Helpers
// =============================================================================

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith("0x") ? hex.slice(2) : hex;
  // Validate hex string format to prevent silent NaN corruption
  if (!/^[0-9a-fA-F]*$/.test(cleanHex) || cleanHex.length % 2 !== 0) {
    throw new Error(`Invalid hex string: ${hex}`);
  }
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
function createApp(bindings: WorkerBindings) {
  const env = parse(bindings);
  const app = new Hono<{ Bindings: WorkerBindings }>();

  app.use("/*", cors());

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

  // Demo agents list endpoint (accepts optional network query param)
  app.get("/api/demo-agents", (c) => {
    const network = c.req.query("network") || "devnet";
    const demoAgentMint = network === "mainnet" ? env.DEMO_AGENT_MINT_MAINNET : env.DEMO_AGENT_MINT_DEVNET;

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
  // CryptoKeyPair Promise for concurrent-safe lazy initialization
  let agentKeyPairPromise: Promise<CryptoKeyPair> | undefined;

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
                feedbackSchema: getNetworkConfig("devnet").feedbackSchema,
                demoAgentMint: env.DEMO_AGENT_MINT_DEVNET,
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
      return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
    }

    // Parse request body
    let body: EchoRequest;
    try {
      body = await c.req.json<EchoRequest>();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    // Validate required fields
    if (!body.sasSchema || !body.taskRef || !body.agentMint || !body.dataHash) {
      return c.json(
        {
          error: "Missing required fields: sasSchema, taskRef, agentMint, dataHash",
        },
        400,
      );
    }

    // Validate Solana addresses
    if (!isAddress(body.sasSchema)) {
      return c.json({ error: "Invalid sasSchema address" }, 400);
    }
    if (!isAddress(body.agentMint)) {
      return c.json({ error: "Invalid agentMint address" }, 400);
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
    const interactionHash = computeInteractionHash(body.sasSchema as Address, taskRefBytes, dataHashBytes);

    // Create keypair lazily (async) - Promise ensures concurrent-safe initialization
    if (!agentKeyPairPromise) {
      agentKeyPairPromise = createKeyPairFromBytes(agentSignerBytes);
    }
    const agentKeyPair = await agentKeyPairPromise;

    // Sign the interaction hash with agent's private key using Web Crypto
    const signature = await signBytes(agentKeyPair.privateKey, interactionHash);

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
      !body.network ||
      !body.sasSchema ||
      !body.taskRef ||
      !body.agentMint ||
      !body.dataHash ||
      body.outcome === undefined ||
      !body.counterparty ||
      !body.agentSignature ||
      !body.agentAddress
    ) {
      return c.json({ error: "Missing required fields" }, 400);
    }

    // Validate network
    if (body.network !== "devnet" && body.network !== "mainnet") {
      return c.json({ error: "Invalid network - must be 'devnet' or 'mainnet'" }, 400);
    }

    // Get network-specific config
    const networkConfig = getNetworkConfig(body.network);

    // Validate addresses
    if (!isAddress(body.sasSchema)) {
      return c.json({ error: "Invalid sasSchema address" }, 400);
    }
    // Validate schema is one of the allowed feedback schemas (security check)
    if (body.sasSchema !== networkConfig.feedbackSchema && body.sasSchema !== networkConfig.feedbackPublicSchema) {
      return c.json({ error: "Invalid schema - only feedback/feedbackPublic schemas supported" }, 400);
    }
    if (!isAddress(body.agentMint)) {
      return c.json({ error: "Invalid agentMint address" }, 400);
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

    // Validate content size (SingleSigner schema has 240 byte limit)
    if (body.content) {
      const contentBytes = new TextEncoder().encode(body.content);
      if (contentBytes.length > MAX_SINGLE_SIGNATURE_CONTENT_SIZE) {
        return c.json(
          {
            error: `Content too large: ${contentBytes.length} bytes exceeds maximum ${MAX_SINGLE_SIGNATURE_CONTENT_SIZE} bytes`,
          },
          400,
        );
      }
    }

    // Detect CounterpartySigned mode (FeedbackPublic) by presence of counterpartyMessage
    const isCounterpartySigned = !!body.counterpartyMessage;

    // Validate counterpartyMessage if provided
    let counterpartyMessageBytes: Uint8Array | undefined;
    if (body.counterpartyMessage) {
      counterpartyMessageBytes = hexToBytes(body.counterpartyMessage);
    }

    try {
      // Get network-appropriate RPC URLs
      const { rpc: rpcUrl, ws: wsUrl } = env.RPC_URLS[body.network];

      // Initialize Sati client with Helius RPC for Light Protocol
      const sati = new Sati({
        network: body.network,
        rpcUrl,
        wsUrl,
        photonRpcUrl: rpcUrl,
      });

      if (isCounterpartySigned) {
        // =================================================================
        // CounterpartySigned mode (FeedbackPublic): Server pays and submits
        // =================================================================
        // User only signed SIWS message, server pays gas and submits tx

        if (!agentSignerBytes) {
          return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
        }

        // Create signer from server's key to pay for transaction
        const serverPayer = await createKeyPairSignerFromBytes(agentSignerBytes);

        const result = await sati.createFeedback({
          payer: serverPayer, // Server pays gas!
          sasSchema: body.sasSchema as Address,
          taskRef: taskRefBytes,
          agentMint: body.agentMint as Address,
          counterparty: body.counterparty as Address,
          dataHash: dataHashBytes,
          outcome: body.outcome as Outcome,
          // For CounterpartySigned: user's SIWS signature goes as agentSignature
          agentSignature: {
            pubkey: body.agentAddress as Address,
            signature: agentSigBytes,
          },
          // SIWS message bytes the user signed
          counterpartyMessage: counterpartyMessageBytes,
          lookupTableAddress: networkConfig.lookupTable as Address,
          // Optional content (JSON with tags/score/message)
          ...(body.content && {
            contentType: body.contentType ?? 1, // 1 = JSON
            content: new TextEncoder().encode(body.content),
          }),
        });

        return c.json({
          success: true,
          attestationAddress: result.address,
          signature: result.signature,
        });
      } else {
        // =================================================================
        // DualSignature mode: Build unsigned tx, user pays and submits
        // =================================================================
        const result = await sati.buildFeedbackTransaction({
          payer: body.counterparty as Address, // counterparty is the payer
          sasSchema: body.sasSchema as Address,
          taskRef: taskRefBytes,
          agentMint: body.agentMint as Address,
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
          lookupTableAddress: networkConfig.lookupTable as Address,
          // Optional content (JSON with tags/score/message)
          ...(body.content && {
            contentType: body.contentType ?? 1, // 1 = JSON
            content: new TextEncoder().encode(body.content),
          }),
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
      }
    } catch (error) {
      console.error("Failed to process feedback:", error);
      return c.json(
        {
          error: error instanceof Error ? error.message : "Failed to process feedback",
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
  async fetch(request: Request, bindings: WorkerBindings, ctx: ExecutionContext) {
    const app = createApp(bindings);
    return app.fetch(request, bindings, ctx);
  },
};
