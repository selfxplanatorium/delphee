import { describe, it, expect } from "vitest";
import { buildInsights, aaOf, type InsightsInput } from "../src/insights/carriera.js";
import type { Esame, PianoEsame, Prenotazione } from "../src/types.js";

const esame = (o: Partial<Esame> & Pick<Esame, "codice" | "nome">): Esame => ({
  numero: null, ssd: null, annoAccademico: null, data: null, cfu: 12, voto: null, votoLabel: null,
  note: null, tipoAttivita: null, verbale: null, stato: "superato", isPartial: false, ...o,
});
const voto = (valore: number, lode = false) => ({ tipo: "trentesimi" as const, valore, lode });
const pianoEsame = (o: Partial<PianoEsame> & Pick<PianoEsame, "codice" | "nome">): PianoEsame => ({
  cfu: 12, annoCorso: "1", stato: "da_fare", ssd: null, taf: "B", gruppo: "Insegnamenti obbligatori", ...o,
});
const prenotazione = (o: Partial<Prenotazione>): Prenotazione => ({
  insegnamento: "X (UNICO)", cfu: 12, codice: null, docente: null, annoAccademico: null, tipologia: null,
  finePrenotazione: null, dataEsame: null, appello: null, posizione: null, prenotati: null, sede: null,
  turno: null, attiva: false, verbale: null, ref: null, ...o,
});

const carriera = {
  header: { studente: null, matricola: "1", cdl: null },
  rendimento: { esamiValidi: null, cfuEsamiValidi: null, idoneita: null, cfuIdoneita: null, mediaAritmetica: null, mediaPonderata: null },
  esami: [
    esame({ codice: "A", nome: "ANALISI", data: "2025-02-10", cfu: 12, voto: voto(24), votoLabel: "24", verbale: "V1" }),
    esame({ codice: "B", nome: "FISICA", data: "2025-07-01", cfu: 6, voto: voto(30, true), votoLabel: "30L", verbale: "V2" }),
    esame({ codice: "C", nome: "INGLESE", data: "2025-06-01", stato: "non_superato", verbale: "V3" }),
    esame({ codice: "C", nome: "INGLESE", data: "2025-09-20", voto: voto(27), votoLabel: "27", verbale: "V4" }),
    esame({ codice: "P", nome: "SCRITTO", data: "2025-05-01", cfu: null, voto: { tipo: "qualifica", valore: "OTTIMO" }, isPartial: true }),
  ],
};

const input: InsightsInput = {
  carriera,
  piano: {
    cdl: null, annoCorso: null, composerUrl: null, esamiDa: null,
    piani: [{ ps: null, aa: "2025/2026", ultimaModifica: "01/10/2025 10:00:00", denominazione: null, status: "Approvato", composerUrl: null }],
    esami: [
      pianoEsame({ codice: "A", nome: "ANALISI", stato: "superato", taf: "A" }),
      pianoEsame({ codice: "B", nome: "FISICA", cfu: 6, stato: "superato" }),
      pianoEsame({ codice: "C", nome: "INGLESE", stato: "superato" }),
      pianoEsame({ codice: "D", nome: "STORIA", cfu: 6, annoCorso: "2", gruppo: "QUADRO 1 Un esame a scelta tra:" }),
      pianoEsame({ codice: "E", nome: "INFORMATICA", annoCorso: "3" }),
      pianoEsame({ codice: "F", nome: "PROVA FINALE", cfu: 6, annoCorso: "3", taf: "E", gruppo: "Per la prova finale" }),
    ],
  },
  prenotazioni: {
    prenotazioni: [
      prenotazione({ codice: "C", insegnamento: "INGLESE (UNICO)", dataEsame: "2025-05-15" }),
      prenotazione({ codice: "C", insegnamento: "INGLESE (UNICO)", dataEsame: "2025-06-01", verbale: "V3" }),
      prenotazione({ codice: "C", insegnamento: "INGLESE (UNICO)", dataEsame: "2025-09-20", verbale: "V4" }),
      prenotazione({ codice: "E", insegnamento: "INFORMATICA (UNICO)", dataEsame: "2025-11-20" }),
    ],
  },
  tasse: null,
  anagrafica: { aaImmatricolazione: "2024/2025", tipologiaCorso: "Laurea" } as InsightsInput["anagrafica"],
  isee: null,
  oggi: "2025-10-01",
};

describe("career insights", () => {
  const ins = buildInsights(input);

  it("starts the academic year on 1 November", () => {
    expect(aaOf("2025-10-31")).toBe("2024/2025");
    expect(aaOf("2025-11-01")).toBe("2025/2026");
  });

  it("computes Delphi's weighted average, lode counted as 30, partials excluded", () => {
    // (24*12 + 30*6 + 27*12) / 30 = 26.4
    expect(ins.media.ponderata).toBe(26.4);
    expect(ins.media.baseLaurea).toBe(96.8);
    expect(ins.media.distribuzione.find((d) => d.voto === "30L")!.esami).toBe(1);
    expect(ins.media.andamento.map((p) => p.mediaCumulata)).toEqual([24, 26, 26.4]);
  });

  it("measures progress against the plan", () => {
    expect(ins.progresso).toMatchObject({ cfuAcquisiti: 30, cfuTotali: 54, totaliDaPiano: true, cfuMancanti: 24 });
    expect(ins.progresso.esamiMancanti.map((e) => e.codice)).toEqual(["D", "E", "F"]);
  });

  it("forecasts graduation from the recent pace", () => {
    const p = ins.previsione;
    expect(p).toMatchObject({ durataAnni: 3, ultimoAaInCorso: "2026/2027", scadenzaInCorso: "2028-03-31", ritmoRecente: 30, ritmoUsato: 30 });
    expect(p.inCorso).toBe(true);
    expect(p.cfuCumulati.at(-1)).toEqual({ data: "2025-09-20", cfu: 30 });
  });

  it("leaves pass/fail activities out of the target solver", () => {
    expect(ins.obiettivo.cfuDaValutare).toBe(18);
    expect(ins.obiettivo.esami.map((e) => e.codice)).toEqual(["E", "D"]);
  });

  it("links bookings to outcomes through the record number", () => {
    const inglese = ins.tentativi.find((s) => s.codice === "C")!;
    expect(inglese.tentativi.map((t) => t.esito)).toEqual(["senza_esito", "non_superato", "superato"]);
    expect(inglese.superatoAl).toBe(3);
    expect(ins.tentativi.find((s) => s.codice === "E")!.tentativi[0]!.esito).toBe("in_programma");
  });

  it("builds the timeline and the graduation checklist", () => {
    expect(ins.timeline[0]!.tipo).toBe("immatricolazione");
    expect(ins.timeline.filter((e) => e.tipo === "assenza")).toHaveLength(1);
    const voci = Object.fromEntries(ins.checklist.map((c) => [c.voce, c.stato]));
    expect(voci).toMatchObject({ "Esami del piano": "da_fare", "Prova finale": "da_fare", "Piano di studi": "ok" });
  });

  it("lists elective groups only", () => {
    expect(ins.gruppiScelta.map((g) => g.gruppo)).toEqual(["QUADRO 1 Un esame a scelta tra:"]);
  });
});
