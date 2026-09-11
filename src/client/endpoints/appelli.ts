import { load, cleanText, parseDateIt, parseIntSafe } from "./util.js";
import type { Appello } from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for the appelli listing. The single-insegnamento appelli page is the
// older Delphi flow; the modern path is the calendar search (not yet wired). The
// parser resolves columns from the header row when present, else falls back to
// positional defaults, so it survives the column-order drift Delphi is prone to.

const COLS: Record<string, string[]> = {
  codice: ["codice"],
  insegnamento: ["insegnamento", "esame", "materia"],
  data: ["data", "appello"],
  postiDisponibili: ["disponibili", "posti"],
  iscritti: ["iscritti", "prenotati"],
  stato: ["stato"],
};

function resolveColumns(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const [key, kws] of Object.entries(COLS)) {
    const idx = headers.findIndex((h) => kws.some((k) => h.includes(k)));
    if (idx >= 0) map[key] = idx;
  }
  return map;
}

function parseStato(label: string, posti: number | null): Appello["stato"] {
  const t = label.toLowerCase();
  if (t.includes("chius")) return "chiuso";
  if (t.includes("pien") || posti === 0) return "pieno";
  if (t.includes("apert") || (posti !== null && posti > 0)) return "aperto";
  return "sconosciuto";
}

function findTable($: CheerioAPI) {
  let found: any = null;
  $("table").each((_, table) => {
    if (found) return;
    const headers = $(table)
      .find("tr")
      .first()
      .find("td, th")
      .map((_, c) => cleanText($(c).text()).toLowerCase())
      .get();
    if (headers.some((h) => h.includes("data")) &&
        headers.some((h) => h.includes("codice") || h.includes("esame"))) {
      found = table;
    }
  });
  return found;
}

export function parse(html: string): Appello[] {
  const $ = load(html);
  const table = findTable($);
  if (!table) return [];

  const headerCells = $(table)
    .find("tr")
    .first()
    .find("td, th")
    .map((_, c) => cleanText($(c).text()).toLowerCase())
    .get();
  const cols = resolveColumns(headerCells);

  const out: Appello[] = [];
  $(table)
    .find("tr")
    .slice(1)
    .each((_, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < 2) return;
      const at = (key: string, fallback: number) =>
        cleanText(cells.eq(cols[key] ?? fallback).text());
      const postiDisponibili = parseIntSafe(at("postiDisponibili", 2));
      const stato = parseStato(at("stato", 5), postiDisponibili);
      out.push({
        codice: at("codice", 0) || null,
        insegnamento: at("insegnamento", 1) || null,
        data: parseDateIt(at("data", 1)),
        postiDisponibili,
        postiTotali: null,
        iscritti: parseIntSafe(at("iscritti", 4)),
        stato,
      });
    });
  return out;
}
