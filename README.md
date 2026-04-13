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

## Install & run

Node 18+ required.

```bash
npx vedurstofa-mcp
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
