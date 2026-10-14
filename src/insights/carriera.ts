import type {
  Anagrafica,
  CarrieraResponse,
  Esame,
  IseeResponse,
  Piano,
  PianoEsame,
  PrenotazioniResponse,
  SituazioneTasse,
} from "../types.js";

// Career analysis built only from data Delphee already reads: the exam record
// (carriera), the study plan (piano, from the GOMP PDF), bookings, fees, ISEE,
// and the profile. Pure functions, no I/O: the API gathers the inputs.
//
// Conventions shared by every section:
// - Exams are joined across sources by code (codice verbalizzazione). The
//   record, bookings, calendar, and plan use the same codes; a booking and
//   its outcome also share the record number (verbale).
// - The weighted average matches Delphi's own figure: passed exams graded in
//   thirtieths, partials excluded, "30 e lode" counted as 30, CFU weights.
// - An academic year runs from 1 November: September and October exams
//   belong to the autumn session of the year that is ending.

export interface InsightsInput {
  carriera: CarrieraResponse;
  piano: Piano | null;
  prenotazioni: PrenotazioniResponse | null;
  tasse: SituazioneTasse | null;
  anagrafica: Anagrafica | null;
  isee: IseeResponse | null;
  oggi: string; // ISO date
}

export interface PuntoAndamento {
  data: string;
  nome: string;
  voto: number;
  lode: boolean;
  cfu: number;
  mediaCumulata: number;
}

export interface PuntoCfu {
  data: string;
  cfu: number; // cumulative
}

export interface Tentativo {
  data: string | null;
  esito: "superato" | "non_superato" | "senza_esito" | "in_programma";
  voto: string | null;
  prenotato: boolean;
}

export interface StoriaEsame {
  codice: string;
  nome: string;
  tentativi: Tentativo[];
  superatoAl: number | null; // 1-based attempt that passed
}

export interface EventoCarriera {
  data: string | null;
  aa: string | null;
  tipo: "immatricolazione" | "esame" | "fallito" | "assenza" | "tassa" | "piano";
  titolo: string;
  dettaglio: string | null;
}

export interface VoceChecklist {
  voce: string;
  stato: "ok" | "da_fare" | "attenzione" | "info";
  dettaglio: string;
}

export interface GruppoScelta {
  gruppo: string;
  anno: string | null;
  esami: Array<Pick<PianoEsame, "codice" | "nome" | "cfu" | "stato">>;
}

export interface CarrieraInsights {
  oggi: string;
  progresso: {
    cfuAcquisiti: number;
    cfuTotali: number;
    totaliDaPiano: boolean;
    cfuMancanti: number;
    esamiMancanti: PianoEsame[];
  };
  media: {
    ponderata: number | null;
    aritmetica: number | null;
    baseLaurea: number | null;
    sommaVotiCfu: number;
    cfuConVoto: number;
    distribuzione: Array<{ voto: string; esami: number }>;
    andamento: PuntoAndamento[];
  };
  perAnno: Array<{ aa: string; cfu: number; esami: number }>;
  previsione: {
    aaImmatricolazione: string | null;
    durataAnni: number;
    ultimoAaInCorso: string | null;
    scadenzaInCorso: string | null;
    ritmoMedio: number | null; // CFU per year since enrolment
    ritmoRecente: number; // CFU in the last 365 days
    ritmoUsato: number | null;
    dataStimata: string | null;
    aaStimato: string | null;
    inCorso: boolean | null;
    cfuAnnoNecessari: number | null;
    cfuCumulati: PuntoCfu[];
  };
  obiettivo: {
    cfuDaValutare: number;
    esami: Array<{ codice: string | null; nome: string; cfu: number; peso: number }>;
  };
  tentativi: StoriaEsame[];
  timeline: EventoCarriera[];
  checklist: VoceChecklist[];
  gruppiScelta: GruppoScelta[];
}

const DAY = 86_400_000;

export function aaOf(iso: string): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return m >= 11 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);
}

const isGraded = (e: Esame) =>
  e.stato === "superato" && e.voto?.tipo === "trentesimi" && !e.isPartial && (e.cfu ?? 0) > 0;

const cleanName = (n: string) => n.replace(/\s*\((UNICO|[A-Z]-[A-Z]|CANALE [^)]*)\)\s*$/i, "").trim();

