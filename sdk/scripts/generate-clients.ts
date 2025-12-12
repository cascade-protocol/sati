#!/usr/bin/env npx tsx
/**
 * Generate Codama clients from SATI Registry Anchor IDL
 *
 * This script:
 * 1. Loads the Anchor IDL
 * 2. Converts to Codama tree
 * 3. Renders @solana/kit compatible TypeScript client
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load Anchor IDL
const idlPath = path.join(__dirname, "..", "idl.json");
const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));

// Convert Anchor IDL to Codama tree
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

// Render JavaScript client
const outputDir = path.join(__dirname, "..", "src", "generated");
codama.accept(
  renderJavaScriptVisitor(outputDir, {
    deleteFolderBeforeRendering: true,
    formatCode: true,
    useGranularImports: false,
  })
);

console.log(`✓ Generated SATI client in ${outputDir}`);
