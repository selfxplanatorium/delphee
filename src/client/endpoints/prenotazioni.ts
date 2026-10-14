import { load, cleanText, orNull, parseDateIt, parseFloatSafe } from "./util.js";
import type {
  Prenotazione,
  PrenotazioniResponse,
  PrenotazioneDettaglio,
  ModuloPrenotazione,
} from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parsers for the prenotazioni area (Prenotazione esami → Visualizza o
// Cancella Prenotazioni).
//
// visualizzaPrenotazioni.jsp: one row per booking, 17 cells: Insegnamento,
// CFU, Codice verbalizzazione, Codice anagrafico, Docente, AA, Tipologia, Fine
// prenotazione, Data esame, Appello, Numero prenotati ("2 su 4" = your place
// in the list), Sede, Turno, Attiva (green/red gif), blank, numero verbale,
// and a form with the hidden fields that address the booking for Dettagli /
// Ristampa. The empty state is a single "Non risultano prenotazioni" message.
//
// dettagliPrenotazione (the Dettagli POST response): label/value rows
// (td.text + td.dati) plus a nested table of the course's moduli.

function rowToPrenotazione($: CheerioAPI, tr: any): Prenotazione | null {
  const cells = $(tr).children("td.esamidispari, td.esamipari");
  if (cells.length < 16) return null;
  const at = (i: number) => cleanText(cells.eq(i).text());
  const posti = at(10).match(/(\d+)\s*su\s*(\d+)/i);
  const form = $(tr).find("form").first();
  const hidden = (name: string) => form.find(`input[name="${name}"]`).attr("value")?.trim() ?? "";
  const id = hidden("idPrenotazioneSeguita");
  return {
    insegnamento: orNull(at(0)),
    cfu: parseFloatSafe(at(1)),
    codice: orNull(at(2)),
    docente: orNull(at(4)),
    annoAccademico: at(5).match(/(\d{4}\/\d{4})/)?.[1] ?? null,
    tipologia: orNull(at(6)),
    finePrenotazione: parseDateIt(at(7)),
    dataEsame: parseDateIt(at(8)),
    appello: orNull(at(9)),
    posizione: posti ? Number(posti[1]) : null,
    prenotati: posti ? Number(posti[2]) : null,
    sede: orNull(at(11)),
    turno: orNull(at(12)),
    attiva: /green\.gif/i.test(cells.eq(13).html() ?? ""),
    verbale: orNull(at(15)),
    ref: /^\d+$/.test(id)
      ? { id, index: hidden("indexPrenotazione"), ordine: hidden("ordine") }
      : null,
  };
}

export function parse(html: string): PrenotazioniResponse {
  const $ = load(html);
  const prenotazioni: Prenotazione[] = [];
  $("tr").each((_, tr) => {
    const p = rowToPrenotazione($, tr);
    if (p) prenotazioni.push(p);
  });
  return { prenotazioni };
}

export function parseDettaglio(html: string): PrenotazioneDettaglio {
  const $ = load(html);
  const fields = new Map<string, string>();
  $("tr").each((_, tr) => {
    const label = $(tr).children("td.text").first();
    const value = $(tr).children("td.dati").first();
    if (!label.length || !value.length) return;
    fields.set(cleanText(label.text()).toLowerCase(), cleanText(value.text()));
  });
  const get = (...labels: string[]) => {
    for (const l of labels) {
      const v = fields.get(l);
      if (v !== undefined) return orNull(v);
    }
    return null;
  };

  const moduli: ModuloPrenotazione[] = [];
  $("td.tabella1").first().closest("table").find("tr").each((_, tr) => {
    const cells = $(tr).children("td.dati");
    if (cells.length < 4) return;
    const at = (i: number) => cleanText(cells.eq(i).text());
    moduli.push({ nome: orNull(at(0)), docente: orNull(at(1)), ssd: orNull(at(2)), cfu: parseFloatSafe(at(3)) });
  });

  return {
    insegnamento: get("insegnamento"),
    docente: get("docente"),
    annoAccademico: get("anno accademico"),
    dataEsame: parseDateIt(get("data esame")),
    orario: get("orario"),
    inizioPrenotazione: parseDateIt(get("inizio prenotazione")),
    finePrenotazione: parseDateIt(get("fine prenotazione")),
    modalita: get("modalità"),
    tipologia: get("tipologia"),
    appello: get("appello"),
    // Delphi leaks an untranslated i18n key as the session label.
    sessione: get("sessione", "lab.prenotdettpren.sessione"),
    edificio: get("edificio"),
    aula: get("aula"),
    comunicazioni: get("comunicazioni"),
    numeroPrenotazione: get("numero prenotazione"),
    moduli,
  };
}
