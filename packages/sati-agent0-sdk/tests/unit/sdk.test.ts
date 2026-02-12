import { describe, it, expect } from "vitest";
import { SatiAgent0 } from "../../src/sdk.js";
import { SOLANA_CAIP2_CHAINS } from "../../src/adapters.js";
import { UnsupportedOperationError } from "../../src/errors.js";
import type { SatiAgent0Config } from "../../src/types.js";

// Mock signer for tests (SatiAgent0Config requires KeyPairSigner but we only test
// non-chain methods here, so a minimal mock is fine).
const mockConfig: SatiAgent0Config = {
  network: "devnet",
  signer: {} as SatiAgent0Config["signer"],
};

describe("SatiAgent0", () => {
  it("should create an instance", () => {
    const sdk = new SatiAgent0(mockConfig);
    expect(sdk).toBeInstanceOf(SatiAgent0);
  });

  it("should return the configured network", () => {
    const sdk = new SatiAgent0({ ...mockConfig, network: "mainnet" });
    expect(sdk.network).toBe("mainnet");
  });

  it("should return the CAIP-2 chain reference", () => {
    const devnetSdk = new SatiAgent0(mockConfig);
    expect(devnetSdk.chain).toBe(SOLANA_CAIP2_CHAINS.devnet);

    const mainnetSdk = new SatiAgent0({ ...mockConfig, network: "mainnet" });
    expect(mainnetSdk.chain).toBe(SOLANA_CAIP2_CHAINS.mainnet);

    const localnetSdk = new SatiAgent0({ ...mockConfig, network: "localnet" });
    expect(localnetSdk.chain).toBe(SOLANA_CAIP2_CHAINS.localnet);
  });

  it("should create an agent with createAgent", () => {
    const sdk = new SatiAgent0(mockConfig);
    const agent = sdk.createAgent("TestAgent", "A test agent");
    expect(agent.name).toBe("TestAgent");
    expect(agent.description).toBe("A test agent");
    expect(agent.agentId).toBeUndefined();
  });

  it("should create an agent with image", () => {
    const sdk = new SatiAgent0(mockConfig);
    const agent = sdk.createAgent("TestAgent", "A test agent", "https://example.com/img.png");
    expect(agent.image).toBe("https://example.com/img.png");
  });

  it("prepareFeedbackFile should merge input with extras", () => {
    const sdk = new SatiAgent0(mockConfig);
    const result = sdk.prepareFeedbackFile({ text: "Great service" }, { customField: "extra" });
    expect(result.text).toBe("Great service");
    expect(result.customField).toBe("extra");
  });

  it("appendResponse should throw UnsupportedOperationError", async () => {
    const sdk = new SatiAgent0(mockConfig);
    const testAgentId = `${SOLANA_CAIP2_CHAINS.devnet}:SomeMintAddress`;
    await expect(sdk.appendResponse(testAgentId, "0x123", 0, { uri: "ipfs://abc", hash: "0x" })).rejects.toThrow(
      UnsupportedOperationError,
    );
  });
});
