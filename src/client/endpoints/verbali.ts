import { load, cleanText, parseRiepilogoHeader, parseDateIt, parseFloatSafe } from "./util.js";
import type { VerbaliResponse, Verbale, CarrieraHeader } from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for studenti/esami/verbaliNonChiusi.jsp. The page reuses the esami
// table layout (riepilogo header + tabella1 column labels + esamidispari rows)
// but with 7 columns (N., Esame, Docente, AA, Data, Crediti, N. verbale).
// "Docente" carries a "Prof." prefix; the verbale number is alphanumeric
// (e.g. "LETT-1234567") and never null.

const DOCENTE_PREFIX = /^prof\.\s*/i;

function rowToVerbale($: CheerioAPI, tr: any): Verbale | null {
  const $tr = $(tr);
  const cells = $tr.find("td.esamidispari, td.esamipari");
  if (cells.length < 7) return null;
  const at = (i: number) => cleanText(cells.eq(i).text());
  const docenteRaw = at(2);
  const docente = docenteRaw.replace(DOCENTE_PREFIX, "").trim() || null;
  return {
    numero: parseIntSafe(at(0)),
    nome: at(1) || null,
    docente,
    annoAccademico: at(3).match(/(\d{4}\/\d{4})/)?.[1] ?? null,
    data: parseDateIt(at(4)),
    cfu: parseFloatSafe(at(5)),
    verbale: at(6) || null,
  };
}

function parseIntSafe(s: string): number | null {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

export function parse(html: string): VerbaliResponse {
  const $ = load(html);
  const header: CarrieraHeader = parseRiepilogoHeader($);
  const verbali: Verbale[] = [];
  $("tr").each((_, tr) => {
    if ($(tr).find("td.esamidispari, td.esamipari").length < 7) return;
    const v = rowToVerbale($, tr);
    if (v) verbali.push(v);
  });
  return { header, verbali };
}
