import { describe, it, expect } from "vitest";
import {
  SOLANA_CAIP2_CHAINS,
  formatSatiAgentId,
  parseSatiAgentId,
  toAgent0Endpoints,
  fromAgent0Endpoints,
  toAgentSummary,
  toFeedback,
} from "../../src/adapters.js";
import { EndpointType } from "agent0-sdk";
import type { AgentIdentity } from "@cascade-fyi/sati-sdk";
import type { Address } from "@solana/kit";

const MAINNET_CHAIN = SOLANA_CAIP2_CHAINS.mainnet;
const TEST_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

describe("adapters", () => {
  describe("formatSatiAgentId / parseSatiAgentId", () => {
    it("should produce CAIP-2 format agentId", () => {
      const agentId = formatSatiAgentId(TEST_MINT, MAINNET_CHAIN);
      expect(agentId).toBe(`${MAINNET_CHAIN}:${TEST_MINT}`);
    });

    it("should round-trip agent IDs", () => {
      const agentId = formatSatiAgentId(TEST_MINT, MAINNET_CHAIN);
      const parsed = parseSatiAgentId(agentId);
      expect(parsed).toBe(TEST_MINT);
    });

    it("should return null for non-Solana agent IDs", () => {
      expect(parseSatiAgentId("8453:123")).toBeNull();
      expect(parseSatiAgentId("invalid")).toBeNull();
    });

    it("should return null for malformed Solana IDs", () => {
      expect(parseSatiAgentId("solana:chain")).toBeNull(); // only 2 parts
      expect(parseSatiAgentId("solana:chain:mint:extra")).toBeNull(); // 4 parts
    });

    it("should work with devnet chain", () => {
      const devnetChain = SOLANA_CAIP2_CHAINS.devnet;
      const agentId = formatSatiAgentId(TEST_MINT, devnetChain);
      expect(agentId).toBe(`${devnetChain}:${TEST_MINT}`);
      expect(parseSatiAgentId(agentId)).toBe(TEST_MINT);
    });
  });

  describe("endpoint converters", () => {
    it("should convert SATI endpoints to agent0 format", () => {
      const satiEndpoints = [
        { name: "MCP", endpoint: "https://mcp.example.com", version: "2025-06-18" },
        { name: "A2A", endpoint: "https://a2a.example.com" },
      ];
      const result = toAgent0Endpoints(satiEndpoints);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(EndpointType.MCP);
      expect(result[0].value).toBe("https://mcp.example.com");
      expect(result[0].meta).toEqual({ version: "2025-06-18" });
      expect(result[1].type).toBe(EndpointType.A2A);
      expect(result[1].meta).toBeUndefined();
    });

    it("should carry capability fields through to agent0 format", () => {
      const satiEndpoints = [
        {
          name: "MCP",
          endpoint: "https://mcp.example.com",
          version: "2025-06-18",
          mcpTools: ["tool1", "tool2"],
          mcpPrompts: ["prompt1"],
        },
        {
          name: "A2A",
          endpoint: "https://a2a.example.com",
          a2aSkills: ["skill1"],
        },
        {
          name: "OASF",
          endpoint: "https://oasf.example.com",
          skills: ["oasf-skill"],
          domains: ["oasf-domain"],
        },
      ];
      const result = toAgent0Endpoints(satiEndpoints);

      expect(result[0].meta?.mcpTools).toEqual(["tool1", "tool2"]);
      expect(result[0].meta?.mcpPrompts).toEqual(["prompt1"]);
      expect(result[1].meta?.a2aSkills).toEqual(["skill1"]);
      expect(result[2].meta?.skills).toEqual(["oasf-skill"]);
      expect(result[2].meta?.domains).toEqual(["oasf-domain"]);
    });

    it("should convert agent0 endpoints back to SATI format", () => {
      const agent0Endpoints = [
        { type: EndpointType.MCP, value: "https://mcp.example.com", meta: { version: "1.0" } },
        { type: EndpointType.WALLET, value: "0x1234" },
      ];
      const result = fromAgent0Endpoints(agent0Endpoints);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("MCP");
      expect(result[0].endpoint).toBe("https://mcp.example.com");
      expect(result[0].version).toBe("1.0");
      expect(result[1].name).toBe("agentWallet");
    });

    it("should carry capability fields back from agent0 format", () => {
      const agent0Endpoints = [
        {
          type: EndpointType.MCP,
          value: "https://mcp.example.com",
          meta: { version: "1.0", mcpTools: ["t1"], mcpPrompts: ["p1"], mcpResources: ["r1"] },
        },
        {
          type: EndpointType.OASF,
          value: "https://oasf.example.com",
          meta: { skills: ["s1"], domains: ["d1"] },
        },
      ];
      const result = fromAgent0Endpoints(agent0Endpoints);

      expect(result[0].mcpTools).toEqual(["t1"]);
      expect(result[0].mcpPrompts).toEqual(["p1"]);
      expect(result[0].mcpResources).toEqual(["r1"]);
      expect(result[1].skills).toEqual(["s1"]);
      expect(result[1].domains).toEqual(["d1"]);
    });
  });

  describe("toAgentSummary", () => {
    const identity: AgentIdentity = {
      mint: TEST_MINT as Address,
      owner: "OwnerPubkey1111" as Address,
      name: "TestAgent",
      uri: "https://example.com/metadata.json",
      memberNumber: 7n,
      additionalMetadata: {},
      nonTransferable: false,
    };

    it("should convert SATI identity to agent0 AgentSummary with CAIP-2 agentId", () => {
      const result = toAgentSummary(identity, MAINNET_CHAIN);

      expect(result.chainId).toBe(0);
      expect(result.agentId).toBe(`${MAINNET_CHAIN}:${TEST_MINT}`);
      expect(result.name).toBe("TestAgent");
      expect(result.owners).toEqual(["OwnerPubkey1111"]);
      expect(result.extras).toEqual({});
    });

    it("should populate skills/tools from registration file endpoints", () => {
      const regFile = {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const,
        name: "TestAgent",
        description: "Test",
        image: "https://example.com/img.png",
        properties: { files: [{ uri: "https://example.com/img.png", type: "image/png" }] },
        endpoints: [
          {
            name: "MCP",
            endpoint: "https://mcp.example.com",
            mcpTools: ["tool1", "tool2"],
            mcpPrompts: ["prompt1"],
            mcpResources: ["resource1"],
          },
          {
            name: "A2A",
            endpoint: "https://a2a.example.com",
            a2aSkills: ["skill1"],
          },
          {
            name: "OASF",
            endpoint: "https://oasf.example.com",
            skills: ["oasf-skill1"],
            domains: ["finance"],
          },
        ],
      };

      const result = toAgentSummary(identity, MAINNET_CHAIN, regFile);

      expect(result.mcpTools).toEqual(["tool1", "tool2"]);
      expect(result.mcpPrompts).toEqual(["prompt1"]);
      expect(result.mcpResources).toEqual(["resource1"]);
      expect(result.a2aSkills).toEqual(["skill1"]);
      expect(result.oasfSkills).toEqual(["oasf-skill1"]);
      expect(result.oasfDomains).toEqual(["finance"]);
      expect(result.mcp).toBe("https://mcp.example.com");
      expect(result.a2a).toBe("https://a2a.example.com");
    });

    it("should default skills/tools to empty arrays without registration file", () => {
      const result = toAgentSummary(identity, MAINNET_CHAIN);

      expect(result.mcpTools).toEqual([]);
      expect(result.mcpPrompts).toEqual([]);
      expect(result.mcpResources).toEqual([]);
      expect(result.a2aSkills).toEqual([]);
      expect(result.oasfSkills).toEqual([]);
      expect(result.oasfDomains).toEqual([]);
    });
  });

  describe("toFeedback", () => {
    it("should convert SATI feedback data to agent0 Feedback with CAIP-2 agentId", () => {
      const result = toFeedback({
        agentMint: TEST_MINT,
        chain: MAINNET_CHAIN,
        reviewer: "ReviewerPubkey",
        feedbackIndex: 0,
        content: {
          value: 85,
          tag1: "quality",
          tag2: "speed",
          endpoint: "https://api.example.com",
          text: "Excellent work",
        },
        txSignature: "5abc123",
        createdAt: 1700000000,
      });

      expect(result.agentId).toBe(`${MAINNET_CHAIN}:${TEST_MINT}`);
      expect(result.reviewer).toBe("ReviewerPubkey");
      expect(result.value).toBe(85);
      expect(result.tags).toEqual(["quality", "speed"]);
      expect(result.endpoint).toBe("https://api.example.com");
      expect(result.text).toBe("Excellent work");
      expect(result.txHash).toBe("5abc123");
      expect(result.isRevoked).toBe(false);
    });

    it("should handle missing optional fields", () => {
      const result = toFeedback({
        agentMint: TEST_MINT,
        chain: MAINNET_CHAIN,
        reviewer: "Reviewer",
        feedbackIndex: 0,
        content: {},
      });

      expect(result.value).toBeUndefined();
      expect(result.tags).toEqual([]);
      expect(result.endpoint).toBeUndefined();
    });

    it("should store outcome as raw number in context", () => {
      const result = toFeedback({
        agentMint: TEST_MINT,
        chain: MAINNET_CHAIN,
        reviewer: "Reviewer",
        feedbackIndex: 0,
        content: {},
        outcome: 2,
      });

      expect(result.context?.outcome).toBe(2);
      // No label translation
      expect(result.context?.satiOutcome).toBeUndefined();
      expect(result.context?.satiOutcomeRaw).toBeUndefined();
    });

    it("should not derive value from outcome", () => {
      const result = toFeedback({
        agentMint: TEST_MINT,
        chain: MAINNET_CHAIN,
        reviewer: "Reviewer",
        feedbackIndex: 0,
        content: {},
        outcome: 2,
      });

      // value should only come from explicit content.value, not from outcome mapping
      expect(result.value).toBeUndefined();
    });

    it("should use explicit content.value when provided alongside outcome", () => {
      const result = toFeedback({
        agentMint: TEST_MINT,
        chain: MAINNET_CHAIN,
        reviewer: "Reviewer",
        feedbackIndex: 0,
        content: { value: 75 },
        outcome: 0,
      });

      expect(result.value).toBe(75);
      expect(result.context?.outcome).toBe(0);
    });
  });
});
