/**
 * Simple TTL cache for feedback query results.
 *
 * Reduces redundant RPC calls when the same feedback data is queried
 * multiple times in quick succession (e.g. listing then revoking,
 * or dashboard re-renders).
 *
 * Automatically invalidated after write operations (giveFeedback,
 * revokeFeedback, submitPreparedFeedback).
 */

interface CacheEntry<T> {
  data: T;
  expires: number;
}

export class FeedbackCache {
  private cache = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly ttlMs = 30_000) {}

  /** Get cached data or null if expired/missing. */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() > entry.expires) {
      if (entry) this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /** Store data with TTL. */
  set<T>(key: string, data: T): void {
    this.cache.set(key, { data, expires: Date.now() + this.ttlMs });
  }

  /** Invalidate a specific key, or all entries if no key given. */
  invalidate(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /** Build a cache key from schema and optional agent mint. */
  static cacheKey(sasSchema: string, agentMint?: string): string {
    return `${sasSchema}:${agentMint ?? "*"}`;
  }
}
