/**
 * Unit Tests for Domain-Separated Hash Functions
 *
 * These tests verify that the TypeScript hash implementations produce
 * deterministic results and match the expected structure.
 */

import { describe, test, expect } from "vitest";
import { Keypair } from "@solana/web3.js";
import { address } from "@solana/kit";
import {
  computeInteractionHash,
  computeFeedbackHash,
  computeValidationHash,
  computeReputationHash,
  computeAttestationNonce,
  computeReputationNonce,
  Outcome,
  DOMAINS,
} from "../../src/hashes";

// =============================================================================
// Test Utilities
// =============================================================================

function randomAddress() {
  return address(Keypair.generate().publicKey.toBase58());
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

// =============================================================================
// Tests: Domain Separators
// =============================================================================

describe("Domain Separators", () => {
  test("domain separators have correct prefixes", () => {
    expect(new TextDecoder().decode(DOMAINS.INTERACTION)).toBe(
      "SATI:interaction:v1",
    );
    expect(new TextDecoder().decode(DOMAINS.FEEDBACK)).toBe("SATI:feedback:v1");
    expect(new TextDecoder().decode(DOMAINS.VALIDATION)).toBe(
      "SATI:validation:v1",
    );
    expect(new TextDecoder().decode(DOMAINS.REPUTATION)).toBe(
      "SATI:reputation:v1",
    );
  });

  test("domain separators are unique", () => {
    const domains = [
      DOMAINS.INTERACTION,
      DOMAINS.FEEDBACK,
      DOMAINS.VALIDATION,
      DOMAINS.REPUTATION,
    ];

    const asStrings = domains.map((d) => new TextDecoder().decode(d));
    const unique = new Set(asStrings);
    expect(unique.size).toBe(domains.length);
  });
});

// =============================================================================
// Tests: Interaction Hash
// =============================================================================

describe("computeInteractionHash", () => {
  test("produces 32-byte hash", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const dataHash = randomBytes(32);

    const hash = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash,
    );

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const dataHash = randomBytes(32);

    const hash1 = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash,
    );
    const hash2 = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash,
    );

    expect(hash1).toEqual(hash2);
  });

  test("produces different hashes for different inputs", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const dataHash1 = randomBytes(32);
    const dataHash2 = randomBytes(32);

    const hash1 = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash1,
    );
    const hash2 = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash2,
    );

    expect(hash1).not.toEqual(hash2);
  });

  test("throws on invalid taskRef length", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const dataHash = randomBytes(32);

    expect(() =>
      computeInteractionHash(
        sasSchema,
        randomBytes(16),
        tokenAccount,
        dataHash,
      ),
    ).toThrow("taskRef must be 32 bytes");
  });

  test("throws on invalid dataHash length", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();

    expect(() =>
      computeInteractionHash(sasSchema, taskRef, tokenAccount, randomBytes(16)),
    ).toThrow("dataHash must be 32 bytes");
  });
});

// =============================================================================
// Tests: Feedback Hash
// =============================================================================

describe("computeFeedbackHash", () => {
  test("produces 32-byte hash", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const outcome = Outcome.Positive;

    const hash = computeFeedbackHash(sasSchema, taskRef, tokenAccount, outcome);

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const outcome = Outcome.Neutral;

    const hash1 = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      outcome,
    );
    const hash2 = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      outcome,
    );

    expect(hash1).toEqual(hash2);
  });

  test("produces different hashes for different outcomes", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();

    const hashPositive = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      Outcome.Positive,
    );
    const hashNeutral = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      Outcome.Neutral,
    );
    const hashNegative = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      Outcome.Negative,
    );

    expect(hashPositive).not.toEqual(hashNeutral);
    expect(hashNeutral).not.toEqual(hashNegative);
    expect(hashPositive).not.toEqual(hashNegative);
  });

  test("throws on invalid taskRef length", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();

    expect(() =>
      computeFeedbackHash(
        sasSchema,
        randomBytes(16),
        tokenAccount,
        Outcome.Positive,
      ),
    ).toThrow("taskRef must be 32 bytes");
  });

  test("throws on invalid outcome", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();

    expect(() =>
      computeFeedbackHash(sasSchema, taskRef, tokenAccount, 3),
    ).toThrow("outcome must be 0, 1, or 2");
  });
});

// =============================================================================
// Tests: Validation Hash
// =============================================================================

describe("computeValidationHash", () => {
  test("produces 32-byte hash", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const response = 85;

    const hash = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      response,
    );

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const response = 50;

    const hash1 = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      response,
    );
    const hash2 = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      response,
    );

    expect(hash1).toEqual(hash2);
  });

  test("produces different hashes for different response scores", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();

    const hash0 = computeValidationHash(sasSchema, taskRef, tokenAccount, 0);
    const hash50 = computeValidationHash(sasSchema, taskRef, tokenAccount, 50);
    const hash100 = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      100,
    );

    expect(hash0).not.toEqual(hash50);
    expect(hash50).not.toEqual(hash100);
    expect(hash0).not.toEqual(hash100);
  });

  test("throws on invalid response value", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();

    expect(() =>
      computeValidationHash(sasSchema, taskRef, tokenAccount, 101),
    ).toThrow("response must be an integer 0-100");
  });
});

