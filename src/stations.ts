/**
 * Station catalog — loaded at startup from api.vedur.is, cached forever.
 * Provides name/ID resolution with diacritic tolerance.
 *
 * The exact upstream shape is not formally documented; this module is
 * permissive about the response structure and extracts what it can.
 */

import { API_VEDUR_BASE, DEFAULT_STATION_NAMES, RECOMMENDED_STATIONS, TTL } from "./config.js";
import { cache } from "./cache.js";
import { fetchJson } from "./http.js";
import { UnknownStationError } from "./errors.js";
import { log } from "./logger.js";

export interface Station {
  id: string;
  name: string;
  /** Normalized (lowercase, diacritic-stripped) for lookup. */
  nameNormalized: string;
  /** Station kind if known: sk|ur|vf|sj|aws|synop|etc. */
  type?: string;
  /** Human-readable region label if upstream provides one. */
  region?: string;
  latitude?: number;
  longitude?: number;
}

const STATION_CACHE_KEY = "stations:catalog";
const STATIONS_URL = `${API_VEDUR_BASE}/weather/stations`;

/**
 * Icelandic letters that don't decompose via NFD → ASCII equivalent.
 * Run before NFD so composed letters like ö → o + combining diaeresis
 * still handle through the general diacritic strip.
 */
const ICELANDIC_ASCII_MAP: Record<string, string> = {
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  æ: "ae",
  Æ: "ae",
  ø: "o",
  Ø: "o",
};

