import type { ToolDescriptor } from "./types.js";
import { getEarthquakesTool } from "./get_earthquakes.js";
import { getWeatherForecastTool } from "./get_weather_forecast.js";
import { getWeatherNowTool } from "./get_weather_now.js";
import { getWeatherTextTool } from "./get_weather_text.js";
import { getWeatherWarningsTool } from "./get_weather_warnings.js";
import { listWeatherStationsTool } from "./list_weather_stations.js";

/**
 * Registered tools — keep this list in the order we want Claude to see them.
 * Each new Phase 1 tool gets appended here.
 */
export const tools: ReadonlyArray<ToolDescriptor> = [
  getWeatherNowTool,
  getWeatherForecastTool,
  getWeatherTextTool,
  getWeatherWarningsTool,
  getEarthquakesTool,
  listWeatherStationsTool,
];
