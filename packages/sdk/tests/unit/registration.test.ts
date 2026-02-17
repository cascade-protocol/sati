import { describe, it, expect } from "vitest";
import {
  ERC8004_TYPE,
  VALID_TRUST_MODELS,
  SATI_CHAIN_ID,
  SATI_CHAIN_ID_DEVNET,
  SATI_CHAIN_IDS,
  SATI_PROGRAM_ID,
  validateRegistrationFile,
  assertRegistrationFile,
  parseRegistrationFile,
  normalizeRegistrationFile,
  buildSatiRegistrationEntry,
  isValidAgentRegistry,
  isSatiAgentRegistry,
  hasSatiRegistration,
  getSatiAgentIds,
  type RegistrationFile,
} from "../../src/registration.js";

const VALID_REG_FILE = {
  type: ERC8004_TYPE,
  name: "TestAgent",
  description: "A test agent for unit testing purposes",
  image: "https://example.com/image.png",
  properties: {
    files: [{ uri: "https://example.com/image.png", type: "image/png" }],
  },
};

describe("registration validation", () => {
  describe("validateRegistrationFile", () => {
    it("should pass for a valid registration file", () => {
      const result = validateRegistrationFile(VALID_REG_FILE);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it("should pass with all optional fields", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        services: [{ name: "MCP", endpoint: "https://mcp.example.com" }],
        registrations: [{ agentId: "mint123", agentRegistry: "solana:chain:program" }],
        supportedTrust: ["reputation"],
        active: true,
        x402Support: true,
      });
      expect(result.ok).toBe(true);
    });

    it("should error on missing type", () => {
      const result = validateRegistrationFile({ ...VALID_REG_FILE, type: "wrong" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "type")).toBe(true);
    });

    it("should error on empty name", () => {
      const result = validateRegistrationFile({ ...VALID_REG_FILE, name: "" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "name")).toBe(true);
    });

    it("should error on missing description", () => {
      const { description: _, ...noDesc } = VALID_REG_FILE;
      const result = validateRegistrationFile(noDesc);
      expect(result.ok).toBe(false);
    });

    it("should error on invalid image URL", () => {
      const result = validateRegistrationFile({ ...VALID_REG_FILE, image: "not-a-url" });
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.field === "image")).toBe(true);
    });

    it("should error on missing properties", () => {
      const { properties: _, ...noProps } = VALID_REG_FILE;
      const result = validateRegistrationFile(noProps);
      expect(result.ok).toBe(false);
    });

    it("should error on invalid supportedTrust values", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        supportedTrust: ["invalid-trust"],
      });
      expect(result.ok).toBe(false);
    });

    it("should error on non-object input", () => {
      const result = validateRegistrationFile("not an object");
      expect(result.ok).toBe(false);
    });

    it("should error on null input", () => {
      const result = validateRegistrationFile(null);
      expect(result.ok).toBe(false);
    });

    // Best-practice warnings
    it("should warn on long name", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        name: "A".repeat(33),
      });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.field === "name")).toBe(true);
    });

    it("should warn on short description", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        description: "Short",
      });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.field === "description")).toBe(true);
    });

    it("should warn on invalid MCP endpoint URL", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        services: [{ name: "MCP", endpoint: "not-a-url" }],
      });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.field === "services[0].endpoint")).toBe(true);
    });

    it("should warn on invalid A2A endpoint URL", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        services: [{ name: "A2A", endpoint: "not-a-url" }],
      });
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.field === "services[0].endpoint")).toBe(true);
    });

    it("should not warn on non-URL endpoints for non-MCP/A2A services", () => {
      const result = validateRegistrationFile({
        ...VALID_REG_FILE,
        services: [{ name: "ENS", endpoint: "myagent.eth" }],
      });
      expect(result.ok).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe("assertRegistrationFile", () => {
    it("should not throw for valid data", () => {
      expect(() => assertRegistrationFile(VALID_REG_FILE)).not.toThrow();
    });

    it("should throw for invalid data", () => {
      expect(() => assertRegistrationFile({})).toThrow("Invalid ERC-8004 registration file");
    });
  });

  describe("parseRegistrationFile", () => {
    it("should return typed object for valid data", () => {
      const result = parseRegistrationFile(VALID_REG_FILE);
      expect(result).not.toBeNull();
      expect(result?.name).toBe("TestAgent");
      expect(result?.type).toBe(ERC8004_TYPE);
    });

    it("should return null for invalid data", () => {
      expect(parseRegistrationFile({})).toBeNull();
      expect(parseRegistrationFile(null)).toBeNull();
      expect(parseRegistrationFile("string")).toBeNull();
    });

    it("should default active to true", () => {
      const result = parseRegistrationFile(VALID_REG_FILE);
      expect(result?.active).toBe(true);
    });
  });
});

