import { describe, it, expect, vi } from "vitest";
import { FeedbackCache } from "../../src/feedback-cache.js";

describe("FeedbackCache", () => {
  it("should return null on cache miss", () => {
    const cache = new FeedbackCache();
    expect(cache.get("nonexistent")).toBeNull();
  });

  it("should return cached data on hit", () => {
    const cache = new FeedbackCache();
    cache.set("key1", { items: [1, 2, 3] });
    expect(cache.get("key1")).toEqual({ items: [1, 2, 3] });
  });

  it("should expire entries after TTL", () => {
    vi.useFakeTimers();
    try {
      const cache = new FeedbackCache(100); // 100ms TTL
      cache.set("key1", "data");

      expect(cache.get("key1")).toBe("data");

      vi.advanceTimersByTime(150);
      expect(cache.get("key1")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should invalidate specific key", () => {
    const cache = new FeedbackCache();
    cache.set("key1", "a");
    cache.set("key2", "b");

    cache.invalidate("key1");
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBe("b");
  });

  it("should invalidate all entries when no key given", () => {
    const cache = new FeedbackCache();
    cache.set("key1", "a");
    cache.set("key2", "b");

    cache.invalidate();
    expect(cache.get("key1")).toBeNull();
    expect(cache.get("key2")).toBeNull();
  });

  it("cacheKey should build schema:agentMint format", () => {
    expect(FeedbackCache.cacheKey("schema1", "mint1")).toBe("schema1:mint1");
  });

  it("cacheKey should use wildcard when no agentMint", () => {
    expect(FeedbackCache.cacheKey("schema1")).toBe("schema1:*");
  });
});
