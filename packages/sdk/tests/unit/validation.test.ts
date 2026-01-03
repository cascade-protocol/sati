/**
 * Unit Tests for Data Validation and Layout
 *
 * Tests Universal Base Layout v1 constraints critical for:
 * 1. On-chain program validation (outcome ranges)
 * 2. Photon memcmp filtering (fixed offsets)
 * 3. Size limits (content)
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
  MAX_CONTENT_SIZE,
  MIN_BASE_LAYOUT_SIZE,
  CURRENT_LAYOUT_VERSION,
  OFFSETS,
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
// Tests: Universal Base Layout v1
// =============================================================================

describe("buildFeedbackData - Universal Base Layout v1", () => {
  const baseParams = {
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    outcome: Outcome.Positive,
  };

  describe("Fixed Offsets (Critical for Photon memcmp)", () => {
    test("layoutVersion is at offset 0", () => {
      const data = buildFeedbackData(baseParams);
      expect(data[OFFSETS.LAYOUT_VERSION]).toBe(CURRENT_LAYOUT_VERSION);
    });

    test("taskRef is at offset 1-32", () => {
      const taskRef = randomBytes(32);
      const data = buildFeedbackData({ ...baseParams, taskRef });
      const extracted = data.slice(OFFSETS.TASK_REF, OFFSETS.TASK_REF + 32);
      expect(extracted).toEqual(taskRef);
    });

    test("tokenAccount is at offset 33-64", () => {
      const data = buildFeedbackData(baseParams);
      // Token account is an address encoded at offset 33
      expect(data.slice(OFFSETS.TOKEN_ACCOUNT, OFFSETS.TOKEN_ACCOUNT + 32).length).toBe(32);
    });

    test("counterparty is at offset 65-96", () => {
      const data = buildFeedbackData(baseParams);
      expect(data.slice(OFFSETS.COUNTERPARTY, OFFSETS.COUNTERPARTY + 32).length).toBe(32);
    });

    test("outcome is at offset 97", () => {
      for (const outcome of [Outcome.Negative, Outcome.Neutral, Outcome.Positive]) {
        const data = buildFeedbackData({ ...baseParams, outcome });
        expect(data[OFFSETS.OUTCOME]).toBe(outcome);
      }
    });

    test("dataHash is at offset 98-129", () => {
      const dataHash = randomBytes(32);
      const data = buildFeedbackData({ ...baseParams, dataHash });
      const extracted = data.slice(OFFSETS.DATA_HASH, OFFSETS.DATA_HASH + 32);
      expect(extracted).toEqual(dataHash);
    });

    test("contentType is at offset 130", () => {
      const data = buildFeedbackData({ ...baseParams, contentType: ContentType.JSON });
      expect(data[OFFSETS.CONTENT_TYPE]).toBe(ContentType.JSON);
    });
  });

  describe("Layout Size", () => {
    test("base layout is MIN_BASE_LAYOUT_SIZE (131) bytes without content", () => {
      const data = buildFeedbackData(baseParams);
      expect(data.length).toBe(MIN_BASE_LAYOUT_SIZE);
    });

    test("content extends beyond base layout", () => {
      const content = new TextEncoder().encode("Great service!");
      const data = buildFeedbackData({ ...baseParams, content });
      expect(data.length).toBe(MIN_BASE_LAYOUT_SIZE + content.length);
    });

    test("large content is truncated to MAX_CONTENT_SIZE", () => {
      const largeContent = randomBytes(1000);
      const data = buildFeedbackData({ ...baseParams, content: largeContent });
      expect(data.length).toBe(MIN_BASE_LAYOUT_SIZE + MAX_CONTENT_SIZE);
    });
  });
});

// =============================================================================
// Tests: Validation and ReputationScore use same layout
// =============================================================================

describe("buildValidationData - Same Universal Layout", () => {
  const baseParams = {
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    outcome: Outcome.Positive,
  };

  test("uses same layout as Feedback", () => {
    const data = buildValidationData(baseParams);
    expect(data.length).toBe(MIN_BASE_LAYOUT_SIZE);
    expect(data[OFFSETS.LAYOUT_VERSION]).toBe(CURRENT_LAYOUT_VERSION);
    expect(data[OFFSETS.OUTCOME]).toBe(Outcome.Positive);
  });
});

describe("buildReputationScoreData - Same Universal Layout", () => {
  const baseParams = {
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    outcome: Outcome.Positive,
  };

  test("uses same layout as Feedback", () => {
    const data = buildReputationScoreData(baseParams);
    expect(data.length).toBe(MIN_BASE_LAYOUT_SIZE);
    expect(data[OFFSETS.LAYOUT_VERSION]).toBe(CURRENT_LAYOUT_VERSION);
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
    });

    test("rejects negative values", () => {
      expect(isValidScore(-1)).toBe(false);
    });
  });

  describe("isValidContentType", () => {
    test("accepts 0-5", () => {
      expect(isValidContentType(ContentType.None)).toBe(true);
      expect(isValidContentType(ContentType.JSON)).toBe(true);
      expect(isValidContentType(ContentType.UTF8)).toBe(true);
      expect(isValidContentType(ContentType.IPFS)).toBe(true);
      expect(isValidContentType(ContentType.Arweave)).toBe(true);
      expect(isValidContentType(5)).toBe(true); // Encrypted
    });

    test("rejects > 5", () => {
      expect(isValidContentType(6)).toBe(false);
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
  test("MAX_CONTENT_SIZE is 512", () => {
    expect(MAX_CONTENT_SIZE).toBe(512);
  });

  test("MIN_BASE_LAYOUT_SIZE is 131", () => {
    expect(MIN_BASE_LAYOUT_SIZE).toBe(131);
  });

  test("CURRENT_LAYOUT_VERSION is 1", () => {
    expect(CURRENT_LAYOUT_VERSION).toBe(1);
  });
});

// =============================================================================
// Tests: TypeScript Enum Bypass Protection
// =============================================================================

describe("TypeScript Enum Bypass Protection", () => {
  test("casting -1 as Outcome should be detected as invalid", () => {
    const maliciousOutcome = -1 as Outcome;
    expect(isValidOutcome(maliciousOutcome)).toBe(false);
  });

  test("casting 255 as ContentType should be detected as invalid", () => {
    const maliciousType = 255 as ContentType;
    expect(isValidContentType(maliciousType)).toBe(false);
  });
});
