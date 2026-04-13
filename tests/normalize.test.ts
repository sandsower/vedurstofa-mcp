import { describe, expect, it } from "vitest";

import { normalizeObservation, parseVedurTimestamp } from "../src/normalize.js";

describe("normalizeObservation", () => {
  it("maps single-letter keys to snake_case with units", () => {
    const raw = {
      id: "1470",
      name: "Reykjavík",
      time: "2026-04-13 10:00:00",
      F: "8",
      FX: "9",
      FG: "16",
      D: "NNE",
      D2: "30",
      T: "5.6",
      W: "Clear",
      P: "1003",
      RH: "58",
      TD: "-2.0",
      R: "0.1",
      valid: "1",
    };
    const obs = normalizeObservation(raw);
    expect(obs.station_id).toBe("1470");
    expect(obs.station_name).toBe("Reykjavík");
    expect(obs.data_available).toBe(true);
    expect(obs.wind_speed_ms).toBe(8);
    expect(obs.max_wind_speed_ms).toBe(9);
    expect(obs.max_wind_gust_ms).toBe(16);
    expect(obs.wind_direction).toBe("NNE");
    expect(obs.wind_direction_degrees).toBe(30);
    expect(obs.temperature_c).toBe(5.6);
    expect(obs.description).toBe("Clear");
    expect(obs.pressure_hpa).toBe(1003);
    expect(obs.humidity_pct).toBe(58);
    expect(obs.dew_point_c).toBe(-2);
    expect(obs.precipitation_mm_per_h).toBe(0.1);
    expect(obs.observed_at).toBe("2026-04-13T10:00:00.000Z");
  });

  it("drops empty-string fields", () => {
    const obs = normalizeObservation({
      id: "1",
      name: "Test",
      time: "2026-04-13 10:00:00",
      T: "5",
      W: "",
      V: "",
      valid: "1",
    });
    expect(obs.temperature_c).toBe(5);
    expect(obs).not.toHaveProperty("description");
    expect(obs).not.toHaveProperty("visibility_km");
  });

  it("returns data_available: false for stations reporting valid=0", () => {
    const obs = normalizeObservation({
      id: "999",
      name: "Offline",
      time: "2026-04-13 10:00:00",
      T: "5",
      valid: "0",
    });
    expect(obs.data_available).toBe(false);
    expect(obs.reason).toContain("valid=0");
    expect(obs).not.toHaveProperty("temperature_c");
  });

  it("handles missing timestamp gracefully", () => {
    const obs = normalizeObservation({ id: "1", name: "X", T: "3", valid: "1" });
    expect(obs.observed_at).toBeNull();
    expect(obs.temperature_c).toBe(3);
  });
});

describe("parseVedurTimestamp", () => {
  it("parses space-separated timestamps as UTC", () => {
    expect(parseVedurTimestamp("2026-04-13 10:00:00")).toBe("2026-04-13T10:00:00.000Z");
  });

  it("accepts already-ISO timestamps", () => {
    expect(parseVedurTimestamp("2026-04-13T10:00:00Z")).toBe("2026-04-13T10:00:00.000Z");
  });

  it("returns null for junk input", () => {
    expect(parseVedurTimestamp("")).toBeNull();
    expect(parseVedurTimestamp("not a date")).toBeNull();
    expect(parseVedurTimestamp(null)).toBeNull();
    expect(parseVedurTimestamp(undefined)).toBeNull();
  });
});
