/**
 * SATI Dashboard Worker
 *
 * Serves the SPA and provides API endpoints for feedback attestations.
 * Implements x402 payment-gated feedback flow for demo agents.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { type Address, isAddress, createKeyPairFromBytes, createKeyPairSignerFromBytes, signBytes } from "@solana/kit";
import {
  computeInteractionHash,
  loadDeployedConfig,
  Sati,
  type Outcome,
  Outcome as OutcomeEnum,
  MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE,
  serializeValidation,
  buildCounterpartyMessage,
  ContentType,
  type ParsedAttestation,
  type ParsedValidationAttestation,
  SATI_CHAIN_IDS,
  hexToBytes,
  bytesToHex,
} from "@cascade-fyi/sati-sdk";
import bs58 from "bs58";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { parse } from "../env";
import { fetchPopularMarket, generatePrediction, passesConfidenceThreshold } from "./predict";
import { computeCreditScore, computeLendingDecision } from "../react-app/lib/credit-engine";
import { createIdentityApi } from "./identity-api";
import { createFaucetApi } from "./faucet";

// =============================================================================
// Types
// =============================================================================

interface WorkerBindings extends Record<string, unknown> {
  VITE_HELIUS_API_KEY?: string;
  SATI_AGENT_SIGNER_KEY?: string;
  FAUCET_DEVNET_KEYPAIR?: string;
  FAUCET_KV?: KVNamespace;
}

interface EchoRequest {
  // Parameters for computing interaction hash
  sasSchema: string;
  taskRef: string; // hex-encoded 32 bytes
  agentMint: string;
  dataHash: string; // hex-encoded 32 bytes
}

interface CreditScoreRequest {
  agentMint: string;
  network: "devnet" | "mainnet";
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
  agentOwner: string;
  counterpartySignature?: string; // Optional for DualSignature schemas
  // For CounterpartySigned mode (FeedbackPublic): SIWS message bytes user signed
  counterpartyMessage?: string; // hex-encoded - triggers server-paid submission
  // Optional content (JSON string with value/tag1/tag2/message)
  content?: string;
  contentType?: number; // ContentType enum (1 = JSON)
}

// =============================================================================
// Constants
// =============================================================================

// Facilitator URLs
const FACILITATOR_URL_DEVNET = "https://www.x402.org/facilitator";
const FACILITATOR_URL_MAINNET = "https://x402.dexter.cash";
// const FACILITATOR_URL_MAINNET = "https://facilitator.payai.network";
// const FACILITATOR_URL_MAINNET = "https://pay.x402.jobs";
// const FACILITATOR_URL_MAINNET = "https://pay.openfacilitator.io";

// Solana CAIP-2 network identifiers (used for x402 payments)
const SOLANA_DEVNET_NETWORK = SATI_CHAIN_IDS.devnet;
const SOLANA_MAINNET_NETWORK = SATI_CHAIN_IDS.mainnet;

// Helper to create a Sati client for a given network
function createSatiClient(network: "devnet" | "mainnet", env: ReturnType<typeof parse>) {
  const { rpc: rpcUrl, ws: wsUrl } = env.RPC_URLS[network];
  return new Sati({ network, rpcUrl, wsUrl, photonRpcUrl: rpcUrl });
}

// Helper to get deployed config for a network
function getNetworkConfig(network: "devnet" | "mainnet") {
  const config = loadDeployedConfig(network);
  return {
    feedbackSchema: config?.schemas?.feedback,
    feedbackPublicSchema: config?.schemas?.feedbackPublic,
    validationSchema: config?.schemas?.validation,
    reputationScoreSchema: config?.schemas?.reputationScore,
    credential: config?.credential,
    lookupTable: config?.lookupTable,
  };
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

  // Global error handler - catches ALL uncaught errors
  app.onError((err, c) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    console.error(`[ERROR:${requestId}] ${c.req.method} ${c.req.path}`);
    console.error(`[ERROR:${requestId}] Message:`, err.message);
    console.error(`[ERROR:${requestId}] Stack:`, err.stack);

    if (err instanceof HTTPException) {
      return err.getResponse();
    }

    return c.json({ error: err.message, requestId }, 500);
  });

  // Request logging middleware - logs all requests and responses
  app.use("/*", async (c, next) => {
    const requestId = crypto.randomUUID().slice(0, 8);
    const start = Date.now();
    console.log(`[REQ:${requestId}] ${c.req.method} ${c.req.path}`);

    // Store requestId for later use
    c.set("requestId" as never, requestId as never);

    await next();

    const duration = Date.now() - start;
    console.log(`[RES:${requestId}] ${c.res.status} (${duration}ms)`);
  });

  app.use("/*", cors());

  // Health check
  app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

  // Config endpoint - returns demo agent info for the network
  app.get("/api/config", (c) => {
    const network = c.req.query("network") || "devnet";
    const demoAgentMint = network === "mainnet" ? env.DEMO_AGENT_MINT_MAINNET : env.DEMO_AGENT_MINT_DEVNET;
    return c.json({
      demoAgentMint: demoAgentMint || null,
    });
  });

  // Get agent address for payment routing
  let agentOwner: string | undefined;
  let agentSignerBytes: Uint8Array | undefined;
  // CryptoKeyPair Promise for concurrent-safe lazy initialization
  let agentKeyPairPromise: Promise<CryptoKeyPair> | undefined;

  if (env.SATI_AGENT_SIGNER_KEY) {
    try {
      agentSignerBytes = bs58.decode(env.SATI_AGENT_SIGNER_KEY);
      // Extract public key (last 32 bytes of 64-byte secret key)
      const publicKey = agentSignerBytes.slice(32);
      agentOwner = bs58.encode(publicKey);
    } catch (e) {
      console.error("Failed to decode agent signer key:", e);
    }
  }

  // Only set up payment middleware if agent is configured
  if (agentOwner) {
    // Create facilitator clients
    const devnetFacilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL_DEVNET });
    const mainnetFacilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL_MAINNET });

    // V1-style facilitators need maxAmountRequired field
    const isV1Facilitator =
      FACILITATOR_URL_MAINNET.includes("openfacilitator") || FACILITATOR_URL_MAINNET.includes("x402.jobs");

    console.log(
      `[x402] Mainnet facilitator: ${FACILITATOR_URL_MAINNET} (${isV1Facilitator ? "v1-compat" : "v2"} mode)`,
    );

    // ALWAYS override verify/settle for logging visibility - x402 middleware swallows errors
    mainnetFacilitator.verify = async (paymentPayload, paymentRequirements) => {
      const patchedRequirements = isV1Facilitator
        ? { ...paymentRequirements, maxAmountRequired: paymentRequirements.amount }
        : paymentRequirements;

      console.log(`[x402] VERIFY ${FACILITATOR_URL_MAINNET}`);
      console.log(`[x402] Verify payload:`, JSON.stringify(paymentPayload).slice(0, 500));

      try {
        const res = await fetch(`${FACILITATOR_URL_MAINNET}/verify`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ paymentPayload, paymentRequirements: patchedRequirements }),
        });

        const text = await res.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error("[x402] Verify response not JSON:", e, "Raw:", text.slice(0, 500));
          data = { raw: text.slice(0, 500) };
        }

        console.log(`[x402] Verify response: ${res.status}`, JSON.stringify(data));

        if (!res.ok) {
          const err = new Error(`Facilitator verify failed (${res.status}): ${JSON.stringify(data)}`);
          console.error("[x402] Verify error:", err.message);
          throw err;
        }

        if (!data.isValid) {
          console.error("[x402] Verify rejected:", data.invalidReason);
        }

        return {
          isValid: data.isValid as boolean,
          payer: data.payer as string,
          invalidReason: data.invalidReason as string | undefined,
          transaction: data.transaction as string | undefined,
        };
      } catch (e) {
        console.error("[x402] Verify exception:", e);
        throw e;
      }
    };

    mainnetFacilitator.settle = async (paymentPayload, paymentRequirements) => {
      const patchedRequirements = isV1Facilitator
        ? { ...paymentRequirements, maxAmountRequired: paymentRequirements.amount }
        : paymentRequirements;

      console.log(`[x402] SETTLE ${FACILITATOR_URL_MAINNET}`);

      try {
        const res = await fetch(`${FACILITATOR_URL_MAINNET}/settle`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ paymentPayload, paymentRequirements: patchedRequirements }),
        });

        const text = await res.text();
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error("[x402] Settle response not JSON:", e, "Raw:", text.slice(0, 500));
          data = { raw: text.slice(0, 500) };
        }

        console.log(`[x402] Settle response: ${res.status}`, JSON.stringify(data));

        if (!res.ok) {
          const err = new Error(`Facilitator settle failed (${res.status}): ${JSON.stringify(data)}`);
          console.error("[x402] Settle error:", err.message);
          throw err;
        }

        if (!data.success) {
          console.error("[x402] Settle failed:", data.errorReason || data);
        }

        return {
          success: data.success as boolean,
          transaction: data.transaction as string,
          network: paymentRequirements.network,
        };
      } catch (e) {
        console.error("[x402] Settle exception:", e);
        throw e;
      }
    };

    // Create x402 resource server with SVM scheme for both networks
    const resourceServer = new x402ResourceServer([devnetFacilitator, mainnetFacilitator])
      .register(SOLANA_DEVNET_NETWORK, new ExactSvmScheme())
      .register(SOLANA_MAINNET_NETWORK, new ExactSvmScheme());

    // Apply payment middleware to /api/echo (supports both devnet and mainnet)
    app.use(
      "/api/echo",
      paymentMiddleware(
        {
          "POST /api/echo": {
            accepts: [
              {
                scheme: "exact",
                network: SOLANA_DEVNET_NETWORK,
                price: "$0.001",
                payTo: agentOwner,
                extra: {
                  feedbackSchema: getNetworkConfig("devnet").feedbackSchema,
                  demoAgentMint: env.DEMO_AGENT_MINT_DEVNET,
                },
              },
              {
                scheme: "exact",
                network: SOLANA_MAINNET_NETWORK,
                price: "$0.001",
                payTo: agentOwner,
                extra: {
                  feedbackSchema: getNetworkConfig("mainnet").feedbackSchema,
                  demoAgentMint: env.DEMO_AGENT_MINT_MAINNET,
                },
              },
            ],
            description: "SATI Echo - Agent signature for feedback attestation",
            mimeType: "application/json",
          },
        },
        resourceServer,
      ),
    );

    // Apply payment middleware to /api/predict (supports both devnet and mainnet)
    app.use(
      "/api/predict",
      paymentMiddleware(
        {
          "POST /api/predict": {
            accepts: [
              {
                scheme: "exact",
                network: SOLANA_DEVNET_NETWORK,
                price: "$0.001",
                payTo: agentOwner,
                extra: {
                  validationSchema: getNetworkConfig("devnet").validationSchema,
                  feedbackSchema: getNetworkConfig("devnet").feedbackSchema,
                  predictionAgentMint: env.PREDICTION_AGENT_MINT_DEVNET,
                },
              },
              {
                scheme: "exact",
                network: SOLANA_MAINNET_NETWORK,
                price: "$0.001",
                payTo: agentOwner,
                extra: {
                  validationSchema: getNetworkConfig("mainnet").validationSchema,
                  feedbackSchema: getNetworkConfig("mainnet").feedbackSchema,
                  predictionAgentMint: env.PREDICTION_AGENT_MINT_MAINNET,
                },
              },
            ],
            description: "SATI Predict - AI prediction with validation attestation",
            mimeType: "application/json",
          },
        },
        resourceServer,
      ),
    );

    // Apply payment middleware to /api/register ($0.30 USDC for agent registration)
    app.use(
      "/api/register",
      paymentMiddleware(
        {
          "POST /api/register": {
            accepts: [
              {
                scheme: "exact",
                network: SOLANA_DEVNET_NETWORK,
                price: "$0.30",
                payTo: agentOwner,
              },
              {
                scheme: "exact",
                network: SOLANA_MAINNET_NETWORK,
                price: "$0.30",
                payTo: agentOwner,
              },
            ],
            description: "SATI Agent Registration - On-chain identity via Token-2022 NFT",
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

    if (!agentSignerBytes || !agentOwner) {
      return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
    }

    // Parse request body
    let body: EchoRequest;
    try {
      body = await c.req.json<EchoRequest>();
    } catch (e) {
      console.error("[echo] Failed to parse request body:", e);
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
        agentOwner,
        interactionHash: bytesToHex(interactionHash),
        signature: bytesToHex(signature),
        signatureBase58: bs58.encode(signature),
      },
    });
  });

  // =============================================================================
  // POST /api/predict - Kalshi prediction with ValidationV1 attestation
  // =============================================================================
  //
  // Fetches a popular Kalshi market, generates an AI prediction,
  // validates it (confidence threshold check), and creates a ValidationV1 attestation.
  //
  app.post("/api/predict", async (c) => {
    // If we get here, x402 payment has been verified by middleware

    if (!agentSignerBytes || !agentOwner) {
      return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return c.json({ error: "Server misconfigured: missing ANTHROPIC_API_KEY" }, 500);
    }

    // Get network from query param (body may be consumed by x402 middleware)
    const networkParam = c.req.query("network");
    const network = networkParam === "mainnet" ? "mainnet" : "devnet";
    const networkConfig = getNetworkConfig(network);

    // Get network-specific prediction agent mint
    const predictionAgentMint =
      network === "mainnet" ? env.PREDICTION_AGENT_MINT_MAINNET : env.PREDICTION_AGENT_MINT_DEVNET;

    if (!predictionAgentMint) {
      return c.json({ error: `Prediction agent not configured for ${network}` }, 500);
    }

    if (!networkConfig.validationSchema) {
      return c.json({ error: "Validation schema not configured for network" }, 500);
    }

    try {
      // Step 1: Fetch a popular Kalshi market
      const market = await fetchPopularMarket();
      if (!market) {
        return c.json({ error: "Failed to fetch market data from Kalshi" }, 500);
      }

      // Step 2: Generate AI prediction
      const prediction = await generatePrediction(env.ANTHROPIC_API_KEY, market);

      // Step 3: Compute taskRef and dataHash using Web Crypto SHA-256
      const timestamp = Date.now();
      const taskRefInput = `predict:${timestamp}:${market.ticker}`;
      const taskRefDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(taskRefInput));
      const taskRefBytes = new Uint8Array(taskRefDigest);

      // dataHash = SHA-256(JSON.stringify({market, prediction}))
      const dataHashInput = JSON.stringify({
        market: {
          ticker: market.ticker,
          title: market.title,
          yesPrice: market.yesPrice,
          noPrice: market.noPrice,
        },
        prediction: {
          outcome: prediction.prediction,
          confidence: prediction.confidence,
          reasoning: prediction.reasoning,
        },
      });
      const dataHashDigest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataHashInput));
      const dataHashBytes = new Uint8Array(dataHashDigest);

      // Step 4: Agent blind signature (signs interaction_hash BEFORE knowing validation outcome)
      // Sign for validation attestation
      const validationInteractionHash = computeInteractionHash(
        networkConfig.validationSchema as Address,
        taskRefBytes,
        dataHashBytes,
      );

      // Also sign for feedback attestation (different schema = different hash)
      const feedbackInteractionHash = computeInteractionHash(
        networkConfig.feedbackSchema as Address,
        taskRefBytes,
        dataHashBytes,
      );

      // Create keypair lazily (async) - Promise ensures concurrent-safe initialization
      if (!agentKeyPairPromise) {
        agentKeyPairPromise = createKeyPairFromBytes(agentSignerBytes);
      }
      const agentKeyPair = await agentKeyPairPromise;

      // Sign both interaction hashes with agent's private key (blind commitment)
      const validationAgentSignature = await signBytes(agentKeyPair.privateKey, validationInteractionHash);
      const feedbackAgentSignature = await signBytes(agentKeyPair.privateKey, feedbackInteractionHash);

      // Step 5: Validation check - does prediction pass confidence threshold?
      const CONFIDENCE_THRESHOLD = 60;
      const validationPassed = passesConfidenceThreshold(prediction.confidence, CONFIDENCE_THRESHOLD);
      const validationOutcome = validationPassed ? OutcomeEnum.Positive : OutcomeEnum.Negative;

      // Step 6: Create ValidationV1 attestation on-chain
      // Use dedicated validator key (DualSignature requires different signers for agent and validator)
      if (!env.SATI_DEMO_VALIDATOR_SIGNER_KEY) {
        return c.json({ error: "Server misconfigured: missing SATI_DEMO_VALIDATOR_SIGNER_KEY" }, 500);
      }
      const validatorSignerBytes = bs58.decode(env.SATI_DEMO_VALIDATOR_SIGNER_KEY);
      const validatorKeyPair = await createKeyPairFromBytes(validatorSignerBytes);
      // Extract public key (last 32 bytes of 64-byte secret key)
      const validatorAddress = bs58.encode(validatorSignerBytes.slice(32));

      const validationData = serializeValidation({
        taskRef: taskRefBytes,
        agentMint: predictionAgentMint as Address,
        counterparty: validatorAddress as Address,
        dataHash: dataHashBytes,
        outcome: validationOutcome,
        contentType: ContentType.None,
        content: new Uint8Array(0),
      });

      // Build SIWS message for validator signature
      const { messageBytes: validatorMessage } = buildCounterpartyMessage({
        schemaName: "ValidationV1",
        data: validationData,
      });

      // Validator signs the SIWS message
      const validatorSignature = await signBytes(validatorKeyPair.privateKey, validatorMessage);

      // Create ValidationV1 attestation
      const sati = createSatiClient(network, env);

      const serverPayer = await createKeyPairSignerFromBytes(agentSignerBytes);

      const validationResult = await sati.createValidation({
        payer: serverPayer,
        sasSchema: networkConfig.validationSchema as Address,
        taskRef: taskRefBytes,
        agentMint: predictionAgentMint as Address,
        counterparty: validatorAddress as Address,
        dataHash: dataHashBytes,
        outcome: validationOutcome,
        contentType: ContentType.None,
        content: new Uint8Array(0),
        agentSignature: {
          pubkey: agentOwner as Address,
          signature: validationAgentSignature,
        },
        validatorSignature: {
          pubkey: validatorAddress as Address,
          signature: validatorSignature,
        },
        counterpartyMessage: validatorMessage,
        lookupTableAddress: networkConfig.lookupTable as Address,
      });

      // Step 7: Return prediction result with validation proof
      return c.json({
        success: true,
        data: {
          market: {
            ticker: market.ticker,
            title: market.title,
            subtitle: market.subtitle,
            yesPrice: market.yesPrice,
            noPrice: market.noPrice,
            closeTime: market.closeTime,
          },
          prediction: {
            outcome: prediction.prediction,
            confidence: prediction.confidence,
            reasoning: prediction.reasoning,
          },
          validation: {
            outcome: validationPassed ? "Pass" : "Fail",
            threshold: CONFIDENCE_THRESHOLD,
            attestationAddress: validationResult.address,
            signature: validationResult.signature,
          },
          // For feedback flow (uses feedback schema's interaction hash)
          taskRef: bytesToHex(taskRefBytes),
          dataHash: bytesToHex(dataHashBytes),
          agentSignature: bytesToHex(feedbackAgentSignature),
          agentOwner,
          agentMint: predictionAgentMint,
        },
      });
    } catch (error) {
      console.error("[predict] ERROR:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to generate prediction";
      console.error("[predict] Error message:", errorMessage);
      if (error instanceof Error && error.stack) {
        console.error("[predict] Stack:", error.stack);
      }
      return c.json({ error: errorMessage }, 500);
    }
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
    } catch (e) {
      console.error("[build-feedback-tx] Failed to parse request body:", e);
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
      !body.agentOwner
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
    if (!isAddress(body.agentOwner)) {
      return c.json({ error: "Invalid agentOwner" }, 400);
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

    // Validate content size (CounterpartySigned schema has 100 byte limit)
    if (body.content) {
      const contentBytes = new TextEncoder().encode(body.content);
      if (contentBytes.length > MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE) {
        return c.json(
          {
            error: `Content too large: ${contentBytes.length} bytes exceeds maximum ${MAX_COUNTERPARTY_SIGNED_CONTENT_SIZE} bytes`,
          },
          400,
        );
      }
    }

    // Detect CounterpartySigned mode (FeedbackPublic): has counterpartyMessage but NO counterpartySignature
    // DualSignature mode: has BOTH counterpartyMessage AND counterpartySignature
    const isCounterpartySigned = !!body.counterpartyMessage && !body.counterpartySignature;

    // Validate counterpartyMessage if provided
    let counterpartyMessageBytes: Uint8Array | undefined;
    if (body.counterpartyMessage) {
      counterpartyMessageBytes = hexToBytes(body.counterpartyMessage);
    }

    try {
      // Get network-appropriate RPC URLs
      // Initialize Sati client with Helius RPC for Light Protocol
      const sati = createSatiClient(body.network, env);

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
            pubkey: body.agentOwner as Address,
            signature: agentSigBytes,
          },
          // SIWS message bytes the user signed
          counterpartyMessage: counterpartyMessageBytes,
          lookupTableAddress: networkConfig.lookupTable as Address,
          // Optional content (JSON with value/tag1/tag2/message)
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
        // DualSignature mode: Server pays and submits (same as FeedbackPublic)
        // =================================================================
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
          agentSignature: {
            pubkey: body.agentOwner as Address,
            signature: agentSigBytes,
          },
          // Include counterpartySignature for DualSignature schemas
          ...(counterpartySigBytes && {
            counterpartySignature: {
              pubkey: body.counterparty as Address,
              signature: counterpartySigBytes,
            },
          }),
          // counterpartyMessage required when counterpartySignature is provided
          counterpartyMessage: counterpartyMessageBytes,
          lookupTableAddress: networkConfig.lookupTable as Address,
          // Optional content (JSON with value/tag1/tag2/message)
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
      }
    } catch (error) {
      console.error("[build-feedback-tx] ERROR:", error);
      if (error instanceof Error && error.stack) {
        console.error("[build-feedback-tx] Stack:", error.stack);
      }
      return c.json(
        {
          error: error instanceof Error ? error.message : "Failed to process feedback",
        },
        500,
      );
    }
  });

  // =============================================================================
  // POST /api/credit-score - Compute and publish on-chain credit score
  // =============================================================================
  //
  // Reads an agent's feedback + validation history, computes a credit score,
  // publishes it as a ReputationScoreV3 attestation, and returns lending terms.
  // No x402 gate - free endpoint for demo purposes.
  //
  app.post("/api/credit-score", async (c) => {
    if (!agentSignerBytes) {
      return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
    }

    let body: CreditScoreRequest;
    try {
      body = await c.req.json<CreditScoreRequest>();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    if (!body.agentMint || !body.network) {
      return c.json({ error: "Missing required fields: agentMint, network" }, 400);
    }

    if (body.network !== "devnet" && body.network !== "mainnet") {
      return c.json({ error: "Invalid network" }, 400);
    }

    if (!isAddress(body.agentMint)) {
      return c.json({ error: "Invalid agentMint address" }, 400);
    }

    const networkConfig = getNetworkConfig(body.network);

    if (!networkConfig.reputationScoreSchema) {
      return c.json({ error: "ReputationScore schema not configured for network" }, 500);
    }

    if (!networkConfig.credential) {
      return c.json({ error: "Credential not configured for network" }, 500);
    }

    try {
      const sati = createSatiClient(body.network, env);

      // Fetch feedbacks from both schemas
      const feedbackSchemas = [networkConfig.feedbackSchema, networkConfig.feedbackPublicSchema].filter(
        Boolean,
      ) as string[];

      const allFeedbacks: ParsedAttestation[] = [];
      for (const schema of feedbackSchemas) {
        const result = await sati.listFeedbacks({ sasSchema: schema as Address, agentMint: body.agentMint as Address });
        allFeedbacks.push(...result.items);
      }

      // Fetch validations
      const allValidations: ParsedValidationAttestation[] = [];
      if (networkConfig.validationSchema) {
        const result = await sati.listValidations({
          sasSchema: networkConfig.validationSchema as Address,
          agentMint: body.agentMint as Address,
        });
        allValidations.push(...result.items);
      }

      // Compute credit score
      const creditScore = computeCreditScore(allFeedbacks, allValidations);
      const lendingDecision = computeLendingDecision(creditScore);

      // Publish ReputationScoreV3 on-chain
      const serverPayer = await createKeyPairSignerFromBytes(agentSignerBytes);

      const content = new TextEncoder().encode(
        JSON.stringify({
          s: creditScore.score,
          m: "sati-credit-v1",
          t: creditScore.tier,
          fc: creditScore.feedbackCount,
          vc: creditScore.validationCount,
          pr: Math.round(creditScore.positiveRate * 100),
          vr: Math.round(creditScore.validationPassRate * 100),
        }),
      );

      const result = await sati.updateReputationScore({
        payer: serverPayer,
        provider: serverPayer,
        sasSchema: networkConfig.reputationScoreSchema as Address,
        satiCredential: networkConfig.credential as Address,
        agentMint: body.agentMint as Address,
        outcome: creditScore.score >= 60 ? OutcomeEnum.Positive : OutcomeEnum.Negative,
        contentType: ContentType.JSON,
        content,
      });

      return c.json({
        success: true,
        data: {
          creditScore,
          lendingDecision,
          attestation: {
            address: result.address,
            signature: result.signature,
          },
        },
      });
    } catch (error) {
      console.error("[credit-score] ERROR:", error);
      if (error instanceof Error && error.stack) {
        console.error("[credit-score] Stack:", error.stack);
      }
      return c.json({ error: error instanceof Error ? error.message : "Failed to compute credit score" }, 500);
    }
  });

  // =============================================================================
  // Identity Service API (register, discover, feedback, reputation)
  // =============================================================================

  const identityApi = createIdentityApi(env);
  app.route("/", identityApi);

  // Faucet API (devnet only) - requires FAUCET_DEVNET_KEYPAIR + FAUCET_KV bindings
  const faucetKeypair = bindings.FAUCET_DEVNET_KEYPAIR as string | undefined;
  const faucetKv = bindings.FAUCET_KV as KVNamespace | undefined;
  if (faucetKeypair && faucetKv && env.VITE_HELIUS_API_KEY) {
    const faucetApi = createFaucetApi({
      faucetKeypair,
      heliusApiKey: env.VITE_HELIUS_API_KEY,
      kv: faucetKv,
    });
    app.route("/", faucetApi);
  }

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