// =============================================================================
// Tests: Reputation Hash
// =============================================================================

describe("computeReputationHash", () => {
  test("produces 32-byte hash", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const provider = randomAddress();
    const score = 75;

    const hash = computeReputationHash(
      sasSchema,
      tokenAccount,
      provider,
      score,
    );

    expect(hash).toBeInstanceOf(Uint8Array);
    expect(hash.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const provider = randomAddress();
    const score = 90;

    const hash1 = computeReputationHash(
      sasSchema,
      tokenAccount,
      provider,
      score,
    );
    const hash2 = computeReputationHash(
      sasSchema,
      tokenAccount,
      provider,
      score,
    );

    expect(hash1).toEqual(hash2);
  });

  test("throws on invalid score value", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const provider = randomAddress();

    expect(() =>
      computeReputationHash(sasSchema, tokenAccount, provider, 101),
    ).toThrow("score must be an integer 0-100");
  });
});

// =============================================================================
// Tests: Attestation Nonce
// =============================================================================

describe("computeAttestationNonce", () => {
  test("produces 32-byte nonce", () => {
    const taskRef = randomBytes(32);
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty = randomAddress();

    const nonce = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty,
    );

    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const taskRef = randomBytes(32);
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty = randomAddress();

    const nonce1 = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty,
    );
    const nonce2 = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty,
    );

    expect(nonce1).toEqual(nonce2);
  });

  test("produces unique nonces per (task, agent, counterparty) tuple", () => {
    const taskRef = randomBytes(32);
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty1 = randomAddress();
    const counterparty2 = randomAddress();

    const nonce1 = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty1,
    );
    const nonce2 = computeAttestationNonce(
      taskRef,
      sasSchema,
      tokenAccount,
      counterparty2,
    );

    expect(nonce1).not.toEqual(nonce2);
  });

  test("throws on invalid taskRef length", () => {
    const sasSchema = randomAddress();
    const tokenAccount = randomAddress();
    const counterparty = randomAddress();

    expect(() =>
      computeAttestationNonce(
        randomBytes(16),
        sasSchema,
        tokenAccount,
        counterparty,
      ),
    ).toThrow("taskRef must be 32 bytes");
  });
});

// =============================================================================
// Tests: Reputation Nonce
// =============================================================================

describe("computeReputationNonce", () => {
  test("produces 32-byte nonce", () => {
    const provider = randomAddress();
    const tokenAccount = randomAddress();

    const nonce = computeReputationNonce(provider, tokenAccount);

    expect(nonce).toBeInstanceOf(Uint8Array);
    expect(nonce.length).toBe(32);
  });

  test("is deterministic with same inputs", () => {
    const provider = randomAddress();
    const tokenAccount = randomAddress();

    const nonce1 = computeReputationNonce(provider, tokenAccount);
    const nonce2 = computeReputationNonce(provider, tokenAccount);

    expect(nonce1).toEqual(nonce2);
  });

  test("produces unique nonces per (provider, agent) pair", () => {
    const provider1 = randomAddress();
    const provider2 = randomAddress();
    const tokenAccount = randomAddress();

    const nonce1 = computeReputationNonce(provider1, tokenAccount);
    const nonce2 = computeReputationNonce(provider2, tokenAccount);

    expect(nonce1).not.toEqual(nonce2);
  });
});

// =============================================================================
// Tests: Outcome Enum
// =============================================================================

describe("Outcome Enum", () => {
  test("has correct values", () => {
    expect(Outcome.Negative).toBe(0);
    expect(Outcome.Neutral).toBe(1);
    expect(Outcome.Positive).toBe(2);
  });
});

// =============================================================================
// Tests: Boundary Values (Edge Cases)
// =============================================================================

describe("Boundary Values", () => {
  describe("Outcome boundaries", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();

    test("accepts Outcome.Negative (0)", () => {
      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, Outcome.Negative),
      ).not.toThrow();
    });

    test("accepts Outcome.Neutral (1)", () => {
      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, Outcome.Neutral),
      ).not.toThrow();
    });

    test("accepts Outcome.Positive (2)", () => {
      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, Outcome.Positive),
      ).not.toThrow();
    });

    test("rejects outcome 3 (just above valid range)", () => {
      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, 3),
      ).toThrow("outcome must be 0, 1, or 2");
    });

    test("rejects outcome 255 (max u8)", () => {
      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, 255),
      ).toThrow("outcome must be 0, 1, or 2");
    });
  });

  describe("Response/Score boundaries", () => {
    const sasSchema = randomAddress();
    const taskRef = randomBytes(32);
    const tokenAccount = randomAddress();
    const provider = randomAddress();

    test("accepts score 0 (minimum)", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, 0),
      ).not.toThrow();
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, 0),
      ).not.toThrow();
    });

    test("accepts score 50 (midpoint)", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, 50),
      ).not.toThrow();
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, 50),
      ).not.toThrow();
    });

    test("accepts score 100 (maximum)", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, 100),
      ).not.toThrow();
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, 100),
      ).not.toThrow();
    });

    test("rejects score 101 (just above valid range)", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, 101),
      ).toThrow("response must be an integer 0-100");
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, 101),
      ).toThrow("score must be an integer 0-100");
    });

    test("rejects score 255 (max u8)", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, 255),
      ).toThrow("response must be an integer 0-100");
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, 255),
      ).toThrow("score must be an integer 0-100");
    });
  });
});

