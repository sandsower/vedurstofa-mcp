/**
 * Per-station forecast scraper.
 *
 * IMO embeds forecast data directly in their HTML as inline JavaScript:
 *   var wInfo = [[...], [...], ...];
 *   var wTime = [[...], [...], ...];
 *
 * `wInfo` holds the numeric/categorical values (temp, wind, W-code, etc.)
 * `wTime` holds the matching timestamps.
 *
 * We extract these arrays, validate them with zod, and pair them up.
 * If the HTML shape changes we throw ScraperDriftError so the tool can
 * fall back to the text forecast.
 */

import { z } from "zod";

import { TTL, VEDUR_SITE_BASE } from "../config.js";
import { cache } from "../cache.js";
import { fetchText } from "../http.js";
import { ScraperDriftError } from "../errors.js";

/**
 * Station-ID → forecast-page slug. Each slug is appended to the base URL:
 *   {VEDUR_SITE_BASE}/vedur/spar/textaspar/{slug}/
 *
 * NOTE: This mapping is a working hypothesis based on the known default
 * stations. Some stations share a regional page. Verify empirically and
 * expand as gaps show up.
 */
export const STATION_FORECAST_SLUGS: Record<string, string> = {
  "1470": "hofudborgarsvaedid", // Reykjavík → Capital area
  "1350": "sudvesturland",       // Keflavík
  "3471": "nordausturland",      // Akureyri
  "570": "austurland",           // Egilsstaðir
  "6016": "sudurland",           // Vestmannaeyjar
  "2644": "vestfirdir",          // Ísafjörður
  "5544": "austurland",          // Höfn
  "6049": "sudurland",           // Vík
  "2050": "vesturland",          // Stykkishólmur
  "3433": "nordvesturland",      // Sauðárkrókur
  "1361": "sudvesturland",       // Grindavík
  "1486": "hofudborgarsvaedid",  // Bláfjöll (ski area near capital)
  "6300": "sudurland",           // Selfoss
};

/** Minimum-shape validator for a single entry in wInfo. */
const wInfoEntrySchema = z
  .array(z.union([z.number(), z.string(), z.null()]))
  .min(3);

/** Minimum-shape validator for a single entry in wTime. */
const wTimeEntrySchema = z
  .array(z.union([z.number(), z.string(), z.null()]))
  .min(1);

const wInfoSchema = z.array(wInfoEntrySchema).min(1);
const wTimeSchema = z.array(wTimeEntrySchema).min(1);

export interface ForecastEntry {
  forecast_time: string;
  temperature_c: number | null;
  wind_speed_ms: number | null;
  wind_direction: string | null;
  description: string | null;
  precipitation_mm_per_h: number | null;
}

export interface StationForecast {
  station_id: string;
  station_slug: string;
  source_url: string;
  forecast: ForecastEntry[];
}

/**
 * Fetch + parse the forecast for a single station.
 * Throws ScraperDriftError if the page's embedded JS does not match the
 * expected shape.
 */
export async function getStationForecast(stationId: string): Promise<StationForecast> {
  const slug = STATION_FORECAST_SLUGS[stationId];
  if (!slug) {
    throw new ScraperDriftError(
      "forecast",
      `no known forecast-page slug for station ${stationId}`,
    );
  }
  const url = `${VEDUR_SITE_BASE}/vedur/spar/textaspar/${slug}/`;
  const cacheKey = `forecast:station:${stationId}`;
  return cache.get<StationForecast>(cacheKey, TTL.forecast, async () => {
    const html = await fetchText(url, "vedur.is");
    const forecast = parseForecastHtml(html, url);
    return { station_id: stationId, station_slug: slug, source_url: url, forecast };
  });
}

const W_INFO_RE = /var\s+wInfo\s*=\s*(\[[\s\S]*?\]);/;
const W_TIME_RE = /var\s+wTime\s*=\s*(\[[\s\S]*?\]);/;

export function parseForecastHtml(html: string, sourceUrl: string): ForecastEntry[] {
  const wInfoMatch = html.match(W_INFO_RE);
  const wTimeMatch = html.match(W_TIME_RE);
  if (!wInfoMatch || !wTimeMatch) {
    throw new ScraperDriftError(sourceUrl, "wInfo/wTime JavaScript variables not found in page HTML");
  }

  const wInfoRaw = safeJsonParse(wInfoMatch[1]!);
  const wTimeRaw = safeJsonParse(wTimeMatch[1]!);
  if (!wInfoRaw || !wTimeRaw) {
    throw new ScraperDriftError(sourceUrl, "wInfo/wTime values could not be JSON-parsed");
  }

  const wInfo = wInfoSchema.safeParse(wInfoRaw);
  const wTime = wTimeSchema.safeParse(wTimeRaw);
  if (!wInfo.success || !wTime.success) {
    throw new ScraperDriftError(sourceUrl, "wInfo/wTime did not match expected array-of-arrays shape");
  }

  const pairs = Math.min(wInfo.data.length, wTime.data.length);
  const out: ForecastEntry[] = [];
  for (let i = 0; i < pairs; i += 1) {
    const info = wInfo.data[i]!;
    const time = wTime.data[i]!;
    out.push({
      forecast_time: interpretTime(time),
      // Index positions inferred from the historical apis.is wrapper.
      // Guarded by type checks — garbage slots collapse to null.
      temperature_c: numberAt(info, 1),
      wind_speed_ms: numberAt(info, 2),
      wind_direction: stringAt(info, 3),
      description: stringAt(info, 4),
      precipitation_mm_per_h: numberAt(info, 5),
    });
  }
  return out;
}

/**
 * JS arrays in IMO pages are mostly JSON-compatible but may include
 * quoted strings with single quotes. Normalize and parse.
 */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Swap single-quoted strings for double-quoted.
    const patched = raw.replace(/'([^']*)'/g, (_, inner: string) => JSON.stringify(inner));
    try {
      return JSON.parse(patched);
    } catch {
      return null;
    }
  }
}

function interpretTime(entry: Array<number | string | null>): string {
  // IMO encodes time either as a single timestamp string or a
  // [year, month, day, hour, minute] tuple. Handle both.
  if (entry.length === 1 && typeof entry[0] === "string") {
    const iso = entry[0].includes("T") ? entry[0] : entry[0].replace(" ", "T");
    const withZ = iso.endsWith("Z") ? iso : `${iso}Z`;
    const d = new Date(withZ);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (entry.length >= 4 && entry.slice(0, 4).every((v) => typeof v === "number")) {
    const [y, m, d, h, min = 0] = entry as number[];
    const date = new Date(Date.UTC(y!, (m as number) - 1, d!, h!, min as number));
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return "";
}

function numberAt(row: Array<number | string | null>, i: number): number | null {
  const v = row[i];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function stringAt(row: Array<number | string | null>, i: number): string | null {
  const v = row[i];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}
