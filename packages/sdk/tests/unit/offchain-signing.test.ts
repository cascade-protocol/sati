/**
 * Unit Tests for Off-chain Signing Utilities
 *
 * Tests the message building functions for wallet signing.
 * These are pure unit tests - no network required.
 *
 * Run: pnpm vitest run tests/unit/offchain-signing.test.ts
 */

import { describe, test, expect } from "vitest";
import { type Address, getAddressDecoder } from "@solana/kit";
import {
  formatCaip10,
  buildCounterpartyMessage,
  buildFeedbackSigningMessage,
  SOLANA_CHAIN_REFS,
} from "../../src/offchain-signing";
import { Outcome, ContentType, OFFSETS } from "../../src/schemas";

// =============================================================================
// Test Utilities
// =============================================================================

const addressDecoder = getAddressDecoder();

function randomAddress(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return addressDecoder.decode(bytes) as Address;
}

function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Build valid universal layout test data
 */
function buildTestData(
  options: { outcome?: Outcome; contentType?: ContentType; content?: Uint8Array } = {},
): Uint8Array {
  const outcome = options.outcome ?? Outcome.Positive;
  const contentType = options.contentType ?? ContentType.JSON;
  const content = options.content ?? new TextEncoder().encode('{"score": 95}');

  // Universal layout: task_ref(32) + token_account(32) + counterparty(32) + outcome(1) + data_hash(32) + content_type(1) + content
  const data = new Uint8Array(OFFSETS.CONTENT + content.length);

  // Fill task_ref (0-32)
  const taskRef = randomBytes32();
  data.set(taskRef, OFFSETS.TASK_REF);

  // Fill token_account (32-64)
  const tokenAccount = randomBytes32();
  data.set(tokenAccount, OFFSETS.TOKEN_ACCOUNT);

  // Fill counterparty (64-96)
  const counterparty = randomBytes32();
  data.set(counterparty, OFFSETS.COUNTERPARTY);

  // Set outcome (96)
  data[OFFSETS.OUTCOME] = outcome;

  // Fill data_hash (97-129)
  const dataHash = randomBytes32();
  data.set(dataHash, OFFSETS.DATA_HASH);

  // Set content_type (129)
  data[OFFSETS.CONTENT_TYPE] = contentType;

  // Set content (130+)
  data.set(content, OFFSETS.CONTENT);

  return data;
}

// =============================================================================
// Tests: Constants
// =============================================================================

describe("Off-chain Signing Constants", () => {
  test("SOLANA_CHAIN_REFS has correct mainnet reference", () => {
    expect(SOLANA_CHAIN_REFS.mainnet).toBe("5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp");
  });

  test("SOLANA_CHAIN_REFS has correct devnet reference", () => {
    expect(SOLANA_CHAIN_REFS.devnet).toBe("EtWTRABZaYq6iMfeYKouRu166VU2xqa1");
  });

  test("SOLANA_CHAIN_REFS has correct localnet reference", () => {
    expect(SOLANA_CHAIN_REFS.localnet).toBe("localnet");
  });
});

// =============================================================================
// Tests: formatCaip10
// =============================================================================

describe("formatCaip10", () => {
  test("formats mainnet address correctly", () => {
    const address = "7S3P4HxJpyyGbSbp4WKY6sHF3KBxZJzPqnkfbDq9KYyS" as Address;
    const result = formatCaip10(address, "mainnet");

    expect(result).toBe(`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${address}`);
  });

  test("formats devnet address correctly", () => {
    const address = "7S3P4HxJpyyGbSbp4WKY6sHF3KBxZJzPqnkfbDq9KYyS" as Address;
    const result = formatCaip10(address, "devnet");

    expect(result).toBe(`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${address}`);
  });

  test("formats localnet address correctly", () => {
    const address = "7S3P4HxJpyyGbSbp4WKY6sHF3KBxZJzPqnkfbDq9KYyS" as Address;
    const result = formatCaip10(address, "localnet");

    expect(result).toBe(`solana:localnet:${address}`);
  });

  test("defaults to mainnet when no network specified", () => {
    const address = "7S3P4HxJpyyGbSbp4WKY6sHF3KBxZJzPqnkfbDq9KYyS" as Address;
    const result = formatCaip10(address);

    expect(result).toBe(`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${address}`);
  });

  test("matches CAIP-10 format pattern", () => {
    const address = randomAddress();
    const result = formatCaip10(address, "mainnet");

    // CAIP-10 format: namespace:chain_reference:account_address
    expect(result).toMatch(/^solana:[a-zA-Z0-9]+:.+$/);
  });
});

