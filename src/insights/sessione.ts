import type { AppelloCalendario, PianoEsame, Prenotazione } from "../types.js";

// Exam-session planner. Picks one exam sitting per remaining plan exam from
// the calendar, so that exams are spread out: heavier exams (more CFU) get
// more free days around them. Greedy and deterministic: exams that are
// already booked are fixed first, then the exams with the fewest sittings to
// choose from, then the heaviest. When no sitting keeps the full gap, the one
// farthest from the others is taken and marked `ravvicinato`.

export interface EsamePianificato {
  codice: string;
  nome: string;
  cfu: number | null;
  appello: AppelloCalendario;
  alternative: AppelloCalendario[];
  prenotato: boolean;
  prenotazione: "aperta" | "da_aprire" | "chiusa" | "sconosciuta";
  ravvicinato: boolean;
}

export interface PianoSessione {
  da: string;
  a: string;
  pianificati: EsamePianificato[];
  senzaAppello: Array<{ codice: string; nome: string; cfu: number | null }>;
}

export interface SessioneInput {
  mancanti: PianoEsame[];
  appelli: AppelloCalendario[];
  prenotazioni: Prenotazione[];
  oggi: string;
  orizzonteGiorni?: number;
  escludi?: Set<string>;
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / DAY);
const gapFor = (cfu: number | null) => ((cfu ?? 6) >= 12 ? 5 : (cfu ?? 6) >= 9 ? 4 : 3);

function statoPrenotazione(a: AppelloCalendario, oggi: string): EsamePianificato["prenotazione"] {
  if (!a.inizioPrenotazione || !a.finePrenotazione) return "sconosciuta";
  if (oggi < a.inizioPrenotazione) return "da_aprire";
  return oggi <= a.finePrenotazione ? "aperta" : "chiusa";
}

export function pianificaSessione(input: SessioneInput): PianoSessione {
  const { oggi } = input;
  const a = new Date(Date.parse(oggi) + (input.orizzonteGiorni ?? 150) * DAY).toISOString().slice(0, 10);
  const esami = input.mancanti.filter(
    (e): e is PianoEsame & { codice: string } => !!e.codice && !input.escludi?.has(e.codice),
  );

  const booked = new Map(
    input.prenotazioni
      .filter((p) => p.codice && p.dataEsame && p.dataEsame >= oggi)
      .map((p) => [p.codice!, p.dataEsame!]),
  );
  // Future sittings per exam, one per date. A sitting whose booking window has
  // closed is dropped unless the student already booked it: windows usually
  // close days before the exam.
  const candidati = new Map<string, AppelloCalendario[]>();
  for (const e of esami) {
    const seen = new Set<string>();
    const list = input.appelli
      .filter((x) => x.codice === e.codice && x.dataEsame && x.dataEsame > oggi && x.dataEsame <= a)
      .filter((x) => !x.finePrenotazione || x.finePrenotazione >= oggi || booked.get(e.codice) === x.dataEsame)
      .sort((x, y) => x.dataEsame!.localeCompare(y.dataEsame!))
      .filter((x) => !seen.has(x.dataEsame!) && seen.add(x.dataEsame!));
    candidati.set(e.codice, list);
  }

  const order = [...esami].sort((x, y) => {
    const bx = booked.has(x.codice) ? 0 : 1;
    const by = booked.has(y.codice) ? 0 : 1;
    return bx - by || candidati.get(x.codice)!.length - candidati.get(y.codice)!.length || (y.cfu ?? 0) - (x.cfu ?? 0);
  });

  const scelti: Array<{ data: string; cfu: number | null }> = [];
  const pianificati: EsamePianificato[] = [];
  const senzaAppello: PianoSessione["senzaAppello"] = [];

  for (const e of order) {
    const list = candidati.get(e.codice)!;
    const bookedDate = booked.get(e.codice);
    const options = bookedDate ? list.filter((x) => x.dataEsame === bookedDate) : list;
    if (!options.length) {
      if (!bookedDate) senzaAppello.push({ codice: e.codice, nome: e.nome, cfu: e.cfu });
      continue;
    }
    const fits = (x: AppelloCalendario) =>
      scelti.every((s) => days(s.data, x.dataEsame!) >= Math.max(gapFor(s.cfu), gapFor(e.cfu)));
    const distance = (x: AppelloCalendario) =>
      scelti.length ? Math.min(...scelti.map((s) => days(s.data, x.dataEsame!))) : Infinity;
    const chosen = options.find(fits) ?? [...options].sort((x, y) => distance(y) - distance(x))[0]!;
    const ravvicinato = !fits(chosen) && !bookedDate;
    scelti.push({ data: chosen.dataEsame!, cfu: e.cfu });
    pianificati.push({
      codice: e.codice,
      nome: e.nome,
      cfu: e.cfu,
      appello: chosen,
      alternative: list.filter((x) => x !== chosen),
      prenotato: !!bookedDate,
      prenotazione: statoPrenotazione(chosen, oggi),
      ravvicinato,
    });
  }
  pianificati.sort((x, y) => x.appello.dataEsame!.localeCompare(y.appello.dataEsame!));
  return { da: oggi, a, pianificati, senzaAppello };
}
