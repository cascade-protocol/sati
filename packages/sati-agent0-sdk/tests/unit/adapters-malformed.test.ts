import { describe, it, expect } from "vitest";
import {
  SOLANA_CAIP2_CHAINS,
  parseSatiAgentId,
  toAgentSummary,
  fromAgent0RegistrationFile,
} from "../../src/adapters.js";
import { EndpointType, TrustModel } from "agent0-sdk";
import type { AgentIdentity } from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";
import type { SatiWarning } from "../../src/types.js";

const MAINNET_CHAIN = SOLANA_CAIP2_CHAINS.mainnet;

const TEST_IDENTITY: AgentIdentity = {
  mint: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" as Address,
  owner: "SQ2xxkJ6uEDHprYMNXPxS2AwyEtGGToZ7YC94icKH3Z" as Address,
  name: "TestAgent",
  uri: "https://example.com/reg.json",
  memberNumber: 1n,
  additionalMetadata: {},
  nonTransferable: false,
};

describe("adapters - malformed inputs", () => {
  describe("toAgentSummary with malformed services", () => {
    it("should handle services with missing name fields", () => {
      // Simulate malformed runtime data where name is missing
      const namelessService = JSON.parse('{"endpoint":"https://mcp.example.com"}');
      const regFile = {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const,
        name: "Test",
        description: "Test agent",
        image: "https://example.com/img.png",
        properties: { files: [{ uri: "https://example.com/img.png", type: "image/png" }] },
        services: [namelessService, { name: "MCP", endpoint: "https://mcp2.example.com" }],
      };
      const summary = toAgentSummary(TEST_IDENTITY, MAINNET_CHAIN, regFile);
      expect(summary.mcp).toBe("https://mcp2.example.com");
    });

    it("should handle null regFile", () => {
      const summary = toAgentSummary(TEST_IDENTITY, MAINNET_CHAIN, null);
      expect(summary.mcp).toBeUndefined();
      expect(summary.description).toBe("");
      expect(summary.active).toBe(true);
    });

    it("should handle regFile with empty services array", () => {
      const regFile = {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const,
        name: "Test",
        description: "Test agent",
        image: "https://example.com/img.png",
        properties: { files: [{ uri: "https://example.com/img.png", type: "image/png" }] },
        services: [],
      };
      const summary = toAgentSummary(TEST_IDENTITY, MAINNET_CHAIN, regFile);
      expect(summary.mcp).toBeUndefined();
      expect(summary.a2a).toBeUndefined();
    });
  });

  describe("fromAgent0RegistrationFile warning callback", () => {
    it("should invoke onWarning for invalid converted output", () => {
      const warnings: SatiWarning[] = [];
      fromAgent0RegistrationFile(
        {
          name: "",
          description: "",
          image: "",
          endpoints: [],
          trustModels: [],
          owners: [],
          operators: [],
          active: true,
          x402support: false,
          metadata: {},
          updatedAt: 0,
        },
        (w) => warnings.push(w),
      );
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0].code).toBe("PARSE_ERROR");
    });

    it("should not invoke onWarning for valid converted output", () => {
      const warnings: SatiWarning[] = [];
      fromAgent0RegistrationFile(
        {
          name: "ValidAgent",
          description: "A valid test agent for testing purposes",
          image: "https://example.com/img.png",
          endpoints: [{ type: EndpointType.MCP, value: "https://mcp.example.com" }],
          trustModels: [TrustModel.REPUTATION],
          owners: ["owner1"],
          operators: [],
          active: true,
          x402support: false,
          metadata: {},
          updatedAt: 0,
        },
        (w) => warnings.push(w),
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("parseSatiAgentId edge cases", () => {
    it("should return null for empty string", () => {
      expect(parseSatiAgentId("")).toBeNull();
    });

    it("should return null for solana: prefix with no parts", () => {
      expect(parseSatiAgentId("solana:")).toBeNull();
    });

    it("should return null for extra colons", () => {
      expect(parseSatiAgentId("solana:chain:mint:extra:more")).toBeNull();
    });
  });
});
