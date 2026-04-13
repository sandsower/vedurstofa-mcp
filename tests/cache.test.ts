import { describe, expect, it, vi } from "vitest";

import { TTLCache } from "../src/cache.js";

describe("TTLCache", () => {
  it("caches successful values and returns them without calling loader again", async () => {
    const cache = new TTLCache();
    const loader = vi.fn(async () => 42);
    const a = await cache.get("k", 60_000, loader);
    const b = await cache.get("k", 60_000, loader);
    expect(a).toBe(42);
    expect(b).toBe(42);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("expires values after ttl", async () => {
    const cache = new TTLCache();
    vi.useFakeTimers();
    const loader = vi.fn(async () => Math.random());
    const a = await cache.get("k", 1000, loader);
    vi.advanceTimersByTime(2000);
    const b = await cache.get("k", 1000, loader);
    expect(a).not.toBe(b);
    expect(loader).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("singleflights concurrent misses into one loader call", async () => {
    const cache = new TTLCache();
    let resolver: ((v: number) => void) | undefined;
    const loader = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolver = r;
        }),
    );
    const [p1, p2, p3] = [
      cache.get("k", 60_000, loader),
      cache.get("k", 60_000, loader),
      cache.get("k", 60_000, loader),
    ];
    // Let the loader start before resolving.
    await Promise.resolve();
    resolver!(7);
    const results = await Promise.all([p1, p2, p3]);
    expect(results).toEqual([7, 7, 7]);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("does not cache thrown errors — next caller retries", async () => {
    const cache = new TTLCache();
    const loader = vi
      .fn<[], Promise<number>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(100);

    await expect(cache.get("k", 60_000, loader)).rejects.toThrow("boom");
    await expect(cache.get("k", 60_000, loader)).resolves.toBe(100);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("Infinity ttl never expires", async () => {
    const cache = new TTLCache();
    vi.useFakeTimers();
    const loader = vi.fn(async () => "forever");
    await cache.get("k", Number.POSITIVE_INFINITY, loader);
    vi.advanceTimersByTime(10 ** 9);
    const b = await cache.get("k", Number.POSITIVE_INFINITY, loader);
    expect(b).toBe("forever");
    expect(loader).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
