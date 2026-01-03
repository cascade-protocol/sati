/**
 * Unit Tests for Schema Serialization
 *
 * Tests universal base layout serialization and deserialization for all schemas.
 * Universal layout (131 bytes): layout_version + task_ref + token_account + counterparty +
 * outcome + data_hash + content_type + content
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
  serializeUniversalLayout,
  deserializeUniversalLayout,
  validateBaseLayout,
  validateContentSize,
  getMaxContentSize,
  parseFeedbackContent,
  parseValidationContent,
  parseReputationScoreContent,
  createJsonContent,
  getOutcomeLabel,
  getContentTypeLabel,
  outcomeToScore,
  zeroDataHash,
  OFFSETS,
  FEEDBACK_OFFSETS,
  VALIDATION_OFFSETS,
  REPUTATION_SCORE_OFFSETS,
  MIN_BASE_LAYOUT_SIZE,
  MAX_CONTENT_SIZE,
  MAX_DUAL_SIGNATURE_CONTENT_SIZE,
  MAX_SINGLE_SIGNATURE_CONTENT_SIZE,
  CURRENT_LAYOUT_VERSION,
  SCHEMA_CONFIGS,
  type FeedbackData,
  type ValidationData,
  type ReputationScoreData,
  type BaseLayout,
  type FeedbackContent,
  type ValidationContent,
  type ReputationScoreContent,
} from "../../src/schemas";
import { SignatureMode, StorageType } from "../../src/generated";

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
// Tests: Enums
// =============================================================================

describe("DataType Enum", () => {
  test("has correct values", () => {
    expect(DataType.Feedback).toBe(0);
    expect(DataType.Validation).toBe(1);
    expect(DataType.ReputationScore).toBe(2);
  });
});

describe("Outcome Enum", () => {
  test("has correct values", () => {
    expect(Outcome.Negative).toBe(0);
    expect(Outcome.Neutral).toBe(1);
    expect(Outcome.Positive).toBe(2);
  });
});

describe("ContentType Enum", () => {
  test("has correct values", () => {
    expect(ContentType.None).toBe(0);
    expect(ContentType.JSON).toBe(1);
    expect(ContentType.UTF8).toBe(2);
    expect(ContentType.IPFS).toBe(3);
    expect(ContentType.Arweave).toBe(4);
    expect(ContentType.Encrypted).toBe(5);
  });
});

describe("ValidationType Enum", () => {
  test("has correct values", () => {
    expect(ValidationType.TEE).toBe(0);
    expect(ValidationType.ZKML).toBe(1);
    expect(ValidationType.Reexecution).toBe(2);
    expect(ValidationType.Consensus).toBe(3);
  });
});

describe("SignatureMode Enum", () => {
  test("has correct values", () => {
    expect(SignatureMode.DualSignature).toBe(0);
    expect(SignatureMode.CounterpartySigned).toBe(1);
    expect(SignatureMode.AgentOwnerSigned).toBe(2);
  });
});

describe("StorageType Enum", () => {
  test("has correct values", () => {
    expect(StorageType.Compressed).toBe(0);
    expect(StorageType.Regular).toBe(1);
  });
});

// =============================================================================
// Tests: Universal Layout Constants
// =============================================================================

describe("Universal Layout Constants", () => {
  test("MIN_BASE_LAYOUT_SIZE is 131", () => {
    expect(MIN_BASE_LAYOUT_SIZE).toBe(131);
  });

  test("MAX_CONTENT_SIZE is 512", () => {
    expect(MAX_CONTENT_SIZE).toBe(512);
  });

  test("OFFSETS has correct values", () => {
    expect(OFFSETS.LAYOUT_VERSION).toBe(0);
    expect(OFFSETS.TASK_REF).toBe(1);
    expect(OFFSETS.TOKEN_ACCOUNT).toBe(33);
    expect(OFFSETS.COUNTERPARTY).toBe(65);
    expect(OFFSETS.OUTCOME).toBe(97);
    expect(OFFSETS.DATA_HASH).toBe(98);
    expect(OFFSETS.CONTENT_TYPE).toBe(130);
    expect(OFFSETS.CONTENT).toBe(131);
  });

  test("schema-specific offsets match universal offsets", () => {
    // All schemas now use universal layout
    expect(FEEDBACK_OFFSETS).toBe(OFFSETS);
    expect(VALIDATION_OFFSETS).toBe(OFFSETS);
    expect(REPUTATION_SCORE_OFFSETS).toBe(OFFSETS);
  });
});

// =============================================================================
// Tests: Universal Layout Serialization
// =============================================================================

describe("Universal Layout Serialization", () => {
  const createBaseLayout = (overrides?: Partial<BaseLayout>): BaseLayout => ({
    taskRef: randomBytes(32),
    tokenAccount: randomAddress(),
    counterparty: randomAddress(),
    outcome: Outcome.Positive,
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes to correct minimum size (130 bytes)", () => {
    const data = createBaseLayout();
    const serialized = serializeUniversalLayout(data);

    expect(serialized.length).toBe(MIN_BASE_LAYOUT_SIZE);
  });

  test("serializes and deserializes correctly", () => {
    const data = createBaseLayout();
    const serialized = serializeUniversalLayout(data);
    const deserialized = deserializeUniversalLayout(serialized);

    expect(deserialized.taskRef).toEqual(data.taskRef);
    expect(deserialized.tokenAccount).toBe(data.tokenAccount);
    expect(deserialized.counterparty).toBe(data.counterparty);
    expect(deserialized.outcome).toBe(data.outcome);
    expect(deserialized.dataHash).toEqual(data.dataHash);
    expect(deserialized.contentType).toBe(data.contentType);
    expect(deserialized.content).toEqual(data.content);
  });

  test("serializes all outcome values", () => {
    for (const outcome of [Outcome.Negative, Outcome.Neutral, Outcome.Positive]) {
      const data = createBaseLayout({ outcome });
      const serialized = serializeUniversalLayout(data);
      const deserialized = deserializeUniversalLayout(serialized);

      expect(deserialized.outcome).toBe(outcome);
    }
  });

  test("serializes all content types", () => {
    for (const contentType of [
      ContentType.None,
      ContentType.JSON,
      ContentType.UTF8,
      ContentType.IPFS,
      ContentType.Arweave,
      ContentType.Encrypted,
    ]) {
      const data = createBaseLayout({ contentType });
      const serialized = serializeUniversalLayout(data);
      const deserialized = deserializeUniversalLayout(serialized);

      expect(deserialized.contentType).toBe(contentType);
    }
  });

  test("serializes with content", () => {
    const content = new TextEncoder().encode("Test content");
    const data = createBaseLayout({
      contentType: ContentType.UTF8,
      content,
    });
    const serialized = serializeUniversalLayout(data);
    const deserialized = deserializeUniversalLayout(serialized);

    expect(serialized.length).toBe(MIN_BASE_LAYOUT_SIZE + content.length);
    expect(deserialized.content).toEqual(content);
  });

  test("throws on data too small", () => {
    const smallData = new Uint8Array(100);

    expect(() => deserializeUniversalLayout(smallData)).toThrow("Data too small");
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
    outcome: Outcome.Positive,
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes and deserializes", () => {
    const feedback = createFeedbackData();
    const serialized = serializeFeedback(feedback);
    const deserialized = deserializeFeedback(serialized);

    expect(deserialized.taskRef).toEqual(feedback.taskRef);
    expect(deserialized.tokenAccount).toBe(feedback.tokenAccount);
    expect(deserialized.counterparty).toBe(feedback.counterparty);
    expect(deserialized.outcome).toBe(feedback.outcome);
    expect(deserialized.dataHash).toEqual(feedback.dataHash);
    expect(deserialized.contentType).toBe(feedback.contentType);
    expect(deserialized.content).toEqual(feedback.content);
  });

  test("serializes with JSON content", () => {
    const feedbackContent: FeedbackContent = {
      score: 85,
      tags: ["fast", "accurate"],
      m: "Great response!",
    };
    const content = createJsonContent(feedbackContent);
    const feedback = createFeedbackData({
      contentType: ContentType.JSON,
      content,
    });

    const serialized = serializeFeedback(feedback);
    const deserialized = deserializeFeedback(serialized);
    const parsed = parseFeedbackContent(deserialized.content, deserialized.contentType);

    expect(parsed).not.toBeNull();
    expect(parsed?.score).toBe(85);
    expect(parsed?.tags).toEqual(["fast", "accurate"]);
    expect(parsed?.m).toBe("Great response!");
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
    outcome: Outcome.Positive,
    dataHash: randomBytes(32),
    contentType: ContentType.None,
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes and deserializes", () => {
    const validation = createValidationData();
    const serialized = serializeValidation(validation);
    const deserialized = deserializeValidation(serialized);

    expect(deserialized.taskRef).toEqual(validation.taskRef);
    expect(deserialized.tokenAccount).toBe(validation.tokenAccount);
    expect(deserialized.counterparty).toBe(validation.counterparty);
    expect(deserialized.outcome).toBe(validation.outcome);
    expect(deserialized.dataHash).toEqual(validation.dataHash);
    expect(deserialized.contentType).toBe(validation.contentType);
    expect(deserialized.content).toEqual(validation.content);
  });

  test("serializes with JSON content", () => {
    const validationContent: ValidationContent = {
      type: "tee",
      confidence: 95,
      methodology: "SGX enclave verification",
    };
    const content = createJsonContent(validationContent);
    const validation = createValidationData({
      contentType: ContentType.JSON,
      content,
    });

    const serialized = serializeValidation(validation);
    const deserialized = deserializeValidation(serialized);
    const parsed = parseValidationContent(deserialized.content, deserialized.contentType);

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe("tee");
    expect(parsed?.confidence).toBe(95);
    expect(parsed?.methodology).toBe("SGX enclave verification");
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
    outcome: Outcome.Positive,
    dataHash: zeroDataHash(), // SingleSigner uses zero data hash
    contentType: ContentType.None,
    content: new Uint8Array(0),
    ...overrides,
  });

  test("serializes and deserializes", () => {
    const reputationScore = createReputationScoreData();
    const serialized = serializeReputationScore(reputationScore);
    const deserialized = deserializeReputationScore(serialized);

    expect(deserialized.taskRef).toEqual(reputationScore.taskRef);
    expect(deserialized.tokenAccount).toBe(reputationScore.tokenAccount);
    expect(deserialized.counterparty).toBe(reputationScore.counterparty);
    expect(deserialized.outcome).toBe(reputationScore.outcome);
    expect(deserialized.dataHash).toEqual(reputationScore.dataHash);
    expect(deserialized.contentType).toBe(reputationScore.contentType);
    expect(deserialized.content).toEqual(reputationScore.content);
  });

  test("serializes with JSON content", () => {
    const reputationContent: ReputationScoreContent = {
      score: 88,
      methodology: "weighted_average",
      components: { accuracy: 90, speed: 85, reliability: 89 },
    };
    const content = createJsonContent(reputationContent);
    const reputationScore = createReputationScoreData({
      contentType: ContentType.JSON,
      content,
    });

    const serialized = serializeReputationScore(reputationScore);
    const deserialized = deserializeReputationScore(serialized);
    const parsed = parseReputationScoreContent(deserialized.content, deserialized.contentType);

    expect(parsed).not.toBeNull();
    expect(parsed?.score).toBe(88);
    expect(parsed?.methodology).toBe("weighted_average");
    expect(parsed?.components).toEqual({ accuracy: 90, speed: 85, reliability: 89 });
  });
});

// =============================================================================
// Tests: Content Parsing
// =============================================================================

describe("Content Parsing", () => {
  test("parseFeedbackContent returns null for non-JSON", () => {
    const content = new TextEncoder().encode("plain text");
    expect(parseFeedbackContent(content, ContentType.UTF8)).toBeNull();
    expect(parseFeedbackContent(content, ContentType.None)).toBeNull();
  });

  test("parseFeedbackContent returns null for empty content", () => {
    expect(parseFeedbackContent(new Uint8Array(0), ContentType.JSON)).toBeNull();
  });

  test("parseFeedbackContent returns null for invalid JSON", () => {
    const content = new TextEncoder().encode("not valid json");
    expect(parseFeedbackContent(content, ContentType.JSON)).toBeNull();
  });

  test("parseValidationContent returns null for non-JSON", () => {
    const content = new TextEncoder().encode("plain text");
    expect(parseValidationContent(content, ContentType.UTF8)).toBeNull();
  });

  test("parseReputationScoreContent returns null for non-JSON", () => {
    const content = new TextEncoder().encode("plain text");
    expect(parseReputationScoreContent(content, ContentType.UTF8)).toBeNull();
  });
});

// =============================================================================
// Tests: Validation
// =============================================================================

describe("validateBaseLayout", () => {
  test("accepts valid minimum layout", () => {
    const data = new Uint8Array(MIN_BASE_LAYOUT_SIZE);
    data[OFFSETS.LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;
    data[OFFSETS.OUTCOME] = Outcome.Positive;
    data[OFFSETS.CONTENT_TYPE] = ContentType.None;

    expect(() => validateBaseLayout(data)).not.toThrow();
  });

  test("throws for data too small", () => {
    const data = new Uint8Array(100);

    expect(() => validateBaseLayout(data)).toThrow("Data too small");
  });

  test("throws for unsupported layout version", () => {
    const data = new Uint8Array(MIN_BASE_LAYOUT_SIZE);
    data[OFFSETS.LAYOUT_VERSION] = 0; // Invalid version
    data[OFFSETS.OUTCOME] = Outcome.Positive;
    data[OFFSETS.CONTENT_TYPE] = ContentType.None;

    expect(() => validateBaseLayout(data)).toThrow("Unsupported layout version");
  });

  test("throws for invalid outcome", () => {
    const data = new Uint8Array(MIN_BASE_LAYOUT_SIZE);
    data[OFFSETS.LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;
    data[OFFSETS.OUTCOME] = 10; // Invalid
    data[OFFSETS.CONTENT_TYPE] = ContentType.None;

    expect(() => validateBaseLayout(data)).toThrow("Invalid outcome");
  });

  test("throws for invalid content type", () => {
    const data = new Uint8Array(MIN_BASE_LAYOUT_SIZE);
    data[OFFSETS.LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;
    data[OFFSETS.OUTCOME] = Outcome.Positive;
    data[OFFSETS.CONTENT_TYPE] = 20; // Invalid

    expect(() => validateBaseLayout(data)).toThrow("Invalid content type");
  });

  test("throws for content too large", () => {
    const data = new Uint8Array(MIN_BASE_LAYOUT_SIZE + MAX_CONTENT_SIZE + 1);
    data[OFFSETS.LAYOUT_VERSION] = CURRENT_LAYOUT_VERSION;
    data[OFFSETS.OUTCOME] = Outcome.Positive;
    data[OFFSETS.CONTENT_TYPE] = ContentType.JSON;

    expect(() => validateBaseLayout(data)).toThrow("Content too large");
  });
});

// =============================================================================
// Tests: Content Size Validation (Transaction Limits)
// =============================================================================

describe("Content Size Constants", () => {
  test("MAX_DUAL_SIGNATURE_CONTENT_SIZE is 70", () => {
    expect(MAX_DUAL_SIGNATURE_CONTENT_SIZE).toBe(70);
  });

  test("MAX_SINGLE_SIGNATURE_CONTENT_SIZE is 240", () => {
    expect(MAX_SINGLE_SIGNATURE_CONTENT_SIZE).toBe(240);
  });

  test("DualSignature limit is smaller than SingleSignature limit", () => {
    expect(MAX_DUAL_SIGNATURE_CONTENT_SIZE).toBeLessThan(MAX_SINGLE_SIGNATURE_CONTENT_SIZE);
  });
});

describe("getMaxContentSize", () => {
  test("returns 70 for DualSignature mode", () => {
    expect(getMaxContentSize(SignatureMode.DualSignature)).toBe(70);
  });

  test("returns 240 for SingleSigner mode", () => {
    expect(getMaxContentSize(SignatureMode.CounterpartySigned)).toBe(240);
  });
});

describe("validateContentSize", () => {
  test("returns valid:true for content under DualSignature limit", () => {
    const content = new Uint8Array(50); // Under 70
    const result = validateContentSize(content, SignatureMode.DualSignature, { throwOnError: false });

    expect(result.valid).toBe(true);
    expect(result.maxSize).toBe(70);
    expect(result.actualSize).toBe(50);
    expect(result.error).toBeUndefined();
  });

  test("returns valid:true for content at exact DualSignature limit", () => {
    const content = new Uint8Array(70); // Exactly 70
    const result = validateContentSize(content, SignatureMode.DualSignature, { throwOnError: false });

    expect(result.valid).toBe(true);
  });

  test("returns valid:false for content over DualSignature limit", () => {
    const content = new Uint8Array(100); // Over 70
    const result = validateContentSize(content, SignatureMode.DualSignature, { throwOnError: false });

    expect(result.valid).toBe(false);
    expect(result.maxSize).toBe(70);
    expect(result.actualSize).toBe(100);
    expect(result.error).toContain("Content too large for DualSignature mode");
    expect(result.error).toContain("100 bytes exceeds maximum 70 bytes");
  });

  test("returns valid:true for content under SingleSignature limit", () => {
    const content = new Uint8Array(200); // Under 240
    const result = validateContentSize(content, SignatureMode.CounterpartySigned, { throwOnError: false });

    expect(result.valid).toBe(true);
    expect(result.maxSize).toBe(240);
    expect(result.actualSize).toBe(200);
  });

  test("returns valid:false for content over SingleSignature limit", () => {
    const content = new Uint8Array(300); // Over 240
    const result = validateContentSize(content, SignatureMode.CounterpartySigned, { throwOnError: false });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("Content too large for SingleSignature mode");
    expect(result.error).toContain("300 bytes exceeds maximum 240 bytes");
  });

  test("throws by default when content exceeds limit", () => {
    const content = new Uint8Array(100); // Over 70

    expect(() => validateContentSize(content, SignatureMode.DualSignature)).toThrow(
      "Content too large for DualSignature mode",
    );
  });

  test("does not throw when throwOnError is false", () => {
    const content = new Uint8Array(100); // Over 70

    expect(() => validateContentSize(content, SignatureMode.DualSignature, { throwOnError: false })).not.toThrow();
  });

  test("returns valid:true for empty content", () => {
    const content = new Uint8Array(0);
    const result = validateContentSize(content, SignatureMode.DualSignature, { throwOnError: false });

    expect(result.valid).toBe(true);
    expect(result.actualSize).toBe(0);
  });

  test("error message suggests IPFS/Arweave for large content", () => {
    const content = new Uint8Array(100);
    const result = validateContentSize(content, SignatureMode.DualSignature, { throwOnError: false });

    expect(result.error).toContain("Use ContentType.IPFS or ContentType.Arweave");
  });
});

// =============================================================================
// Tests: Utility Functions
// =============================================================================

describe("Utility Functions", () => {
  test("getOutcomeLabel returns correct labels", () => {
    expect(getOutcomeLabel(Outcome.Negative)).toBe("Negative");
    expect(getOutcomeLabel(Outcome.Neutral)).toBe("Neutral");
    expect(getOutcomeLabel(Outcome.Positive)).toBe("Positive");
    expect(getOutcomeLabel(99 as Outcome)).toBe("Unknown");
  });

  test("getContentTypeLabel returns correct labels", () => {
    expect(getContentTypeLabel(ContentType.None)).toBe("None");
    expect(getContentTypeLabel(ContentType.JSON)).toBe("JSON");
    expect(getContentTypeLabel(ContentType.UTF8)).toBe("UTF-8");
    expect(getContentTypeLabel(ContentType.IPFS)).toBe("IPFS");
    expect(getContentTypeLabel(ContentType.Arweave)).toBe("Arweave");
    expect(getContentTypeLabel(ContentType.Encrypted)).toBe("Encrypted");
    expect(getContentTypeLabel(99 as ContentType)).toBe("Unknown");
  });

  test("outcomeToScore returns ERC-8004 compatible scores", () => {
    expect(outcomeToScore(Outcome.Negative)).toBe(0);
    expect(outcomeToScore(Outcome.Neutral)).toBe(50);
    expect(outcomeToScore(Outcome.Positive)).toBe(100);
    expect(outcomeToScore(99 as Outcome)).toBe(50); // Default
  });

  test("zeroDataHash returns 32 zero bytes", () => {
    const hash = zeroDataHash();
    expect(hash.length).toBe(32);
    expect(hash.every((b) => b === 0)).toBe(true);
  });

  test("createJsonContent serializes object to UTF-8 JSON bytes", () => {
    const obj = { key: "value", num: 42 };
    const content = createJsonContent(obj);
    const decoded = JSON.parse(new TextDecoder().decode(content));

    expect(decoded).toEqual(obj);
  });
});

// =============================================================================
// Tests: Schema Configs
// =============================================================================

describe("SCHEMA_CONFIGS", () => {
  test("Feedback config is correct", () => {
    expect(SCHEMA_CONFIGS.Feedback.signatureMode).toBe(SignatureMode.DualSignature);
    expect(SCHEMA_CONFIGS.Feedback.storageType).toBe(StorageType.Compressed);
    expect(SCHEMA_CONFIGS.Feedback.closeable).toBe(false);
    expect(SCHEMA_CONFIGS.Feedback.name).toBe("FeedbackV1");
  });

  test("FeedbackPublic config is correct", () => {
    expect(SCHEMA_CONFIGS.FeedbackPublic.signatureMode).toBe(SignatureMode.CounterpartySigned);
    expect(SCHEMA_CONFIGS.FeedbackPublic.storageType).toBe(StorageType.Compressed);
    expect(SCHEMA_CONFIGS.FeedbackPublic.closeable).toBe(false);
    expect(SCHEMA_CONFIGS.FeedbackPublic.name).toBe("FeedbackPublicV1");
  });

  test("Validation config is correct", () => {
    expect(SCHEMA_CONFIGS.Validation.signatureMode).toBe(SignatureMode.DualSignature);
    expect(SCHEMA_CONFIGS.Validation.storageType).toBe(StorageType.Compressed);
    expect(SCHEMA_CONFIGS.Validation.closeable).toBe(false);
    expect(SCHEMA_CONFIGS.Validation.name).toBe("ValidationV1");
  });

  test("ReputationScore config is correct", () => {
    expect(SCHEMA_CONFIGS.ReputationScore.signatureMode).toBe(SignatureMode.CounterpartySigned);
    expect(SCHEMA_CONFIGS.ReputationScore.storageType).toBe(StorageType.Regular);
    expect(SCHEMA_CONFIGS.ReputationScore.closeable).toBe(true);
    expect(SCHEMA_CONFIGS.ReputationScore.name).toBe("ReputationScoreV1");
  });

  test("Delegate config is correct", () => {
    expect(SCHEMA_CONFIGS.Delegate.signatureMode).toBe(SignatureMode.AgentOwnerSigned);
    expect(SCHEMA_CONFIGS.Delegate.storageType).toBe(StorageType.Regular);
    expect(SCHEMA_CONFIGS.Delegate.closeable).toBe(true);
    expect(SCHEMA_CONFIGS.Delegate.name).toBe("DelegateV1");
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
      outcome: Outcome.Positive,
      dataHash: randomBytes(32),
      contentType: ContentType.JSON,
      content: createJsonContent({ score: 85, tags: ["test"], m: "Message" }),
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
      outcome: Outcome.Positive,
      dataHash: randomBytes(32),
      contentType: ContentType.JSON,
      content: createJsonContent({ type: "tee", confidence: 95 }),
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
      outcome: Outcome.Positive,
      dataHash: zeroDataHash(),
      contentType: ContentType.JSON,
      content: createJsonContent({ score: 88, methodology: "weighted" }),
    };

    const serialized1 = serializeReputationScore(original);
    const deserialized = deserializeReputationScore(serialized1);
    const serialized2 = serializeReputationScore(deserialized);

    expect(serialized1).toEqual(serialized2);
  });
});
