import { load, cleanText, orNull, parseDateIt, parseIntSafe } from "./util.js";
import type { Anagrafica, Indirizzo, Laurea } from "../../types.js";

// Parser for datiStudente.jsp. The page is one big table whose rows alternate
// between section headers (td.boxsfondotabella) and label/value pairs
// (td.text + td.dati). We bucket values by section because the same label
// ("Indirizzo", "Comune", "Provincia", "CAP") repeats across Residenza and
// Domicilio. The laurea / stato-carriera info lives on the post-login dashboard,
// not this page, so it's parsed separately and merged in by the Api.

type Sections = Map<string, Map<string, string>>;

function sectionKey(raw: string): string {
  // "Residenza ( eletto a recapito postale )" → "residenza"
  return cleanText(raw.split("(")[0] ?? raw).toLowerCase();
}

function parseSections(html: string): Sections {
  const $ = load(html);
  const sections: Sections = new Map();
  let current: Map<string, string> | null = null;

  $("table.tabelladatipersonali tr").each((_, tr) => {
    const $tr = $(tr);
    const header = $tr.find("td.boxsfondotabella").first();
    if (header.length) {
      const clone = header.clone();
      clone.find("a").remove(); // strip the "Modifica" link
      const key = sectionKey(clone.text());
      current = new Map();
      sections.set(key, current);
      return;
    }
    const label = $tr.find("td.text").first();
    if (label.length && current) {
      const value = label.nextAll("td.dati").first();
      const k = cleanText(label.text());
      if (k) current.set(k.toLowerCase(), cleanText(value.text()));
    }
  });
  return sections;
}

function get(sections: Sections, section: string, label: string): string | null {
  const v = sections.get(section)?.get(label.toLowerCase());
  return v == null ? null : orNull(v);
}

function buildIndirizzo(sections: Sections, key: string): Indirizzo {
  return {
    indirizzo: get(sections, key, "Indirizzo"),
    comune: get(sections, key, "Comune"),
    provincia: get(sections, key, "Provincia"),
    cap: get(sections, key, "CAP"),
    telefono: get(sections, key, "Telefono"),
  };
}

export function parse(html: string, baseUrl: string): Anagrafica {
  const sections = parseSections(html);
  const $ = load(html);

  const fotoSrc = $("table.tabelladatipersonali img").first().attr("src") ?? null;
  const fotoUrl = fotoSrc ? new URL(fotoSrc, baseUrl).toString() : null;

  const aaUltimaRaw = get(sections, "carriera universitaria", "AA ultima iscrizione");
  const aaUltima = aaUltimaRaw?.match(/(\d{4}\/\d{4})/)?.[1] ?? aaUltimaRaw ?? null;
  const annoCorsoLabel = get(sections, "carriera universitaria", "Anno di Corso");

  return {
    cognome: get(sections, "anagrafica", "Cognome"),
    nome: get(sections, "anagrafica", "Nome"),
    codiceFiscale: get(sections, "anagrafica", "Codice Fiscale"),
    dataNascita: parseDateIt(get(sections, "anagrafica", "Data di Nascita")),
    comuneNascita: get(sections, "anagrafica", "Comune di Nascita"),
    provinciaNascita: get(sections, "anagrafica", "Provincia"),
    nazioneCittadinanza: get(sections, "anagrafica", "Nazione di cittadinanza"),
    cellulare: get(sections, "anagrafica", "Cellulare"),
    email: get(sections, "anagrafica", "E-Mail"),
    skype: get(sections, "anagrafica", "Skype"),
    residenza: buildIndirizzo(sections, "residenza"),
    domicilio: buildIndirizzo(sections, "domicilio"),
    matricola: get(sections, "carriera universitaria", "Matricola"),
    facolta: get(sections, "carriera universitaria", "Facoltà"),
    corso: get(sections, "carriera universitaria", "Corso"),
    tipologiaCorso: get(sections, "carriera universitaria", "Tipologia Corso"),
    sedeCorso: get(sections, "carriera universitaria", "Sede del Corso"),
    codiceCorso: get(sections, "carriera universitaria", "Codice Corso"),
    annoCorso: parseIntSafe(annoCorsoLabel),
    annoCorsoLabel,
    aaImmatricolazione: get(sections, "carriera universitaria", "AA immatricolazione"),
    aaUltimaIscrizione: aaUltima,
    statoCarriera: null, // filled from the dashboard
    laurea: null, // filled from the dashboard
    fotoUrl,
  };
}

// The post-login dashboard ("Dati carriera" cell) carries the career state and,
// for graduates, the laurea details. Returns nulls for active students whose
// dashboard has no such cell.
export function parseDashboardCarriera(html: string): {
  statoCarriera: string | null;
  laurea: Laurea | null;
} {
  const $ = load(html);
  const text = cleanText($("body").text());

  let laurea: Laurea | null = null;
  const m = text.match(
    /Conseguita\s+(?:laurea[^.]*?)\s+in\s+(.+?)\s+in data\s+(\d{1,2}\/\d{1,2}\/\d{4})(?:\s+con la votazione di\s+([\d/]+|[\d]+ e lode|[\dL/]+))?/i,
  );
  if (m) {
    laurea = {
      corso: orNull(m[1]),
      data: parseDateIt(m[2]),
      votazione: orNull(m[3] ?? null),
    };
  }

  // The "Carriera studente conclusa/in corso" phrase is static boilerplate on
  // BOTH login landing pages, so it's present for active students too and can't
  // be trusted. A career is concluded only when a completed laurea (with a
  // graduation date) is actually present.
  const statoCarriera = laurea ? "Carriera studente conclusa" : null;

  return { statoCarriera, laurea };
}
