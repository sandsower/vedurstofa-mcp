/**
 * Per-region forecast scraper.
 *
 * IMO's public site embeds forecast data as inline JavaScript on the
 * regional "stadaspar" pages:
 *   https://www.vedur.is/vedur/spar/stadaspar/{region}/
 *
 * Each region page carries one canonical forecast station in an object:
 *   wInfo: { <stationId>: { 'W':[...], 'T':[...], 'D2':[...], 'F':[...],
 *                           'TD':[...], 'R':[...], 'N':[...], 'RT':[...] } }
 *   wTime: [ new Date(Y, M-1, D, h, m), ... ]
 *
 * A user-specified station is resolved to its region via the `area` field
 * in wslinfo.js, which we fetch once and cache. The forecast itself is
 * regional; the `?s=` query param only changes the UI station selector,
 * not the underlying wInfo payload.
 */

import { z } from "zod";

import { TTL, VEDUR_SITE_BASE } from "../config.js";
import { cache } from "../cache.js";
import { fetchText } from "../http.js";
import { ScraperDriftError } from "../errors.js";
import { log } from "../logger.js";

const STADASPAR_BASE = `${VEDUR_SITE_BASE}/vedur/spar/stadaspar`;
const WSLINFO_URL = `${VEDUR_SITE_BASE}/wstations/wslinfo.js`;

/** IMO internal area code → region slug used in stadaspar URLs. */
const AREA_TO_SLUG: Record<string, string> = {
  af: "austfirdir",
  ag: "austurland",
  br: "breidafjordur",
  fa: "hofudborgarsvaedid",
  mi: "midhalendid",
  na: "nordurland_eystra",
  nv: "nordurland_vestra",
  sa: "sudausturland",
  su: "sudurland",
  ve: "vestfirdir",
};

/** Ordered list of valid region slugs. */
export const FORECAST_REGIONS: ReadonlyArray<string> = Object.values(AREA_TO_SLUG);

const STATION_AREA_CACHE_KEY = "forecast:station-area-map";

/** Fetch + parse station-id → area-code map from wslinfo.js. Cached forever. */
export async function getStationAreaMap(): Promise<Map<number, string>> {
  return cache.get<Map<number, string>>(STATION_AREA_CACHE_KEY, TTL.stations, async () => {
    const js = await fetchText(WSLINFO_URL, "vedur.is");
    const map = parseStationAreaMap(js);
    log.debug("forecast: loaded station to area map", { count: map.size });
    return map;
  });
}

