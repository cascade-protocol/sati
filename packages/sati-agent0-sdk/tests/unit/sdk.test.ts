import { describe, it, expect } from "vitest";
import { SatiSDK } from "../../src/sdk.js";
import { SOLANA_CAIP2_CHAINS } from "../../src/adapters.js";
import type { SatiSDKConfig } from "../../src/types.js";

// Mock signer for tests (SatiSDKConfig requires KeyPairSigner but we only test
// non-chain methods here, so a minimal mock is fine).
const mockConfig: SatiSDKConfig = {
  network: "devnet",
  signer: {} as SatiSDKConfig["signer"],
};

describe("SatiSDK", () => {
  it("should create an instance", () => {
    const sdk = new SatiSDK(mockConfig);
    expect(sdk).toBeInstanceOf(SatiSDK);
  });

  it("should return the configured network", () => {
    const sdk = new SatiSDK({ ...mockConfig, network: "mainnet" });
    expect(sdk.network).toBe("mainnet");
  });

  it("should return the CAIP-2 chain reference", () => {
    const devnetSdk = new SatiSDK(mockConfig);
    expect(devnetSdk.chain).toBe(SOLANA_CAIP2_CHAINS.devnet);

    const mainnetSdk = new SatiSDK({ ...mockConfig, network: "mainnet" });
    expect(mainnetSdk.chain).toBe(SOLANA_CAIP2_CHAINS.mainnet);

    const localnetSdk = new SatiSDK({ ...mockConfig, network: "localnet" });
    expect(localnetSdk.chain).toBe(SOLANA_CAIP2_CHAINS.localnet);
  });

  it("should create an agent with createAgent", () => {
    const sdk = new SatiSDK(mockConfig);
    const agent = sdk.createAgent("TestAgent", "A test agent");
    expect(agent.name).toBe("TestAgent");
    expect(agent.description).toBe("A test agent");
    expect(agent.agentId).toBeUndefined();
  });

  it("should create an agent with image", () => {
    const sdk = new SatiSDK(mockConfig);
    const agent = sdk.createAgent("TestAgent", "A test agent", "https://example.com/img.png");
    expect(agent.image).toBe("https://example.com/img.png");
  });

  it("prepareFeedbackFile should merge input with extras", () => {
    const sdk = new SatiSDK(mockConfig);
    const result = sdk.prepareFeedbackFile({ text: "Great service" }, { customField: "extra" });
    expect(result.text).toBe("Great service");
    expect(result.customField).toBe("extra");
  });

  it("appendResponse should throw not supported", async () => {
    const sdk = new SatiSDK(mockConfig);
    const testAgentId = `${SOLANA_CAIP2_CHAINS.devnet}:SomeMintAddress`;
    await expect(sdk.appendResponse(testAgentId, "0x123", 0, { uri: "ipfs://abc", hash: "0x" })).rejects.toThrow(
      "not supported on SATI",
    );
  });
});