// Activities that end with a pass/fail outcome rather than a grade: final
// exam (E), other activities (F), internships (S).
const UNGRADED_TAF = new Set(["E", "F", "S"]);

function durataNormale(input: InsightsInput): number {
  const anni = (input.piano?.esami ?? []).map((e) => Number(e.annoCorso)).filter((n) => n > 0);
  if (anni.length) return Math.max(...anni);
  const tipo = input.anagrafica?.tipologiaCorso ?? "";
  if (/ciclo unico/i.test(tipo)) return 5;
  if (/magistrale|specialistica/i.test(tipo)) return 2;
  return 3;
}

function media(esami: Esame[]) {
  const graded = esami.filter(isGraded).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
  let somma = 0;
  let cfu = 0;
  const andamento: PuntoAndamento[] = [];
  for (const e of graded) {
    const v = e.voto as { tipo: "trentesimi"; valore: number; lode: boolean };
    somma += v.valore * e.cfu!;
    cfu += e.cfu!;
    if (e.data) {
      andamento.push({ data: e.data, nome: e.nome, voto: v.valore, lode: v.lode, cfu: e.cfu!, mediaCumulata: round(somma / cfu) });
    }
  }
  const ponderata = cfu ? somma / cfu : null;
  const aritmetica = graded.length
    ? graded.reduce((s, e) => s + (e.voto as { valore: number }).valore, 0) / graded.length
    : null;
  const distribuzione = [...Array.from({ length: 13 }, (_, i) => String(18 + i)), "30L"].map((voto) => ({
    voto,
    esami: graded.filter((e) => {
      const v = e.voto as { valore: number; lode: boolean };
      return voto === "30L" ? v.lode : !v.lode && String(v.valore) === voto;
    }).length,
  }));
  return {
    ponderata: ponderata == null ? null : round(ponderata),
    aritmetica: aritmetica == null ? null : round(aritmetica),
    baseLaurea: ponderata == null ? null : round((ponderata * 110) / 30),
    sommaVotiCfu: somma,
    cfuConVoto: cfu,
    distribuzione,
    andamento,
  };
}

const counts = (e: Esame) => e.stato === "superato" || e.stato === "idoneo";

function cfuCumulati(esami: Esame[]): PuntoCfu[] {
  let tot = 0;
  return esami
    .filter((e) => counts(e) && e.data && (e.cfu ?? 0) > 0)
    .sort((a, b) => a.data!.localeCompare(b.data!))
    .map((e) => ({ data: e.data!, cfu: (tot += e.cfu!) }));
}

function perAnno(esami: Esame[]) {
  const map = new Map<string, { cfu: number; esami: number }>();
  for (const e of esami) {
    if (!counts(e) || !e.data || !(e.cfu ?? 0)) continue;
    const aa = aaOf(e.data);
    const cur = map.get(aa) ?? { cfu: 0, esami: 0 };
    cur.cfu += e.cfu!;
    cur.esami += 1;
    map.set(aa, cur);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([aa, v]) => ({ aa, ...v }));
}

// Exams still to do: plan entries not passed. Without a plan there is no
// reliable list, so it stays empty and totals fall back to 60 CFU per year.
function progresso(input: InsightsInput, durata: number) {
  const cfuAcquisiti = input.carriera.esami.filter(counts).reduce((s, e) => s + (e.cfu ?? 0), 0);
  const pianoEsami = input.piano?.esami ?? [];
  const totaliDaPiano = pianoEsami.length > 0;
  const cfuTotali = totaliDaPiano ? pianoEsami.reduce((s, e) => s + (e.cfu ?? 0), 0) : durata * 60;
  const esamiMancanti = pianoEsami.filter((e) => e.stato !== "superato");
  const cfuMancanti = totaliDaPiano
    ? esamiMancanti.reduce((s, e) => s + (e.cfu ?? 0), 0)
    : Math.max(0, cfuTotali - cfuAcquisiti);
  return { cfuAcquisiti, cfuTotali, totaliDaPiano, cfuMancanti, esamiMancanti };
}

