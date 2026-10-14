import { load, cleanText, orNull, parseFloatSafe } from "./util.js";
import type { InfoInsegnamento, ModuloInsegnamento } from "../../types.js";
import type { Cheerio } from "cheerio";

// Parser for prenotazioni/infoEsame.jsp (calendarioEsami.jsp?info=si&idCorIns=N
// redirects there): the syllabus of one course. Label/value rows (td.text +
// td.dati) in document order. Courses with modules add a header row per module
// (one td.text colspan=2: "NOME<br>6.0 cfu<br>SSD<br>DOCENTE") followed by its
// own Programma row; courses without modules have a single Programma row.
// Values come as plain text, a readonly <textarea>, or, for the programme,
// an <iframe srcdoc> holding HTML.

const NON_INDICATO = /^non indicato$/i;

function valueText($cell: Cheerio<any>): string | null {
  const area = $cell.find("textarea");
  if (area.length) return blockText(area.text());
  const srcdoc = $cell.find("iframe").attr("srcdoc");
  if (srcdoc !== undefined) {
    const $doc = load(srcdoc);
    const paras = $doc("p").toArray().map((p) => $doc(p).text());
    return blockText(paras.length ? paras.join("\n") : $doc.root().text());
  }
  return blockText($cell.text());
}

// Keeps line breaks (the syllabus is multi-line prose), trims each line, and
// maps Delphi's "Non Indicato" placeholder to null. Not cleanText: that one
// strips a trailing colon, which is right for labels and wrong for prose.
function blockText(s: string): string | null {
  const text = s
    .split("\n")
    .map((l) => l.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return text && !NON_INDICATO.test(text) ? text : null;
}

export function parse(html: string): InfoInsegnamento {
  const $ = load(html);
  const info: InfoInsegnamento = {
    obiettivi: null,
    prerequisiti: null,
    metodiInsegnamento: null,
    metodiValutazione: null,
    programma: null,
    moduli: [],
  };
  let modulo: ModuloInsegnamento | null = null;

  $("tr").each((_, tr) => {
    const label = $(tr).children("td.text").first();
    if (!label.length) return;
    if (label.attr("colspan") === "2") {
      const parts = (label.html() ?? "").split(/<br\s*\/?>/i).map((x) => orNull(load(x).root().text()));
      modulo = {
        nome: parts[0] ?? null,
        cfu: parseFloatSafe(parts[1]),
        ssd: parts[2] ?? null,
        docente: parts[3] ?? null,
        programma: null,
      };
      info.moduli.push(modulo);
      return;
    }
    const value = $(tr).children("td.dati").first();
    if (!value.length) return;
    const text = valueText(value);
    switch (cleanText(label.text()).toLowerCase()) {
      case "obiettivi": info.obiettivi = text; break;
      case "prerequisiti": info.prerequisiti = text; break;
      case "metodi di insegnamento": info.metodiInsegnamento = text; break;
      case "metodi di valutazione": info.metodiValutazione = text; break;
      case "programma":
        if (modulo) modulo.programma = text;
        else info.programma = text;
        break;
    }
  });
  return info;
}
