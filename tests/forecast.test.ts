import { describe, expect, it } from "vitest";

import { ScraperDriftError } from "../src/errors.js";
import {
  extractWTimeBody,
  extractWTimes,
  parseRegionForecastHtml,
  parseStationAreaMap,
} from "../src/sources/forecast.js";

describe("extractWTimes", () => {
  it("parses new Date(Y, M-1, D, h, m) tuples as UTC", () => {
    const body = "new Date(2026,4-1,14,0,0),new Date(2026,4-1,14,3,0),new Date(2026,4-1,14,6,30)";
    expect(extractWTimes(body)).toEqual([
      "2026-04-14T00:00:00.000Z",
      "2026-04-14T03:00:00.000Z",
      "2026-04-14T06:30:00.000Z",
    ]);
  });

  it("handles the 4-arg form (no minutes)", () => {
    expect(extractWTimes("new Date(2026,4-1,14,12)")).toEqual(["2026-04-14T12:00:00.000Z"]);
  });

  it("returns empty array when no dates are present", () => {
    expect(extractWTimes("no dates here")).toEqual([]);
  });
});

describe("extractWTimeBody", () => {
  it("isolates the array contents so unrelated new Date() calls are ignored", () => {
    const html = `var now = new Date(2026,4-1,13,22,55);
      VI.conf = { wTime: [new Date(2026,4-1,14,0,0), new Date(2026,4-1,14,1,0)], alertTime: new Date(2026,4-1,10,0,0) };`;
    const body = extractWTimeBody(html);
    expect(body).not.toBeNull();
    expect(extractWTimes(body!)).toEqual([
      "2026-04-14T00:00:00.000Z",
      "2026-04-14T01:00:00.000Z",
    ]);
  });

  it("returns null when wTime is missing", () => {
    expect(extractWTimeBody("no wTime here")).toBeNull();
  });
});

describe("parseStationAreaMap", () => {
  it("extracts station id to area code pairs from a wslinfo.js-like blob", () => {
    const js = `
      VI.wsInfo = {
        1: {'name':'Reykjavík','iTy':3,'nst':[],'area':'fa'},
        422: {'name':'Akureyri','iTy':3,'nst':[],'area':'na'},
        6015: {'name':'Vestmannaeyjar','iTy':3,'nst':[],'area':'su'}
      };
    `;
    const map = parseStationAreaMap(js);
    expect(map.get(1)).toBe("fa");
    expect(map.get(422)).toBe("na");
    expect(map.get(6015)).toBe("su");
    expect(map.size).toBe(3);
  });
});

describe("parseRegionForecastHtml", () => {
  const SAMPLE = `
    <script>
      var VI;
      VI.conf = {
        tInfo: {
          wInfo: { 1473: {
            'W': [3, 3, 4, 5],
            'T': [4.2, 4.0, 3.8, 3.5],
            'D2': [45, 60, 75, 90],
            'F': [6.1, 5.8, 4.9, 3.2],
            'TD': [1.0, 0.8, 0.5, 0.2],
            'R': [0, 0.1, 0.3, 0],
            'N': [80, 60, 40, 20],
            'RT': [null, null, null, null]
          } },
          wTime: [
            new Date(2026,4-1,14,0,0),
            new Date(2026,4-1,14,1,0),
            new Date(2026,4-1,14,2,0),
            new Date(2026,4-1,14,3,0)
          ]
        };
    </script>
  `;

  it("extracts forecast entries paired with timestamps", () => {
    const { forecast, canonicalStationId } = parseRegionForecastHtml(SAMPLE, "https://example.invalid/");
    expect(canonicalStationId).toBe("1473");
    expect(forecast).toHaveLength(4);
    expect(forecast[0]).toMatchObject({
      forecast_time: "2026-04-14T00:00:00.000Z",
      weather_code: 3,
      temperature_c: 4.2,
      wind_speed_ms: 6.1,
      wind_direction_degrees: 45,
      dew_point_c: 1,
      precipitation_mm_per_h: 0,
      cloud_cover_pct: 80,
      road_temperature_c: null,
    });
    expect(forecast[3]?.wind_direction_degrees).toBe(90);
  });

  it("throws ScraperDriftError when wInfo is missing", () => {
    expect(() => parseRegionForecastHtml("<html></html>", "https://example.invalid/")).toThrow(
      ScraperDriftError,
    );
  });

  it("throws ScraperDriftError when wInfo has no numeric station keys", () => {
    const bad = `wInfo: { wrapper: {} } , wTime: [new Date(2026,4-1,14,0,0)]`;
    expect(() => parseRegionForecastHtml(bad, "https://example.invalid/")).toThrow(
      ScraperDriftError,
    );
  });

  it("throws ScraperDriftError when wTime is empty", () => {
    const bad = `wInfo: { 1: { 'W':[1],'T':[1],'F':[1] } } , wTime: []`;
    expect(() => parseRegionForecastHtml(bad, "https://example.invalid/")).toThrow(
      ScraperDriftError,
    );
  });

  it("truncates to the shortest of W/T/F and wTime", () => {
    const short = `
      wInfo: { 1: {
        'W': [1, 2, 3, 4, 5],
        'T': [1, 2],
        'F': [1, 2, 3]
      } },
      wTime: [new Date(2026,4-1,14,0,0), new Date(2026,4-1,14,1,0), new Date(2026,4-1,14,2,0)]
    `;
    const { forecast } = parseRegionForecastHtml(short, "https://example.invalid/");
    expect(forecast).toHaveLength(2); // limited by T
  });
});