// Graduation forecast. Enrolment year comes from the profile. The last
// regular ("in corso") academic year is the enrolment year plus the plan's
// length; graduating within it is possible until that year's last session,
// approximated as 31 March after it ends. Pace is CFU per year: recent (last
// 365 days) when there is any, else the average since enrolment.
function previsione(input: InsightsInput, durata: number, prog: ReturnType<typeof progresso>) {
  const aaImm = input.anagrafica?.aaImmatricolazione?.match(/^(\d{4})\/\d{4}$/) ? input.anagrafica.aaImmatricolazione : null;
  const startYear = aaImm ? Number(aaImm.slice(0, 4)) : null;
  const ultimoAaInCorso = startYear ? `${startYear + durata - 1}/${startYear + durata}` : null;
  const scadenzaInCorso = startYear ? `${startYear + durata + 1}-03-31` : null;
  const oggi = input.oggi;
  const elapsed = startYear ? (Date.parse(oggi) - Date.parse(`${startYear}-10-01`)) / (365.25 * DAY) : null;
  const ritmoMedio = elapsed && elapsed > 0.25 ? round(prog.cfuAcquisiti / elapsed, 1) : null;
  const yearAgo = addDays(oggi, -365);
  const ritmoRecente = input.carriera.esami
    .filter((e) => counts(e) && e.data && e.data > yearAgo && e.data <= oggi)
    .reduce((s, e) => s + (e.cfu ?? 0), 0);
  const ritmoUsato = ritmoRecente > 0 ? ritmoRecente : ritmoMedio && ritmoMedio > 0 ? ritmoMedio : null;
  const dataStimata =
    prog.cfuMancanti === 0 ? oggi : ritmoUsato ? addDays(oggi, Math.ceil((prog.cfuMancanti / ritmoUsato) * 365.25)) : null;
  const anniAllaScadenza = scadenzaInCorso ? (Date.parse(scadenzaInCorso) - Date.parse(oggi)) / (365.25 * DAY) : null;
  return {
    aaImmatricolazione: aaImm,
    durataAnni: durata,
    ultimoAaInCorso,
    scadenzaInCorso,
    ritmoMedio,
    ritmoRecente,
    ritmoUsato,
    dataStimata,
    aaStimato: dataStimata ? aaOf(dataStimata) : null,
    inCorso: dataStimata && scadenzaInCorso ? dataStimata <= scadenzaInCorso : null,
    cfuAnnoNecessari:
      anniAllaScadenza && anniAllaScadenza > 0 ? round(prog.cfuMancanti / anniAllaScadenza, 1) : null,
    cfuCumulati: cfuCumulati(input.carriera.esami),
  };
}

// Inputs for the target solver: the remaining CFU that will carry a grade,
// and each exam's share of them (how much it can move the average).
function obiettivo(prog: ReturnType<typeof progresso>) {
  const graded = prog.esamiMancanti.filter((e) => (e.cfu ?? 0) > 0 && !UNGRADED_TAF.has(e.taf ?? ""));
  const cfuDaValutare = graded.reduce((s, e) => s + e.cfu!, 0);
  return {
    cfuDaValutare,
    esami: graded
      .map((e) => ({ codice: e.codice, nome: e.nome, cfu: e.cfu!, peso: round(e.cfu! / cfuDaValutare, 3) }))
      .sort((a, b) => b.cfu - a.cfu || a.nome.localeCompare(b.nome)),
  };
}

