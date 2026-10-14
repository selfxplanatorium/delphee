import { load, cleanText, orNull } from "./util.js";
import type { AutorizzazioneIsee, IseeResponse } from "../../types.js";

// Parser for studenti/autorizzaAccessoInps/autorizzazione.jsp ("Acquisizione
// Isee-Università"). Only the "Elenco autorizzazioni presentate" table is read:
// one esamidispari/esamipari row per academic year with 9 cells (AA,
// autorizzazione, data, stato elaborazione, ultimo accesso INPS, errore INPS,
// data elaborazione, protocollo, "visualizza" link). The header row uses the
// same classes, so rows are selected by an AA value in the first cell.

export function parse(html: string): IseeResponse {
  const $ = load(html);
  const autorizzazioni: AutorizzazioneIsee[] = [];
  $("tr").each((_, tr) => {
    const cells = $(tr).children("td.esamidispari, td.esamipari");
    if (cells.length < 8) return;
    const at = (i: number) => cleanText(cells.eq(i).text());
    const aa = at(0).match(/^(\d{4}\/\d{4})$/)?.[1];
    if (!aa) return;
    autorizzazioni.push({
      annoAccademico: aa,
      autorizzazione: orNull(at(1)),
      dataAutorizzazione: orNull(at(2)),
      stato: orNull(at(3)),
      ultimoAccessoInps: orNull(at(4)),
      erroreInps: orNull(at(5)),
      dataElaborazione: orNull(at(6)),
      protocollo: orNull(at(7)),
    });
  });
  return { autorizzazioni };
}
