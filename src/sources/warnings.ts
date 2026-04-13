/**
 * CAP (Common Alerting Protocol) v1 feed from api.vedur.is.
 * The service publishes severe-weather warnings as CAP XML.
 *
 * We parse what's in the feed conservatively — CAP is standardized but
 * different agencies fill different fields, so we pull the universally
 * present bits and pass them through.
 */

import { parse, type HTMLElement } from "node-html-parser";

import { API_VEDUR_BASE, TTL } from "../config.js";
import { cache } from "../cache.js";
import { fetchText } from "../http.js";

const CAP_URL = `${API_VEDUR_BASE}/cap/v1/capbroker/active/detailed/all/`;
const CAP_CACHE_KEY = "warnings:cap:v1";

export interface CapArea {
  description: string | null;
  polygon: string | null;
  geocodes: Array<{ name: string; value: string }>;
}

export interface CapInfo {
  language: string | null;
  category: string | null;
  event: string | null;
  urgency: string | null;
  severity: string | null;
  certainty: string | null;
  effective: string | null;
  expires: string | null;
  sender_name: string | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  areas: CapArea[];
}

export interface CapAlert {
  identifier: string | null;
  sender: string | null;
  sent: string | null;
  status: string | null;
  msg_type: string | null;
  scope: string | null;
  infos: CapInfo[];
}

export interface WarningsFetch {
  alerts: CapAlert[];
  source: string;
  fetchedAt: Date;
}

export async function getWeatherWarnings(): Promise<WarningsFetch> {
  const data = await cache.get<{ fetchedAt: string; alerts: CapAlert[] }>(
    CAP_CACHE_KEY,
    TTL.warnings,
    async () => {
      const body = await fetchText(CAP_URL, "api.vedur.is");
      const alerts = parseCapDocument(body);
      return { fetchedAt: new Date().toISOString(), alerts };
    },
  );

  return {
    alerts: data.alerts,
    source: CAP_URL,
    fetchedAt: new Date(data.fetchedAt),
  };
}

/**
 * HTML5 void element names that collide with CAP element names. The parser
 * treats these as self-closing in HTML mode, losing their children. We
 * prefix them before parsing and strip the prefix in `textOf`.
 */
const VOID_COLLISIONS = ["area", "source", "link", "base"] as const;
const VOID_PREFIX = "cap";

function escapeVoidCollisions(xml: string): string {
  let out = xml;
  for (const tag of VOID_COLLISIONS) {
    const open = new RegExp(`<${tag}(\\s|>|/)`, "gi");
    const close = new RegExp(`</${tag}>`, "gi");
    out = out.replace(open, `<${VOID_PREFIX}-${tag}$1`).replace(close, `</${VOID_PREFIX}-${tag}>`);
  }
  return out;
}

/**
 * Parse one or more CAP alerts from an XML body.
 * Supports:
 * - A single <alert> document
 * - A collection wrapping many alerts (<alerts>, <feed>, etc.)
 */
export function parseCapDocument(xml: string): CapAlert[] {
  // node-html-parser is HTML-biased — rename void-element collisions first
  // so their children survive parsing.
  const escaped = escapeVoidCollisions(xml);
  const root = parse(escaped, { lowerCaseTagName: true });

  const alertNodes = root.querySelectorAll("alert");
  if (alertNodes.length > 0) {
    return alertNodes.map(parseAlertElement);
  }
  return [];
}

function parseAlertElement(el: HTMLElement): CapAlert {
  return {
    identifier: textOf(el, "identifier"),
    sender: textOf(el, "sender"),
    sent: textOf(el, "sent"),
    status: textOf(el, "status"),
    msg_type: textOf(el, "msgtype"),
    scope: textOf(el, "scope"),
    infos: el.querySelectorAll("info").map(parseInfoElement),
  };
}

function parseInfoElement(el: HTMLElement): CapInfo {
  return {
    language: textOf(el, "language"),
    category: textOf(el, "category"),
    event: textOf(el, "event"),
    urgency: textOf(el, "urgency"),
    severity: textOf(el, "severity"),
    certainty: textOf(el, "certainty"),
    effective: textOf(el, "effective"),
    expires: textOf(el, "expires"),
    sender_name: textOf(el, "sendername"),
    headline: textOf(el, "headline"),
    description: textOf(el, "description"),
    instruction: textOf(el, "instruction"),
    areas: el.querySelectorAll(`${VOID_PREFIX}-area`).map(parseAreaElement),
  };
}

function parseAreaElement(el: HTMLElement): CapArea {
  const geocodes = el.querySelectorAll("geocode").map((g) => ({
    name: textOf(g, "valuename") ?? "",
    value: textOf(g, "value") ?? "",
  }));
  return {
    description: textOf(el, "areadesc"),
    polygon: textOf(el, "polygon"),
    geocodes,
  };
}

/** Return direct-child text of a named tag, not descending into nested alerts. */
function textOf(parent: HTMLElement, tag: string): string | null {
  // First direct child matching the tag — CAP lets some tags nest, but for
  // the top-level fields we want the outermost occurrence.
  const child = parent.childNodes.find(
    (n) => (n as HTMLElement).tagName?.toLowerCase() === tag.toLowerCase(),
  ) as HTMLElement | undefined;
  const el = child ?? parent.querySelector(tag);
  if (!el) return null;
  const t = el.text?.trim();
  return t && t.length > 0 ? t : null;
}

/** Filter out expired alerts using the `expires` field when present. */
export function filterActive(alerts: ReadonlyArray<CapAlert>, now: Date = new Date()): CapAlert[] {
  const cutoff = now.getTime();
  return alerts.filter((alert) => {
    if (alert.infos.length === 0) return true;
    return alert.infos.some((info) => {
      if (!info.expires) return true;
      const ts = Date.parse(info.expires);
      if (Number.isNaN(ts)) return true;
      return ts >= cutoff;
    });
  });
}
