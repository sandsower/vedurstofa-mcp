/**
 * Tool: get_earthquakes
 * Returns recent Icelandic earthquakes, filtered by region preset, custom
 * lat/lon radius, or magnitude. Default excludes unreviewed (automatic) events.
 */

import { z } from "zod";

import { QUAKE_REGIONS } from "../config.js";
import { buildEnvelope, serializeEnvelope } from "../response.js";
import {
  getRecentQuakes,
  haversineKm,
  isInBbox,
  type NormalizedQuake,
} from "../sources/quakes.js";
import type { ToolDescriptor } from "./types.js";

const regionEnum = z.enum(
  Object.keys(QUAKE_REGIONS) as [keyof typeof QUAKE_REGIONS, ...Array<keyof typeof QUAKE_REGIONS>],
);

const inputSchema = z
  .object({
    region: regionEnum
      .optional()
      .describe(
        `Named region preset. One of: ${Object.keys(QUAKE_REGIONS).join(", ")}. Mutually exclusive with 'near'.`,
      ),
    near: z
      .object({
        lat: z.number().min(63).max(67),
        lon: z.number().min(-25).max(-13),
        radius_km: z.number().min(1).max(500),
      })
      .optional()
      .describe(
        "Arbitrary point + radius filter (km). Use this for locations not covered by 'region'. Mutually exclusive with 'region'.",
      ),
    min_magnitude: z.number().min(0).max(10).default(0),
    hours: z
      .number()
      .int()
      .min(1)
      .max(168)
      .default(48)
      .describe("How far back to look, in hours. Max 168 (7 days)."),
    include_unreviewed: z
      .boolean()
      .default(false)
      .describe("Include automatic (unreviewed) events. Default false — reviewed events are more reliable."),
  })
  .strict()
  .refine((v) => !(v.region && v.near), {
    message: "Provide either 'region' or 'near', not both.",
    path: ["region"],
  });

export const getEarthquakesTool: ToolDescriptor<typeof inputSchema> = {
  name: "get_earthquakes",
  description:
    "Get recent earthquakes in Iceland with magnitude, location, depth, and timestamp. Filter by named region preset (reykjanes, mydalsjokull, bardarbunga, tjornes, katla, askja, hekla, grimsvotn) or a custom lat/lon radius. Defaults to the last 48 hours and excludes automatic (unreviewed) detections.",
  inputSchema: {
    type: "object",
    properties: {
      region: {
        type: "string",
        enum: Object.keys(QUAKE_REGIONS),
        description:
          "Named region preset. Mutually exclusive with 'near'. Useful for monitoring specific volcanic systems.",
      },
      near: {
        type: "object",
        description: "Custom point + radius filter. Mutually exclusive with 'region'.",
        properties: {
          lat: { type: "number", minimum: 63, maximum: 67, description: "Latitude in degrees (63–67 covers Iceland)." },
          lon: { type: "number", minimum: -25, maximum: -13, description: "Longitude in degrees." },
          radius_km: { type: "number", minimum: 1, maximum: 500, description: "Search radius in kilometers." },
        },
        required: ["lat", "lon", "radius_km"],
        additionalProperties: false,
      },
      min_magnitude: {
        type: "number",
        minimum: 0,
        maximum: 10,
        description: "Minimum magnitude (Mlw). Defaults to 0 (all events).",
      },
      hours: {
        type: "integer",
        minimum: 1,
        maximum: 168,
        description: "Time window in hours. Max 168 (7 days). Defaults to 48.",
      },
      include_unreviewed: {
        type: "boolean",
        description: "Include automatic unreviewed detections. Defaults to false.",
      },
    },
    additionalProperties: false,
  },
  schema: inputSchema,
  async handler(input) {
    const { quakes, source, fetchedAt } = await getRecentQuakes({
      hours: input.hours,
      includeUnreviewed: input.include_unreviewed,
    });

    let filtered: NormalizedQuake[] = quakes;

    // Defence-in-depth client-side filters — server filters may not apply
    // cleanly to every upstream shape.
    if (!input.include_unreviewed) {
      filtered = filtered.filter((q) => q.reviewed);
    }
    if (input.min_magnitude > 0) {
      filtered = filtered.filter((q) => (q.magnitude ?? -1) >= input.min_magnitude);
    }

    let regionInfo: { key: string; label: string } | undefined;
    if (input.region) {
      const preset = QUAKE_REGIONS[input.region];
      if (preset) {
        filtered = filtered.filter((q) => isInBbox(q, preset.bbox));
        regionInfo = { key: input.region, label: preset.label };
      }
    } else if (input.near) {
      const center = { lat: input.near.lat, lon: input.near.lon };
      filtered = filtered.filter((q) => {
        const d = haversineKm(center, { lat: q.latitude, lon: q.longitude });
        return d <= input.near!.radius_km;
      });
    }

    // Most recent first
    filtered.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0));

    const env = buildEnvelope({
      source,
      fetchedAt,
      data: {
        count: filtered.length,
        window_hours: input.hours,
        region: regionInfo,
        ...(input.near ? { near: input.near } : {}),
        message:
          filtered.length === 0
            ? "No earthquakes match these filters in the requested window. This is normal during quiet periods."
            : undefined,
        events: filtered,
      },
    });
    return serializeEnvelope(env);
  },
};