// =============================================================================
// Tests: buildCounterpartyMessage
// =============================================================================

describe("buildCounterpartyMessage", () => {
  test("returns SigningMessage with messageBytes and text", () => {
    const data = buildTestData();
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result).toHaveProperty("messageBytes");
    expect(result).toHaveProperty("text");
    expect(result.messageBytes).toBeInstanceOf(Uint8Array);
    expect(typeof result.text).toBe("string");
  });

  test("messageBytes equals encoded text", () => {
    const data = buildTestData();
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    const encodedText = new TextEncoder().encode(result.text);
    expect(result.messageBytes).toEqual(encodedText);
  });

  test("includes schema name in message", () => {
    const data = buildTestData();
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("SATI Feedback");
  });

  test("includes correct outcome label for Positive", () => {
    const data = buildTestData({ outcome: Outcome.Positive });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Outcome: Positive");
  });

  test("includes correct outcome label for Neutral", () => {
    const data = buildTestData({ outcome: Outcome.Neutral });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Outcome: Neutral");
  });

  test("includes correct outcome label for Negative", () => {
    const data = buildTestData({ outcome: Outcome.Negative });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Outcome: Negative");
  });

  test("includes JSON content as text", () => {
    const content = new TextEncoder().encode('{"score": 95, "tags": ["fast"]}');
    const data = buildTestData({
      contentType: ContentType.JSON,
      content,
    });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain('Details: {"score": 95, "tags": ["fast"]}');
  });

  test("includes UTF8 content as text", () => {
    const content = new TextEncoder().encode("Great service!");
    const data = buildTestData({
      contentType: ContentType.UTF8,
      content,
    });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Details: Great service!");
  });

  test("shows (none) for empty content", () => {
    const data = buildTestData({
      contentType: ContentType.None,
      content: new Uint8Array(0),
    });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Details: (none)");
  });

  test("shows (encrypted) for encrypted content", () => {
    const data = buildTestData({
      contentType: ContentType.Encrypted,
      content: randomBytes32(),
    });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Details: (encrypted)");
  });

  test("shows ipfs:// prefix for IPFS content", () => {
    const data = buildTestData({
      contentType: ContentType.IPFS,
      content: randomBytes32(),
    });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Details: ipfs://");
  });

  test("shows ar:// prefix for Arweave content", () => {
    const data = buildTestData({
      contentType: ContentType.Arweave,
      content: randomBytes32(),
    });
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Details: ar://");
  });

  test("includes call to action", () => {
    const data = buildTestData();
    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toContain("Sign to create this attestation.");
  });

  test("throws on data too small", () => {
    const smallData = new Uint8Array(100); // Less than 130 bytes

    expect(() =>
      buildCounterpartyMessage({
        schemaName: "Feedback",
        data: smallData,
      }),
    ).toThrow(/Data too small/);
  });

  test("throws on invalid outcome value", () => {
    const data = buildTestData({ outcome: Outcome.Positive });
    // Manually set invalid outcome
    data[OFFSETS.OUTCOME] = 3;

    expect(() =>
      buildCounterpartyMessage({
        schemaName: "Feedback",
        data,
      }),
    ).toThrow(/Invalid outcome value/);
  });

  test("works with minimum valid data size (131 bytes)", () => {
    const data = buildTestData({ content: new Uint8Array(0) });
    expect(data.length).toBe(131);

    const result = buildCounterpartyMessage({
      schemaName: "Feedback",
      data,
    });

    expect(result.text).toBeTruthy();
  });
});

// =============================================================================
// Tests: buildFeedbackSigningMessage (legacy)
// =============================================================================

