/**
 * In-memory TTL cache with singleflight dedup.
 *
 * `get(key, ttl, loader)` returns the cached value if fresh, otherwise invokes
 * `loader()` — exactly once even if many callers miss simultaneously.
 */

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TTLCache {
  private store = new Map<string, Entry<unknown>>();
  private inflight = new Map<string, Promise<unknown>>();

  /** Returns the cached value if present and unexpired. */
  peek<T>(key: string): T | undefined {
    const entry = this.store.get(key) as Entry<T> | undefined;
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    const expiresAt = ttlMs === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Date.now() + ttlMs;
    this.store.set(key, { value, expiresAt });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
    this.inflight.clear();
  }

  /**
   * Singleflight-dedup'd loader. Concurrent misses share one upstream call.
   * The loader's result is cached with the given TTL.
   */
  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    const cached = this.peek<T>(key);
    if (cached !== undefined) return cached;

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
      try {
        const value = await loader();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }
}

/** Shared cache instance for the server process. */
export const cache = new TTLCache();
