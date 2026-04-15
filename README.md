# vedurstofa-mcp

MCP server for Icelandic weather, forecasts, warnings, and earthquakes. Data comes from the Icelandic Meteorological Office (Veðurstofa Íslands, [vedur.is](https://vedur.is)). Works with Claude Desktop, Claude Code, and any other MCP client.

## What it does

Six tools:

| Tool | What it returns |
|---|---|
| `get_weather_now` | Current AWS observations per station (temperature, wind, pressure, humidity, precipitation). |
| `get_weather_forecast` | Per-station multi-day forecasts scraped from vedur.is. Falls back to the text forecast if scraping fails. |
| `get_weather_text` | Prose weather forecasts and text warnings (national, multi-day, or warnings), in English or Icelandic. |
| `get_weather_warnings` | Structured CAP v1 severe-weather alerts. |
| `get_earthquakes` | Recent earthquakes with region presets (Reykjanes, Katla, Bárðarbunga, Tjörnes, Askja, Hekla, Grímsvötn) and arbitrary lat/lon radius filters. |
| `list_weather_stations` | Station catalog for ID/name lookups. |

Station inputs accept IDs (`"1470"`) or names with or without diacritics (`"Reykjavík"`, `"reykjavik"`). Unknown names return a typo-tolerant "did you mean..." error.

## For agents

Read this section if you're an AI agent picking tools from this server.

- **No auth, no API key, no setup.** Just run `npx vedurstofa-mcp` over stdio.
- **All data is Icelandic.** If the user asks about weather outside Iceland, stop — this server can't help.
- **Every response is a JSON envelope** with `attribution`, `source`, `fetched_at`, `data`, and optionally `errors`, `degraded`, `truncated`. Always cite the `attribution` field when surfacing data to users.
- **Units are metric.** °C, m/s, hPa, mm, km. Convert only when the user asks.
- **Timestamps are ISO 8601 UTC.** Iceland is on UTC year-round (no DST).

### Tool selection guide

| User asks about… | Use |
|---|---|
| Current temperature, wind, pressure at a location | `get_weather_now` |
| Hourly forecast for the next hours/days at a location | `get_weather_forecast` (pass `hours` to narrow the window) |
| Narrative / prose forecast (national outlook, multi-day, text warnings) | `get_weather_text` |
| Severe-weather alerts, storm warnings, structured hazard data | `get_weather_warnings` |
| Recent earthquakes — volcanic regions, lat/lon radius, magnitude | `get_earthquakes` |
| "Which stations are there?" / resolving a place name to a station ID | `list_weather_stations` |

### Multi-tool workflows

- **"What's the weather like in Iceland today?"** → `get_weather_now` for the user's city + `get_weather_warnings` to surface any active alerts. Add `get_weather_text` with `category: "national"` only if the user wants a narrative.
- **"Should I drive from Reykjavík to Akureyri tomorrow?"** → `get_weather_forecast` for both endpoints + `get_weather_warnings`. Don't pull `get_weather_now` unless the user asks about *right now*.
- **"Are there any earthquakes near me?"** → `get_earthquakes` with `region` preset if the user names a volcanic system (Reykjanes, Katla, etc.), otherwise `near: { lat, lon, radius_km }`.

### Degraded responses

`get_weather_forecast` scrapes HTML and can fail when the upstream site changes. When this happens, the response carries `degraded: true` and `degraded_reason`, and falls back to the national text forecast. Surface this to the user rather than pretending the structured forecast is available.

## Install & run

Node 18+ required.

```bash
# Latest
npx -y vedurstofa-mcp

# Version-pinned (recommended for configs that shouldn't drift)
npx -y vedurstofa-mcp@1.0.0
```

The server speaks MCP over stdio, so you won't see interactive output. Plug it into a client.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "vedurstofa": {
      "command": "npx",
      "args": ["vedurstofa-mcp"]
    }
  }
}
```

## Claude Code

```bash
claude mcp add vedurstofa -- npx vedurstofa-mcp
```

## Cursor

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "vedurstofa": {
      "command": "npx",
      "args": ["vedurstofa-mcp"]
    }
  }
}
```

## Cline (VS Code)

In VS Code, open the Cline extension → MCP servers → **Edit MCP settings**, and add:

```json
{
  "mcpServers": {
    "vedurstofa": {
      "command": "npx",
      "args": ["vedurstofa-mcp"]
    }
  }
}
```

## ChatGPT

ChatGPT's MCP support (Developer Mode, Plus/Pro and higher) currently accepts only remote MCP servers exposed over an SSE URL, not local stdio servers like this one. To use `vedurstofa-mcp` with ChatGPT you'd need to wrap it behind an stdio→SSE bridge (e.g. `mcp-proxy`, `supergateway`) and point ChatGPT at the bridge URL. See OpenAI's [MCP docs](https://developers.openai.com/api/docs/mcp) for setup.

## Example output

`get_weather_now` with `stations: ["Reykjavík"]`:

```json
{
  "attribution": "Icelandic Met Office (vedur.is), CC BY-SA 4.0. ...",
  "source": "https://api.vedur.is/weather/observations/aws/hour/latest",
  "fetched_at": "2026-04-15T21:00:00.000Z",
  "data": {
    "observations": [
      {
        "station_id": "1470",
        "station_name": "Reykjavík",
        "observed_at": "2026-04-15T20:50:00.000Z",
        "temperature_c": 4.2,
        "wind_speed_ms": 7.1,
        "wind_direction_deg": 230,
        "wind_direction_cardinal": "SW",
        "pressure_hpa": 1008.4,
        "humidity_pct": 82,
        "precipitation_mm": 0.0
      }
    ]
  }
}
```

`get_earthquakes` with `region: "reykjanes"` returns a sorted list of events with `timestamp`, `latitude`, `longitude`, `depth_km`, `magnitude`, `magnitude_type`, `location`, `reviewed`. Fields default to `null` when upstream omits them.

## Example prompts

- "What's the weather in Reykjavík right now?"
- "Compare current conditions in Akureyri, Ísafjörður and Höfn."
- "Any weather warnings active for Iceland?"
- "Earthquakes near Grindavík in the last 24 hours above magnitude 2."
- "Show me the Icelandic multi-day text forecast."

## Data attribution

Data comes from the Icelandic Meteorological Office under CC BY-SA 4.0. Every response includes an `attribution` field. The MIT license in this repo covers the server code only, not the data.

## Limitations

- Forecast scraping is fragile. Per-station forecasts are extracted from inline JavaScript on vedur.is pages. When the HTML changes, the scraper falls back to the national text forecast and marks the response `degraded: true`. File an issue when you see it.
- Forecast station coverage is limited to ~13 major named stations. Others share a regional page or have no scrapeable forecast.
- Units are metric: °C, m/s, hPa, mm, km. Claude converts on request.
- Timestamps are ISO 8601 UTC. Iceland is on UTC year-round (no DST).

## Development

```bash
npm install
npm run typecheck
npm run test
npm run build
```

`VEDURSTOFA_DEBUG=1` enables debug-level logs on stderr. Stdout is reserved for the MCP protocol.

## License

MIT for the server code. Data is the property of the Icelandic Meteorological Office under CC BY-SA 4.0.
