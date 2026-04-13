/**
 * Text forecast and warning prose, scraped from vedur.is.
 *
 * IMO historically exposed typed text forecasts at
 *   https://www.vedur.is/vedur/spar/texti/textaspa.aspx?type=<N>
 * The page returns structured HTML with a title, issue time, validity range,
 * and the forecast body. We parse what's stable and fall back gracefully.
 */

import { parse, type HTMLElement } from "node-html-parser";

import { TEXT_TYPE_IDS, TTL, VEDUR_SITE_BASE } from "../config.js";
import { cache } from "../cache.js";
import { fetchText } from "../http.js";

const TEXT_BASE = `${VEDUR_SITE_BASE}/vedur/spar/texti/textaspa.aspx`;

export type TextCategory = "national" | "multi_day" | "warnings";
export type TextLang = "is" | "en";

export interface TextForecast {
  category: TextCategory;
  lang: TextLang;
  type_id: string;
  title: string | null;
  issued_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  content: string;
  source_url: string;
}

export async function getTextForecast(
  category: TextCategory,
  lang: TextLang,
): Promise<TextForecast> {
  const typeId = TEXT_TYPE_IDS[lang][category];
  const url = `${TEXT_BASE}?type=${typeId}`;
  const cacheKey = `text:${lang}:${category}`;

  return cache.get<TextForecast>(cacheKey, TTL.textForecast, async () => {
    const html = await fetchText(url, "vedur.is");
    return parseTextForecastPage(html, { category, lang, typeId, url });
  });
}

interface ParseContext {
  category: TextCategory;
  lang: TextLang;
  typeId: string;
  url: string;
}

export function parseTextForecastPage(html: string, ctx: ParseContext): TextForecast {
  const root = parse(html);
  const main = pickMain(root);

  const title = firstText(main, ["h1", "h2.textforec", "h2"]);
  const bodyEl = main.querySelector("div.textforec") ?? main;
  const content = cleanText(bodyEl.text);

  const { issued_at, valid_from, valid_to } = extractTimes(main);

  return {
    category: ctx.category,
    lang: ctx.lang,
    type_id: ctx.typeId,
    title: title ?? null,
    issued_at,
    valid_from,
    valid_to,
    content,
    source_url: ctx.url,
  };
}

function pickMain(root: HTMLElement): HTMLElement {
  return (
    root.querySelector("div#main") ??
    root.querySelector("main") ??
    root.querySelector("div.content") ??
    root
  );
}

function firstText(el: HTMLElement, selectors: string[]): string | null {
  for (const sel of selectors) {
    const hit = el.querySelector(sel);
    if (hit) {
      const text = cleanText(hit.text);
      if (text) return text;
    }
  }
  return null;
}

function cleanText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/**
 * Best-effort extraction of issue/validity timestamps from the page prose.
 * IMO text forecasts typically carry a line like
 *   "Gefið út: 13.04.2026 10:00" or "Issued: 2026-04-13 10:00"
 * and validity in a similar format.
 */
function extractTimes(el: HTMLElement): {
  issued_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
} {
  const text = el.text;
  const issued = matchDateTime(text, /(gefi[ðd] út|issued)[^\d]{0,10}(\d{1,4}[.\-\/]\d{1,2}[.\-\/]\d{1,4}[ T]\d{1,2}[:\.]\d{2})/i);
  const from = matchDateTime(text, /(í gildi frá|valid from)[^\d]{0,10}(\d{1,4}[.\-\/]\d{1,2}[.\-\/]\d{1,4}[ T]\d{1,2}[:\.]\d{2})/i);
  const to = matchDateTime(text, /(til|to|through)[^\d]{0,10}(\d{1,4}[.\-\/]\d{1,2}[.\-\/]\d{1,4}[ T]\d{1,2}[:\.]\d{2})/i);
  return { issued_at: issued, valid_from: from, valid_to: to };
}

function matchDateTime(haystack: string, regex: RegExp): string | null {
  const m = haystack.match(regex);
  if (!m || !m[2]) return null;
  return coerceIsoUtc(m[2]);
}

/**
 * Parse a loose date string into ISO UTC.
 * Handles "13.04.2026 10:00", "2026-04-13 10:00", "13/04/2026 10.00".
 */
function coerceIsoUtc(raw: string): string | null {
  const cleaned = raw.replace(/\./g, match => match).replace(/\s+/g, " ").trim();
  // DD.MM.YYYY HH:MM
  const euro = cleaned.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})[ T](\d{1,2})[:\.](\d{2})$/);
  if (euro) {
    const [, dd, mm, yyyy, hh, min] = euro;
    const year = yyyy!.length === 2 ? Number(`20${yyyy}`) : Number(yyyy);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(min)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  // YYYY-MM-DD HH:MM
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:\.](\d{2})$/);
  if (iso) {
    const [, yyyy, mm, dd, hh, min] = iso;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}
