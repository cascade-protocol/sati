/**
 * SATI Dashboard Worker
 *
 * Simple worker for serving the SPA.
 * Upload functionality removed - using static logo for agent images.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());

// Health check
app.get("/api/health", (c) => c.json({ ok: true, timestamp: Date.now() }));

export default app;
