/**
 * Field normalization for IMO weather observation records from
 * api.vedur.is /weather/observations/aws/... endpoints.
 *
 * Upstream uses short lowercase codes (t, f, d, d_txt, etc.). We map to
 * snake_case names with units baked into the name.
 */

/** Map from upstream key → normalized key. Values not listed are dropped. */
const FIELD_MAP: Record<string, string> = {
  // Temperatures
  t: "temperature_c",
  tx: "max_temperature_c",
  tn: "min_temperature_c",
  td: "dew_point_c",
  t0: "ground_temperature_c",
  t0x: "max_ground_temperature_c",
  t0n: "min_ground_temperature_c",
  tg: "grass_temperature_c",
  tgn: "min_grass_temperature_c",

  // Wind
  f: "wind_speed_ms",
  fx: "max_wind_speed_ms",
  fg: "max_wind_gust_ms",
  d: "wind_direction_degrees",
  d_txt: "wind_direction",

  // Atmosphere
  p: "pressure_hpa",
  rh: "humidity_pct",
  vp: "vapor_pressure_hpa",

  // Precipitation
  r: "precipitation_mm_per_h",

  // Visibility and clouds (present on SYNOP and some AWS)
  v: "visibility_km",
  n: "cloud_cover_pct",
  w: "description",

  // Snow
  snc: "snow_description",
  snd: "snow_depth_cm",
  sed: "snow_type",

  // Road weather (where equipped)
  rte: "road_temperature_c",

  // Radiation
  radgl: "global_radiation_w_m2",
};

/** Fields that should always be parsed as numbers when non-empty. */
const NUMERIC_FIELDS = new Set<string>([
  "temperature_c",
  "max_temperature_c",
  "min_temperature_c",
  "dew_point_c",
  "ground_temperature_c",
  "max_ground_temperature_c",
  "min_ground_temperature_c",
  "grass_temperature_c",
  "min_grass_temperature_c",
  "wind_speed_ms",
  "max_wind_speed_ms",
  "max_wind_gust_ms",
  "wind_direction_degrees",
  "pressure_hpa",
  "humidity_pct",
  "vapor_pressure_hpa",
  "precipitation_mm_per_h",
  "visibility_km",
  "cloud_cover_pct",
  "snow_depth_cm",
  "road_temperature_c",
  "global_radiation_w_m2",
]);

export interface NormalizedObservation {
  station_id: string;
  station_name: string;
  observed_at: string | null;
  data_available: boolean;
  reason?: string;
  [field: string]: unknown;
}

/**
 * Normalize a single raw observation record from api.vedur.is.
 * Also accepts the legacy uppercase-key shape (T, D, F, ...) for back-compat
 * with older apis.is fixtures.
 */
export function normalizeObservation(raw: Record<string, unknown>): NormalizedObservation {
  const stationId = String(raw["station"] ?? raw["id"] ?? "");
  const stationName = String(raw["name"] ?? "");
  const observedAt = parseVedurTimestamp(raw["time"]);

  // Legacy apis.is shape carries "valid: '0'" for empty-data stations.
  const valid = raw["valid"];
  if (valid !== undefined && String(valid) === "0") {
    return {
      station_id: stationId,
      station_name: stationName,
      observed_at: observedAt,
      data_available: false,
      reason: "Station reported valid=0 — no current data.",
    };
  }

  const normalized: NormalizedObservation = {
    station_id: stationId,
    station_name: stationName,
    observed_at: observedAt,
    data_available: true,
  };

  for (const [rawKey, value] of Object.entries(raw)) {
    // Keys from api.vedur.is are all-lowercase. Legacy apis.is keys are
    // all-uppercase. Dispatch based on case to avoid collisions (the letter
    // 'D' means cardinal direction in legacy but numeric degrees in lowercase).
    const hasUpper = /[A-Z]/.test(rawKey);
    const mapped = hasUpper
      ? (LEGACY_UPPERCASE_MAP[rawKey] ?? FIELD_MAP[rawKey.toLowerCase()])
      : FIELD_MAP[rawKey];
    if (!mapped) continue;
    if (value === null || value === undefined) continue;
    const str = typeof value === "string" ? value.trim() : value;
    if (str === "") continue;
    if (NUMERIC_FIELDS.has(mapped)) {
      const num = typeof str === "number" ? str : Number(str);
      if (Number.isFinite(num)) normalized[mapped] = num;
    } else {
      normalized[mapped] = str;
    }
  }

  return normalized;
}

/**
 * Legacy apis.is field names (uppercase). Kept as a fallback so tests and
 * any still-valid apis.is fixtures continue to work.
 */
const LEGACY_UPPERCASE_MAP: Record<string, string> = {
  F: "wind_speed_ms",
  FX: "max_wind_speed_ms",
  FG: "max_wind_gust_ms",
  D: "wind_direction",
  D2: "wind_direction_degrees",
  T: "temperature_c",
  W: "description",
  V: "visibility_km",
  N: "cloud_cover_pct",
  P: "pressure_hpa",
  RH: "humidity_pct",
  SNC: "snow_description",
  SND: "snow_depth_cm",
  SED: "snow_type",
  RTE: "road_temperature_c",
  TD: "dew_point_c",
  R: "precipitation_mm_per_h",
};

/**
 * Convert IMO timestamps ("YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD HH:MM:SS",
 * Iceland is always UTC, no DST) to ISO 8601 UTC. Returns null if unparseable.
 */
export function parseVedurTimestamp(input: unknown): string | null {
  if (typeof input !== "string" || input.trim() === "") return null;
  // Treat naive timestamps as UTC (Iceland observes UTC year-round).
  const iso = input.includes("T") ? input : input.replace(" ", "T");
  const withZ = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const date = new Date(withZ);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
