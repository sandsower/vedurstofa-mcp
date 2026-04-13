/**
 * Tool: list_weather_stations
 * Returns the preloaded station catalog, optionally filtered by region
 * (substring match against the catalog's region field).
 */

import { z } from "zod";

import { API_VEDUR_BASE } from "../config.js";
import { buildEnvelope, serializeEnvelope } from "../response.js";
import { normalizeName } from "../stations.js";
import type { ToolDescriptor } from "./types.js";

const inputSchema = z
  .object({
    region: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("Case-insensitive substring match against the station's region label (e.g. 'north', 'capital')."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe("Maximum number of stations to return. Defaults to all."),
  })
  .strict();

export const listWeatherStationsTool: ToolDescriptor<typeof inputSchema> = {
  name: "list_weather_stations",
  description:
    "List weather stations in Iceland with their IDs, names, types, and coordinates. Use this to look up station IDs for get_weather_now and get_weather_forecast, or to help users discover stations near a region. Stations are loaded from the Icelandic Meteorological Office (api.vedur.is).",
  inputSchema: {
    type: "object",
    properties: {
      region: {
        type: "string",
        description:
          "Case-insensitive substring match against the station's region label (e.g. 'north', 'capital', 'westfjords'). Optional.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 1000,
        description: "Maximum number of stations to return. Defaults to all.",
      },
    },
    additionalProperties: false,
  },
  schema: inputSchema,
  async handler(input, ctx) {
    const { region, limit } = input;
    let results = ctx.stations;

    if (region) {
      const needle = normalizeName(region);
      results = results.filter((s) => {
        if (!s.region) return false;
        return normalizeName(s.region).includes(needle);
      });
    }

    if (limit !== undefined) {
      results = results.slice(0, limit);
    }

    const env = buildEnvelope({
      source: `${API_VEDUR_BASE}/weather/stations`,
      data: {
        count: results.length,
        total_in_catalog: ctx.stations.length,
        stations: results.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          region: s.region,
          latitude: s.latitude,
          longitude: s.longitude,
        })),
      },
    });
    return serializeEnvelope(env);
  },
};
