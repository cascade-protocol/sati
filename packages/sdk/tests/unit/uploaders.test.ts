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

  test("should upload via v3 API and return ipfs:// URI", async () => {
    const mockCid = "QmTestHash123abc";
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      // Upload call -> v3 response
      if (url === "https://uploads.pinata.cloud/v3/files") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { id: "file-id", name: "registration.json", cid: mockCid, created_at: "" } }),
        });
      }
      // Gateway verification call -> 200 OK
      if (url.includes("gateway.pinata.cloud")) {
        return Promise.resolve({ ok: true });
      }
      return Promise.reject(new Error(`Unexpected URL: ${url}`));
    });

    const uploader = createPinataUploader("test-jwt-token");
    const uri = await uploader.upload({ name: "TestAgent", description: "A test" });

    expect(uri).toBe(`ipfs://${mockCid}`);

    // Verify upload fetch was called with correct args
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls;
    const [uploadUrl, uploadOpts] = calls[0];
    expect(uploadUrl).toBe("https://uploads.pinata.cloud/v3/files");
    expect(uploadOpts.method).toBe("POST");
    expect(uploadOpts.headers.Authorization).toBe("Bearer test-jwt-token");

    // Body is FormData (v3 API uses multipart upload)
    expect(uploadOpts.body).toBeInstanceOf(FormData);
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

  test("should throw when no CID in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });

    const uploader = createPinataUploader("test-jwt");
    await expect(uploader.upload({ name: "test" })).rejects.toThrow("No CID returned from Pinata");
  });
});
