/**
 * SATI Dashboard Worker
 *
 * Handles uploads via Turbo (AR.IO) for permanent Arweave storage.
 * Uses server-side Solana private key for signing.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { TurboFactory } from "@ardrive/turbo-sdk/web";

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// Health check
app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

// Helper to get authenticated Turbo client
async function getTurboClient(privateKey: string) {
  return TurboFactory.authenticated({
    privateKey,
    token: "solana",
  });
}

// Upload file to Arweave via Turbo
app.post("/api/upload", async (c) => {
  const privateKey = c.env.TURBO_SOLANA_PRIVATE_KEY;
  if (!privateKey) {
    return c.json({ error: "Turbo not configured" }, 500);
  }

  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return c.json({ error: "File too large (max 10MB)" }, 400);
    }

    const turbo = await getTurboClient(privateKey);
    const arrayBuffer = await file.arrayBuffer();

    const result = await turbo.upload({
      data: new Uint8Array(arrayBuffer),
      dataItemOpts: {
        tags: [{ name: "Content-Type", value: file.type || "application/octet-stream" }],
      },
    });

    return c.json({
      id: result.id,
      uri: `https://arweave.net/${result.id}`,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

// Upload metadata JSON to Arweave via Turbo
app.post("/api/upload-metadata", async (c) => {
  const privateKey = c.env.TURBO_SOLANA_PRIVATE_KEY;
  if (!privateKey) {
    return c.json({ error: "Turbo not configured" }, 500);
  }

  try {
    const metadata = await c.req.json();

    // Validate required fields
    if (!metadata.name) {
      return c.json({ error: "Name is required" }, 400);
    }

    // Create Metaplex-compatible metadata
    const metadataJson = {
      name: metadata.name,
      symbol: metadata.symbol || "SATI",
      description: metadata.description || "",
      image: metadata.image || "",
      attributes: metadata.attributes || [],
      properties: {
        category: "agent",
        creators: [],
      },
    };

    const turbo = await getTurboClient(privateKey);

    const result = await turbo.upload({
      data: JSON.stringify(metadataJson, null, 2),
      dataItemOpts: {
        tags: [{ name: "Content-Type", value: "application/json" }],
      },
    });

    return c.json({
      id: result.id,
      uri: `https://arweave.net/${result.id}`,
    });
  } catch (error) {
    console.error("Metadata upload error:", error);
    return c.json({ error: "Upload failed" }, 500);
  }
});

export default app;
