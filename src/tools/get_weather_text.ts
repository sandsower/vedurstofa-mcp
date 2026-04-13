/**
 * Tool: get_weather_text
 * Scrapes the Icelandic Met Office text forecast pages (vedur.is) and
 * returns the prose for a requested category + language.
 */

import { z } from "zod";

import { buildEnvelope, serializeEnvelope } from "../response.js";
import { getTextForecast } from "../sources/text_forecast.js";
import type { ToolDescriptor } from "./types.js";

const inputSchema = z
  .object({
    category: z
      .enum(["national", "multi_day", "warnings"])
      .default("national")
      .describe(
        "Which text forecast to fetch: 'national' (today's outlook), 'multi_day' (next several days), or 'warnings' (active textual weather warnings).",
      ),
    lang: z
      .enum(["en", "is"])
      .default("en")
      .describe(
        "Language. 'is' (Icelandic) text is typically more detailed and updates faster than the English version.",
      ),
  })
  .strict();

export const getWeatherTextTool: ToolDescriptor<typeof inputSchema> = {
  name: "get_weather_text",
  description:
    "Get written (prose) weather forecasts for Iceland from the Icelandic Meteorological Office. Use for narrative forecasts and text weather warnings. For structured per-station observations use get_weather_now. For structured warnings use get_weather_warnings.",
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["national", "multi_day", "warnings"],
        description: "Which text forecast to fetch. Defaults to 'national'.",
      },
      lang: {
        type: "string",
        enum: ["en", "is"],
        description: "Language. Icelandic versions are often more detailed. Defaults to 'en'.",
      },
    },
    additionalProperties: false,
  },
  schema: inputSchema,
  async handler(input) {
    const forecast = await getTextForecast(input.category, input.lang);
    const env = buildEnvelope({
      source: forecast.source_url,
      data: forecast,
    });
    return serializeEnvelope(env);
  },
};
