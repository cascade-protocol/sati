/**
 * SATI Identity Service API
 *
 * Provides HTTP endpoints for agent registration, discovery, feedback,
 * and reputation queries. ERC-8004 compatible.
 *
 * - Registration: x402 paywalled ($0.30 USDC), mints Token-2022 NFT
 * - Feedback: free, server acts as counterparty
 * - Discovery & reputation: free read endpoints
 */

import { Hono } from "hono";
import { type Address, isAddress, createKeyPairSignerFromBytes, signBytes, createKeyPairFromBytes } from "@solana/kit";
import {
  Sati,
  buildRegistrationFile,
  fetchRegistrationFile,
  createPinataUploader,
  serializeFeedback,
  buildCounterpartyMessage,
  buildFeedbackContent,
  ContentType,
  parseFeedbackContent,
  Outcome as OutcomeEnum,
  type FeedbackData,
  SATI_PROGRAM_ADDRESS,
  SATI_CHAIN_IDS,
  type AgentIdentity,
} from "@cascade-fyi/sati-sdk";
import type { ServiceDefinition, TrustMechanism } from "@cascade-fyi/sati-sdk";
import bs58 from "bs58";
import type { Env } from "../env";

// =============================================================================
// Rate Limiter (per-isolate, best-effort)
// =============================================================================

/** Per-IP sliding window rate limiter. State lives in module scope (shared within a CF Worker isolate). */
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count++;
  return bucket.count > maxRequests;
}

// Periodic cleanup of stale buckets (runs at most once per minute)
let lastCleanup = 0;
function cleanupBuckets() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, bucket] of rateLimitBuckets) {
    if (now >= bucket.resetAt) rateLimitBuckets.delete(key);
  }
}

// =============================================================================
// Constants
// =============================================================================

const MAX_METADATA_SIZE = 100 * 1024; // 100 KB

// =============================================================================
// Types
// =============================================================================

interface RegisterRequest {
  network?: "devnet" | "mainnet";
  ownerAddress: string;
  name: string;
  description: string;
  image: string;
  services?: Array<{
    name: string;
    endpoint: string;
    version?: string;
    mcpTools?: string[];
    mcpPrompts?: string[];
    mcpResources?: string[];
    a2aSkills?: string[];
    skills?: string[];
    domains?: string[];
  }>;
  x402Support?: boolean;
  active?: boolean;
  supportedTrust?: string[];
  externalUrl?: string;
}

interface FeedbackRequest {
  network?: "devnet" | "mainnet";
  agentMint: string;
  value: number;
  valueDecimals?: number;
  tag1?: string;
  tag2?: string;
  endpoint?: string;
  reviewerAddress?: string;
  feedbackURI?: string;
  feedbackHash?: string;
}

// CAIP-2 chain identifiers (from SDK)
const CAIP2_CHAINS = SATI_CHAIN_IDS;

// =============================================================================
// Helpers
// =============================================================================

function getNetwork(param: string | undefined): "devnet" | "mainnet" {
  return param === "devnet" ? "devnet" : "mainnet";
}

function createSatiClient(network: "devnet" | "mainnet", env: Env) {
  const { rpc: rpcUrl, ws: wsUrl } = env.RPC_URLS[network];
  return new Sati({ network, rpcUrl, wsUrl, photonRpcUrl: rpcUrl });
}

function getNetworkConfig(sati: Sati) {
  return {
    feedbackSchema: sati.feedbackSchema,
    feedbackPublicSchema: sati.feedbackPublicSchema,
    validationSchema: sati.validationSchema,
    reputationScoreSchema: sati.reputationScoreSchema,
    credential: sati.credential,
    lookupTable: sati.lookupTable,
  };
}

// =============================================================================
// App Factory
// =============================================================================

