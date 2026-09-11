import { load, cleanText, orNull, parseDateIt, parseFloatSafe } from "./util.js";
import type {
  SituazioneTasse,
  TasseStudente,
  IscrizioneSummary,
  AnnoTasse,
  Rata,
  Bollettino,
  AltroBollettino,
  RicevutaRef,
} from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for situazioneRateNew.jsp — the gnarliest page. Per anno accademico:
// an "AA YYYY/YYYY + Isee" header, a rata header/data pair, then a row holding a
// nested bollettino table whose first data row spans (rowspan) the dettaglio
// lines and carries the ricevuta form fields. We walk the OUTER table's direct
// rows as a small state machine (current anno / current rata) because the
// rowspans make pure sibling-hopping fragile.

function parseStudente($: CheerioAPI): TasseStudente {
  const fields = new Map<string, string>();
  $("table#adempi td.intesta").each((_, td) => {
    const label = cleanText($(td).text()).toLowerCase().replace(/:$/, "");
    const value = $(td).nextAll("td.cella").first();
    if (label && value.length) fields.set(label, cleanText(value.text()));
  });
  return {
    matricola: orNull(fields.get("matricola") ?? null),
    nome: orNull(fields.get("nome") ?? null),
    cognome: orNull(fields.get("cognome") ?? null),
  };
}