describe("buildFeedbackSigningMessage", () => {
  describe("legacy signature (hash, outcome)", () => {
    test("returns SigningMessage with messageBytes and text", () => {
      const feedbackHash = randomBytes32();
      const result = buildFeedbackSigningMessage(feedbackHash, Outcome.Positive);

      expect(result).toHaveProperty("messageBytes");
      expect(result).toHaveProperty("text");
    });

    test("includes SATI:feedback:v1 header", () => {
      const feedbackHash = randomBytes32();
      const result = buildFeedbackSigningMessage(feedbackHash, Outcome.Positive);

      expect(result.text).toContain("SATI:feedback:v1");
    });

    test("includes correct outcome label", () => {
      const feedbackHash = randomBytes32();

      expect(buildFeedbackSigningMessage(feedbackHash, Outcome.Negative).text).toContain("Outcome: Negative");
      expect(buildFeedbackSigningMessage(feedbackHash, Outcome.Neutral).text).toContain("Outcome: Neutral");
      expect(buildFeedbackSigningMessage(feedbackHash, Outcome.Positive).text).toContain("Outcome: Positive");
    });

    test("includes hash in hex format", () => {
      const feedbackHash = new Uint8Array(32).fill(0xab);
      const result = buildFeedbackSigningMessage(feedbackHash, Outcome.Positive);

      // Hash should appear as 0x followed by hex
      expect(result.text).toContain("0x");
      expect(result.text).toContain("ab".repeat(32)); // 32 bytes = 64 hex chars
    });

    test("throws on invalid hash length", () => {
      const shortHash = new Uint8Array(16);
      const longHash = new Uint8Array(64);

      expect(() => buildFeedbackSigningMessage(shortHash, Outcome.Positive)).toThrow("feedbackHash must be 32 bytes");
      expect(() => buildFeedbackSigningMessage(longHash, Outcome.Positive)).toThrow("feedbackHash must be 32 bytes");
    });

    test("throws on invalid outcome", () => {
      const feedbackHash = randomBytes32();

      expect(() => buildFeedbackSigningMessage(feedbackHash, 3 as Outcome)).toThrow("outcome must be 0, 1, or 2");
      expect(() => buildFeedbackSigningMessage(feedbackHash, -1 as Outcome)).toThrow("outcome must be 0, 1, or 2");
    });
  });

  describe("params signature (SIWS-style)", () => {
    test("returns SigningMessage with messageBytes and text", () => {
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress: randomAddress(),
        agentMint: randomAddress(),
        network: "mainnet",
      });

      expect(result).toHaveProperty("messageBytes");
      expect(result).toHaveProperty("text");
    });

    test("includes sati.fyi domain", () => {
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress: randomAddress(),
        agentMint: randomAddress(),
      });

      expect(result.text).toContain("sati.fyi wants you to attest");
    });

    test("includes owner address", () => {
      const ownerAddress = randomAddress();
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress,
        agentMint: randomAddress(),
      });

      expect(result.text).toContain(ownerAddress);
    });

    test("includes CAIP-10 agent identifier", () => {
      const agentMint = randomAddress();
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress: randomAddress(),
        agentMint,
        network: "mainnet",
      });

      expect(result.text).toContain(`Agent: solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${agentMint}`);
    });

    test("uses correct chain reference for devnet", () => {
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress: randomAddress(),
        agentMint: randomAddress(),
        network: "devnet",
      });

      expect(result.text).toContain("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:");
    });

    test("defaults to mainnet", () => {
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress: randomAddress(),
        agentMint: randomAddress(),
      });

      expect(result.text).toContain("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:");
    });

    test("includes attestation type", () => {
      const result = buildFeedbackSigningMessage({
        feedbackHash: randomBytes32(),
        outcome: Outcome.Positive,
        ownerAddress: randomAddress(),
        agentMint: randomAddress(),
      });

      expect(result.text).toContain("Attestation: Feedback");
    });

    test("throws on invalid hash length", () => {
      expect(() =>
        buildFeedbackSigningMessage({
          feedbackHash: new Uint8Array(16),
          outcome: Outcome.Positive,
          ownerAddress: randomAddress(),
          agentMint: randomAddress(),
        }),
      ).toThrow("feedbackHash must be 32 bytes");
    });

    test("throws on invalid outcome", () => {
      expect(() =>
        buildFeedbackSigningMessage({
          feedbackHash: randomBytes32(),
          outcome: 5 as Outcome,
          ownerAddress: randomAddress(),
          agentMint: randomAddress(),
        }),
      ).toThrow("outcome must be 0, 1, or 2");
    });
  });
});
