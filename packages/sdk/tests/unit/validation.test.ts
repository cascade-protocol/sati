/**
 * Unit Tests for Data Validation and Layout
 *
 * Tests the data layout constraints that are critical for:
 * 1. On-chain program validation (outcome, response, score ranges)
 * 2. Photon memcmp filtering (fixed offsets for outcome/response)
 * 3. Size limits (tags, content)
 */

import { describe, test, expect } from "vitest";
import { type Address, getAddressDecoder } from "@solana/kit";
import {
  buildFeedbackData,
  buildValidationData,
  buildReputationScoreData,
  isValidOutcome,
  isValidScore,
  isValidContentType,
  isValidValidationType,
  Outcome,
  ContentType,
  ValidationType,
  MAX_TAG_LENGTH,
  MAX_CONTENT_SIZE,
  MIN_BASE_LAYOUT_SIZE,
} from "../helpers";

// =============================================================================
// Test Utilities
// =============================================================================

const addressDecoder = getAddressDecoder();

function randomAddress(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return addressDecoder.decode(bytes) as Address;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// =============================================================================
// Tests: Feedback Data Layout
// =============================================================================

describe("buildFeedbackData", () => {
  const baseParams = {
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    outcome: Outcome.Positive,
  };

  describe("Fixed Offsets (Critical for Photon memcmp)", () => {
    test("outcome is at fixed offset 129", () => {
      const data = buildFeedbackData({
        ...baseParams,
        outcome: Outcome.Positive,
      });

      // Offset 129 should contain outcome value (2 for Positive)
      expect(data[129]).toBe(Outcome.Positive);
    });

    test("all outcome values at offset 129", () => {
      for (const outcome of [Outcome.Negative, Outcome.Neutral, Outcome.Positive]) {
        const data = buildFeedbackData({
          ...baseParams,
          outcome,
        });

        expect(data[129]).toBe(outcome);
      }
    });

    test("contentType is at offset 128", () => {
      const data = buildFeedbackData({
        ...baseParams,
        contentType: ContentType.JSON,
      });

      expect(data[128]).toBe(ContentType.JSON);
    });

    test("base layout occupies first 130 bytes", () => {
      const data = buildFeedbackData(baseParams);

      // taskRef (0-31) + tokenAccount (32-63) + counterparty (64-95) +
      // dataHash (96-127) + contentType (128) + outcome (129)
      expect(data.length).toBeGreaterThanOrEqual(130);
    });
  });

  describe("Variable Length Fields", () => {
    test("empty tags produce minimal serialization", () => {
      const data = buildFeedbackData({
        ...baseParams,
        tag1: "",
        tag2: "",
      });

      // 130 (base) + 1 (tag1 len) + 1 (tag2 len) + 4 (content len) = 136
      expect(data.length).toBe(136);
    });

    test("tags are serialized with length prefix", () => {
      const data = buildFeedbackData({
        ...baseParams,
        tag1: "quality",
        tag2: "speed",
      });

      // Offset 130 should be tag1 length
      expect(data[130]).toBe(7); // "quality".length
    });

    test("long tags are truncated to MAX_TAG_LENGTH", () => {
      const longTag = "a".repeat(50); // Exceeds 32 char limit

      const data = buildFeedbackData({
        ...baseParams,
        tag1: longTag,
        tag2: "",
      });

      // Should be truncated to 32 chars
      expect(data[130]).toBe(MAX_TAG_LENGTH);
    });

    test("content is serialized with 4-byte length prefix", () => {
      const content = new TextEncoder().encode("Great service!");

      const data = buildFeedbackData({
        ...baseParams,
        contentType: ContentType.UTF8,
        content,
      });

      // Content length should be at end of variable section
      // Read as little-endian u32
      const taglessSize = 130 + 1 + 1; // base + tag1_len(0) + tag2_len(0)
      const contentLenView = new DataView(data.buffer, taglessSize, 4);
      expect(contentLenView.getUint32(0, true)).toBe(content.length);
    });

    test("large content is truncated to MAX_CONTENT_SIZE", () => {
      const largeContent = randomBytes(1000); // Exceeds 512 byte limit

      const data = buildFeedbackData({
        ...baseParams,
        content: largeContent,
      });

      // Content length should be capped at 512
      const taglessSize = 130 + 1 + 1;
      const contentLenView = new DataView(data.buffer, taglessSize, 4);
      expect(contentLenView.getUint32(0, true)).toBe(MAX_CONTENT_SIZE);
    });
  });

  describe("Base Layout Integrity", () => {
    test("taskRef is at offset 0-31", () => {
      const taskRef = randomBytes(32);
      const data = buildFeedbackData({
        ...baseParams,
        taskRef,
      });

      const extracted = data.slice(0, 32);
      expect(extracted).toEqual(taskRef);
    });

    test("dataHash is at offset 96-127", () => {
      const dataHash = randomBytes(32);
      const data = buildFeedbackData({
        ...baseParams,
        dataHash,
      });

      const extracted = data.slice(96, 128);
      expect(extracted).toEqual(dataHash);
    });
  });
});

// =============================================================================
// Tests: Validation Data Layout
// =============================================================================

describe("buildValidationData", () => {
  const baseParams = {
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    validationType: ValidationType.TEE,
    response: 95,
  };

  describe("Fixed Offsets", () => {
    test("response is at fixed offset 130", () => {
      const data = buildValidationData({
        ...baseParams,
        response: 85,
      });

      expect(data[130]).toBe(85);
    });

    test("validationType is at offset 129", () => {
      const data = buildValidationData({
        ...baseParams,
        validationType: ValidationType.ZKML,
      });

      expect(data[129]).toBe(ValidationType.ZKML);
    });

    test("all response scores at offset 130", () => {
      for (const response of [0, 50, 100]) {
        const data = buildValidationData({
          ...baseParams,
          response,
        });

        expect(data[130]).toBe(response);
      }
    });
  });

  describe("Base Layout", () => {
    test("minimum size is 135 bytes (base + 4-byte content length)", () => {
      const data = buildValidationData(baseParams);

      // 131 (base with response) + 4 (content length) = 135
      expect(data.length).toBe(135);
    });
  });
});

// =============================================================================
// Tests: ReputationScore Data Layout
// =============================================================================

describe("buildReputationScoreData", () => {
  const baseParams = {
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    score: 75,
    contentType: ContentType.None,
  };

  test("score is at offset 96", () => {
    const data = buildReputationScoreData({
      ...baseParams,
      score: 90,
    });

    expect(data[96]).toBe(90);
  });

  test("contentType is at offset 97", () => {
    const data = buildReputationScoreData({
      ...baseParams,
      contentType: ContentType.JSON,
    });

    expect(data[97]).toBe(ContentType.JSON);
  });

  test("minimum size is 102 bytes", () => {
    const data = buildReputationScoreData(baseParams);

    // 98 (base with contentType) + 4 (content length) = 102
    expect(data.length).toBe(102);
  });
});

// =============================================================================
// Tests: Range Validation
// =============================================================================

describe("Range Validation", () => {
  describe("isValidOutcome", () => {
    test("accepts 0, 1, 2", () => {
      expect(isValidOutcome(0)).toBe(true);
      expect(isValidOutcome(1)).toBe(true);
      expect(isValidOutcome(2)).toBe(true);
    });

    test("rejects > 2", () => {
      expect(isValidOutcome(3)).toBe(false);
      expect(isValidOutcome(255)).toBe(false);
    });

    test("rejects negative values", () => {
      expect(isValidOutcome(-1)).toBe(false);
      expect(isValidOutcome(-100)).toBe(false);
    });
  });

  describe("isValidScore", () => {
    test("accepts 0-100", () => {
      expect(isValidScore(0)).toBe(true);
      expect(isValidScore(50)).toBe(true);
      expect(isValidScore(100)).toBe(true);
    });

    test("rejects > 100", () => {
      expect(isValidScore(101)).toBe(false);
      expect(isValidScore(255)).toBe(false);
    });

    test("rejects negative values", () => {
      expect(isValidScore(-1)).toBe(false);
      expect(isValidScore(-50)).toBe(false);
    });
  });

  describe("isValidContentType", () => {
    test("accepts 0-4", () => {
      expect(isValidContentType(ContentType.None)).toBe(true);
      expect(isValidContentType(ContentType.JSON)).toBe(true);
      expect(isValidContentType(ContentType.UTF8)).toBe(true);
      expect(isValidContentType(ContentType.IPFS)).toBe(true);
      expect(isValidContentType(ContentType.Arweave)).toBe(true);
    });

    test("rejects > 4", () => {
      expect(isValidContentType(5)).toBe(false);
      expect(isValidContentType(255)).toBe(false);
    });

    test("rejects negative values", () => {
      expect(isValidContentType(-1)).toBe(false);
    });
  });

  describe("isValidValidationType", () => {
    test("accepts 0-3", () => {
      expect(isValidValidationType(ValidationType.TEE)).toBe(true);
      expect(isValidValidationType(ValidationType.ZKML)).toBe(true);
      expect(isValidValidationType(ValidationType.Reexecution)).toBe(true);
      expect(isValidValidationType(ValidationType.Consensus)).toBe(true);
    });

    test("rejects > 3", () => {
      expect(isValidValidationType(4)).toBe(false);
      expect(isValidValidationType(255)).toBe(false);
    });

    test("rejects negative values", () => {
      expect(isValidValidationType(-1)).toBe(false);
    });
  });
});

// =============================================================================
// Tests: Enum Values
// =============================================================================

describe("Enum Values Match Spec", () => {
  test("Outcome values", () => {
    expect(Outcome.Negative).toBe(0);
    expect(Outcome.Neutral).toBe(1);
    expect(Outcome.Positive).toBe(2);
  });

  test("ContentType values", () => {
    expect(ContentType.None).toBe(0);
    expect(ContentType.JSON).toBe(1);
    expect(ContentType.UTF8).toBe(2);
    expect(ContentType.IPFS).toBe(3);
    expect(ContentType.Arweave).toBe(4);
  });

  test("ValidationType values", () => {
    expect(ValidationType.TEE).toBe(0);
    expect(ValidationType.ZKML).toBe(1);
    expect(ValidationType.Reexecution).toBe(2);
    expect(ValidationType.Consensus).toBe(3);
  });
});

// =============================================================================
// Tests: Constants Match Spec
// =============================================================================

describe("Constants Match Spec", () => {
  test("MAX_TAG_LENGTH is 32", () => {
    expect(MAX_TAG_LENGTH).toBe(32);
  });

  test("MAX_CONTENT_SIZE is 512", () => {
    expect(MAX_CONTENT_SIZE).toBe(512);
  });

  test("MIN_BASE_LAYOUT_SIZE is 96", () => {
    expect(MIN_BASE_LAYOUT_SIZE).toBe(96);
  });
});

// =============================================================================
// Tests: TypeScript Enum Bypass (Edge Cases)
// =============================================================================

describe("TypeScript Enum Bypass Protection", () => {
  test("casting -1 as Outcome should be detected as invalid", () => {
    // TypeScript allows this bypass
    const maliciousOutcome = -1 as Outcome;

    // Our validator should catch it
    expect(isValidOutcome(maliciousOutcome)).toBe(false);
  });

  test("casting 255 as ContentType should be detected as invalid", () => {
    const maliciousType = 255 as ContentType;

    expect(isValidContentType(maliciousType)).toBe(false);
  });

  test("casting -50 as score should be detected as invalid", () => {
    const maliciousScore = -50;

    expect(isValidScore(maliciousScore)).toBe(false);
  });
});
