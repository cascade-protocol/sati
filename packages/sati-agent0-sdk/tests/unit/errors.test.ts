import { describe, it, expect } from "vitest";
import {
  SatiError,
  AgentNotFoundError,
  ReadOnlyError,
  SignerRequiredError,
  SchemaNotDeployedError,
  InvalidAgentIdError,
  UnsupportedOperationError,
} from "../../src/errors.js";

describe("error classes", () => {
  it("SatiError has code and message", () => {
    const err = new SatiError("TEST_CODE", "test message");
    expect(err.code).toBe("TEST_CODE");
    expect(err.message).toBe("test message");
    expect(err.name).toBe("SatiError");
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SatiError);
  });

  it("SatiError supports cause chaining", () => {
    const cause = new Error("root cause");
    const err = new SatiError("TEST", "wrapped", { cause });
    expect(err.cause).toBe(cause);
  });

  it("AgentNotFoundError", () => {
    const err = new AgentNotFoundError("solana:devnet:abc123");
    expect(err.code).toBe("AGENT_NOT_FOUND");
    expect(err.message).toContain("abc123");
    expect(err.name).toBe("AgentNotFoundError");
    expect(err).toBeInstanceOf(SatiError);
  });

  it("ReadOnlyError with operation", () => {
    const err = new ReadOnlyError("transferAgent");
    expect(err.code).toBe("READ_ONLY");
    expect(err.message).toContain("transferAgent");
    expect(err.name).toBe("ReadOnlyError");
    expect(err).toBeInstanceOf(SatiError);
  });

  it("ReadOnlyError without operation", () => {
    const err = new ReadOnlyError();
    expect(err.code).toBe("READ_ONLY");
    expect(err.message).toContain("signer or transactionSender");
  });

  it("SignerRequiredError", () => {
    const err = new SignerRequiredError("revokeFeedback");
    expect(err.code).toBe("SIGNER_REQUIRED");
    expect(err.message).toContain("revokeFeedback");
    expect(err.name).toBe("SignerRequiredError");
    expect(err).toBeInstanceOf(SatiError);
  });

  it("SchemaNotDeployedError", () => {
    const err = new SchemaNotDeployedError("FeedbackPublic", "devnet");
    expect(err.code).toBe("SCHEMA_NOT_DEPLOYED");
    expect(err.message).toContain("FeedbackPublic");
    expect(err.message).toContain("devnet");
    expect(err.name).toBe("SchemaNotDeployedError");
    expect(err).toBeInstanceOf(SatiError);
  });

  it("InvalidAgentIdError", () => {
    const err = new InvalidAgentIdError("bad-id");
    expect(err.code).toBe("INVALID_AGENT_ID");
    expect(err.message).toContain("bad-id");
    expect(err.name).toBe("InvalidAgentIdError");
    expect(err).toBeInstanceOf(SatiError);
  });

  it("UnsupportedOperationError", () => {
    const err = new UnsupportedOperationError("appendResponse");
    expect(err.code).toBe("UNSUPPORTED_OPERATION");
    expect(err.message).toContain("appendResponse");
    expect(err.name).toBe("UnsupportedOperationError");
    expect(err).toBeInstanceOf(SatiError);
  });
});
