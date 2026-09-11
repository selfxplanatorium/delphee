import { load, cleanText, parseRiepilogoHeader, parseDateIt, parseFloatSafe, parseIntSafe } from "./util.js";
import type {
  CarrieraResponse,
  Rendimento,
  Esame,
  Voto,
  Stato,
} from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for esamiVerbalizzati.jsp. Three logical blocks inside one table:
// a riepilogo header (studente/matricola/CDL), the esami grid (data rows carry
// td.esamidispari/td.esamipari), and a rendimento riepilogo at the bottom. The
// voto cell does the most work — Delphi mixes numeric grades, "30 E LODE",
// idoneità qualifiers, language-exam partials, and failure markers that
// sometimes land in the adjacent note column.

const PARTIAL_QUALIFIERS = ["OTTIMO", "BUONO", "DISTINTO", "DISCRETO", "SUFFICIENTE"];
const IDONEO = ["IDONEO", "APPROVATO", "PASS"];
const FAILED = ["RITIRATO", "RESPINTO", "BOCCIATO", "ASSENTE", "INSUFFICIENTE"];

function parseRendimento($: CheerioAPI): Rendimento {
  let text = "";
  $("td.riepilogo").each((_, el) => {
    const t = cleanText($(el).text());
    if (/Esami validi/i.test(t)) text = t;
  });
  const num = (re: RegExp): number | null => parseIntSafe(text.match(re)?.[1] ?? null);
  const flt = (re: RegExp): number | null => parseFloatSafe(text.match(re)?.[1] ?? null);
  return {
    esamiValidi: num(/Esami validi:\s*(\d+)/i),
    cfuEsamiValidi: num(/CFU Esami validi:\s*(\d+)/i),
    idoneita: num(/Idoneit[àa]:\s*(\d+)/i),
    cfuIdoneita: num(/CFU Idoneit[àa]:\s*(\d+)/i),
    mediaAritmetica: flt(/Media aritmetica:\s*([\d.,]+)/i),
    mediaPonderata: flt(/Media ponderata:\s*([\d.,]+)/i),
  };
}

export function parseVoto(
  votoRaw: string,
  noteRaw: string,
  cfu: number | null,
): { voto: Voto; votoLabel: string | null; stato: Stato; isPartial: boolean } {
  const voto = cleanText(votoRaw).toUpperCase();
  const note = cleanText(noteRaw).toUpperCase();
  const combined = `${voto} ${note}`;

  if (FAILED.some((f) => combined.includes(f))) {
    return { voto: null, votoLabel: null, stato: "non_superato", isPartial: false };
  }
  if (/30\s*E\s*LODE|30L/.test(voto)) {
    return {
      voto: { tipo: "trentesimi", valore: 30, lode: true },
      votoLabel: "30 e lode",
      stato: "superato",
      isPartial: false,
    };
  }
  const trent = voto.match(/^(\d{1,2})\s*\/\s*30$/) ?? voto.match(/^(\d{1,2})$/);
  if (trent) {
    const v = Number.parseInt(trent[1]!, 10);
    if (v >= 18 && v <= 30) {
      return {
        voto: { tipo: "trentesimi", valore: v, lode: false },
        votoLabel: `${v}/30`,
        stato: "superato",
        isPartial: false,
      };
    }
  }
  if (IDONEO.some((q) => voto.includes(q))) {
    return {
      voto: { tipo: "qualifica", valore: "IDONEO" },
      votoLabel: "IDONEO",
      stato: "idoneo",
      isPartial: false,
    };
  }
  // Giudizio grades (OTTIMO/BUONO/…) are a PASSING result — Delphi shows a
  // failed judgment as INSUFFICIENTE/RESPINTO, caught by FAILED above. So these
  // are superato, not in-progress; they carry no trentesimi voto and usually no
  // CFU, but the exam is done.
  const giudizio = PARTIAL_QUALIFIERS.find((q) => voto.includes(q));
  if (giudizio) {
    return {
      voto: { tipo: "qualifica", valore: giudizio },
      votoLabel: giudizio,
      stato: "superato",
      isPartial: false,
    };
  }
  if (voto === "") {
    return { voto: null, votoLabel: null, stato: "in_corso", isPartial: cfu === null };
  }
  return {
    voto: { tipo: "qualifica", valore: voto },
    votoLabel: cleanText(votoRaw),
    stato: "in_corso",
    isPartial: false,
  };
}

function rowToEsame($: CheerioAPI, tr: any): Esame | null {
  const $tr = $(tr);
  const cells = $tr.find("td.esamidispari, td.esamipari");
  if (cells.length < 7) return null;

  const cellText = (i: number): string => cleanText(cells.eq(i).text());

  const esameCell = cellText(1);
  const codiceMatch = esameCell.match(/^(\d{6,9})\s+(.+)$/);
  const codice = codiceMatch?.[1] ?? null;
  const nome = codiceMatch?.[2] ?? esameCell;

  let aa: string | null = cellText(3).match(/(\d{4}\/\d{4})/)?.[1] ?? null;
  if (!aa) {
    // TIROCINIO and similar inline the "riconosciuto da" cells; scan later cells.
    for (let i = 10; i < cells.length; i++) {
      const m = cellText(i).match(/(\d{4}\/\d{4})/);
      if (m) { aa = m[1]!; break; }
    }
  }

  const cfu = parseFloatSafe(cellText(5));
  const { voto, votoLabel, stato, isPartial } = parseVoto(cellText(6), cellText(7), cfu);
  const verbaleRaw = cellText(9);
  const verbale = /^[-\s]*$|^---$/.test(verbaleRaw) ? null : verbaleRaw || null;
  const note = cellText(7);

  return {
    numero: parseIntSafe(cellText(0)),
    codice,
    nome,
    ssd: cellText(2) || null,
    annoAccademico: aa,
    data: parseDateIt(cellText(4)),
    cfu,
    voto,
    votoLabel,
    note: note && note !== "" ? note : null,
    tipoAttivita: cellText(8) || null,
    verbale,
    stato,
    isPartial,
  };
}

export function parse(html: string): CarrieraResponse {
  const $ = load(html);
  // Data rows are marked by td.esamidispari/td.esamipari; the column-header row
  // (td.tabella1) and the riepilogo blocks live in the same table, so we select
  // the data rows directly rather than trying to identify "the esami table".
  const esami: Esame[] = [];
  $("tr").each((_, tr) => {
    if ($(tr).find("td.esamidispari, td.esamipari").length < 7) return;
    const e = rowToEsame($, tr);
    if (e) esami.push(e);
  });
  return { header: parseRiepilogoHeader($), esami, rendimento: parseRendimento($) };
}
