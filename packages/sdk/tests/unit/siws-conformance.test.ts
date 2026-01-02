/**
 * SIWS Message Format Conformance Tests
 *
 * These tests verify that the TypeScript SIWS message builder produces output
 * matching the shared test vectors. The same vectors are used by Rust tests
 * to ensure cross-language consistency.
 *
 * If these tests fail after a format change, update the vectors file in
 * programs/sati/tests/fixtures/siws-vectors.json and verify Rust tests also pass.
 *
 * Run: pnpm vitest run tests/unit/siws-conformance.test.ts
 */

import { describe, test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCounterpartyMessage } from "../../src/offchain-signing";
import { OFFSETS } from "../../src/schemas";

// =============================================================================
// Test Vector Types
// =============================================================================

interface Vector {
  name: string;
  schemaName: string;
  tokenAccountHex: string;
  taskRefHex: string;
  outcome: number;
  contentType: number;
  contentHex: string;
  expectedBase64: string;
}

interface VectorsFile {
  description: string;
  vectors: Vector[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Encode Uint8Array to base64 string (browser-compatible)
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length === 0) {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Build universal layout data from vector fields.
 * Layout: task_ref(32) + token_account(32) + counterparty(32) + outcome(1) + data_hash(32) + content_type(1) + content
 */
function buildDataFromVector(vector: Vector): Uint8Array {
  const taskRef = hexToBytes(vector.taskRefHex);
  const tokenAccount = hexToBytes(vector.tokenAccountHex);
  const content = hexToBytes(vector.contentHex);

  // Universal layout is 130 bytes minimum + content
  const data = new Uint8Array(OFFSETS.CONTENT + content.length);

  // task_ref (0-32)
  data.set(taskRef, OFFSETS.TASK_REF);

  // token_account (32-64)
  data.set(tokenAccount, OFFSETS.TOKEN_ACCOUNT);

  // counterparty (64-96) - use zeros for test (not used in SIWS message)
  // data.set(new Uint8Array(32), OFFSETS.COUNTERPARTY); // already zeros

  // outcome (96)
  data[OFFSETS.OUTCOME] = vector.outcome;

  // data_hash (97-129) - use zeros for test (not used in SIWS message)
  // data.set(new Uint8Array(32), OFFSETS.DATA_HASH); // already zeros

  // content_type (129)
  data[OFFSETS.CONTENT_TYPE] = vector.contentType;

  // content (130+)
  data.set(content, OFFSETS.CONTENT);

  return data;
}

// =============================================================================
// Tests
// =============================================================================

describe("SIWS Message Format Conformance", () => {
  // Load test vectors from the shared file
  const vectorsPath = join(__dirname, "../../../../programs/sati/tests/fixtures/siws-vectors.json");
  const vectorsFile: VectorsFile = JSON.parse(readFileSync(vectorsPath, "utf-8"));

  test("vectors file is valid", () => {
    expect(vectorsFile.vectors).toBeDefined();
    expect(vectorsFile.vectors.length).toBeGreaterThan(0);
  });

  describe("buildCounterpartyMessage matches Rust implementation", () => {
    for (const vector of vectorsFile.vectors) {
      test(`${vector.name}`, () => {
        // Build data from vector fields
        const data = buildDataFromVector(vector);

        // Build SIWS message using SDK function
        const { messageBytes } = buildCounterpartyMessage({
          schemaName: vector.schemaName,
          data,
        });

        // Encode result as base64 for comparison
        const resultBase64 = uint8ArrayToBase64(messageBytes);

        // Compare with expected
        expect(resultBase64).toBe(vector.expectedBase64);
      });
    }
  });

  test("message format includes required fields", () => {
    const vector = vectorsFile.vectors[0];
    const data = buildDataFromVector(vector);

    const { text } = buildCounterpartyMessage({
      schemaName: vector.schemaName,
      data,
    });

    // Verify SIWS format
    expect(text).toMatch(/^SATI \w+/);
    expect(text).toContain("Agent:");
    expect(text).toContain("Task:");
    expect(text).toContain("Outcome:");
    expect(text).toContain("Details:");
    expect(text).toContain("Sign to create this attestation.");
  });

  test("outcome labels are correct", () => {
    // Test Negative (0)
    const negativeVector = vectorsFile.vectors.find((v) => v.outcome === 0);
    if (negativeVector) {
      const data = buildDataFromVector(negativeVector);
      const { text } = buildCounterpartyMessage({
        schemaName: negativeVector.schemaName,
        data,
      });
      expect(text).toContain("Outcome: Negative");
    }

    // Test Neutral (1)
    const neutralVector = vectorsFile.vectors.find((v) => v.outcome === 1);
    if (neutralVector) {
      const data = buildDataFromVector(neutralVector);
      const { text } = buildCounterpartyMessage({
        schemaName: neutralVector.schemaName,
        data,
      });
      expect(text).toContain("Outcome: Neutral");
    }

    // Test Positive (2)
    const positiveVector = vectorsFile.vectors.find((v) => v.outcome === 2);
    if (positiveVector) {
      const data = buildDataFromVector(positiveVector);
      const { text } = buildCounterpartyMessage({
        schemaName: positiveVector.schemaName,
        data,
      });
      expect(text).toContain("Outcome: Positive");
    }
  });
});
