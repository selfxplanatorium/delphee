import { load, cleanText, parseDateIt, parseIntSafe } from "./util.js";
import type { AppelloCalendario } from "../../types.js";

// Parser for the calendarioEsami.jsp search results. Delphi renders one table
// where the six group columns (denominazione…docente) span all the appello
// rows of an insegnamento via rowspan; continuation rows carry only the 9
// per-appello cells. We track the open group and emit one flat row per
// appello. The "Attivo" column is a traffic-light gif: green = prenotazioni
// aperte, red = chiuse, yellow = in transizione (→ sconosciuto).

const STATO_BY_GIF: Record<string, AppelloCalendario["stato"]> = {
  "green.gif": "aperto",
  "red.gif": "chiuso",
};

export function parse(html: string): AppelloCalendario[] {
  const $ = load(html);
  // The results table is the one whose header cells name "Denominazione".
  const table = $("table")
    .filter((_, t) =>
      $(t)
        .find("td.tabella1")
        .toArray()
        .some((c) => cleanText($(c).text()).includes("Denominazione")),
    )
    .first();
  if (!table.length) return [];

  const out: AppelloCalendario[] = [];
  let group: Omit<AppelloCalendario, "sessione" | "appello" | "dataEsame" | "ora" | "aula" | "inizioPrenotazione" | "finePrenotazione" | "stato"> | null =
    null;

  table
    .find("tr")
    .slice(1) // skip header
    .each((_, tr) => {
      const cells = $(tr).find("td");
      if (cells.length < 9) return;
      let off = 0;
      if (cells.toArray().some((c) => $(c).attr("rowspan"))) {
        const href = cells.eq(0).find("a").attr("href") ?? "";
        group = {
          insegnamento: cleanText(cells.eq(0).text()),
          idCorIns: href.match(/idCorIns=(\d+)/)?.[1] ?? null,
          cfu: parseIntSafe(cells.eq(1).text()),
          codice: cleanText(cells.eq(2).text()) || null,
          canale: cleanText(cells.eq(4).text()) || null,
          docente: cleanText(cells.eq(5).text()) || null,
        };
        off = 6;
      }
      if (!group) return;
      const at = (i: number) => cleanText(cells.eq(off + i).text());
      const gif = cells.eq(off).find("img").attr("src")?.split("/").pop() ?? "";
      out.push({
        ...group,
        sessione: at(1) || null,
        appello: at(2) || null,
        dataEsame: parseDateIt(at(3)),
        inizioPrenotazione: parseDateIt(at(4)),
        finePrenotazione: parseDateIt(at(5)),
        ora: at(6) || null,
        aula: at(7) || null,
        stato: STATO_BY_GIF[gif] ?? "sconosciuto",
      });
    });
  return out;
}
