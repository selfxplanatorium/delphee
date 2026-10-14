import { describe, it, expect } from "vitest";
import { prenotazioniCalendar } from "../src/server/ics.js";
import type { Prenotazione, PrenotazioneDettaglio } from "../src/types.js";

const base: Prenotazione = {
  insegnamento: "LINGUA POLACCA 2 (UNICO)", cfu: 12, codice: "8048199", docente: "AMENTA",
  annoAccademico: "2025/2026", tipologia: "ESAME FINALE", finePrenotazione: "2026-06-14",
  dataEsame: "2026-06-17", appello: "I", posizione: 2, prenotati: 2, sede: null, turno: null,
  attiva: true, verbale: null, ref: { id: "4824144", index: "0", ordine: "2" },
};
const dettaglio: PrenotazioneDettaglio = {
  insegnamento: base.insegnamento, docente: "AMENTA ALESSANDRO", annoAccademico: "2025/2026",
  dataEsame: "2026-06-17", orario: "11:00", inizioPrenotazione: null, finePrenotazione: null,
  modalita: "ORALE", tipologia: "ESAME FINALE", appello: "I", sessione: "ESTIVA", edificio: "B",
  aula: "STUDIO 38", comunicazioni: "L'esame, se possibile; inizia presto", numeroPrenotazione: "4832919", moduli: [],
};
const NOW = new Date("2026-06-01T10:00:00Z");

describe("prenotazioni calendar", () => {
  const ics = prenotazioniCalendar([{ prenotazione: base, dettaglio }], NOW);
  const lines = ics.split("\r\n");

  it("uses CRLF line endings and wraps the events in one calendar", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });
  it("gives a timed event in Rome time with a fixed duration", () => {
    expect(lines).toContain("DTSTART;TZID=Europe/Rome:20260617T110000");
    expect(lines).toContain("DURATION:PT2H");
    expect(ics).toContain("BEGIN:VTIMEZONE");
  });
  it("escapes commas and semicolons in text values", () => {
    expect(lines).toContain("LOCATION:B\\, STUDIO 38");
    expect(ics.replace(/\r\n /g, "")).toContain("L'esame\\, se possibile\\; inizia presto");
  });
  it("folds lines longer than 75 octets", () => {
    for (const l of lines) expect(Buffer.byteLength(l)).toBeLessThanOrEqual(75);
  });
  it("falls back to an all-day event without details", () => {
    const allDay = prenotazioniCalendar([{ prenotazione: base, dettaglio: null }], NOW);
    expect(allDay).toContain("DTSTART;VALUE=DATE:20260617");
    expect(allDay).not.toContain("DURATION");
  });
});