export function createIdentityApi(env: Env) {
  const app = new Hono();

  // Decode server signer (reused across endpoints)
  let signerBytes: Uint8Array | undefined;
  let signerKeyPairPromise: Promise<CryptoKeyPair> | undefined;

  if (env.SATI_AGENT_SIGNER_KEY) {
    try {
      signerBytes = bs58.decode(env.SATI_AGENT_SIGNER_KEY);
    } catch (e) {
      console.error("[identity-api] Failed to decode signer key:", e);
    }
  }

  // ---------------------------------------------------------------------------
  // POST /api/register - Register agent identity (x402 paywalled)
  // ---------------------------------------------------------------------------

  app.post("/api/register", async (c) => {
    if (!signerBytes) {
      return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
    }

    if (!env.PINATA_JWT) {
      return c.json({ error: "Server misconfigured: missing PINATA_JWT" }, 500);
    }

    let body: RegisterRequest;
    try {
      body = await c.req.json<RegisterRequest>();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    // Validate required fields
    if (!body.name?.trim()) {
      return c.json({ error: "Missing required field: name" }, 400);
    }
    if (!body.description?.trim()) {
      return c.json({ error: "Missing required field: description" }, 400);
    }
    if (!body.image?.trim()) {
      return c.json({ error: "Missing required field: image" }, 400);
    }
    if (!body.ownerAddress?.trim()) {
      return c.json({ error: "Missing required field: ownerAddress" }, 400);
    }
    if (!isAddress(body.ownerAddress)) {
      return c.json({ error: "Invalid ownerAddress - must be a valid Solana address" }, 400);
    }

    const network = getNetwork(body.network);

    try {
      // Build registration file (ERC-8004 format)
      const regFile = buildRegistrationFile({
        name: body.name.trim(),
        description: body.description.trim(),
        image: body.image.trim(),
        externalUrl: body.externalUrl,
        services: body.services as ServiceDefinition[],
        supportedTrust: body.supportedTrust as TrustMechanism[],
        active: body.active ?? true,
        x402Support: body.x402Support,
      });

      // Upload to IPFS
      const uploader = createPinataUploader(env.PINATA_JWT);
      const uri = await uploader.upload(regFile);

      // Register on-chain
      const sati = createSatiClient(network, env);
      const serverPayer = await createKeyPairSignerFromBytes(signerBytes);

      const result = await sati.registerAgent({
        payer: serverPayer,
        name: body.name.trim(),
        uri,
        owner: body.ownerAddress as Address,
      });

      // Build CAIP-10 agent ID
      const chainId = CAIP2_CHAINS[network];
      const agentId = `${chainId}:${result.mint}`;

      return c.json({
        success: true,
        mint: result.mint,
        agentId,
        memberNumber: Number(result.memberNumber),
        signature: result.signature,
        uri,
        registrations: [
          {
            agentId: result.mint,
            agentRegistry: `${chainId}:${SATI_PROGRAM_ADDRESS}`,
          },
        ],
      });
    } catch (error) {
      console.error("[register] ERROR:", error);
      if (error instanceof Error && error.stack) {
        console.error("[register] Stack:", error.stack);
      }
      return c.json({ error: error instanceof Error ? error.message : "Registration failed" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents - List/search agents
  // ---------------------------------------------------------------------------

  app.get("/api/agents", async (c) => {
    const network = getNetwork(c.req.query("network"));
    const nameFilter = c.req.query("name")?.toLowerCase();
    const ownerFilter = c.req.query("owner");
    const limitParam = Number.parseInt(c.req.query("limit") ?? "20", 10);
    const limit = Math.min(Math.max(limitParam, 1), 50);

    try {
      const sati = createSatiClient(network, env);

      let agents: AgentIdentity[];
      if (ownerFilter) {
        if (!isAddress(ownerFilter)) {
          return c.json({ error: "Invalid owner address" }, 400);
        }
        agents = await sati.listAgentsByOwner(ownerFilter as Address);
      } else {
        const result = await sati.listAllAgents({ limit });
        agents = result.agents;
      }

      // Fetch registration files and apply name filter
      const results = [];
      for (const agent of agents) {
        if (results.length >= limit) break;

        const regFile = await fetchRegistrationFile(agent.uri, { strict: true });

        if (nameFilter) {
          const agentName = (regFile?.name ?? agent.name).toLowerCase();
          if (!agentName.includes(nameFilter)) continue;
        }

        results.push({
          mint: agent.mint,
          agentId: `${CAIP2_CHAINS[network]}:${agent.mint}`,
          owner: agent.owner,
          name: regFile?.name ?? agent.name,
          description: regFile?.description ?? "",
          image: regFile?.image ?? "",
          uri: agent.uri,
          memberNumber: Number(agent.memberNumber),
          active: regFile?.active ?? true,
          services: regFile?.services ?? [],
          supportedTrust: regFile?.supportedTrust ?? [],
          x402Support: regFile?.x402Support ?? false,
        });
      }

      return c.json({ agents: results, count: results.length });
    } catch (error) {
      console.error("[agents] ERROR:", error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to list agents" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/agents/:mint - Get single agent
  // ---------------------------------------------------------------------------

  app.get("/api/agents/:mint", async (c) => {
    const mint = c.req.param("mint");
    const network = getNetwork(c.req.query("network"));

    if (!isAddress(mint)) {
      return c.json({ error: "Invalid mint address" }, 400);
    }

    try {
      const sati = createSatiClient(network, env);
      const agent = await sati.loadAgent(mint as Address);

      if (!agent) {
        return c.json({ error: "Agent not found" }, 404);
      }

      const regFile = await fetchRegistrationFile(agent.uri, { strict: true });

      // Fetch reputation summary
      const networkConfig = getNetworkConfig(sati);
      const feedbackSchemas = [networkConfig.feedbackSchema, networkConfig.feedbackPublicSchema].filter(Boolean);

      let feedbackCount = 0;
      let totalValue = 0;

      for (const schema of feedbackSchemas) {
        const feedbacks = await sati.listFeedbacks({
          sasSchema: schema as Address,
          agentMint: mint as Address,
        });

        for (const fb of feedbacks.items) {
          const parsed = parseFeedbackContent(fb.data.content, fb.data.contentType);
          feedbackCount++;
          if (parsed?.value !== undefined) {
            totalValue += parsed.value;
          }
        }
      }

      return c.json({
        mint: agent.mint,
        agentId: `${CAIP2_CHAINS[network]}:${agent.mint}`,
        owner: agent.owner,
        name: regFile?.name ?? agent.name,
        description: regFile?.description ?? "",
        image: regFile?.image ?? "",
        uri: agent.uri,
        memberNumber: Number(agent.memberNumber),
        active: regFile?.active ?? true,
        services: regFile?.services ?? [],
        supportedTrust: regFile?.supportedTrust ?? [],
        x402Support: regFile?.x402Support ?? false,
        registrations: regFile?.registrations ?? [],
        reputation: {
          count: feedbackCount,
          summaryValue: feedbackCount > 0 ? Math.round(totalValue / feedbackCount) : 0,
          summaryValueDecimals: 0,
        },
      });
    } catch (error) {
      console.error("[agent] ERROR:", error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to load agent" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/reputation/:mint - Get reputation summary
  // ---------------------------------------------------------------------------

  app.get("/api/reputation/:mint", async (c) => {
    const mint = c.req.param("mint");
    const network = getNetwork(c.req.query("network"));
    const tag1Filter = c.req.query("tag1");
    const tag2Filter = c.req.query("tag2");
    const clientAddressesParam = c.req.query("clientAddresses");

    if (!isAddress(mint)) {
      return c.json({ error: "Invalid mint address" }, 400);
    }

    const clientAddresses = clientAddressesParam?.split(",").filter(Boolean) ?? [];

    try {
      const sati = createSatiClient(network, env);
      const networkConfig = getNetworkConfig(sati);
      const feedbackSchemas = [networkConfig.feedbackSchema, networkConfig.feedbackPublicSchema].filter(Boolean);

      let count = 0;
      let totalValue = 0;
      let hasValues = false;

      for (const schema of feedbackSchemas) {
        const feedbacks = await sati.listFeedbacks({
          sasSchema: schema as Address,
          agentMint: mint as Address,
        });

        for (const fb of feedbacks.items) {
          const parsed = parseFeedbackContent(fb.data.content, fb.data.contentType);

          // Apply filters
          if (tag1Filter && parsed?.tag1 !== tag1Filter) continue;
          if (tag2Filter && parsed?.tag2 !== tag2Filter) continue;
          if (clientAddresses.length > 0 && !clientAddresses.includes(fb.data.counterparty)) continue;

          count++;
          if (parsed?.value !== undefined) {
            totalValue += parsed.value;
            hasValues = true;
          }
        }
      }

      return c.json({
        count,
        summaryValue: hasValues ? Math.round(totalValue / count) : 0,
        summaryValueDecimals: 0,
      });
    } catch (error) {
      console.error("[reputation] ERROR:", error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to get reputation" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/feedback/:mint - List feedback for agent
  // ---------------------------------------------------------------------------

  app.get("/api/feedback/:mint", async (c) => {
    const mint = c.req.param("mint");
    const network = getNetwork(c.req.query("network"));
    const clientAddressFilter = c.req.query("clientAddress");
    const tag1Filter = c.req.query("tag1");
    const tag2Filter = c.req.query("tag2");

    if (!isAddress(mint)) {
      return c.json({ error: "Invalid mint address" }, 400);
    }

    try {
      const sati = createSatiClient(network, env);
      const networkConfig = getNetworkConfig(sati);
      const feedbackSchemas = [networkConfig.feedbackSchema, networkConfig.feedbackPublicSchema].filter(Boolean);

      const feedbackItems: Array<Record<string, unknown>> = [];
      let feedbackIndex = 0;

      for (const schema of feedbackSchemas) {
        const feedbacks = await sati.listFeedbacks({
          sasSchema: schema as Address,
          agentMint: mint as Address,
        });

        for (const fb of feedbacks.items) {
          const parsed = parseFeedbackContent(fb.data.content, fb.data.contentType);

          // Apply filters
          if (clientAddressFilter && fb.data.counterparty !== clientAddressFilter) continue;
          if (tag1Filter && parsed?.tag1 !== tag1Filter) continue;
          if (tag2Filter && parsed?.tag2 !== tag2Filter) continue;

          feedbackItems.push({
            clientAddress: fb.data.counterparty,
            feedbackIndex: feedbackIndex++,
            value: parsed?.value ?? 0,
            valueDecimals: parsed?.valueDecimals ?? 0,
            tag1: parsed?.tag1 ?? "",
            tag2: parsed?.tag2 ?? "",
            endpoint: parsed?.endpoint ?? "",
            reviewer: parsed?.reviewer ?? "",
            outcome: fb.data.outcome,
            isRevoked: false,
          });
        }
      }

      return c.json({ feedbacks: feedbackItems, count: feedbackItems.length });
    } catch (error) {
      console.error("[feedback list] ERROR:", error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to list feedback" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/feedback - Give feedback (free, server signs as counterparty)
  // ---------------------------------------------------------------------------

  app.post("/api/feedback", async (c) => {
    if (!signerBytes) {
      return c.json({ error: "Server misconfigured: missing SATI_AGENT_SIGNER_KEY" }, 500);
    }

    let body: FeedbackRequest;
    try {
      body = await c.req.json<FeedbackRequest>();
    } catch {
      return c.json({ error: "Invalid request body" }, 400);
    }

    if (!body.agentMint?.trim()) {
      return c.json({ error: "Missing required field: agentMint" }, 400);
    }
    if (body.value === undefined || body.value === null) {
      return c.json({ error: "Missing required field: value" }, 400);
    }
    if (!isAddress(body.agentMint)) {
      return c.json({ error: "Invalid agentMint address" }, 400);
    }

    const network = getNetwork(body.network);
    const sati = createSatiClient(network, env);
    const networkConfig = getNetworkConfig(sati);

    if (!networkConfig.feedbackPublicSchema) {
      return c.json({ error: "FeedbackPublic schema not configured for network" }, 500);
    }

    try {
      const serverPayer = await createKeyPairSignerFromBytes(signerBytes);
      const counterpartyAddress = serverPayer.address;

      // Build content JSON (ERC-8004 format) using SDK helper
      const contentBytes = buildFeedbackContent({
        value: body.value,
        valueDecimals: body.valueDecimals ?? 0,
        tag1: body.tag1,
        tag2: body.tag2,
        endpoint: body.endpoint,
        reviewer: body.reviewerAddress,
        feedbackURI: body.feedbackURI,
        feedbackHash: body.feedbackHash,
      });

      // Generate random taskRef
      const taskRef = crypto.getRandomValues(new Uint8Array(32));
      const dataHash = new Uint8Array(32); // zero hash

      // Serialize feedback data for SIWS message
      const feedbackData: FeedbackData = {
        taskRef,
        agentMint: body.agentMint as Address,
        counterparty: counterpartyAddress,
        dataHash,
        outcome: OutcomeEnum.Neutral,
        contentType: ContentType.JSON,
        content: contentBytes,
      };
      const serializedData = serializeFeedback(feedbackData);

      // Build SIWS message and sign with server key
      const { messageBytes } = buildCounterpartyMessage({
        schemaName: "FeedbackPublicV1",
        data: serializedData,
      });

      // Sign SIWS message with server keypair
      if (!signerKeyPairPromise) {
        signerKeyPairPromise = createKeyPairFromBytes(signerBytes);
      }
      const keyPair = await signerKeyPairPromise;
      const counterpartySignature = await signBytes(keyPair.privateKey, messageBytes);

      // Submit feedback on-chain
      const result = await sati.createFeedback({
        payer: serverPayer,
        sasSchema: networkConfig.feedbackPublicSchema as Address,
        taskRef,
        agentMint: body.agentMint as Address,
        counterparty: counterpartyAddress,
        dataHash,
        outcome: OutcomeEnum.Neutral,
        agentSignature: {
          pubkey: counterpartyAddress,
          signature: counterpartySignature,
        },
        counterpartyMessage: messageBytes,
        contentType: ContentType.JSON,
        content: contentBytes,
        lookupTableAddress: networkConfig.lookupTable as Address,
      });

      return c.json({
        success: true,
        txSignature: result.signature,
        attestationAddress: result.address,
      });
    } catch (error) {
      console.error("[feedback] ERROR:", error);
      if (error instanceof Error && error.stack) {
        console.error("[feedback] Stack:", error.stack);
      }
      return c.json({ error: error instanceof Error ? error.message : "Failed to submit feedback" }, 500);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/photon/:network - Photon RPC proxy
  // ---------------------------------------------------------------------------

  app.post("/api/photon/:network", async (c) => {
    cleanupBuckets();

    const network = c.req.param("network");
    if (network !== "devnet" && network !== "mainnet") {
      return c.json({ error: "Invalid network - must be devnet or mainnet" }, 400);
    }

    // Rate limit: 120 requests per minute per IP
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    if (isRateLimited(`photon:${ip}`, 120, 60_000)) {
      return c.json({ error: "Rate limit exceeded - max 120 requests per minute" }, 429);
    }

    const rpcUrl = env.RPC_URLS[network].rpc;
    const body = await c.req.text();

    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const result = await response.text();
    return new Response(result, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/upload-metadata - Upload metadata JSON to IPFS
  // ---------------------------------------------------------------------------

  app.post("/api/upload-metadata", async (c) => {
    cleanupBuckets();

    // Rate limit: 10 uploads per minute per IP
    const ip = c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? "unknown";
    if (isRateLimited(`upload:${ip}`, 10, 60_000)) {
      return c.json({ error: "Rate limit exceeded - max 10 uploads per minute" }, 429);
    }

    if (!env.PINATA_JWT) {
      return c.json({ error: "Server misconfigured: missing PINATA_JWT" }, 500);
    }

    // Payload size cap
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_METADATA_SIZE) {
      return c.json({ error: `Payload too large - max ${MAX_METADATA_SIZE / 1024}KB` }, 413);
    }

    let data: unknown;
    try {
      const body = await c.req.text();
      if (body.length > MAX_METADATA_SIZE) {
        return c.json({ error: `Payload too large - max ${MAX_METADATA_SIZE / 1024}KB` }, 413);
      }
      data = JSON.parse(body);
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!data || typeof data !== "object") {
      return c.json({ error: "Request body must be a JSON object" }, 400);
    }

    try {
      const uploader = createPinataUploader(env.PINATA_JWT);
      const uri = await uploader.upload(data);
      return c.json({ uri });
    } catch (error) {
      console.error("[upload-metadata] ERROR:", error);
      return c.json({ error: error instanceof Error ? error.message : "Upload failed" }, 500);
    }
  });

  return app;
}