/** Strip combining diacritics + map Icelandic letters, lowercase, trim. */
export function normalizeName(input: string): string {
  let out = "";
  for (const ch of input) {
    out += ICELANDIC_ASCII_MAP[ch] ?? ch;
  }
  return out
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Parse an upstream station record into our Station shape.
 * Accepts several plausible field spellings because the upstream schema
 * has shifted over time and isn't strongly documented.
 */
function parseStation(raw: unknown): Station | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  const id = pickString(r, ["station", "id", "station_id", "stationId", "number", "num"]);
  const name = pickString(r, ["name", "station_name", "stationName", "label"]);
  if (!id || !name) return null;

  const station: Station = {
    id,
    name,
    nameNormalized: normalizeName(name),
  };
  const type = pickString(r, ["type", "station_type", "category"]);
  if (type) station.type = type;
  const region = pickString(r, ["region", "area", "location", "district"]);
  if (region) station.region = region;
  const lat = pickNumber(r, ["latitude", "lat"]);
  if (lat !== undefined) station.latitude = lat;
  const lon = pickNumber(r, ["longitude", "lon", "lng"]);
  if (lon !== undefined) station.longitude = lon;
  return station;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** Extract an array of station records from whatever shape the upstream returns. */
function extractStationArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === "object") {
    for (const key of ["stations", "results", "data", "items"]) {
      const v = (payload as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

/** Offline-capable fallback catalog built from recommended stations. */
function fallbackCatalog(): Station[] {
  return RECOMMENDED_STATIONS.map((s) => ({
    id: s.id,
    name: s.name,
    nameNormalized: normalizeName(s.name),
  }));
}

/**
 * Load the full station catalog. Cached forever after first success;
 * falls back to hardcoded recommended stations if upstream fails so the
 * server still starts and can resolve major cities.
 */
export async function loadStations(): Promise<Station[]> {
  return cache.get<Station[]>(STATION_CACHE_KEY, TTL.stations, async () => {
    try {
      const payload = await fetchJson<unknown>(STATIONS_URL, "api.vedur.is");
      const raw = extractStationArray(payload);
      const stations = raw
        .map(parseStation)
        .filter((s): s is Station => s !== null);
      if (stations.length === 0) {
        log.warn("station catalog upstream returned no parseable records, using fallback", {
          url: STATIONS_URL,
        });
        return fallbackCatalog();
      }
      log.debug("station catalog loaded", { count: stations.length });
      return stations;
    } catch (err) {
      log.warn("station catalog fetch failed, using fallback", {
        error: err instanceof Error ? err.message : String(err),
      });
      return fallbackCatalog();
    }
  });
}

/**
 * Station types that report to /weather/observations/aws/.../latest.
 * Empirically only type 'sj' (automatic weather stations) appear in the
 * AWS endpoint — 'ur', 'sk', 'vf' do not, even though 'ur' is described
 * as "unmanned automatic" in IMO docs.
 */
function isAwsType(s: Station): boolean {
  return s.type === "sj";
}

export interface Resolution {
  station: Station;
  /** How the resolution matched — for debug/logging. */
  matchedBy: "id" | "exact_name" | "prefix" | "substring";
}

/**
 * Resolve an input (ID or name) against the catalog.
 * Throws UnknownStationError with suggestions if no match is found.
 */
export function resolveStation(input: string, catalog: ReadonlyArray<Station>): Resolution {
  const trimmed = input.trim();
  if (trimmed === "") {
    throw new UnknownStationError(input, []);
  }

  // Pure-digit inputs go through ID lookup first.
  if (/^\d+$/.test(trimmed)) {
    const byId = catalog.find((s) => s.id === trimmed);
    if (byId) return { station: byId, matchedBy: "id" };
  }

  const needle = normalizeName(trimmed);
  const exactMatches = catalog.filter((s) => s.nameNormalized === needle);
  const prefixMatches = catalog.filter(
    (s) => s.nameNormalized !== needle && s.nameNormalized.startsWith(needle),
  );
  const substringMatches = catalog.filter(
    (s) => !s.nameNormalized.startsWith(needle) && s.nameNormalized.includes(needle),
  );

  // Prefer AWS-reporting types (sj/ur) across all match tiers before
  // falling back to manned synoptic stations. Users asking for a city
  // name overwhelmingly want current data, which only AWS delivers.
  const aws = [...exactMatches, ...prefixMatches, ...substringMatches].filter(isAwsType);
  if (aws.length > 0) {
    const tier = exactMatches.some(isAwsType)
      ? "exact_name"
      : prefixMatches.some(isAwsType)
        ? "prefix"
        : "substring";
    return { station: aws[0]!, matchedBy: tier };
  }

  if (exactMatches.length > 0) return { station: exactMatches[0]!, matchedBy: "exact_name" };
  if (prefixMatches.length > 0) return { station: prefixMatches[0]!, matchedBy: "prefix" };
  if (substringMatches.length > 0) return { station: substringMatches[0]!, matchedBy: "substring" };

  const suggestions = suggestStations(trimmed, catalog, 3);
  throw new UnknownStationError(input, suggestions);
}

/** Rank a handful of plausible matches using a cheap similarity score. */
export function suggestStations(
  input: string,
  catalog: ReadonlyArray<Station>,
  limit = 3,
): Array<{ id: string; name: string }> {
  const needle = normalizeName(input);
  if (needle === "") return [];

  const scored = catalog
    .map((s) => ({ station: s, score: similarity(needle, s.nameNormalized) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ station }) => ({ id: station.id, name: station.name }));
}

/**
 * Very cheap similarity: start with prefix/substring hits, then fall back to
 * shared-trigram count. Avoids pulling in a full Levenshtein dependency.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1_000;
  if (b.startsWith(a)) return 500 + a.length;
  if (b.includes(a)) return 300 + a.length;
  const sharedTrigrams = countSharedTrigrams(a, b);
  return sharedTrigrams;
}

function countSharedTrigrams(a: string, b: string): number {
  if (a.length < 3 || b.length < 3) return 0;
  const aTrigrams = new Set<string>();
  for (let i = 0; i <= a.length - 3; i += 1) aTrigrams.add(a.slice(i, i + 3));
  let shared = 0;
  for (let i = 0; i <= b.length - 3; i += 1) {
    if (aTrigrams.has(b.slice(i, i + 3))) shared += 1;
  }
  return shared;
}

/**
 * Resolve a list of inputs. Returns successes and per-input failures
 * separately so multi-station tools can build partial-result responses.
 */
export interface ResolutionResult {
  resolved: Array<{ input: string; station: Station }>;
  failures: Array<{ input: string; reason: string }>;
}

export function resolveStations(inputs: ReadonlyArray<string>, catalog: ReadonlyArray<Station>): ResolutionResult {
  const out: ResolutionResult = { resolved: [], failures: [] };
  for (const input of inputs) {
    try {
      const { station } = resolveStation(input, catalog);
      out.resolved.push({ input, station });
    } catch (err) {
      out.failures.push({
        input,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

/** Resolve caller-supplied stations or fall back to the configured defaults. */
export function resolveOrDefault(
  inputs: ReadonlyArray<string> | undefined,
  catalog: ReadonlyArray<Station>,
): ResolutionResult {
  const effective = inputs && inputs.length > 0 ? inputs : [...DEFAULT_STATION_NAMES];
  return resolveStations(effective, catalog);
}
