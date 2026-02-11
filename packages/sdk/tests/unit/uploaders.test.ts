/**
 * Uploaders Unit Tests
 *
 * Tests MetadataUploader interface and createPinataUploader implementation.
 * Uses mocked fetch - no network required.
 *
 * Run: pnpm vitest run tests/unit/uploaders.test.ts
 */

import { describe, test, expect, vi, afterEach } from "vitest";
import { createPinataUploader } from "../../src/uploaders";

describe("createPinataUploader", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("should upload JSON and return ipfs:// URI", async () => {
    const mockCid = "QmTestHash123abc";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ IpfsHash: mockCid, PinSize: 42, Timestamp: "2026-02-10T00:00:00Z" }),
    });

    const uploader = createPinataUploader("test-jwt-token");
    const uri = await uploader.upload({ name: "TestAgent", description: "A test" });

    expect(uri).toBe(`ipfs://${mockCid}`);

    // Verify fetch was called with correct args
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.pinata.cloud/pinning/pinJSONToIPFS");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer test-jwt-token");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    // Verify the body wraps data in pinataContent
    const body = JSON.parse(opts.body);
    expect(body.pinataContent).toEqual({ name: "TestAgent", description: "A test" });
  });

  test("should throw on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    const uploader = createPinataUploader("bad-jwt");
    await expect(uploader.upload({ name: "test" })).rejects.toThrow("IPFS upload failed (401): Unauthorized");
  });

  test("should throw on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const uploader = createPinataUploader("test-jwt");
    await expect(uploader.upload({ name: "test" })).rejects.toThrow("Network error");
  });
});
