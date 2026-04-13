/**
 * Thin fetch wrapper: adds UA, enforces per-request timeout, gates
 * concurrency via semaphore, and maps upstream failures to typed errors.
 * Also tracks 429 cooldowns per source key so we fail fast after rate-limiting.
 */

import {
  RATE_LIMIT_COOLDOWN_MS,
  UPSTREAM_CONCURRENCY,
  UPSTREAM_TIMEOUT_MS,
  USER_AGENT,
} from "./config.js";
import {
  UpstreamError,
  UpstreamRateLimitError,
  UpstreamTimeoutError,
  UpstreamUnavailableError,
} from "./errors.js";
import { log } from "./logger.js";

/** Simple counting semaphore. */
class Semaphore {
  private waiters: Array<() => void> = [];
  private available: number;

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return this.release.bind(this);
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.available -= 1;
        resolve(this.release.bind(this));
      });
    });
  }

  private release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

const semaphore = new Semaphore(UPSTREAM_CONCURRENCY);

/** 429 cooldown table keyed by source (host or tool label). */
const cooldowns = new Map<string, number>();

function inCooldown(source: string): boolean {
  const until = cooldowns.get(source);
  if (until === undefined) return false;
  if (until <= Date.now()) {
    cooldowns.delete(source);
    return false;
  }
  return true;
}

function setCooldown(source: string): void {
  cooldowns.set(source, Date.now() + RATE_LIMIT_COOLDOWN_MS);
}

export interface FetchOptions {
  /** Extra headers (Accept etc.). UA is always injected. */
  headers?: Record<string, string>;
  /** Override timeout for this call (ms). */
  timeoutMs?: number;
  /** Abort signal from caller. Composed with the timeout signal. */
  signal?: AbortSignal;
}

interface RawResponse {
  status: number;
  text: string;
  url: string;
}

/**
 * Perform a GET request with UA, timeout, semaphore, and 429 tracking.
 * @param source — logical key used for rate-limit cooldown scoping
 *                  (e.g. "api.vedur.is", "vedur.is").
 */
async function request(url: string, source: string, options: FetchOptions = {}): Promise<RawResponse> {
  if (inCooldown(source)) {
    throw new UpstreamRateLimitError(source);
  }

  const release = await semaphore.acquire();
  const timeoutMs = options.timeoutMs ?? UPSTREAM_TIMEOUT_MS;
  const timeoutController = new AbortController();
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

  // Compose external abort signal with timeout signal.
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) timeoutController.abort();
    else externalSignal.addEventListener("abort", () => timeoutController.abort(), { once: true });
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json, text/html, text/xml;q=0.9, */*;q=0.5",
        "Accept-Encoding": "gzip, deflate",
        ...options.headers,
      },
      signal: timeoutController.signal,
    });

    if (response.status === 429) {
      setCooldown(source);
      log.warn("upstream rate-limited", { source, url });
      throw new UpstreamRateLimitError(source);
    }
    if (response.status >= 500) {
      log.warn("upstream 5xx", { source, url, status: response.status });
      throw new UpstreamUnavailableError(source, response.status);
    }
    if (response.status >= 400) {
      // 4xx other than 429: surface as generic upstream error so Claude gets context.
      const body = await response.text().catch(() => "");
      log.warn("upstream 4xx", { source, url, status: response.status, body: body.slice(0, 200) });
      throw new UpstreamUnavailableError(source, response.status);
    }

    const text = await response.text();
    return { status: response.status, text, url: response.url };
  } catch (err) {
    if (err instanceof UpstreamError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      log.warn("upstream timeout", { source, url, timeoutMs });
      throw new UpstreamTimeoutError(source);
    }
    log.warn("upstream fetch failed", { source, url, error: err instanceof Error ? err.message : String(err) });
    throw new UpstreamUnavailableError(source);
  } finally {
    clearTimeout(timeoutHandle);
    release();
  }
}

/** Fetch JSON and parse. Throws UpstreamError subclasses on failure. */
export async function fetchJson<T = unknown>(url: string, source: string, options?: FetchOptions): Promise<T> {
  const res = await request(url, source, options);
  try {
    return JSON.parse(res.text) as T;
  } catch (err) {
    log.warn("upstream returned non-JSON", { source, url, snippet: res.text.slice(0, 200) });
    throw new UpstreamUnavailableError(source);
  }
}

/** Fetch raw text (HTML, XML). */
export async function fetchText(url: string, source: string, options?: FetchOptions): Promise<string> {
  const res = await request(url, source, options);
  return res.text;
}
