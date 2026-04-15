/**
 * Tool: get_weather_now
 * Returns the most recent AWS observation for each requested station.
 * Multi-station calls share one upstream bulk fetch.
 */

import { z } from "zod";

import { buildEnvelope, serializeEnvelope } from "../response.js";
import { getObservationIndex } from "../sources/observations.js";
import { loadStations, resolveOrDefault, suggestStations } from "../stations.js";
import type { ToolDescriptor } from "./types.js";

const inputSchema = z
  .object({
    stations: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(50)
      .optional()
      .describe("Station IDs or names (e.g. '1470' or 'Reykjavík'). Diacritics optional. Defaults to ['Reykjavík']."),
    lang: z
      .enum(["en", "is"])
      .default("en")
      .describe("Language for description fields. Only affects text fields like 'description'. Defaults to 'en'."),
  })
  .strict();

export const getWeatherNowTool: ToolDescriptor<typeof inputSchema> = {
  name: "get_weather_now",
  description:
    "Get current weather observations for locations in Iceland. Returns temperature (°C), wind speed and direction (m/s, cardinal + degrees), pressure (hPa), humidity (%), precipitation (mm/h), and snow/visibility data when available. Accepts station IDs or names — call list_weather_stations to discover available stations.",
  inputSchema: {
    type: "object",
    properties: {
      stations: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 50,
        description:
          "Station IDs or names, e.g. ['1470', 'Akureyri']. Diacritics optional. Defaults to ['Reykjavík'] when omitted.",
      },
      lang: {
        type: "string",
        enum: ["en", "is"],
        description: "Language for description fields. Defaults to 'en'.",
      },
    },
    additionalProperties: false,
  },
  schema: inputSchema,
  async handler(input) {
    const stations = await loadStations();
    const { resolved, failures } = resolveOrDefault(input.stations, stations);

    const errors: Array<{ subject: string; reason: string }> = failures.map((f) => ({
      subject: `input:${f.input}`,
      reason: f.reason,
    }));

    let fetchedAt = new Date();
    let source = "";
    const observations: unknown[] = [];

    if (resolved.length > 0) {
      const bulk = await getObservationIndex();
      fetchedAt = bulk.fetchedAt;
      source = bulk.source;
      for (const { station } of resolved) {
        const obs = bulk.index.get(station.id);
        if (!obs) {
          const suggestions = suggestStations(station.name, stations, 3);
          errors.push({
            subject: `station:${station.id}`,
            reason:
              `Station '${station.name}' (${station.id}) is in the catalog but has no current AWS observation. ` +
              "This can happen for manned/synoptic stations that only report every 3 hours, or if the station is offline. " +
              (suggestions.length > 0
                ? `Nearby alternatives: ${suggestions.map((s) => `${s.name} (${s.id})`).join(", ")}.`
                : ""),
          });
          continue;
        }
        observations.push(obs);
      }
    }

    const env = buildEnvelope({
      source: source || "api.vedur.is/observations/aws/latest",
      fetchedAt,
      data: { observations },
      errors: errors.length > 0 ? errors : undefined,
    });
    return serializeEnvelope(env);
  },
};
