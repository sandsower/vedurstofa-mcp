/**
 * Tool: get_weather_forecast
 * Scrapes per-station forecast data from vedur.is. On scrape failure
 * (HTML drift, unknown station slug, upstream error) falls back to the
 * national text forecast and marks the response as degraded.
 */

import { z } from "zod";

import { buildEnvelope, serializeEnvelope } from "../response.js";
import {
  STATION_FORECAST_SLUGS,
  getStationForecast,
  type StationForecast,
} from "../sources/forecast.js";
import { getTextForecast } from "../sources/text_forecast.js";
import { resolveOrDefault } from "../stations.js";
import { ScraperDriftError, UpstreamError } from "../errors.js";
import { log } from "../logger.js";
import type { ToolDescriptor } from "./types.js";

const inputSchema = z
  .object({
    stations: z
      .array(z.string().trim().min(1))
      .min(1)
      .max(10)
      .optional()
      .describe(
        "Station IDs or names. Only major stations have scrapeable forecasts — see 'supported stations' in tool output. Defaults to ['Reykjavík'].",
      ),
    lang: z
      .enum(["en", "is"])
      .default("en")
      .describe("Language for the text-forecast fallback. Structured values are language-agnostic."),
  })
  .strict();

export const getWeatherForecastTool: ToolDescriptor<typeof inputSchema> = {
  name: "get_weather_forecast",
  description:
    "Get multi-day weather forecasts for locations in Iceland. Returns 3-hourly predictions for temperature, wind, precipitation, and conditions per station. Forecast data is scraped from the Icelandic Meteorological Office public site; if scraping fails for a station, the response falls back to the national text forecast and is marked 'degraded'. Only a curated set of major stations has structured forecasts — use list_weather_stations to pick one.",
  inputSchema: {
    type: "object",
    properties: {
      stations: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        maxItems: 10,
        description: "Station IDs or names. Defaults to ['Reykjavík'].",
      },
      lang: {
        type: "string",
        enum: ["en", "is"],
        description: "Language for the text-forecast fallback. Defaults to 'en'.",
      },
    },
    additionalProperties: false,
  },
  schema: inputSchema,
  async handler(input, ctx) {
    const { resolved, failures } = resolveOrDefault(input.stations, ctx.stations);
    const errors: Array<{ subject: string; reason: string }> = failures.map((f) => ({
      subject: `input:${f.input}`,
      reason: f.reason,
    }));

    const perStation: StationForecast[] = [];
    const fallbackStations: Array<{ station_id: string; station_name: string; reason: string }> = [];

    for (const { station } of resolved) {
      try {
        const fc = await getStationForecast(station.id);
        perStation.push(fc);
      } catch (err) {
        const reason =
          err instanceof ScraperDriftError || err instanceof UpstreamError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        log.warn("forecast scrape failed, will fall back", {
          station_id: station.id,
          station_name: station.name,
          reason,
        });
        fallbackStations.push({ station_id: station.id, station_name: station.name, reason });
        errors.push({ subject: `station:${station.id}`, reason });
      }
    }

    // If *every* requested station fell back, load the text forecast once.
    let degraded: { reason: string } | undefined;
    let textFallback: Awaited<ReturnType<typeof getTextForecast>> | undefined;
    if (fallbackStations.length > 0 && perStation.length === 0) {
      try {
        textFallback = await getTextForecast("national", input.lang);
        degraded = {
          reason: "Structured per-station forecast scrape failed for all requested stations; returning national text forecast.",
        };
      } catch (err) {
        degraded = {
          reason: `Structured forecast scrape failed and the text-forecast fallback also failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const env = buildEnvelope({
      source: textFallback?.source_url ?? "https://www.vedur.is/vedur/spar/textaspar/",
      data: {
        supported_stations: Object.keys(STATION_FORECAST_SLUGS),
        stations: perStation,
        fallback_stations: fallbackStations,
        text_fallback: textFallback,
      },
      errors: errors.length > 0 ? errors : undefined,
      ...(degraded ? { degraded } : {}),
    });
    return serializeEnvelope(env);
  },
};
