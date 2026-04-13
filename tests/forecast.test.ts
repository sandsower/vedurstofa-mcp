import { describe, expect, it } from "vitest";

import { ScraperDriftError } from "../src/errors.js";
import { parseForecastHtml } from "../src/sources/forecast.js";

describe("parseForecastHtml", () => {
  it("extracts entries from well-formed wInfo/wTime", () => {
    const html = `
      <html>
        <body>
          <script>
            var wTime = [["2026-04-13T12:00:00"],["2026-04-13T15:00:00"]];
            var wInfo = [[null, 5, 8, "NNE", "Clear", 0.0], [null, 6, 9, "N", "Partly cloudy", 0.1]];
          </script>
        </body>
      </html>
    `;
    const entries = parseForecastHtml(html, "https://example.invalid/");
    expect(entries).toHaveLength(2);
    expect(entries[0]?.forecast_time).toBe("2026-04-13T12:00:00.000Z");
    expect(entries[0]?.temperature_c).toBe(5);
    expect(entries[0]?.wind_speed_ms).toBe(8);
    expect(entries[0]?.wind_direction).toBe("NNE");
    expect(entries[0]?.description).toBe("Clear");
    expect(entries[0]?.precipitation_mm_per_h).toBe(0);
    expect(entries[1]?.description).toBe("Partly cloudy");
  });

  it("throws ScraperDriftError when wInfo/wTime are missing", () => {
    const html = "<html><body><p>No forecast here</p></body></html>";
    expect(() => parseForecastHtml(html, "https://example.invalid/")).toThrow(ScraperDriftError);
  });

  it("throws ScraperDriftError when shape is malformed", () => {
    const html = `
      <script>
        var wInfo = "not an array";
        var wTime = [["2026-04-13T12:00:00"]];
      </script>
    `;
    expect(() => parseForecastHtml(html, "https://example.invalid/")).toThrow(ScraperDriftError);
  });

  it("swaps single-quoted strings so JSON.parse succeeds", () => {
    const html = `
      <script>
        var wTime = [['2026-04-13T12:00:00']];
        var wInfo = [[null, 5, 8, 'NNE', 'Clear', 0.0]];
      </script>
    `;
    const entries = parseForecastHtml(html, "https://example.invalid/");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.wind_direction).toBe("NNE");
  });
});