export function parseStationAreaMap(js: string): Map<number, string> {
  const out = new Map<number, string>();
  // Match every "<id>:{...'area':'<code>'...}" occurrence.
  const pattern = /(\d+)\s*:\s*\{[^{}]*'area'\s*:\s*'([a-z]+)'/g;
  for (const m of js.matchAll(pattern)) {
    const id = Number(m[1]);
    const area = m[2]!;
    if (Number.isFinite(id)) out.set(id, area);
  }
  return out;
}

/** Map a station ID to its region slug. Throws if unknown. */
export async function regionSlugForStation(stationId: string): Promise<string> {
  const id = Number(stationId);
  if (!Number.isFinite(id)) {
    throw new ScraperDriftError(
      "forecast",
      `station id '${stationId}' is not numeric`,
    );
  }
  const map = await getStationAreaMap();
  const area = map.get(id);
  if (!area) {
    throw new ScraperDriftError(
      "forecast",
      `station ${id} is not in the IMO area index (probably a newer or specialty station without a regional forecast)`,
    );
  }
  const slug = AREA_TO_SLUG[area];
  if (!slug) {
    throw new ScraperDriftError(
      "forecast",
      `area code '${area}' for station ${id} has no mapped region slug`,
    );
  }
  return slug;
}

export interface ForecastEntry {
  forecast_time: string;
  weather_code: number | null;
  temperature_c: number | null;
  wind_speed_ms: number | null;
  wind_direction_degrees: number | null;
  dew_point_c: number | null;
  precipitation_mm_per_h: number | null;
  cloud_cover_pct: number | null;
  road_temperature_c: number | null;
}

export interface StationForecast {
  station_id: string;
  station_name: string | null;
  region_slug: string;
  source_url: string;
  forecast: ForecastEntry[];
}

/** Fetch a station's forecast via its region page. */
export async function getStationForecast(stationId: string): Promise<StationForecast> {
  const slug = await regionSlugForStation(stationId);
  const url = `${STADASPAR_BASE}/${slug}/`;
  const cacheKey = `forecast:region:${slug}`;
  const regional = await cache.get<{ forecast: ForecastEntry[]; canonicalStationId: string }>(
    cacheKey,
    TTL.forecast,
    async () => {
      const html = await fetchText(url, "vedur.is");
      return parseRegionForecastHtml(html, url);
    },
  );

  return {
    station_id: stationId,
    station_name: null,
    region_slug: slug,
    source_url: url,
    forecast: regional.forecast,
  };
}

const WINFO_SCHEMA = z.object({
  W: z.array(z.union([z.number(), z.string(), z.null()])),
  T: z.array(z.union([z.number(), z.string(), z.null()])),
  D2: z.array(z.union([z.number(), z.string(), z.null()])).optional(),
  F: z.array(z.union([z.number(), z.string(), z.null()])),
  TD: z.array(z.union([z.number(), z.string(), z.null()])).optional(),
  R: z.array(z.union([z.number(), z.string(), z.null()])).optional(),
  N: z.array(z.union([z.number(), z.string(), z.null()])).optional(),
  RT: z.array(z.union([z.number(), z.string(), z.null()])).optional(),
});

/**
 * Extract the first station block from wInfo and pair its arrays with wTime.
 * Exported for direct testing with a fixed HTML fixture.
 */
export function parseRegionForecastHtml(
  html: string,
  sourceUrl: string,
): { forecast: ForecastEntry[]; canonicalStationId: string } {
  const wInfoStart = html.search(/wInfo\s*:\s*\{/);
  if (wInfoStart === -1) {
    throw new ScraperDriftError(sourceUrl, "wInfo property not found");
  }
  const afterKey = html.indexOf("{", wInfoStart);
  const wInfoBody = sliceBalanced(html, afterKey);
  if (wInfoBody === null) {
    throw new ScraperDriftError(sourceUrl, "wInfo object was not brace-balanced");
  }

  // First station entry inside wInfo.
  const stationMatch = wInfoBody.match(/(\d+)\s*:\s*\{/);
  if (!stationMatch || stationMatch.index === undefined) {
    throw new ScraperDriftError(sourceUrl, "wInfo had no numeric station keys");
  }
  const canonicalStationId = stationMatch[1]!;
  const stationBlockStart = wInfoBody.indexOf("{", stationMatch.index + stationMatch[1]!.length);
  const stationBlock = sliceBalanced(wInfoBody, stationBlockStart);
  if (stationBlock === null) {
    throw new ScraperDriftError(sourceUrl, "wInfo station block was not balanced");
  }

  const fields = extractFieldArrays(stationBlock);
  const parsed = WINFO_SCHEMA.safeParse(fields);
  if (!parsed.success) {
    throw new ScraperDriftError(sourceUrl, `wInfo fields did not match expected shape: ${parsed.error.message}`);
  }

  const wTimeBody = extractWTimeBody(html);
  if (wTimeBody === null) {
    throw new ScraperDriftError(sourceUrl, "wTime property not found");
  }
  const times = extractWTimes(wTimeBody);
  if (times.length === 0) {
    throw new ScraperDriftError(sourceUrl, "wTime contained no parseable dates");
  }

  const limit = Math.min(
    times.length,
    parsed.data.W.length,
    parsed.data.T.length,
    parsed.data.F.length,
  );
  const forecast: ForecastEntry[] = [];
  for (let i = 0; i < limit; i += 1) {
    forecast.push({
      forecast_time: times[i]!,
      weather_code: toNumber(parsed.data.W[i]),
      temperature_c: toNumber(parsed.data.T[i]),
      wind_speed_ms: toNumber(parsed.data.F[i]),
      wind_direction_degrees: toNumber(parsed.data.D2?.[i]),
      dew_point_c: toNumber(parsed.data.TD?.[i]),
      precipitation_mm_per_h: toNumber(parsed.data.R?.[i]),
      cloud_cover_pct: toNumber(parsed.data.N?.[i]),
      road_temperature_c: toNumber(parsed.data.RT?.[i]),
    });
  }
  return { forecast, canonicalStationId };
}

/** Return the substring enclosed by the balanced brace starting at `start`. */
function sliceBalanced(source: string, start: number): string | null {
  if (source[start] !== "{") return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = start; i < source.length; i += 1) {
    const c = source[i]!;
    if (inString) {
      if (c === "\\") {
        i += 1;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === "'" || c === '"') {
      inString = c;
      continue;
    }
    if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Parse single-quoted key, bracketed array literal pairs. */
function extractFieldArrays(block: string): Record<string, Array<number | string | null>> {
  const out: Record<string, Array<number | string | null>> = {};
  const pattern = /'([A-Z][A-Za-z0-9_]*)'\s*:\s*\[([^\[\]]*)\]/g;
  for (const m of block.matchAll(pattern)) {
    const key = m[1]!;
    const arrBody = m[2]!;
    out[key] = parseJsArrayBody(arrBody);
  }
  return out;
}

function parseJsArrayBody(body: string): Array<number | string | null> {
  if (body.trim() === "") return [];
  return body.split(",").map((raw) => {
    const v = raw.trim();
    if (v === "" || v === "null" || v === "undefined") return null;
    if (v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1);
    if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  });
}

/**
 * Isolate the contents of the `wTime: [...]` array so subsequent Date
 * extraction doesn't pick up `new Date(...)` calls from elsewhere on the
 * page (current-time widgets, alert timestamps, etc.).
 */
export function extractWTimeBody(html: string): string | null {
  const start = html.search(/wTime\s*:\s*\[/);
  if (start === -1) return null;
  const open = html.indexOf("[", start);
  let depth = 0;
  for (let i = open; i < html.length; i += 1) {
    const c = html[i]!;
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) return html.slice(open + 1, i);
    }
  }
  return null;
}

/**
 * Extract all `new Date(Y, M-1, D, h, m?)` constructor calls from a string
 * and convert them to ISO UTC strings. The `M-1` arithmetic is the JS-Date
 * 0-indexed-months convention; we evaluate it literally.
 */
export function extractWTimes(body: string): string[] {
  const times: string[] = [];
  const pattern = /new\s+Date\s*\(\s*(\d{4})\s*,\s*(\d{1,2})\s*-\s*1\s*,\s*(\d{1,2})\s*,\s*(\d{1,2})(?:\s*,\s*(\d{1,2}))?\s*\)/g;
  for (const m of body.matchAll(pattern)) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const hour = Number(m[4]);
    const minute = m[5] ? Number(m[5]) : 0;
    const d = new Date(Date.UTC(year, month - 1, day, hour, minute));
    if (!Number.isNaN(d.getTime())) times.push(d.toISOString());
  }
  return times;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
