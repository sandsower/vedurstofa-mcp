/**
 * Tool: get_weather_warnings
 * Returns active CAP weather warnings from api.vedur.is/cap/v1/.
 */

import { z } from "zod";

import { buildEnvelope, serializeEnvelope } from "../response.js";
import { filterActive, getWeatherWarnings } from "../sources/warnings.js";
import type { ToolDescriptor } from "./types.js";

const inputSchema = z
  .object({
    include_expired: z
      .boolean()
      .default(false)
      .describe("Include alerts past their expires timestamp. Defaults to false."),
    lang: z
      .enum(["en", "is"])
      .optional()
      .describe(
        "If provided, include only info blocks for this language. Defaults to returning all languages per alert.",
      ),
  })
  .strict();

export const getWeatherWarningsTool: ToolDescriptor<typeof inputSchema> = {
  name: "get_weather_warnings",
  description:
    "Get active severe-weather warnings (CAP alerts) for Iceland from the Icelandic Meteorological Office. Returns structured alert metadata including severity, certainty, urgency, effective/expiry times, affected areas, and multilingual headlines + descriptions. For narrative text warnings use get_weather_text with category='warnings'.",
  inputSchema: {
    type: "object",
    properties: {
      include_expired: {
        type: "boolean",
        description: "Include expired alerts (default false).",
      },
      lang: {
        type: "string",
        enum: ["en", "is"],
        description: "Filter to info blocks in this language. Default returns all.",
      },
    },
    additionalProperties: false,
  },
  schema: inputSchema,
  async handler(input) {
    const { alerts, source, fetchedAt } = await getWeatherWarnings();
    const visible = input.include_expired ? alerts : filterActive(alerts);

    const projected = visible.map((alert) => {
      const infos = input.lang
        ? alert.infos.filter((i) => !i.language || i.language.toLowerCase().startsWith(input.lang!.toLowerCase()))
        : alert.infos;
      return { ...alert, infos };
    });

    const env = buildEnvelope({
      source,
      fetchedAt,
      data: {
        count: projected.length,
        message:
          projected.length === 0
            ? "No active weather warnings for Iceland. This is normal — warnings are issued only for significant events."
            : undefined,
        alerts: projected,
      },
    });
    return serializeEnvelope(env);
  },
};
