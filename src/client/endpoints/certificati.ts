import { load, cleanText, orNull, textWithBreaks } from "./util.js";
import type {
  CertificatiResponse,
  Certificato,
  CertificatiStudente,
} from "../../types.js";
import type { CheerioAPI } from "cheerio";

// Parser for stampaCertificati/preIndexCertificati.jsp (after its 302 to
// indexCertificati.jsp). A td.text/td.dati student block, a <ul> of certificate
// links, and an "Attenzione…" limit note whose <br> line breaks must be
// preserved as spaces.

function parseStudente($: CheerioAPI): CertificatiStudente {
  const fields = new Map<string, string>();
  $("td.text").each((_, td) => {
    const label = cleanText($(td).text()).toLowerCase();
    const value = $(td).nextAll("td.dati").first();
    if (label && value.length) fields.set(label, cleanText(value.text()));
  });
  const g = (k: string) => orNull(fields.get(k) ?? null);
  return {
    cognome: g("cognome"),
    nome: g("nome"),
    matricola: g("matricola"),
    corso: g("corso"),
    tipologiaCorso: g("tipologia corso"),
    codiceCorso: g("codice corso"),
  };
}

function parseLista($: CheerioAPI): Certificato[] {
  const out: Certificato[] = [];
  $("ul li a, ol li a").each((_, a) => {
    const $a = $(a);
    const nome = cleanText($a.text());
    const href = $a.attr("href") ?? "";
    if (!nome) return;
    if (!/cert/i.test(href) && !/cert/i.test(nome)) return;

    const [path, query] = href.split("?");
    const parametri: Record<string, string> = {};
    if (query) {
      for (const [k, v] of new URLSearchParams(query)) parametri[k] = v;
    }
    out.push({ nome, path: path || null, parametri });
  });
  return out;
}

function parseLimite($: CheerioAPI): string | null {
  let note: string | null = null;
  $("td.text").each((_, td) => {
    if (note) return;
    const t = cleanText($(td).text());
    if (/attenzione/i.test(t) && /certificat/i.test(t)) {
      note = textWithBreaks($(td));
    }
  });
  return note;
}

export function parse(html: string): CertificatiResponse {
  const $ = load(html);
  return {
    studente: parseStudente($),
    certificati: parseLista($),
    limiteNote: parseLimite($),
  };
}
