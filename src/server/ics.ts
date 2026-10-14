import type { Prenotazione, PrenotazioneDettaglio } from "../types.js";

// iCalendar (RFC 5545) export of exams: bookings and planned sessions. Delphi
// gives a date for every booking and a start time only in the booking
// details; without a time the event is all-day. Exams have no end time upstream, so timed events get a
// fixed two-hour duration.

const EXAM_DURATION = "PT2H";

// Europe/Rome with the EU daylight-saving rules, so clients that need an
// explicit VTIMEZONE (RFC 5545 requires one for every TZID) place the exam
// at the right local time.
const VTIMEZONE_ROME = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Rome",
  "BEGIN:STANDARD",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
];

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// Content lines are limited to 75 octets; longer ones continue on lines that
// start with a space. Splits on code points so a multi-byte character is never
// cut in half.
function fold(line: string): string {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    if (bytes + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

function utcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// One calendar entry. `time` is local Rome time ("HH:MM"); without it the
// event is all-day.
export interface IcsEvent {
  uid: string;
  date: string; // ISO date
  time: string | null;
  summary: string;
  location: string | null;
  description: string | null;
}

function vevent(e: IcsEvent, stamp: string): string[] {
  const date = e.date.replace(/-/g, "");
  const time = e.time?.match(/^(\d{1,2})[:.](\d{2})/);
  const start = time
    ? [`DTSTART;TZID=Europe/Rome:${date}T${time[1]!.padStart(2, "0")}${time[2]}00`, `DURATION:${EXAM_DURATION}`]
    : [`DTSTART;VALUE=DATE:${date}`];
  return [
    "BEGIN:VEVENT",
    `UID:${e.uid}@delphee`,
    `DTSTAMP:${stamp}`,
    ...start,
    `SUMMARY:${escapeText(e.summary)}`,
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    "END:VEVENT",
  ];
}

export function calendar(name: string, events: IcsEvent[], now = new Date()): string {
  const stamp = utcStamp(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Delphee//Esami//IT",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(name)}`,
    ...VTIMEZONE_ROME,
    ...events.flatMap((e) => vevent(e, stamp)),
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function prenotazioniCalendar(
  items: Array<{ prenotazione: Prenotazione; dettaglio: PrenotazioneDettaglio | null }>,
  now = new Date(),
): string {
  const events = items
    .filter((i) => i.prenotazione.dataEsame)
    .map(({ prenotazione: p, dettaglio: d }): IcsEvent => ({
      uid: `prenotazione-${p.ref?.id ?? p.dataEsame}`,
      date: p.dataEsame!,
      time: d?.orario ?? null,
      summary: `Esame: ${p.insegnamento ?? "insegnamento"}`,
      location: [d?.edificio, d?.aula].filter(Boolean).join(", ") || null,
      description: [
        p.appello ? `Appello ${p.appello}` : null,
        d?.modalita ?? p.tipologia,
        d?.docente ?? p.docente ? `Docente: ${d?.docente ?? p.docente}` : null,
        d?.numeroPrenotazione ? `Prenotazione n. ${d.numeroPrenotazione}` : null,
        d?.comunicazioni,
      ].filter(Boolean).join("\n") || null,
    }));
  return calendar("Esami prenotati", events, now);
}
