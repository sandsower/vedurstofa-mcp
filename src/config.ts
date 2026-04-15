/**
 * Central configuration — constants tuned during design phase.
 * See decision ledger for rationale.
 */

import pkg from "../package.json" with { type: "json" };

export const PACKAGE_VERSION: string = pkg.version;

export const USER_AGENT = `vedurstofa-mcp/${PACKAGE_VERSION} (+https://github.com/sandsower/vedurstofa-mcp)`;

/** Upstream timeout per request. No retries. */
export const UPSTREAM_TIMEOUT_MS = 5_000;

/** Max concurrent upstream requests across the whole server. */
export const UPSTREAM_CONCURRENCY = 4;

/** Response size cap per tool call. */
export const MAX_RESPONSE_BYTES = 100 * 1024;

/** Cooldown after 429 from a given upstream key (ms). */
export const RATE_LIMIT_COOLDOWN_MS = 60_000;

/** TTLs for each data category. `Infinity` = cache forever. */
export const TTL = {
  stations: Number.POSITIVE_INFINITY,
  observations: 5 * 60 * 1000,
  forecast: 30 * 60 * 1000,
  warnings: 2 * 60 * 1000,
  quakes: 2 * 60 * 1000,
  textForecast: 10 * 60 * 1000,
} as const;

/** Base URL for the IMO API gateway. */
export const API_VEDUR_BASE = "https://api.vedur.is";

/** Base URL for the public site (scraped for forecasts and text). */
export const VEDUR_SITE_BASE = "https://www.vedur.is";
export const VEDUR_SITE_EN_BASE = "https://en.vedur.is";

/** Default station when caller specifies none. Resolved by name resolver. */
export const DEFAULT_STATION_NAMES = ["reykjavík"] as const;

/** Known major-city AWS stations for quick reference / suggestions. */
export const RECOMMENDED_STATIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "1470", name: "Reykjavík" },
  { id: "1350", name: "Keflavík" },
  { id: "3471", name: "Akureyri" },
  { id: "570", name: "Egilsstaðir" },
  { id: "6016", name: "Vestmannaeyjar" },
  { id: "2644", name: "Ísafjörður" },
  { id: "5544", name: "Höfn" },
  { id: "6049", name: "Vík" },
  { id: "2050", name: "Stykkishólmur" },
  { id: "3433", name: "Sauðárkrókur" },
  { id: "1361", name: "Grindavík" },
  { id: "1486", name: "Bláfjöll" },
  { id: "6300", name: "Selfoss" },
];

/**
 * Named earthquake region presets → bounding boxes.
 * Boxes are deliberately generous to catch peripheral events.
 * Center points are informational; the bbox is what we filter on.
 */
export const QUAKE_REGIONS: Record<
  string,
  { label: string; centerLat: number; centerLon: number; bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number } }
> = {
  reykjanes: {
    label: "Reykjanes peninsula",
    centerLat: 63.85,
    centerLon: -22.4,
    bbox: { minLat: 63.6, maxLat: 64.1, minLon: -23.0, maxLon: -21.6 },
  },
  mydalsjokull: {
    label: "Mýrdalsjökull / Katla caldera region",
    centerLat: 63.63,
    centerLon: -19.05,
    bbox: { minLat: 63.4, maxLat: 63.9, minLon: -19.6, maxLon: -18.5 },
  },
  bardarbunga: {
    label: "Bárðarbunga",
    centerLat: 64.63,
    centerLon: -17.53,
    bbox: { minLat: 64.3, maxLat: 64.9, minLon: -18.1, maxLon: -16.9 },
  },
  tjornes: {
    label: "Tjörnes fracture zone (offshore N. Iceland)",
    centerLat: 66.3,
    centerLon: -17.5,
    bbox: { minLat: 65.9, maxLat: 66.9, minLon: -19.0, maxLon: -16.0 },
  },
  katla: {
    label: "Katla (alias of mydalsjokull)",
    centerLat: 63.63,
    centerLon: -19.05,
    bbox: { minLat: 63.4, maxLat: 63.9, minLon: -19.6, maxLon: -18.5 },
  },
  askja: {
    label: "Askja",
    centerLat: 65.03,
    centerLon: -16.75,
    bbox: { minLat: 64.8, maxLat: 65.3, minLon: -17.2, maxLon: -16.2 },
  },
  hekla: {
    label: "Hekla",
    centerLat: 63.99,
    centerLon: -19.67,
    bbox: { minLat: 63.8, maxLat: 64.2, minLon: -20.0, maxLon: -19.3 },
  },
  grimsvotn: {
    label: "Grímsvötn",
    centerLat: 64.42,
    centerLon: -17.33,
    bbox: { minLat: 64.2, maxLat: 64.6, minLon: -17.8, maxLon: -16.9 },
  },
} as const;

/** Map from Icelandic text type keywords → IMO `types` IDs. */
export const TEXT_TYPE_IDS = {
  is: { national: "2", multi_day: "5", warnings: "11" },
  en: { national: "7", multi_day: "27", warnings: "14" },
} as const;

export const ATTRIBUTION =
  "Icelandic Met Office (vedur.is), CC BY-SA 4.0. Data transformed: field names normalized, forecasts extracted from HTML, units documented explicitly. Original data values unchanged.";

export const DEBUG = process.env["VEDURSTOFA_DEBUG"] === "1";