// =============================================================================
// Tests: TypeScript Enum Bypass (Security Edge Cases)
// =============================================================================

describe("TypeScript Enum Bypass Protection", () => {
  const sasSchema = randomAddress();
  const taskRef = randomBytes(32);
  const tokenAccount = randomAddress();
  const provider = randomAddress();

  describe("Negative value injection", () => {
    test("rejects -1 cast as Outcome", () => {
      // TypeScript allows this bypass at compile time
      const maliciousOutcome = -1 as Outcome;

      // Runtime validation should catch it
      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, maliciousOutcome),
      ).toThrow("outcome must be 0, 1, or 2");
    });

    test("rejects -100 as Outcome", () => {
      const veryNegative = -100 as Outcome;

      expect(() =>
        computeFeedbackHash(sasSchema, taskRef, tokenAccount, veryNegative),
      ).toThrow("outcome must be 0, 1, or 2");
    });

    test("rejects -1 as response score", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, -1),
      ).toThrow("response must be an integer 0-100");
    });

    test("rejects -50 as reputation score", () => {
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, -50),
      ).toThrow("score must be an integer 0-100");
    });
  });

  describe("Non-integer value injection", () => {
    test("rejects fractional outcome (1.5)", () => {
      // Outcome must be an integer
      const fractionalOutcome = 1.5 as unknown as Outcome;

      expect(() =>
        computeFeedbackHash(
          sasSchema,
          taskRef,
          tokenAccount,
          fractionalOutcome,
        ),
      ).toThrow("outcome must be 0, 1, or 2");
    });

    test("rejects fractional score (50.5) - score must be integer", () => {
      // Score/response must be an integer per specification
      const fractionalScore = 50.5;

      expect(() =>
        computeValidationHash(
          sasSchema,
          taskRef,
          tokenAccount,
          fractionalScore,
        ),
      ).toThrow("response must be an integer 0-100");
    });
  });

  describe("Type coercion edge cases", () => {
    test("rejects NaN as outcome", () => {
      expect(() =>
        computeFeedbackHash(
          sasSchema,
          taskRef,
          tokenAccount,
          NaN as unknown as Outcome,
        ),
      ).toThrow();
    });

    test("rejects Infinity as score", () => {
      expect(() =>
        computeValidationHash(sasSchema, taskRef, tokenAccount, Infinity),
      ).toThrow();
    });

    test("rejects -Infinity as score", () => {
      expect(() =>
        computeReputationHash(sasSchema, tokenAccount, provider, -Infinity),
      ).toThrow();
    });
  });
});

// =============================================================================
// Tests: Cross-Domain Hash Isolation
// =============================================================================

describe("Cross-Domain Hash Isolation", () => {
  const sasSchema = randomAddress();
  const taskRef = randomBytes(32);
  const tokenAccount = randomAddress();
  const dataHash = randomBytes(32);

  test("interaction hash differs from feedback hash for same agent/task", () => {
    const interactionHash = computeInteractionHash(
      sasSchema,
      taskRef,
      tokenAccount,
      dataHash,
    );
    const feedbackHash = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      Outcome.Positive,
    );

    expect(interactionHash).not.toEqual(feedbackHash);
  });

  test("feedback hash differs from validation hash for same agent/task", () => {
    const feedbackHash = computeFeedbackHash(
      sasSchema,
      taskRef,
      tokenAccount,
      Outcome.Positive,
    );
    const validationHash = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      100,
    );

    expect(feedbackHash).not.toEqual(validationHash);
  });

  test("validation hash differs from reputation hash for same agent", () => {
    const provider = randomAddress();
    const validationHash = computeValidationHash(
      sasSchema,
      taskRef,
      tokenAccount,
      100,
    );
    const reputationHash = computeReputationHash(
      sasSchema,
      tokenAccount,
      provider,
      100,
    );

    expect(validationHash).not.toEqual(reputationHash);
  });

  test("different schemas produce different hashes", () => {
    const schema1 = randomAddress();
    const schema2 = randomAddress();

    const hash1 = computeInteractionHash(
      schema1,
      taskRef,
      tokenAccount,
      dataHash,
    );
    const hash2 = computeInteractionHash(
      schema2,
      taskRef,
      tokenAccount,
      dataHash,
    );

    expect(hash1).not.toEqual(hash2);
  });
});
