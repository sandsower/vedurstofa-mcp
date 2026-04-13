/**
 * Response envelope builder. Every tool returns this shape.
 */

import { ATTRIBUTION, MAX_RESPONSE_BYTES } from "./config.js";

export interface ResponseEnvelope<T> {
  attribution: string;
  source: string;
  fetched_at: string;
  data: T;
  errors?: Array<{ subject: string; reason: string }>;
  degraded?: true;
  degraded_reason?: string;
  truncated?: true;
}

export interface BuildEnvelopeInput<T> {
  source: string;
  data: T;
  errors?: Array<{ subject: string; reason: string }>;
  degraded?: { reason: string };
  fetchedAt?: Date;
}

export function buildEnvelope<T>(input: BuildEnvelopeInput<T>): ResponseEnvelope<T> {
  const env: ResponseEnvelope<T> = {
    attribution: ATTRIBUTION,
    source: input.source,
    fetched_at: (input.fetchedAt ?? new Date()).toISOString(),
    data: input.data,
  };
  if (input.errors && input.errors.length > 0) env.errors = input.errors;
  if (input.degraded) {
    env.degraded = true;
    env.degraded_reason = input.degraded.reason;
  }
  return env;
}

/**
 * MCP `content` expects text — serialize + enforce the 100KB cap.
 * Truncation appends a marker so Claude can see it happened.
 */
export function serializeEnvelope<T>(env: ResponseEnvelope<T>): string {
  const json = JSON.stringify(env, null, 2);
  if (Buffer.byteLength(json, "utf8") <= MAX_RESPONSE_BYTES) return json;

  // Truncate by dropping array tail inside `data` if possible; otherwise
  // return a shell with `truncated: true` and a hint.
  const truncatedEnv: ResponseEnvelope<unknown> = {
    ...env,
    truncated: true,
    data: Array.isArray(env.data)
      ? env.data.slice(0, Math.max(1, Math.floor(env.data.length / 2)))
      : env.data,
  };
  let next = JSON.stringify(truncatedEnv, null, 2);
  // Keep shrinking until we fit.
  while (Buffer.byteLength(next, "utf8") > MAX_RESPONSE_BYTES && Array.isArray(truncatedEnv.data) && truncatedEnv.data.length > 1) {
    truncatedEnv.data = (truncatedEnv.data as unknown[]).slice(0, Math.max(1, Math.floor((truncatedEnv.data as unknown[]).length / 2)));
    next = JSON.stringify(truncatedEnv, null, 2);
  }
  return next;
}
