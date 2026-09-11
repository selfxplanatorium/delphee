import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { CarrieraHeader } from "../../types.js";

// Shared parsing primitives. Delphi's HTML is entity-encoded latin1 with
// inconsistent whitespace and "---"/"--"/"&nbsp;" used as empty markers, so
// every extraction routes through these normalisers rather than trusting raw
// text().

export function load(html: string) {
  return cheerio.load(html);
}

// Riepilogo header shared by the esamiVerbalizzati / esamiPendenti / verbaliNonChiusi
// pages. Same shape on all three: a single td.riepilogo with bold "Studente:",
// "Matricola:", "Corso di Laurea:" labels.
export function parseRiepilogoHeader($: CheerioAPI): CarrieraHeader {
  const text = cleanText($("td.riepilogo").first().text());
  return {
    studente: text.match(/Studente:\s*([^]*?)\s*(?:Matricola:|Corso|$)/i)?.[1]?.trim() ?? null,
    matricola: text.match(/Matricola:\s*(\d+)/i)?.[1] ?? null,
    cdl: text.match(/Corso di Laurea:\s*(.+?)\s*$/i)?.[1]?.trim() ?? null,
  };
}

export function cleanText(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/ /g, " ") // nbsp
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim();
}

// Empty markers Delphi uses interchangeably for "no value".
export function emptyish(s: string): boolean {
  const t = s.trim();
  return t === "" || t === "---" || t === "--" || t === "-" || t === " ";
}

export function orNull(s: string | null | undefined): string | null {
  const t = cleanText(s ?? "");
  return emptyish(t) ? null : t;
}

// "DD/MM/YYYY" → ISO "YYYY-MM-DD"; null on anything else.
export function parseDateIt(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = cleanText(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

export function parseFloatSafe(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = cleanText(s);
  if (emptyish(t)) return null;
  const cleaned = t.replace(/[^\d.,-]/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function parseIntSafe(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = cleanText(s).match(/-?\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) ? n : null;
}

// cheerio's text() drops <br> with no whitespace; this re-inserts a space.
export function textWithBreaks($el: Cheerio<any>): string {
  const html = $el.html() ?? "";
  return cleanText(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " "));
}
