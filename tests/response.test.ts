import { describe, expect, it } from "vitest";

import { ATTRIBUTION } from "../src/config.js";
import { buildEnvelope, serializeEnvelope } from "../src/response.js";

describe("buildEnvelope", () => {
  it("includes attribution, source, fetched_at, and data", () => {
    const fetchedAt = new Date("2026-04-13T10:00:00Z");
    const env = buildEnvelope({
      source: "https://api.vedur.is/foo",
      data: { hello: "world" },
      fetchedAt,
    });
    expect(env.attribution).toBe(ATTRIBUTION);
    expect(env.source).toBe("https://api.vedur.is/foo");
    expect(env.fetched_at).toBe("2026-04-13T10:00:00.000Z");
    expect(env.data).toEqual({ hello: "world" });
    expect(env.errors).toBeUndefined();
    expect(env.degraded).toBeUndefined();
  });

  it("surfaces errors when provided", () => {
    const env = buildEnvelope({
      source: "x",
      data: [],
      errors: [{ subject: "station:9", reason: "offline" }],
    });
    expect(env.errors).toHaveLength(1);
  });

  it("marks responses degraded", () => {
    const env = buildEnvelope({
      source: "x",
      data: {},
      degraded: { reason: "scraper drift" },
    });
    expect(env.degraded).toBe(true);
    expect(env.degraded_reason).toBe("scraper drift");
  });
});

describe("serializeEnvelope", () => {
  it("returns valid JSON", () => {
    const env = buildEnvelope({ source: "x", data: { a: 1 } });
    const json = serializeEnvelope(env);
    const parsed = JSON.parse(json);
    expect(parsed.data).toEqual({ a: 1 });
  });

  it("truncates oversized array payloads", () => {
    const big = Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      filler: "x".repeat(200),
    }));
    const env = buildEnvelope({ source: "x", data: big });
    const json = serializeEnvelope(env);
    expect(Buffer.byteLength(json, "utf8")).toBeLessThanOrEqual(100 * 1024);
    const parsed = JSON.parse(json);
    expect(parsed.truncated).toBe(true);
    expect(parsed.data.length).toBeLessThan(big.length);
  });
});
