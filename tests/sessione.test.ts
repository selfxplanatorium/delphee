import { describe, it, expect } from "vitest";
import { pianificaSessione } from "../src/insights/sessione.js";
import type { AppelloCalendario, PianoEsame } from "../src/types.js";

const esame = (codice: string, cfu: number): PianoEsame => ({
  codice, nome: codice, cfu, annoCorso: "1", stato: "da_fare", ssd: null, taf: "B", gruppo: null,
});
const appello = (codice: string, dataEsame: string, extra: Partial<AppelloCalendario> = {}): AppelloCalendario => ({
  insegnamento: codice, idCorIns: null, cfu: null, codice, canale: null, docente: null, sessione: "INVERNALE",
  appello: "I", dataEsame, ora: null, aula: null, inizioPrenotazione: "2026-12-01", finePrenotazione: "2027-01-05",
  stato: "chiuso", ...extra,
});

describe("session planner", () => {
  const oggi = "2026-12-10";

  it("spreads exams apart, placing the exam with fewer sittings first", () => {
    const r = pianificaSessione({
      oggi, prenotazioni: [],
      mancanti: [esame("A", 12), esame("B", 6)],
      appelli: [appello("A", "2027-01-10"), appello("A", "2027-01-20"), appello("B", "2027-01-12")],
    });
    expect(r.pianificati.map((p) => [p.codice, p.appello.dataEsame, p.ravvicinato])).toEqual([
      ["B", "2027-01-12", false],
      ["A", "2027-01-20", false],
    ]);
    expect(r.pianificati[1]!.alternative.map((x) => x.dataEsame)).toEqual(["2027-01-10"]);
  });

  it("marks a forced close pair and reports exams with no sitting", () => {
    const r = pianificaSessione({
      oggi, prenotazioni: [],
      mancanti: [esame("A", 12), esame("B", 12), esame("C", 6)],
      appelli: [appello("A", "2027-01-10"), appello("B", "2027-01-11")],
    });
    expect(r.pianificati.filter((p) => p.ravvicinato)).toHaveLength(1);
    expect(r.senzaAppello.map((x) => x.codice)).toEqual(["C"]);
  });

  it("keeps booked exams fixed even after their window closed, skips other closed windows and excluded exams", () => {
    const r = pianificaSessione({
      oggi, escludi: new Set(["C"]),
      mancanti: [esame("A", 12), esame("B", 6), esame("C", 6)],
      appelli: [
        appello("A", "2027-01-10", { finePrenotazione: "2026-12-05" }), appello("A", "2027-01-30"),
        appello("B", "2027-01-11", { finePrenotazione: "2026-12-01" }), appello("B", "2027-02-01"),
        appello("C", "2027-01-15"),
      ],
      prenotazioni: [{ codice: "A", dataEsame: "2027-01-10" } as never],
    });
    expect(r.pianificati.map((p) => [p.codice, p.appello.dataEsame, p.prenotato, p.prenotazione])).toEqual([
      ["A", "2027-01-10", true, "chiusa"],
      ["B", "2027-02-01", false, "aperta"],
    ]);
  });
});
