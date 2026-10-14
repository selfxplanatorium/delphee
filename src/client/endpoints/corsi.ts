import { load, cleanText, orNull, parseFloatSafe } from "./util.js";
import type { CorsoIscrivibile, CorsiResponse } from "../../types.js";

// Parser for IscCorsiStudente/preVisualizzaIscrivibili.jsp, the list of
// courses the student can enrol in ("Frequenza corsi di insegnamento").
// One esamidispari/esamipari row per course with 6 data cells (Descrizione as
// "<codice> - <nome>", AA, CFU, Docente, Sessione o Ciclo, Classe virtuale)
// and a form whose hidden idIscrizioneInsegnata addresses the Iscriviti
// action. The empty state is a single "Non ci sono attualmente corsi" message.
// ponytail: reads the first results page only. The captured list (18 courses)
// fit on one page; walk the "pagina" pager if a longer list shows up.

export function parse(html: string): CorsiResponse {
  const $ = load(html);
  const corsi: CorsoIscrivibile[] = [];
  $("tr").each((_, tr) => {
    const cells = $(tr).children("td.esamidispari, td.esamipari");
    if (cells.length < 6) return;
    const at = (i: number) => cleanText(cells.eq(i).text());
    const desc = at(0).match(/^(\d{6,9})\s*-\s*(.+)$/);
    const id = $(tr).find('input[name="idIscrizioneInsegnata"]').attr("value")?.trim() ?? "";
    corsi.push({
      codice: desc?.[1] ?? null,
      nome: orNull(desc?.[2] ?? at(0)),
      annoAccademico: at(1).match(/(\d{4}\/\d{4})/)?.[1] ?? null,
      cfu: parseFloatSafe(at(2)),
      docente: orNull(at(3)),
      sessione: orNull(at(4)),
      classeVirtuale: orNull(at(5)),
      id: /^\d+$/.test(id) ? id : null,
    });
  });
  return { corsi };
}
