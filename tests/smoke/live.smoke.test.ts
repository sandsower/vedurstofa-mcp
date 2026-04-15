/**
 * Live smoke tests — hit api.vedur.is to catch schema drift the unit fixtures
 * can't see. Kept tiny and read-only. Skipped by the default `test` script;
 * run with `npm run test:smoke`. May fail on network weather.
 */

import { describe, expect, it } from "vitest";

import { getObservationIndex } from "../../src/sources/observations.js";
import { getRecentQuakes } from "../../src/sources/quakes.js";
import { getWeatherWarnings } from "../../src/sources/warnings.js";
import { loadStations } from "../../src/stations.js";

describe("live smoke: observations", () => {
  it("returns a non-empty index of AWS stations", async () => {
    const { index, fetchedAt } = await getObservationIndex();
    expect(index.size).toBeGreaterThan(10);
    expect(fetchedAt.getTime()).toBeLessThanOrEqual(Date.now());

    // Reykjavík (1470) is the anchor station — if this ever goes missing,
    // the AWS feed has changed shape or the IDs have moved.
    const reykjavik = index.get("1470");
    expect(reykjavik).toBeDefined();
    expect(reykjavik?.station_id).toBe("1470");
  });
});

describe("live smoke: quakes", () => {
  it("fetches recent quakes without erroring", async () => {
    // Keep the window small — the endpoint slows down under long windows
    // and smoke tests are for schema drift, not throughput.
    const { quakes, source } = await getRecentQuakes({ hours: 6, includeUnreviewed: true });
    expect(Array.isArray(quakes)).toBe(true);
    expect(source).toContain("api.vedur.is");
    // Every quake has a finite lat/lon if any are returned.
    for (const q of quakes) {
      expect(Number.isFinite(q.latitude)).toBe(true);
      expect(Number.isFinite(q.longitude)).toBe(true);
    }
  });
});

describe("live smoke: warnings", () => {
  it("fetches the CAP feed and returns a parseable list", async () => {
    const { alerts, source } = await getWeatherWarnings();
    expect(source).toContain("api.vedur.is");
    expect(Array.isArray(alerts)).toBe(true);
    // Empty array is valid (no active warnings right now).
    // If any alerts are present, each should have at least one info block.
    for (const alert of alerts) {
      expect(Array.isArray(alert.infos)).toBe(true);
    }
  });
});

describe("live smoke: stations catalog", () => {
  it("loads the station catalog (upstream or fallback)", async () => {
    const stations = await loadStations();
    // Hard floor: the fallback catalog alone has >10 recommended stations.
    // A healthy upstream returns hundreds.
    expect(stations.length).toBeGreaterThan(10);
    // Reykjavík (1470) is in both the upstream feed and the fallback.
    expect(stations.some((s) => s.id === "1470")).toBe(true);
  });
});