// Attempts per exam. A booking whose record number (verbale) appears in the
// exam record takes that record's outcome. A past booking with no record
// number produced no grade: withdrawn, absent, or failed without a record;
// Delphi does not say which. Record entries no booking points to (e.g. a
// grade recorded without an online booking) are attempts too.
function tentativi(input: InsightsInput): StoriaEsame[] {
  const byVerbale = new Map(input.carriera.esami.filter((e) => e.verbale).map((e) => [e.verbale!, e]));
  const usedVerbali = new Set<string>();
  const storie = new Map<string, StoriaEsame>();
  const storia = (codice: string, nome: string) => {
    let s = storie.get(codice);
    if (!s) storie.set(codice, (s = { codice, nome, tentativi: [], superatoAl: null }));
    return s;
  };
  const esito = (e: Esame): Tentativo["esito"] => (counts(e) ? "superato" : e.stato === "non_superato" ? "non_superato" : "senza_esito");

  for (const p of input.prenotazioni?.prenotazioni ?? []) {
    if (!p.codice) continue;
    const rec = p.verbale ? byVerbale.get(p.verbale) : undefined;
    if (rec) usedVerbali.add(rec.verbale!);
    const s = storia(p.codice, rec?.nome ?? cleanName(p.insegnamento ?? p.codice));
    s.tentativi.push({
      data: p.dataEsame,
      esito: rec ? esito(rec) : p.dataEsame && p.dataEsame >= input.oggi ? "in_programma" : "senza_esito",
      voto: rec?.votoLabel ?? null,
      prenotato: true,
    });
  }
  for (const e of input.carriera.esami) {
    if (!e.codice || (e.verbale && usedVerbali.has(e.verbale)) || e.stato === "in_corso") continue;
    storia(e.codice, e.nome).tentativi.push({ data: e.data, esito: esito(e), voto: e.votoLabel, prenotato: false });
  }
  for (const s of storie.values()) {
    s.tentativi.sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
    const i = s.tentativi.findIndex((t) => t.esito === "superato");
    s.superatoAl = i >= 0 ? i + 1 : null;
  }
  const done = (s: StoriaEsame) => s.tentativi.filter((t) => t.esito !== "in_programma").length;
  return [...storie.values()].sort((a, b) => done(b) - done(a) || a.nome.localeCompare(b.nome));
}

function timeline(input: InsightsInput, storie: StoriaEsame[]): EventoCarriera[] {
  const out: EventoCarriera[] = [];
  const aaImm = input.anagrafica?.aaImmatricolazione ?? null;
  if (aaImm) out.push({ data: null, aa: aaImm, tipo: "immatricolazione", titolo: "Immatricolazione", dettaglio: input.anagrafica?.corso ?? null });
  for (const e of input.carriera.esami) {
    if (!e.data || e.stato === "in_corso") continue;
    const passed = counts(e);
    out.push({
      data: e.data, aa: aaOf(e.data), tipo: passed ? "esame" : "fallito", titolo: e.nome,
      dettaglio: passed ? [e.votoLabel, e.cfu ? `${e.cfu} CFU` : null].filter(Boolean).join(" · ") : "Non superato",
    });
  }
  for (const s of storie) {
    for (const t of s.tentativi) {
      if (t.esito === "senza_esito" && t.prenotato && t.data) {
        out.push({ data: t.data, aa: aaOf(t.data), tipo: "assenza", titolo: s.nome, dettaglio: "Prenotato, nessun esito" });
      }
    }
  }
  for (const anno of input.tasse?.anni ?? []) {
    for (const r of anno.rate) {
      for (const b of r.bollettini) {
        if (b.dataPagamento && (b.importo ?? 0) > 0) {
          out.push({ data: b.dataPagamento, aa: aaOf(b.dataPagamento), tipo: "tassa", titolo: `Rata ${r.numero ?? ""} pagata`.replace("  ", " "), dettaglio: `${b.importo?.toFixed(2)} € · AA ${anno.anno}` });
        }
      }
    }
  }
  for (const p of input.piano?.piani ?? []) {
    const d = p.ultimaModifica?.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (!d) continue;
    const data = `${d[3]}-${d[2]}-${d[1]}`;
    out.push({ data, aa: aaOf(data), tipo: "piano", titolo: `Piano di studi ${p.aa ?? ""}`.trim(), dettaglio: p.status });
  }
  return out.sort((a, b) => (a.data ?? "").localeCompare(b.data ?? ""));
}

