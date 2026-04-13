/**
 * Text forecasts and warning prose, scraped from vedur.is.
 *
 * IMO publishes a single per-language page that concatenates all text
 * forecast categories as `<div class="textforec">` blocks. Each block
 * carries an `<a name="N">` anchor where N is the IMO type id.
 *
 * Icelandic:   https://www.vedur.is/vedur/spar/textaspar/
 * English:     https://en.vedur.is/weather/forecasts/text/
 *
 * Known type ids:
 *   2   Veðurhorfur á landinu (IS, national outlook)
 *   3   Veðurhorfur á höfuðborgarsvæðinu (IS, capital area)
 *   5   Veðurhorfur á landinu næstu daga (IS, multi-day)
 *   7   Weather outlook (EN, national outlook)
 *   9   Veðuryfirlit (IS, general synopsis)
 *   11  Weather warnings (IS)
 *   14  Weather warnings (EN)
 *   27  Weather forecast for the next several days (EN)
 *   42  General synopsis (EN)
 *   500 Hugleiðingar veðurfræðings (IS, meteorologist notes)
 */

import { parse } from "node-html-parser";

import { TEXT_TYPE_IDS, TTL, VEDUR_SITE_BASE, VEDUR_SITE_EN_BASE } from "../config.js";
import { cache } from "../cache.js";
import { fetchText } from "../http.js";
import { ScraperDriftError } from "../errors.js";

const TEXT_URL_BY_LANG: Record<TextLang, string> = {
  is: `${VEDUR_SITE_BASE}/vedur/spar/textaspar/`,
  en: `${VEDUR_SITE_EN_BASE}/weather/forecasts/text/`,
};

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

interface PageBlock {
  type_id: string;
  title: string | null;
  issued_at: string | null;
  valid_from: string | null;
  valid_to: string | null;
  content: string;
}

interface ParsedPage {
  blocks: PageBlock[];
  source_url: string;
}

/**
 * Fetch and parse the full text-forecast page for a language. Cached for
 * TTL.textForecast. Categories share one upstream request.
 */
async function getPage(lang: TextLang): Promise<ParsedPage> {
  const url = TEXT_URL_BY_LANG[lang];
  const cacheKey = `text:page:${lang}`;
  return cache.get<ParsedPage>(cacheKey, TTL.textForecast, async () => {
    const html = await fetchText(url, "vedur.is");
    const blocks = parseTextForecastPage(html);
    return { blocks, source_url: url };
  });
}

/** Look up a single category + language. Throws if the block is missing. */
export async function getTextForecast(
  category: TextCategory,
  lang: TextLang,
): Promise<TextForecast> {
  const page = await getPage(lang);
  const typeId = TEXT_TYPE_IDS[lang][category];
  const block = page.blocks.find((b) => b.type_id === typeId);
  if (!block) {
    throw new ScraperDriftError(
      page.source_url,
      `no block with type id ${typeId} (${category}/${lang}). The page may not carry this category right now (e.g. warnings only appear when active).`,
    );
  }
  return { ...block, category, lang, source_url: page.source_url };
}

/** Return every block found on the page. Useful for discovery and debugging. */
export async function getAllTextBlocks(lang: TextLang): Promise<ParsedPage> {
  return getPage(lang);
}

/**
 * Parse the <div class="textforec"> blocks out of a text-forecast HTML page.
 * Exported for fixture tests.
 */
export function parseTextForecastPage(html: string): PageBlock[] {
  const root = parse(html);
  const divs = root.querySelectorAll("div.textforec");
  const out: PageBlock[] = [];
  for (const div of divs) {
    const anchor = div.querySelector("a[name]");
    const typeId = anchor?.getAttribute("name")?.trim();
    if (!typeId) continue;
    const title = cleanText(div.querySelector("h2")?.text ?? "");
    const detailInfo = div.querySelector(".detailinfo");
    const detailText = detailInfo?.text ?? "";
    const { issued_at, valid_to } = extractTimes(detailText);
    // The IMO page only gives "Spá gerð: <issue>. Gildir til: <valid_to>."
    // No separate valid_from is published; use issued_at as the effective start.
    const contentEl = div.querySelector("p");
    const rawContent = contentEl?.innerHTML ?? div.innerHTML;
    const content = cleanText(stripDetailInfo(htmlToText(rawContent)));
    out.push({
      type_id: typeId,
      title: title || null,
      issued_at,
      valid_from: issued_at,
      valid_to,
      content,
    });
  }
  return out;
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

function stripDetailInfo(text: string): string {
  // detailinfo spans repeat things like "Spá gerð: ..." or "Forecast made: ...".
  // Strip that trailing metadata so `content` is just the forecast prose.
  return text
    .replace(/(Spá gerð|Issued|Forecast made|Samantekt gerð|Gildir til|Valid until):.*$/gim, "")
    .trim();
}

function cleanText(input: string): string {
  return input
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function extractTimes(detailText: string): { issued_at: string | null; valid_to: string | null } {
  const ISSUED_LABEL = "(?:Spá gerð|Samantekt gerð|Issued|Forecast made)";
  const VALID_LABEL = "(?:Gildir til|Valid (?:to|until))";
  const EURO_DATE = String.raw`\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}\s+\d{1,2}[:\.]\d{2}`;
  const ISO_DATE = String.raw`\d{4}-\d{1,2}-\d{1,2}[ T]\d{1,2}[:\.]\d{2}`;
  const issued =
    matchDateTime(detailText, new RegExp(`${ISSUED_LABEL}\\s*:?\\s*(${EURO_DATE})`, "i")) ??
    matchDateTime(detailText, new RegExp(`${ISSUED_LABEL}\\s*:?\\s*(${ISO_DATE})`, "i"));
  const validTo =
    matchDateTime(detailText, new RegExp(`${VALID_LABEL}\\s*:?\\s*(${EURO_DATE})`, "i")) ??
    matchDateTime(detailText, new RegExp(`${VALID_LABEL}\\s*:?\\s*(${ISO_DATE})`, "i"));
  return { issued_at: issued, valid_to: validTo };
}

function matchDateTime(haystack: string, regex: RegExp): string | null {
  const m = haystack.match(regex);
  if (!m || !m[1]) return null;
  return coerceIsoUtc(m[1]);
}

function coerceIsoUtc(raw: string): string | null {
  const cleaned = raw.trim();
  const euro = cleaned.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})\s+(\d{1,2})[:\.](\d{2})$/);
  if (euro) {
    const [, dd, mm, yyyy, hh, min] = euro;
    const year = yyyy!.length === 2 ? Number(`20${yyyy}`) : Number(yyyy);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd), Number(hh), Number(min)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2})[:\.](\d{2})$/);
  if (iso) {
    const [, yyyy, mm, dd, hh, min] = iso;
    const d = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min)));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}
