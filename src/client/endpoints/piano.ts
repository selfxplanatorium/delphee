import { load, cleanText, parseFloatSafe } from "./util.js";
import type { Piano, PianoEsame } from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for studenti/pianoDiStudi/index.jsp. This page is a Delphi wrapper
// around GOMP 2010 (ASP.NET); on our accounts it SSO-redirects to GOMP and
// 404s, so in practice the wrapper returns an empty piano plus a composerUrl
// the SPA opens in the portal. The table parser stays here for accounts where
// Delphi does render the static piano listing.

const CDL_SELECTORS = ["span#cdl", "span.cdl", "div.header-cdl", "td.cdl"];
const ANNO_SELECTORS = ["span#anno", "span.anno", "td.anno"];

function firstText($: CheerioAPI, selectors: string[]): string | null {
  for (const sel of selectors) {
    const t = cleanText($(sel).first().text());
    if (t) return t;
  }
  return null;
}

function parseStato(raw: string): PianoEsame["stato"] {
  const t = raw.toLowerCase();
  if (t.includes("superat")) return "superato";
  if (t.includes("corso")) return "in_corso";
  return "da_fare";
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
    const hasCodice = headers.some((h) => h.includes("codice"));
    const hasNome = headers.some(
      (h) => h.includes("insegnamento") || h.includes("nome") || h.includes("materia"),
    );
    if (hasCodice && hasNome) found = table;
  });
  return found;
}

export function parse(html: string, composerUrl: string | null = null): Piano {
  const $ = load(html);
  const esami: PianoEsame[] = [];
  const table = findTable($);
  if (table) {
    $(table)
      .find("tr")
      .slice(1)
      .each((_, tr) => {
        const cells = $(tr).find("td");
        if (cells.length < 3) return;
        const codice = cleanText(cells.eq(0).text()) || null;
        const nome = cleanText(cells.eq(1).text());
        if (!nome) return;
        esami.push({
          codice,
          nome,
          cfu: parseFloatSafe(cells.eq(2).text()),
          annoCorso: cleanText(cells.eq(3).text()) || null,
          stato: parseStato(cleanText(cells.last().text())),
          ssd: null,
          taf: null,
          gruppo: null,
        });
      });
  }
  return {
    cdl: firstText($, CDL_SELECTORS),
    annoCorso: firstText($, ANNO_SELECTORS),
    esami,
    piani: [], // static Delphi listing has no GOMP grid
    composerUrl,
    esamiDa: null,
  };
}