// "Verso la laurea": what is still open before graduating, from the data.
// The degree-application rules quoted here come from Delphi's own
// instructions page (studenti/laurea/indexLaurea.jsp).
function checklist(input: InsightsInput, prog: ReturnType<typeof progresso>): VoceChecklist[] {
  const out: VoceChecklist[] = [];
  const pianoEsami = input.piano?.esami ?? [];
  const esami = prog.esamiMancanti.filter((e) => !UNGRADED_TAF.has(e.taf ?? ""));
  if (pianoEsami.length) {
    out.push({
      voce: "Esami del piano",
      stato: esami.length ? "da_fare" : "ok",
      dettaglio: esami.length ? `${esami.length} da sostenere, ${esami.reduce((s, e) => s + (e.cfu ?? 0), 0)} CFU` : "Tutti superati",
    });
    for (const e of pianoEsami.filter((e) => UNGRADED_TAF.has(e.taf ?? ""))) {
      out.push({ voce: cleanName(e.nome).toLowerCase().replace(/^./, (c) => c.toUpperCase()), stato: e.stato === "superato" ? "ok" : "da_fare", dettaglio: `${e.cfu ?? "—"} CFU${e.stato === "superato" ? " · registrato" : ""}` });
    }
  } else {
    out.push({ voce: "Esami del piano", stato: "info", dettaglio: "Piano di studi non disponibile: impossibile elencare gli esami mancanti" });
  }

  const piano = input.piano?.piani?.[0];
  if (piano) {
    const approved = /approvat/i.test(piano.status ?? "");
    out.push({
      voce: "Piano di studi",
      stato: approved ? "ok" : /attesa/i.test(piano.status ?? "") ? "attenzione" : "da_fare",
      dettaglio: `${piano.aa ?? ""} · ${piano.status ?? "stato sconosciuto"}`,
    });
  }

  if (input.tasse) {
    const unpaid = input.tasse.anni.flatMap((a) => a.rate.filter((r) => !r.saldato && (r.importo ?? 0) > 0).map((r) => ({ r, aa: a.anno })));
    out.push({
      voce: "Tasse",
      stato: unpaid.length ? "attenzione" : "ok",
      dettaglio: unpaid.length
        ? `${unpaid.length} rate da pagare. Per laurearsi tutte le rate dell'anno di iscrizione devono essere pagate.`
        : "Nessuna rata da pagare",
    });
  }

  if (input.isee) {
    const last = input.isee.autorizzazioni[0];
    out.push({
      voce: "ISEE-U",
      stato: last ? "ok" : "info",
      dettaglio: last ? `${last.annoAccademico}: ${last.stato ?? last.autorizzazione ?? "presentata"}` : "Nessuna autorizzazione INPS registrata",
    });
  }

  const oggi = input.oggi;
  const dicembre = `${oggi.slice(0, 4)}-12-31`;
  out.push({
    voce: "Domanda cautelativa",
    stato: "info",
    dettaglio: `Se ti laurei entro la sessione invernale dell'anno in cui sei iscritto, puoi rinviare le rate presentando la domanda cautelativa entro il 31 dicembre${oggi <= dicembre && Number(oggi.slice(5, 7)) >= 9 ? ` (tra ${Math.round((Date.parse(dicembre) - Date.parse(oggi)) / DAY)} giorni)` : ""}.`,
  });
  out.push({
    voce: "Domanda di laurea",
    stato: "info",
    dettaglio: "Servono la dichiarazione di assegnazione della tesi firmata dal relatore, la domanda online con il bollettino pagato e il questionario AlmaLaurea compilato prima della convalida.",
  });
  return out;
}

function gruppiScelta(piano: Piano | null): GruppoScelta[] {
  const map = new Map<string, GruppoScelta>();
  for (const e of piano?.esami ?? []) {
    if (!e.gruppo || !/a scelta/i.test(e.gruppo)) continue;
    const g = map.get(e.gruppo) ?? { gruppo: e.gruppo, anno: e.annoCorso, esami: [] };
    g.esami.push({ codice: e.codice, nome: e.nome, cfu: e.cfu, stato: e.stato });
    map.set(e.gruppo, g);
  }
  return [...map.values()];
}

export function buildInsights(input: InsightsInput): CarrieraInsights {
  const durata = durataNormale(input);
  const prog = progresso(input, durata);
  const storie = tentativi(input);
  return {
    oggi: input.oggi,
    progresso: prog,
    media: media(input.carriera.esami),
    perAnno: perAnno(input.carriera.esami),
    previsione: previsione(input, durata, prog),
    obiettivo: obiettivo(prog),
    tentativi: storie,
    timeline: timeline(input, storie),
    checklist: checklist(input, prog),
    gruppiScelta: gruppiScelta(input.piano),
  };
}

// Attempts for one exam code, for the exam dossier.
export function tentativiPer(codice: string, input: Pick<InsightsInput, "carriera" | "prenotazioni" | "oggi">): StoriaEsame | null {
  return tentativi({ ...input, piano: null, tasse: null, anagrafica: null, isee: null }).find((s) => s.codice === codice) ?? null;
}

