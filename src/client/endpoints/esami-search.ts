import type { Esame, EsamiFilter, EsamiSummary, Stato } from "../../types.js";

// Pure filter + summary helpers over a parsed esami list. Kept separate from the
// HTML parser so they're trivially testable and reusable for the /carriera/esami
// query endpoint. AND across fields; OR within the stato set.

export function filterEsami(esami: Esame[], filter: EsamiFilter): Esame[] {
  const nome = filter.nome?.toLowerCase();
  const ssd = filter.ssd?.toLowerCase();
  const statoSet = filter.stato
    ? new Set(Array.isArray(filter.stato) ? filter.stato : [filter.stato])
    : null;

  return esami.filter((e) => {
    if (nome && !e.nome.toLowerCase().includes(nome)) return false;
    if (ssd && !(e.ssd ?? "").toLowerCase().includes(ssd)) return false;
    if (filter.annoAccademico && e.annoAccademico !== filter.annoAccademico) return false;
    if (statoSet && !statoSet.has(e.stato)) return false;
    if (filter.isPartial !== undefined && e.isPartial !== filter.isPartial) return false;
    if (filter.cfuMin !== undefined && (e.cfu === null || e.cfu < filter.cfuMin)) return false;
    if (filter.cfuMax !== undefined && (e.cfu === null || e.cfu > filter.cfuMax)) return false;
    return true;
  });
}

export function summarizeEsami(esami: Esame[]): EsamiSummary {
  const byStato = (s: Stato) => esami.filter((e) => e.stato === s).length;

  const cfuTotali = esami.reduce((sum, e) => sum + (e.cfu ?? 0), 0);
  const cfuSuperati = esami
    .filter((e) => e.stato === "superato" || e.stato === "idoneo")
    .reduce((sum, e) => sum + (e.cfu ?? 0), 0);

  const trentesimi = esami
    .map((e) => (e.voto?.tipo === "trentesimi" ? e.voto.valore : null))
    .filter((v): v is number => v !== null);
  const cfuMedia =
    trentesimi.length > 0
      ? Math.round((trentesimi.reduce((a, b) => a + b, 0) / trentesimi.length) * 100) / 100
      : null;

  const anniAccademici = [
    ...new Set(esami.map((e) => e.annoAccademico).filter((a): a is string => !!a)),
  ].sort();

  return {
    totale: esami.length,
    superati: byStato("superato"),
    inCorso: byStato("in_corso"),
    nonSuperati: byStato("non_superato"),
    idonei: byStato("idoneo"),
    cfuTotali,
    cfuSuperati,
    cfuMedia,
    anniAccademici,
  };
}
