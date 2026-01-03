#!/usr/bin/env npx tsx
/**
 * Generate Codama clients from SATI Registry Anchor IDL
 *
 * This script:
 * 1. Loads the Anchor IDL
 * 2. Overrides address to canonical program ID (anchor build uses local keypair)
 * 3. Converts to Codama tree
 * 4. Renders @solana/kit compatible TypeScript client
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { createFromRoot } from "codama";
import { rootNodeFromAnchor } from "@codama/nodes-from-anchor";
import { renderVisitor as renderJavaScriptVisitor } from "@codama/renderers-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Canonical program address (must match declare_id! in lib.rs and Anchor.toml)
const SATI_PROGRAM_ADDRESS = "satiRkxEiwZ51cv8PRu8UMzuaqeaNU9jABo6oAFMsLe";

// Load Anchor IDL
const idlPath = path.join(__dirname, "..", "idl.json");
const anchorIdl = JSON.parse(readFileSync(idlPath, "utf-8"));

// Fix address if needed - anchor build uses local keypair which differs from canonical address
if (anchorIdl.address !== SATI_PROGRAM_ADDRESS) {
  console.log(`⚠ Fixing IDL address: ${anchorIdl.address} → ${SATI_PROGRAM_ADDRESS}`);
  anchorIdl.address = SATI_PROGRAM_ADDRESS;
  writeFileSync(idlPath, `${JSON.stringify(anchorIdl, null, 2)}\n`);
  console.log(`✓ Updated ${idlPath}`);
}

// Convert Anchor IDL to Codama tree
const codama = createFromRoot(rootNodeFromAnchor(anchorIdl));

// Render JavaScript client
const outputDir = path.join(__dirname, "..", "src", "generated");
codama.accept(
  renderJavaScriptVisitor(outputDir, {
    deleteFolderBeforeRendering: true,
    formatCode: true,
    useGranularImports: false,
  }),
);

console.log(`✓ Generated SATI client in ${outputDir}`);
