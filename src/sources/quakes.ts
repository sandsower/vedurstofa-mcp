/**
 * Earthquake source. Fetches api.vedur.is/quakes/events and normalizes
 * the GeoJSON feature list into a flat array.
 *
 * The endpoint accepts query parameters for server-side time/magnitude
 * filtering; we pass what we can and also re-filter client-side as a
 * safety net against schema drift.
 */

import { API_VEDUR_BASE, TTL } from "../config.js";
import { cache } from "../cache.js";
import { fetchJson } from "../http.js";

const QUAKES_URL = `${API_VEDUR_BASE}/quakes/events`;
// Params recognized by the IMO quakes /events endpoint.
const QUAKE_PARAM_NAMES = {
  startTime: "start_time",
  endTime: "end_time",
  sizeMin: "size_min",
  sizeMax: "size_max",
  depthMin: "depth_min",
  depthMax: "depth_max",
} as const;

export interface NormalizedQuake {
  timestamp: string;
  latitude: number;
  longitude: number;
  depth_km: number | null;
  magnitude: number | null;
  magnitude_type: string | null;
  location: string | null;
  quality: number | null;
  reviewed: boolean;
  event_id: string | null;
}

export interface QuakeFetch {
  quakes: NormalizedQuake[];
  source: string;
  fetchedAt: Date;
}

export interface QuakeQuery {
  /** How far back to look (hours). */
  hours: number;
  /** Opt-in to include automatic (unreviewed) events. */
  includeUnreviewed: boolean;
}

/**
 * Fetch the recent quakes bulk dump. Cached for TTL.quakes.
 * We intentionally fetch the full window once and filter per-request, so
 * multiple tool calls with different regions/magnitudes share one upstream.
 */
export async function getRecentQuakes(query: QuakeQuery): Promise<QuakeFetch> {
  const cacheKey = `quakes:window:${query.hours}:${query.includeUnreviewed ? "all" : "reviewed"}`;
  const end = new Date();
  const start = new Date(end.getTime() - query.hours * 60 * 60 * 1000);
  const params = new URLSearchParams();
  params.set(QUAKE_PARAM_NAMES.startTime, start.toISOString());
  params.set(QUAKE_PARAM_NAMES.endTime, end.toISOString());
  if (!query.includeUnreviewed) params.set("status", "reviewed");
  const url = `${QUAKES_URL}?${params.toString()}`;

  const data = await cache.get<{ fetchedAt: string; quakes: NormalizedQuake[] }>(
    cacheKey,
    TTL.quakes,
    async () => {
      const payload = await fetchJson<unknown>(url, "api.vedur.is");
      const quakes = parseQuakePayload(payload);
      return { fetchedAt: new Date().toISOString(), quakes };
    },
  );

  return {
    quakes: data.quakes,
    source: url,
    fetchedAt: new Date(data.fetchedAt),
  };
}

/**
 * Parse either a GeoJSON FeatureCollection or a plain results array.
 */
function parseQuakePayload(payload: unknown): NormalizedQuake[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;

  // GeoJSON FeatureCollection
  if (root["type"] === "FeatureCollection" && Array.isArray(root["features"])) {
    return (root["features"] as unknown[])
      .map(parseGeoJsonFeature)
      .filter((q): q is NormalizedQuake => q !== null);
  }

  // Plain array on the root
  if (Array.isArray(payload)) {
    return (payload as unknown[])
      .map(parseFlatRecord)
      .filter((q): q is NormalizedQuake => q !== null);
  }

  // Common wrappers
  for (const key of ["results", "events", "quakes", "data", "items"]) {
    const v = root[key];
    if (Array.isArray(v)) {
      return (v as unknown[])
        .map(parseFlatRecord)
        .filter((q): q is NormalizedQuake => q !== null);
    }
  }
  return [];
}

function parseGeoJsonFeature(raw: unknown): NormalizedQuake | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  const geom = (f["geometry"] as Record<string, unknown> | undefined) ?? {};
  const props = (f["properties"] as Record<string, unknown> | undefined) ?? {};
  const coords = geom["coordinates"];
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const longitude = Number(coords[0]);
  const latitude = Number(coords[1]);
  const depthFromCoords = coords.length >= 3 ? Number(coords[2]) : undefined;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;

  return {
    timestamp: normalizeTimestamp(props["time"] ?? props["timestamp"] ?? props["origin_time"]),
    latitude,
    longitude,
    depth_km: numberOrNull(props["depth"] ?? props["depth_km"] ?? depthFromCoords),
    magnitude: numberOrNull(props["magnitude"] ?? props["mag"] ?? props["size"]),
    magnitude_type: stringOrNull(props["magnitude_type"] ?? props["mag_type"]),
    location: stringOrNull(
      props["location"] ?? props["place"] ?? props["humanReadableLocation"] ?? props["region"],
    ),
    quality: numberOrNull(props["quality"]),
    reviewed: interpretReviewed(props),
    event_id: stringOrNull(f["id"] ?? props["id"] ?? props["event_id"]),
  };
}

function parseFlatRecord(raw: unknown): NormalizedQuake | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const latitude = numberOrNull(r["latitude"] ?? r["lat"]);
  const longitude = numberOrNull(r["longitude"] ?? r["lon"] ?? r["lng"]);
  if (latitude === null || longitude === null) return null;

  return {
    timestamp: normalizeTimestamp(r["timestamp"] ?? r["time"] ?? r["origin_time"]),
    latitude,
    longitude,
    depth_km: numberOrNull(r["depth"] ?? r["depth_km"]),
    magnitude: numberOrNull(r["magnitude"] ?? r["mag"] ?? r["size"]),
    magnitude_type: stringOrNull(r["magnitude_type"] ?? r["mag_type"]),
    location: stringOrNull(
      r["location"] ?? r["place"] ?? r["humanReadableLocation"] ?? r["region"],
    ),
    quality: numberOrNull(r["quality"]),
    reviewed: interpretReviewed(r),
    event_id: stringOrNull(r["id"] ?? r["event_id"]),
  };
}

function interpretReviewed(props: Record<string, unknown>): boolean {
  const status = props["status"];
  if (typeof status === "string") {
    const s = status.toLowerCase();
    if (s === "reviewed" || s === "manual" || s === "confirmed") return true;
    if (s === "automatic" || s === "auto" || s === "preliminary") return false;
  }
  const reviewed = props["reviewed"];
  if (typeof reviewed === "boolean") return reviewed;
  const quality = numberOrNull(props["quality"]);
  if (quality !== null) return quality >= 70;
  return true;
}

function numberOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  return null;
}

function normalizeTimestamp(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "") {
    const maybeIso = v.includes("T") ? v : v.replace(" ", "T");
    const withZ = /Z|[+-]\d{2}:?\d{2}$/.test(maybeIso) ? maybeIso : `${maybeIso}Z`;
    const d = new Date(withZ);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Epoch seconds or milliseconds — heuristic
    const ms = v > 1e12 ? v : v * 1000;
    return new Date(ms).toISOString();
  }
  return new Date(0).toISOString();
}

/** Distance between two lat/lon points using the haversine formula (km). */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371; // km
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export function isInBbox(q: NormalizedQuake, bbox: BoundingBox): boolean {
  return (
    q.latitude >= bbox.minLat &&
    q.latitude <= bbox.maxLat &&
    q.longitude >= bbox.minLon &&
    q.longitude <= bbox.maxLon
  );
}
