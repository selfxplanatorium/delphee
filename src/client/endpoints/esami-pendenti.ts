import { load, cleanText, parseRiepilogoHeader, parseDateIt, parseFloatSafe, parseIntSafe } from "./util.js";
import type { EsamiPendentiResponse, EsamePendente, CarrieraHeader } from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for studenti/esami/esamiPendenti.jsp. Same riepilogo header as
// carriera/verbali, 9 columns (N., Esame, SSD, AA, Data, Crediti, Esito,
// Voto, N. verbale). Empty state is a single row "Non ci sono esami in corso
// di verbalizzazione" — we surface that as an empty array so the client can
// render the same empty-state UI as the other list views.

function rowToEsame($: CheerioAPI, tr: any): EsamePendente | null {
  const $tr = $(tr);
  const cells = $tr.find("td.esamidispari, td.esamipari");
  if (cells.length < 9) return null;
  const at = (i: number) => cleanText(cells.eq(i).text());
  const esameCell = at(1);
  const codiceMatch = esameCell.match(/^(\d{6,9})\s+(.+)$/);
  return {
    numero: parseIntSafe(at(0)),
    codice: codiceMatch?.[1] ?? null,
    nome: (codiceMatch?.[2] ?? esameCell) || null,
    ssd: at(2) || null,
    annoAccademico: at(3).match(/(\d{4}\/\d{4})/)?.[1] ?? null,
    data: parseDateIt(at(4)),
    cfu: parseFloatSafe(at(5)),
    esito: at(6) || null,
    voto: at(7) || null,
    verbale: at(8) || null,
  };
}

export function parse(html: string): EsamiPendentiResponse {
  const $ = load(html);
  const header: CarrieraHeader = parseRiepilogoHeader($);
  const esami: EsamePendente[] = [];
  $("tr").each((_, tr) => {
    if ($(tr).find("td.esamidispari, td.esamipari").length < 9) return;
    const e = rowToEsame($, tr);
    if (e) esami.push(e);
  });
  return { header, esami };
}
