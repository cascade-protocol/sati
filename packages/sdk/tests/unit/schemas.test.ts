/**
 * Unit Tests for Schema Serialization
 *
 * These tests verify that Feedback, Validation, and ReputationScore
 * data structures serialize and deserialize correctly.
 */

import { describe, test, expect } from "vitest";
import { type Address, getAddressDecoder } from "@solana/kit";
import {
  DataType,
  Outcome,
  ContentType,
  ValidationType,
  serializeFeedback,
  serializeValidation,
  serializeReputationScore,
  deserializeFeedback,
  deserializeValidation,
  deserializeReputationScore,
  FEEDBACK_OFFSETS,
  VALIDATION_OFFSETS,
  REPUTATION_SCORE_OFFSETS,
  MAX_CONTENT_SIZE,
  MAX_TAG_LENGTH,
  type FeedbackData,
  type ValidationData,
  type ReputationScoreData,
} from "../../src/schemas";

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
// Tests: DataType Enum
// =============================================================================

describe("DataType Enum", () => {
  test("has correct values", () => {
    expect(DataType.Feedback).toBe(0);
    expect(DataType.Validation).toBe(1);
  });
});

// =============================================================================
// Tests: ContentType Enum
// =============================================================================

describe("ContentType Enum", () => {
  test("has correct values", () => {
    expect(ContentType.None).toBe(0);
    expect(ContentType.JSON).toBe(1);
    expect(ContentType.UTF8).toBe(2);
    expect(ContentType.IPFS).toBe(3);
    expect(ContentType.Arweave).toBe(4);
  });
});

// =============================================================================
// Tests: ValidationType Enum
// =============================================================================

describe("ValidationType Enum", () => {
  test("has correct values", () => {
    expect(ValidationType.TEE).toBe(0);
    expect(ValidationType.ZKML).toBe(1);
    expect(ValidationType.Reexecution).toBe(2);
    expect(ValidationType.Consensus).toBe(3);
  });
});

// =============================================================================
// Tests: Feedback Serialization
// =============================================================================

describe("Feedback Serialization", () => {
  const createFeedbackData = (overrides?: Partial<FeedbackData>): FeedbackData => ({
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    outcome: Outcome.Positive,
    tag1: "",
    tag2: "",
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes and deserializes basic feedback", () => {
    const feedback = createFeedbackData();
    const serialized = serializeFeedback(feedback);
    const deserialized = deserializeFeedback(serialized);

    expect(deserialized.taskRef).toEqual(feedback.taskRef);
    expect(deserialized.tokenAccount).toBe(feedback.tokenAccount);
    expect(deserialized.counterparty).toBe(feedback.counterparty);
    expect(deserialized.dataHash).toEqual(feedback.dataHash);
    expect(deserialized.contentType).toBe(feedback.contentType);
    expect(deserialized.outcome).toBe(feedback.outcome);
    expect(deserialized.tag1).toBe(feedback.tag1);
    expect(deserialized.tag2).toBe(feedback.tag2);
    expect(deserialized.content).toEqual(feedback.content);
  });

  test("serializes feedback with tags", () => {
    const feedback = createFeedbackData({
      tag1: "quality",
      tag2: "helpful",
    });
    const serialized = serializeFeedback(feedback);
    const deserialized = deserializeFeedback(serialized);

    expect(deserialized.tag1).toBe("quality");
    expect(deserialized.tag2).toBe("helpful");
  });

  test("serializes feedback with content", () => {
    const content = new TextEncoder().encode("This was a great interaction!");
    const feedback = createFeedbackData({
      contentType: ContentType.UTF8,
      content,
    });
    const serialized = serializeFeedback(feedback);
    const deserialized = deserializeFeedback(serialized);

    expect(deserialized.contentType).toBe(ContentType.UTF8);
    expect(deserialized.content).toEqual(content);
  });

  test("serializes all outcome values", () => {
    for (const outcome of [Outcome.Negative, Outcome.Neutral, Outcome.Positive]) {
      const feedback = createFeedbackData({ outcome });
      const serialized = serializeFeedback(feedback);
      const deserialized = deserializeFeedback(serialized);

      expect(deserialized.outcome).toBe(outcome);
    }
  });

  test("has correct fixed offsets for memcmp filtering", () => {
    // The outcome field should be at a fixed offset for efficient filtering
    expect(FEEDBACK_OFFSETS.OUTCOME).toBeDefined();
    expect(typeof FEEDBACK_OFFSETS.OUTCOME).toBe("number");
  });
});

// =============================================================================
// Tests: Validation Serialization
// =============================================================================

