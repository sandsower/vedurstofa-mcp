# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-04-15

Initial release.

### Tools

- `get_weather_now` — current AWS observations per station (temperature, wind, pressure, humidity, precipitation).
- `get_weather_forecast` — per-station multi-day hourly forecast scraped from vedur.is, with text-forecast fallback when the scrape drifts.
- `get_weather_text` — prose national forecast, multi-day outlook, and text warnings (en/is).
- `get_weather_warnings` — structured CAP v1 severe-weather alerts.
- `get_earthquakes` — recent earthquakes with region presets (Reykjanes, Katla, Bárðarbunga, Tjörnes, Askja, Hekla, Grímsvötn) and custom lat/lon radius filters.
- `list_weather_stations` — station catalog for ID/name lookups.

### Notes

- Data from the Icelandic Meteorological Office under CC BY-SA 4.0. Every response includes an `attribution` field. The MIT license covers the server code only, not the data.
- Station names accept diacritic-free input (`"Reykjavik"` works) and return typo-tolerant suggestions on miss.
- Responses are capped at ~100KB; larger payloads are truncated with a `truncated: true` marker.

[1.0.0]: https://github.com/sandsower/vedurstofa-mcp/releases/tag/v1.0.0