describe("normalizeRegistrationFile", () => {
  it("should rename endpoints to services", () => {
    const result = normalizeRegistrationFile({
      endpoints: [{ type: "MCP", value: "https://mcp.example.com" }],
    });
    expect(result.services).toBeDefined();
    expect(result.endpoints).toBeUndefined();
    expect((result.services as Record<string, unknown>[])[0].name).toBe("MCP");
    expect((result.services as Record<string, unknown>[])[0].endpoint).toBe("https://mcp.example.com");
  });

  it("should not overwrite existing services with endpoints", () => {
    const result = normalizeRegistrationFile({
      services: [{ name: "A2A", endpoint: "https://a2a.example.com" }],
      endpoints: [{ type: "MCP", value: "https://mcp.example.com" }],
    });
    expect((result.services as Record<string, unknown>[])[0].name).toBe("A2A");
  });

  it("should spread meta into service fields for agent0-style endpoints", () => {
    const result = normalizeRegistrationFile({
      endpoints: [
        {
          type: "MCP",
          value: "https://mcp.example.com",
          meta: { mcpTools: ["tool1"], version: "1.0" },
        },
      ],
    });
    const svc = (result.services as Record<string, unknown>[])[0];
    expect(svc.mcpTools).toEqual(["tool1"]);
    expect(svc.version).toBe("1.0");
  });

  it("should rename x402support to x402Support", () => {
    const result = normalizeRegistrationFile({ x402support: true });
    expect(result.x402Support).toBe(true);
    expect(result.x402support).toBeUndefined();
  });

  it("should not overwrite existing x402Support", () => {
    const result = normalizeRegistrationFile({ x402Support: false, x402support: true });
    expect(result.x402Support).toBe(false);
  });

  it("should rename trustModels to supportedTrust", () => {
    const result = normalizeRegistrationFile({ trustModels: ["reputation"] });
    expect(result.supportedTrust).toEqual(["reputation"]);
    expect(result.trustModels).toBeUndefined();
  });

  it("should pass through spec-compliant data unchanged", () => {
    const input = { ...VALID_REG_FILE };
    const result = normalizeRegistrationFile(input);
    expect(result).toEqual(input);
  });
});

describe("SATI registration helpers", () => {
  describe("buildSatiRegistrationEntry", () => {
    it("should build mainnet entry by default", () => {
      const entry = buildSatiRegistrationEntry("mintAddr");
      expect(entry.agentId).toBe("mintAddr");
      expect(entry.agentRegistry).toBe(`${SATI_CHAIN_ID}:${SATI_PROGRAM_ID}`);
    });

    it("should build devnet entry", () => {
      const entry = buildSatiRegistrationEntry("mintAddr", "devnet");
      expect(entry.agentRegistry).toBe(`${SATI_CHAIN_ID_DEVNET}:${SATI_PROGRAM_ID}`);
    });

    it("should build mainnet entry explicitly", () => {
      const entry = buildSatiRegistrationEntry("mintAddr", "mainnet");
      expect(entry.agentRegistry).toBe(`${SATI_CHAIN_ID}:${SATI_PROGRAM_ID}`);
    });
  });

  describe("hasSatiRegistration / getSatiAgentIds", () => {
    const fileWithSati: RegistrationFile = {
      ...VALID_REG_FILE,
      type: ERC8004_TYPE,
      registrations: [
        { agentId: "mint1", agentRegistry: `${SATI_CHAIN_ID}:${SATI_PROGRAM_ID}` },
        { agentId: "mint2", agentRegistry: `${SATI_CHAIN_ID_DEVNET}:${SATI_PROGRAM_ID}` },
        { agentId: "evm-agent", agentRegistry: "eip155:1:0x742" },
      ],
    };

    it("should detect SATI registrations", () => {
      expect(hasSatiRegistration(fileWithSati)).toBe(true);
    });

    it("should return false for non-SATI files", () => {
      const file: RegistrationFile = {
        ...VALID_REG_FILE,
        type: ERC8004_TYPE,
        registrations: [{ agentId: "evm-agent", agentRegistry: "eip155:1:0x742" }],
      };
      expect(hasSatiRegistration(file)).toBe(false);
    });

    it("should extract SATI agent IDs from both networks", () => {
      const ids = getSatiAgentIds(fileWithSati);
      expect(ids).toEqual(["mint1", "mint2"]);
    });

    it("should return empty array for no registrations", () => {
      const file: RegistrationFile = { ...VALID_REG_FILE, type: ERC8004_TYPE };
      expect(getSatiAgentIds(file)).toEqual([]);
    });
  });
});

describe("CAIP validation", () => {
  describe("isValidAgentRegistry", () => {
    it("should accept valid 3-part registries", () => {
      expect(isValidAgentRegistry("eip155:1:0x742")).toBe(true);
      expect(isValidAgentRegistry("solana:chain:program")).toBe(true);
    });

    it("should reject malformed registries", () => {
      expect(isValidAgentRegistry("invalid")).toBe(false);
      expect(isValidAgentRegistry("a:b")).toBe(false);
      expect(isValidAgentRegistry("a:b:c:d")).toBe(false);
      expect(isValidAgentRegistry("a::c")).toBe(false);
      expect(isValidAgentRegistry("")).toBe(false);
    });
  });

  describe("isSatiAgentRegistry", () => {
    it("should accept mainnet SATI registry", () => {
      expect(isSatiAgentRegistry(`${SATI_CHAIN_ID}:${SATI_PROGRAM_ID}`)).toBe(true);
    });

    it("should accept devnet SATI registry", () => {
      expect(isSatiAgentRegistry(`${SATI_CHAIN_ID_DEVNET}:${SATI_PROGRAM_ID}`)).toBe(true);
    });

    it("should reject non-SATI registries", () => {
      expect(isSatiAgentRegistry("eip155:1:0x742")).toBe(false);
      expect(isSatiAgentRegistry("solana:unknown:program")).toBe(false);
    });
  });
});

describe("constants", () => {
  it("should have correct ERC8004_TYPE", () => {
    expect(ERC8004_TYPE).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
  });

  it("should have correct VALID_TRUST_MODELS", () => {
    expect(VALID_TRUST_MODELS).toEqual(["reputation", "crypto-economic", "tee-attestation"]);
  });

  it("should have consistent SATI_CHAIN_IDS", () => {
    expect(SATI_CHAIN_IDS.mainnet).toBe(SATI_CHAIN_ID);
    expect(SATI_CHAIN_IDS.devnet).toBe(SATI_CHAIN_ID_DEVNET);
  });
});