describe("Validation Serialization", () => {
  const createValidationData = (overrides?: Partial<ValidationData>): ValidationData => ({
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    validationType: ValidationType.TEE,
    response: 85,
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes and deserializes basic validation", () => {
    const validation = createValidationData();
    const serialized = serializeValidation(validation);
    const deserialized = deserializeValidation(serialized);

    expect(deserialized.taskRef).toEqual(validation.taskRef);
    expect(deserialized.tokenAccount).toBe(validation.tokenAccount);
    expect(deserialized.counterparty).toBe(validation.counterparty);
    expect(deserialized.dataHash).toEqual(validation.dataHash);
    expect(deserialized.contentType).toBe(validation.contentType);
    expect(deserialized.validationType).toBe(validation.validationType);
    expect(deserialized.response).toBe(validation.response);
    expect(deserialized.content).toEqual(validation.content);
  });

  test("serializes validation with response score 0-100", () => {
    for (const response of [0, 25, 50, 75, 100]) {
      const validation = createValidationData({ response });
      const serialized = serializeValidation(validation);
      const deserialized = deserializeValidation(serialized);

      expect(deserialized.response).toBe(response);
    }
  });

  test("serializes all validation types", () => {
    for (const validationType of [
      ValidationType.TEE,
      ValidationType.ZKML,
      ValidationType.Reexecution,
      ValidationType.Consensus,
    ]) {
      const validation = createValidationData({ validationType });
      const serialized = serializeValidation(validation);
      const deserialized = deserializeValidation(serialized);

      expect(deserialized.validationType).toBe(validationType);
    }
  });

  test("has correct fixed offsets for memcmp filtering", () => {
    // The response field should be at a fixed offset for efficient filtering
    expect(VALIDATION_OFFSETS.RESPONSE).toBeDefined();
    expect(typeof VALIDATION_OFFSETS.RESPONSE).toBe("number");
  });
});

// =============================================================================
// Tests: ReputationScore Serialization
// =============================================================================

describe("ReputationScore Serialization", () => {
  const createReputationScoreData = (overrides?: Partial<ReputationScoreData>): ReputationScoreData => ({
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    score: 90,
    contentType: ContentType.None,
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes and deserializes basic reputation score", () => {
    const reputationScore = createReputationScoreData();
    const serialized = serializeReputationScore(reputationScore);
    const deserialized = deserializeReputationScore(serialized);

    expect(deserialized.taskRef).toEqual(reputationScore.taskRef);
    expect(deserialized.tokenAccount).toBe(reputationScore.tokenAccount);
    expect(deserialized.counterparty).toBe(reputationScore.counterparty);
    expect(deserialized.score).toBe(reputationScore.score);
    expect(deserialized.contentType).toBe(reputationScore.contentType);
    expect(deserialized.content).toEqual(reputationScore.content);
  });

  test("serializes score values 0-100", () => {
    for (const score of [0, 25, 50, 75, 100]) {
      const reputationScore = createReputationScoreData({ score });
      const serialized = serializeReputationScore(reputationScore);
      const deserialized = deserializeReputationScore(serialized);

      expect(deserialized.score).toBe(score);
    }
  });

  test("serializes with content", () => {
    const content = new TextEncoder().encode('{"methodology": "automated"}');
    const reputationScore = createReputationScoreData({
      contentType: ContentType.JSON,
      content,
    });
    const serialized = serializeReputationScore(reputationScore);
    const deserialized = deserializeReputationScore(serialized);

    expect(deserialized.contentType).toBe(ContentType.JSON);
    expect(deserialized.content).toEqual(content);
  });

  test("has correct offsets for filtering", () => {
    expect(REPUTATION_SCORE_OFFSETS.SCORE).toBeDefined();
    expect(REPUTATION_SCORE_OFFSETS.CONTENT_TYPE).toBeDefined();
    expect(typeof REPUTATION_SCORE_OFFSETS.SCORE).toBe("number");
  });
});

// =============================================================================
// Tests: Size Limits
// =============================================================================

describe("Size Limits", () => {
  test("MAX_CONTENT_SIZE is defined", () => {
    expect(MAX_CONTENT_SIZE).toBe(512);
  });

  test("MAX_TAG_LENGTH is defined", () => {
    expect(MAX_TAG_LENGTH).toBe(32);
  });
});

// =============================================================================
// Tests: Roundtrip Consistency
// =============================================================================

describe("Roundtrip Consistency", () => {
  test("feedback roundtrip is byte-identical", () => {
    const original: FeedbackData = {
      taskRef: randomBytes(32),
      tokenAccount: randomAddress(),
      counterparty: randomAddress(),
      dataHash: randomBytes(32),
      contentType: ContentType.UTF8,
      outcome: Outcome.Positive,
      tag1: "test-tag-1",
      tag2: "test-tag-2",
      content: new TextEncoder().encode("Test content"),
    };

    const serialized1 = serializeFeedback(original);
    const deserialized = deserializeFeedback(serialized1);
    const serialized2 = serializeFeedback(deserialized);

    expect(serialized1).toEqual(serialized2);
  });

  test("validation roundtrip is byte-identical", () => {
    const original: ValidationData = {
      taskRef: randomBytes(32),
      tokenAccount: randomAddress(),
      counterparty: randomAddress(),
      dataHash: randomBytes(32),
      contentType: ContentType.None,
      validationType: ValidationType.ZKML,
      response: 95,
      content: new Uint8Array(0),
    };

    const serialized1 = serializeValidation(original);
    const deserialized = deserializeValidation(serialized1);
    const serialized2 = serializeValidation(deserialized);

    expect(serialized1).toEqual(serialized2);
  });

  test("reputation score roundtrip is byte-identical", () => {
    const original: ReputationScoreData = {
      taskRef: randomBytes(32),
      tokenAccount: randomAddress(),
      counterparty: randomAddress(),
      score: 88,
      contentType: ContentType.None,
      content: new Uint8Array(0),
    };

    const serialized1 = serializeReputationScore(original);
    const deserialized = deserializeReputationScore(serialized1);
    const serialized2 = serializeReputationScore(deserialized);

    expect(serialized1).toEqual(serialized2);
  });
});