function parseIscrizione($: CheerioAPI): IscrizioneSummary {
  const cell = $("td.msggenerico").first();
  const text = cleanText(cell.find("h3").first().text() || cell.text());
  if (!text) return { anno: null, tipo: null, messaggio: null };
  const anno = text.match(/(\d{4}\/\d{4})/)?.[1] ?? null;
  const tipo = text.match(/\(([A-Z][A-Z\s]{2,})\)/)?.[1]?.trim() ?? null;
  let messaggio = text.split(":").slice(1).join(":").trim();
  messaggio = messaggio
    .replace(/\([A-Z][A-Z\s]{2,}\)/, "")
    .replace(/\s*\((?:Si ricorda|Nota|Per)[^]*?\)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return { anno, tipo, messaggio: messaggio || null };
}

function rowCells($: CheerioAPI, tr: any) {
  return $(tr).children("td");
}

function isAaRow($: CheerioAPI, tr: any): RegExpMatchArray | null {
  const txt = cleanText($(tr).text());
  return txt.match(/^AA\s+(\d{4}\/\d{4})/);
}

function isRataHeader($: CheerioAPI, tr: any): boolean {
  const txt = cleanText($(tr).text()).toUpperCase();
  return txt.includes("RATA") && txt.includes("VOCI DA SALDARE");
}

function parseBollettini($: CheerioAPI, nestedTable: any): Bollettino[] {
  const out: Bollettino[] = [];
  const convalidato = /Convalidato con pagoPA/i.test($(nestedTable).text());
  const dettaglio: string[] = [];

  // The primary data row carries the spanning cells (importo/causale/data/IUV)
  // and the optional ricevuta form; following rows add dettaglio lines.
  let primary: any = null;
  $(nestedTable).find("tr").each((_, tr) => {
    const cells = $(tr).find("td.esamipari");
    const hasForm = $(tr).find("form").length > 0;
    if (!primary && (hasForm || cells.length >= 5)) primary = tr;
    // collect dettaglio "Voce: € N" lines wherever they appear
    $(tr).find("td.esamipari div[align='left']").each((_, d) => {
      const t = cleanText($(d).text());
      if (t && t.includes(":")) dettaglio.push(t);
    });
  });
  if (!primary) return out;

  const form = $(primary).find("form").first();
  let ricevuta: RicevutaRef | null = null;
  if (form.length) {
    const inp = (name: string) =>
      orNull(form.find(`input[name='${name}']`).attr("value") ?? null);
    ricevuta = { bollettinoId: inp("bollettinoId"), rataId: inp("rataId"), aa: inp("AA") };
  }

  const cells = $(primary).find("td.esamipari");
  // cells: [numero, importo, causale, dataPagamento, IUV, (dettaglio)]
  const numero = cleanText(cells.eq(0).text()).replace(/\s+/g, " ").trim() || null;
  const importo = parseFloatSafe(cleanText(cells.eq(1).text()).replace("*", ""));
  const causale = orNull(cells.eq(2).text());
  const dataPagamento = parseDateIt(cells.eq(3).text());
  const iuv = orNull(cells.eq(4).text());

  out.push({
    numero,
    importo,
    causale,
    dataPagamento,
    iuv,
    dettaglio,
    convalidatoPagoPa: convalidato,
    ricevuta,
  });
  return out;
}

function parseAnni($: CheerioAPI): AnnoTasse[] {
  // Find the outer table that holds the AA sections.
  let outer: any = null;
  $("td.intesta").each((_, td) => {
    if (outer) return;
    if (/^AA\s+\d{4}\/\d{4}/.test(cleanText($(td).text()))) {
      outer = $(td).closest("table").get(0);
    }
  });
  if (!outer) return [];

  const anni: AnnoTasse[] = [];
  let anno: AnnoTasse | null = null;
  let rata: Rata | null = null;
  let expectRataData = false;

  $(outer).children("tbody").children("tr").addBack("tr").each((_, tr) => {
    const aa = isAaRow($, tr);
    if (aa) {
      const txt = cleanText($(tr).text());
      anno = { anno: aa[1]!, isee: txt.match(/Isee:\s*([^\s<]+)/i)?.[1] ?? null, rate: [] };
      anni.push(anno);
      rata = null;
      expectRataData = false;
      return;
    }
    if (!anno) return;

    if (isRataHeader($, tr)) {
      expectRataData = true;
      return;
    }
    if (expectRataData) {
      const cells = rowCells($, tr).filter((_, td) => $(td).hasClass("esamipari"));
      if (cells.length >= 4) {
        rata = {
          numero: orNull(cells.eq(0).text()),
          importo: parseFloatSafe(cells.eq(1).text()),
          scadenza: parseDateIt(cells.eq(2).text()),
          saldato: /^si$/i.test(cleanText(cells.eq(3).text())),
          bollettini: [],
        };
        anno.rate.push(rata);
        expectRataData = false;
      }
      return;
    }
    // a row holding a nested bollettino table → attach to the current rata
    const nested = $(tr).find("table").get(0);
    if (nested && rata) {
      rata.bollettini.push(...parseBollettini($, nested));
    }
  });

  return anni;
}

function parseAltri($: CheerioAPI): AltroBollettino[] {
  let h3: any = null;
  $("h3").each((_, el) => {
    if (h3) return;
    if (/Altre tipologie di bollettino/i.test(cleanText($(el).text()))) h3 = el;
  });
  if (!h3) return [];
  const table = $(h3).closest("table").next("table");
  if (!table.length) return [];

  const out: AltroBollettino[] = [];
  table.find("tr").each((i, tr) => {
    const cells = $(tr).find("td");
    if (cells.length < 7) return;
    if (cells.filter((_, td) => $(td).hasClass("intesta")).length) return; // header
    const form = $(tr).find("form").first();
    let ricevuta: RicevutaRef | null = null;
    if (form.length) {
      const inp = (n: string) => orNull(form.find(`input[name='${n}']`).attr("value") ?? null);
      ricevuta = { bollettinoId: inp("bollettinoId"), rataId: inp("rataId"), aa: inp("AA") };
    }
    const text = (n: number) => cleanText(cells.eq(n).text());
    out.push({
      causale: orNull(text(0)),
      importo: parseFloatSafe(text(1)),
      dataPagamento: parseDateIt(text(2)),
      pagato: /si/i.test(text(3)),
      annoAccademico: text(6).match(/(\d{4}\/\d{4})/)?.[1] ?? null,
      descrizione: orNull(text(7)),
      iuv: orNull(text(8)),
      ricevuta,
    });
  });
  return out;
}

export function parse(html: string): SituazioneTasse {
  const $ = load(html);
  return {
    studente: parseStudente($),
    iscrizione: parseIscrizione($),
    anni: parseAnni($),
    altriBollettini: parseAltri($),
  };
}
