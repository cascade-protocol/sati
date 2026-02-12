/**
 * SatiAgentBuilder Unit Tests
 *
 * Tests the fluent builder API for agent registration parameters.
 * Pure unit tests - no network required (on-chain methods are not tested here).
 *
 * Run: pnpm vitest run tests/unit/agent-builder.test.ts
 */

import { describe, it, expect } from "vitest";
import type { Address, KeyPairSigner } from "@solana/kit";
import { SatiAgentBuilder } from "../../src/agent-builder";
import type { MetadataUploader } from "../../src/uploaders";

// Minimal mock - builder only uses _sati for on-chain operations (register, update, upload).
// Fluent setters and state management work entirely offline.
const mockSati = {} as ConstructorParameters<typeof SatiAgentBuilder>[0];

describe("SatiAgentBuilder", () => {
  it("should initialize with name, description, image, and active=true", () => {
    const builder = new SatiAgentBuilder(mockSati, "TestAgent", "A test agent", "https://img.example.com/a.png");
    const params = builder.params;

    expect(params.name).toBe("TestAgent");
    expect(params.description).toBe("A test agent");
    expect(params.image).toBe("https://img.example.com/a.png");
    expect(params.active).toBe(true);
    expect(params.services).toEqual([]);
  });

  it("should have no identity before registration", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    expect(builder.identity).toBeUndefined();
  });

  // =========================================================================
  // Fluent API chaining
  // =========================================================================

  it("should support fluent chaining on all setters", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");

    const result = builder
      .setMCP("https://mcp.example.com")
      .setA2A("https://a2a.example.com")
      .setWallet("WalletAddr123")
      .setActive(false)
      .setX402Support(true)
      .setSupportedTrust(["reputation"])
      .setExternalUrl("https://example.com")
      .updateInfo({ name: "Updated" });

    // Every setter should return the same builder instance
    expect(result).toBe(builder);
  });

  // =========================================================================
  // setMCP
  // =========================================================================

  it("setMCP should add an MCP endpoint", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setMCP("https://mcp.example.com");

    const ep = builder.params.services?.find((e) => e.name === "MCP");
    expect(ep).toBeDefined();
    expect(ep?.endpoint).toBe("https://mcp.example.com");
    expect(ep?.version).toBeUndefined();
    expect(ep?.mcpTools).toBeUndefined();
  });

  it("setMCP should include version and meta when provided", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setMCP("https://mcp.example.com", "2025-06-18", {
      tools: ["search", "summarize"],
      prompts: ["code-review"],
      resources: ["project-context"],
    });

    const ep = builder.params.services?.find((e) => e.name === "MCP");
    expect(ep?.version).toBe("2025-06-18");
    expect(ep?.mcpTools).toEqual(["search", "summarize"]);
    expect(ep?.mcpPrompts).toEqual(["code-review"]);
    expect(ep?.mcpResources).toEqual(["project-context"]);
  });

  it("setMCP should omit empty meta arrays", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setMCP("https://mcp.example.com", undefined, {
      tools: [],
      prompts: [],
      resources: [],
    });

    const ep = builder.params.services?.find((e) => e.name === "MCP");
    expect(ep?.mcpTools).toBeUndefined();
    expect(ep?.mcpPrompts).toBeUndefined();
    expect(ep?.mcpResources).toBeUndefined();
  });

  it("setMCP should replace existing MCP endpoint", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setMCP("https://old-mcp.example.com");
    builder.setMCP("https://new-mcp.example.com");

    const mcpEndpoints = builder.params.services?.filter((e) => e.name === "MCP") ?? [];
    expect(mcpEndpoints).toHaveLength(1);
    expect(mcpEndpoints[0].endpoint).toBe("https://new-mcp.example.com");
  });

  // =========================================================================
  // setA2A
  // =========================================================================

  it("setA2A should add an A2A endpoint", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setA2A("https://a2a.example.com/.well-known/agent-card.json");

    const ep = builder.params.services?.find((e) => e.name === "A2A");
    expect(ep).toBeDefined();
    expect(ep?.endpoint).toBe("https://a2a.example.com/.well-known/agent-card.json");
  });

  it("setA2A should include version and skills when provided", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setA2A("https://a2a.example.com", "1.0", { skills: ["code-review", "translate"] });

    const ep = builder.params.services?.find((e) => e.name === "A2A");
    expect(ep?.version).toBe("1.0");
    expect(ep?.a2aSkills).toEqual(["code-review", "translate"]);
  });

  // =========================================================================
  // setWallet
  // =========================================================================

  it("setWallet should add an agentWallet endpoint", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setWallet("WalletAddr123");

    const ep = builder.params.services?.find((e) => e.name === "agentWallet");
    expect(ep).toBeDefined();
    expect(ep?.endpoint).toBe("WalletAddr123");
  });

  // =========================================================================
  // setEndpoint (generic)
  // =========================================================================

  it("setEndpoint should add a custom endpoint", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setEndpoint({ name: "custom", endpoint: "https://custom.example.com" });

    const ep = builder.params.services?.find((e) => e.name === "custom");
    expect(ep).toBeDefined();
    expect(ep?.endpoint).toBe("https://custom.example.com");
  });

  it("setEndpoint should replace existing endpoint with same name", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setEndpoint({ name: "custom", endpoint: "https://v1.example.com" });
    builder.setEndpoint({ name: "custom", endpoint: "https://v2.example.com" });

    const customEndpoints = builder.params.services?.filter((e) => e.name === "custom") ?? [];
    expect(customEndpoints).toHaveLength(1);
    expect(customEndpoints[0].endpoint).toBe("https://v2.example.com");
  });

  // =========================================================================
  // removeEndpoint
  // =========================================================================

  it("removeEndpoint should remove by name", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setMCP("https://mcp.example.com");
    builder.setA2A("https://a2a.example.com");

    builder.removeEndpoint("MCP");

    expect(builder.params.services?.find((e) => e.name === "MCP")).toBeUndefined();
    expect(builder.params.services?.find((e) => e.name === "A2A")).toBeDefined();
  });

  it("removeEndpoint should be a no-op for nonexistent name", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setMCP("https://mcp.example.com");

    builder.removeEndpoint("nonexistent");
    expect(builder.params.services).toHaveLength(1);
  });

  // =========================================================================
  // Boolean / enum setters
  // =========================================================================

  it("setActive should update active flag", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    expect(builder.params.active).toBe(true);

    builder.setActive(false);
    expect(builder.params.active).toBe(false);

    builder.setActive(true);
    expect(builder.params.active).toBe(true);
  });

  it("setX402Support should update x402support flag", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    expect(builder.params.x402Support).toBeUndefined();

    builder.setX402Support(true);
    expect(builder.params.x402Support).toBe(true);

    builder.setX402Support(false);
    expect(builder.params.x402Support).toBe(false);
  });

  it("setSupportedTrust should update trust mechanisms", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");

    builder.setSupportedTrust(["reputation", "tee-attestation"]);
    expect(builder.params.supportedTrust).toEqual(["reputation", "tee-attestation"]);
  });

  it("setExternalUrl should update externalUrl", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    builder.setExternalUrl("https://example.com");
    expect(builder.params.externalUrl).toBe("https://example.com");
  });

  // =========================================================================
  // updateInfo
  // =========================================================================

  it("updateInfo should update specified fields only", () => {
    const builder = new SatiAgentBuilder(mockSati, "Original", "Original desc", "original.png");

    builder.updateInfo({ name: "Updated" });
    expect(builder.params.name).toBe("Updated");
    expect(builder.params.description).toBe("Original desc");
    expect(builder.params.image).toBe("original.png");
  });

  it("updateInfo should update all fields at once", () => {
    const builder = new SatiAgentBuilder(mockSati, "Old", "Old desc", "old.png");

    builder.updateInfo({ name: "New", description: "New desc", image: "new.png" });
    expect(builder.params.name).toBe("New");
    expect(builder.params.description).toBe("New desc");
    expect(builder.params.image).toBe("new.png");
  });

  // =========================================================================
  // setIdentity
  // =========================================================================

  it("setIdentity should set identity and be chainable", () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");
    const fakeIdentity = {
      mint: "MintAddr123" as Address,
      owner: "OwnerAddr123" as Address,
      name: "Test",
      uri: "https://ipfs.io/Qm...",
      memberNumber: 42n,
      additionalMetadata: {},
      nonTransferable: false,
    };

    const result = builder.setIdentity(fakeIdentity);
    expect(result).toBe(builder);
    expect(builder.identity).toBe(fakeIdentity);
  });

  // =========================================================================
  // Complex scenarios
  // =========================================================================

  it("should handle a full configuration flow", () => {
    const builder = new SatiAgentBuilder(
      mockSati,
      "MyAgent",
      "AI trading assistant",
      "https://img.example.com/agent.png",
    );

    builder
      .setMCP("https://mcp.myagent.com", "2025-06-18", {
        tools: ["search", "trade", "analyze"],
        prompts: ["market-analysis"],
      })
      .setA2A("https://a2a.myagent.com/.well-known/agent-card.json", "1.0", {
        skills: ["market-analysis", "portfolio-management"],
      })
      .setWallet("WalletAddr456")
      .setActive(true)
      .setX402Support(true)
      .setSupportedTrust(["reputation"])
      .setExternalUrl("https://myagent.com");

    const params = builder.params;
    expect(params.services).toHaveLength(3);
    expect(params.active).toBe(true);
    expect(params.x402Support).toBe(true);
    expect(params.supportedTrust).toEqual(["reputation"]);
    expect(params.externalUrl).toBe("https://myagent.com");

    const mcp = params.services?.find((e) => e.name === "MCP");
    expect(mcp?.mcpTools).toEqual(["search", "trade", "analyze"]);

    const a2a = params.services?.find((e) => e.name === "A2A");
    expect(a2a?.a2aSkills).toEqual(["market-analysis", "portfolio-management"]);

    const wallet = params.services?.find((e) => e.name === "agentWallet");
    expect(wallet?.endpoint).toBe("WalletAddr456");
  });

  // =========================================================================
  // On-chain operation guards
  // =========================================================================

  it("update should throw if no identity is set", async () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");

    await expect(
      builder.update({
        payer: {} as KeyPairSigner,
        owner: {} as KeyPairSigner,
        uploader: {} as MetadataUploader,
      }),
    ).rejects.toThrow("Agent not registered on-chain");
  });

  it("updateUri should throw if no identity is set", async () => {
    const builder = new SatiAgentBuilder(mockSati, "Test", "desc", "img.png");

    await expect(
      builder.updateUri({
        payer: {} as KeyPairSigner,
        owner: {} as KeyPairSigner,
        uri: "https://example.com",
      }),
    ).rejects.toThrow("Agent not registered on-chain");
  });
});
