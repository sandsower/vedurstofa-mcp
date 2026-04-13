/**
 * Typed error classes. Messages are Claude-facing — they should say
 * what to do next, not just what broke.
 */

export class UpstreamError extends Error {
  constructor(
    public readonly source: string,
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export class UpstreamTimeoutError extends UpstreamError {
  constructor(source: string) {
    super(
      source,
      `Upstream IMO service at ${source} did not respond within the timeout. This is usually transient — ask the user to retry in a minute.`,
    );
    this.name = "UpstreamTimeoutError";
  }
}

export class UpstreamRateLimitError extends UpstreamError {
  constructor(source: string) {
    super(
      source,
      `Upstream IMO service at ${source} rate-limited this request. Wait 60 seconds before retrying.`,
    );
    this.name = "UpstreamRateLimitError";
  }
}

export class UpstreamUnavailableError extends UpstreamError {
  constructor(source: string, status?: number) {
    super(
      source,
      `Upstream IMO service at ${source} returned an error${status ? ` (HTTP ${status})` : ""}. This is likely transient — ask the user to retry in a minute.`,
    );
    this.name = "UpstreamUnavailableError";
  }
}

export class ScraperDriftError extends Error {
  constructor(
    public readonly source: string,
    public readonly reason: string,
  ) {
    super(
      `The scraped forecast page at ${source} did not match the expected shape (${reason}). The upstream HTML may have changed — falling back to text forecast.`,
    );
    this.name = "ScraperDriftError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class UnknownStationError extends ValidationError {
  constructor(
    public readonly input: string,
    public readonly suggestions: ReadonlyArray<{ id: string; name: string }>,
  ) {
    const suggestionText =
      suggestions.length > 0
        ? ` Did you mean ${suggestions.map((s) => `'${s.name}' (${s.id})`).join(" or ")}?`
        : "";
    super(
      `Station '${input}' not found.${suggestionText} Call list_weather_stations to see all available stations.`,
    );
    this.name = "UnknownStationError";
  }
}
