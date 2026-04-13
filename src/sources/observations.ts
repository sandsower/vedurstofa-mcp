/**
 * AWS observation source. Fetches the bulk "latest" dump once and populates
 * the per-station cache, so multi-station queries share one upstream call.
 *
 * The upstream endpoint is api.vedur.is/observations/aws/latest (JSON).
 * Exact shape varies across versions — this loader is permissive and extracts
 * observations from whichever array-ish container it finds.
 */

import { API_VEDUR_BASE, TTL } from "../config.js";
import { cache } from "../cache.js";
import { fetchJson } from "../http.js";
import { normalizeObservation, type NormalizedObservation } from "../normalize.js";

const AWS_URL = `${API_VEDUR_BASE}/weather/observations/aws/hour/latest`;
const BULK_CACHE_KEY = "observations:aws:bulk";
const INDEX_CACHE_KEY = "observations:aws:index";

/** Map of station-id → latest observation, built from the bulk response. */
export type ObservationIndex = ReadonlyMap<string, NormalizedObservation>;

export interface ObservationFetch {
  index: ObservationIndex;
  source: string;
  fetchedAt: Date;
}

function extractRecords(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === "object") {
    for (const key of ["results", "stations", "observations", "data", "items"]) {
      const v = (payload as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

/**
 * Fetch (or reuse cached) bulk observations and return an index keyed by
 * station ID. Cached for TTL.observations; concurrent callers share one
 * upstream request via singleflight.
 */
export async function getObservationIndex(): Promise<ObservationFetch> {
  const fetched = await cache.get<{ fetchedAt: string; index: Record<string, NormalizedObservation> }>(
    BULK_CACHE_KEY,
    TTL.observations,
    async () => {
      const payload = await fetchJson<unknown>(AWS_URL, "api.vedur.is");
      const records = extractRecords(payload);
      const index: Record<string, NormalizedObservation> = {};
      for (const raw of records) {
        const normalized = normalizeObservation(raw);
        if (normalized.station_id) index[normalized.station_id] = normalized;
      }
      return { fetchedAt: new Date().toISOString(), index };
    },
  );

  // Rebuild Map on each call (cheap) — cache stores a plain object since
  // Maps don't survive structuredClone/serialization cleanly.
  const map = new Map<string, NormalizedObservation>();
  for (const [id, obs] of Object.entries(fetched.index)) map.set(id, obs);

  return {
    index: map,
    source: AWS_URL,
    fetchedAt: new Date(fetched.fetchedAt),
  };
}

/** Invalidate the cached bulk fetch — used in tests. */
export function resetObservationCache(): void {
  cache.delete(BULK_CACHE_KEY);
  cache.delete(INDEX_CACHE_KEY);
}
