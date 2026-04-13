import { describe, expect, it } from "vitest";

import {
  haversineKm,
  isInBbox,
  type NormalizedQuake,
} from "../src/sources/quakes.js";

function quake(overrides: Partial<NormalizedQuake> = {}): NormalizedQuake {
  return {
    timestamp: "2026-04-13T10:00:00.000Z",
    latitude: 63.85,
    longitude: -22.4,
    depth_km: 5,
    magnitude: 3.2,
    magnitude_type: "Mlw",
    location: "Reykjanes",
    quality: 90,
    reviewed: true,
    event_id: "abc",
    ...overrides,
  };
}

describe("isInBbox", () => {
  const bbox = { minLat: 63.6, maxLat: 64.1, minLon: -23.0, maxLon: -21.6 };

  it("includes events inside the box", () => {
    expect(isInBbox(quake({ latitude: 63.85, longitude: -22.4 }), bbox)).toBe(true);
  });

  it("excludes events outside the box", () => {
    expect(isInBbox(quake({ latitude: 65.0, longitude: -17.5 }), bbox)).toBe(false);
    expect(isInBbox(quake({ latitude: 63.85, longitude: -18.0 }), bbox)).toBe(false);
  });

  it("includes events exactly on the boundary", () => {
    expect(isInBbox(quake({ latitude: 63.6, longitude: -23.0 }), bbox)).toBe(true);
    expect(isInBbox(quake({ latitude: 64.1, longitude: -21.6 }), bbox)).toBe(true);
  });
});

describe("haversineKm", () => {
  it("returns 0 for the same point", () => {
    expect(haversineKm({ lat: 64, lon: -22 }, { lat: 64, lon: -22 })).toBeCloseTo(0, 5);
  });

  it("computes a plausible distance between Reykjavík and Akureyri", () => {
    const km = haversineKm({ lat: 64.147, lon: -21.94 }, { lat: 65.68, lon: -18.1 });
    // Actual great-circle distance ≈ 250 km
    expect(km).toBeGreaterThan(230);
    expect(km).toBeLessThan(280);
  });

  it("is symmetric", () => {
    const a = { lat: 63.85, lon: -22.4 };
    const b = { lat: 64.42, lon: -17.33 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 6);
  });
});
