// Domain types for the Delphi Wrapper.
//
// Fundamental tension: Delphi's HTML is irregular and entity-encoded, so the
// parsers must be liberal in what they accept; the JSON we expose must be
// strict and predictable so the LINFO host app can trust it. These types are
// the contract between those two worlds. Everything nullable here is a field
// Delphi genuinely omits for some account type or career state.

export type Stato = "superato" | "in_corso" | "non_superato" | "idoneo";

export type Voto =
  | { tipo: "trentesimi"; valore: number; lode: boolean }
  | { tipo: "qualifica"; valore: string }
  | null;

export interface Esame {
  numero: number | null;
  codice: string | null;
  nome: string;
  ssd: string | null;
  annoAccademico: string | null;
  data: string | null; // ISO YYYY-MM-DD
  cfu: number | null;
  voto: Voto;
  votoLabel: string | null;
  note: string | null;
  tipoAttivita: string | null;
  verbale: string | null;
  stato: Stato;
  isPartial: boolean;
}

export interface CarrieraHeader {
  studente: string | null;
  matricola: string | null;
  cdl: string | null;
}

export interface Rendimento {
  esamiValidi: number | null;
  cfuEsamiValidi: number | null;
  idoneita: number | null;
  cfuIdoneita: number | null;
  mediaAritmetica: number | null;
  mediaPonderata: number | null;
}

export interface CarrieraResponse {
  header: CarrieraHeader;
  esami: Esame[];
  rendimento: Rendimento;
}

export interface EsamiFilter {
  nome?: string;
  ssd?: string;
  annoAccademico?: string;
  stato?: Stato | Stato[];
  isPartial?: boolean;
  cfuMin?: number;
  cfuMax?: number;
}

export interface EsamiSummary {
  totale: number;
  superati: number;
  inCorso: number;
  nonSuperati: number;
  idonei: number;
  cfuTotali: number;
  cfuSuperati: number;
  cfuMedia: number | null;
  anniAccademici: string[];
}

export interface EsamiResponse {
  esami: Esame[];
  summary: EsamiSummary;
}

export interface Laurea {
  corso: string | null;
  data: string | null; // ISO
  votazione: string | null; // e.g. "110/110"
}

export interface Anagrafica {
  cognome: string | null;
  nome: string | null;
  codiceFiscale: string | null;
  dataNascita: string | null; // ISO
  comuneNascita: string | null;
  provinciaNascita: string | null;
  nazioneCittadinanza: string | null;
  cellulare: string | null;
  email: string | null;
  skype: string | null;
  residenza: Indirizzo;
  domicilio: Indirizzo;
  matricola: string | null;
  facolta: string | null;
  corso: string | null;
  tipologiaCorso: string | null;
  sedeCorso: string | null;
  codiceCorso: string | null;
  annoCorso: number | null;
  annoCorsoLabel: string | null;
  aaImmatricolazione: string | null;
  aaUltimaIscrizione: string | null;
  statoCarriera: string | null;
  laurea: Laurea | null;
  fotoUrl: string | null;
}

export interface Indirizzo {
  indirizzo: string | null;
  comune: string | null;
  provincia: string | null;
  cap: string | null;
  telefono: string | null;
}

export interface PianoEsame {
  codice: string | null;
  nome: string;
  cfu: number | null;
  annoCorso: string | null;
  stato: "superato" | "in_corso" | "da_fare";
  ssd: string | null;
  // Tipo attività formativa: A base, B caratterizzante, C affine, D a scelta,
  // E prova finale, F altre attività.
  taf: string | null;
  // Plan section the exam belongs to, e.g. "Insegnamenti obbligatori" or an
  // elective group ("QUADRO 1 Seconda lingua triennale 12 CFU a scelta tra:").
  gruppo: string | null;
}

export interface Piano {
  cdl: string | null;
  annoCorso: string | null;
  esami: PianoEsame[];
  // GOMP listing (ElencoPiani): one entry per compiled piano. Empty when the
  // account has none or the SSO bridge failed.
  piani: PianoGomp[];
  composerUrl: string | null;
  // The GOMP plan `esami` was read from (its PDF), or null when `esami` comes
  // from Delphi's own listing or is empty.
  esamiDa: { aa: string | null; status: string | null } | null;
}

// One row of the GOMP piano listing. `composerUrl` opens the WebForms composer
// (works only in a browser that already rode the Delphi→GOMP SSO; the wrapper
// exposes it for completeness). `ps` is the plan id for GET /piano/pdf.
export interface PianoGomp {
  ps: string | null;
  aa: string | null;
  ultimaModifica: string | null; // "dd/mm/yyyy hh:mm:ss", as rendered
  denominazione: string | null;
  status: string | null;
  composerUrl: string | null;
}

export interface Appello {
  codice: string | null;
  insegnamento: string | null;
  data: string | null; // ISO
  postiDisponibili: number | null;
  postiTotali: number | null;
  iscritti: number | null;
  stato: "aperto" | "chiuso" | "pieno" | "sconosciuto";
}

// One row of the calendarioEsami search results, flattened: Delphi groups
// appelli by insegnamento with rowspan cells; we denormalize so the client can
// filter/sort without reconstructing the grouping.
export interface AppelloCalendario {
  insegnamento: string;
  idCorIns: string | null;
  cfu: number | null;
  codice: string | null; // codice verbalizzazione
  canale: string | null;
  docente: string | null;
  sessione: string | null;
  appello: string | null; // numeralo romano (I, II, …)
  dataEsame: string | null; // ISO
  ora: string | null;
  aula: string | null;
  inizioPrenotazione: string | null; // ISO
  finePrenotazione: string | null; // ISO
  stato: "aperto" | "chiuso" | "sconosciuto";
}

// Query params for the calendar search (`GET /appelli` without `insegnamento`).
export interface CalendarioQuery {
  anno?: string; // "2025/2026", defaults to current AA
  sessione?: string; // TUTTE | ESTIVA | ESTIVA ANTICIPATA | AUTUNNALE | INVERNALE | STRAORDINARIA
  iniziale?: string; // "-1" (tutte) or A–Z
  datainizio?: string; // gg/mm/aaaa
  datafine?: string; // gg/mm/aaaa
}

// One activation code (or activation URL) surfaced on a service card. A service
// can carry several: National Instruments lists LabVIEW + Multisim, each with
// its own code, so `label` names the sub-item; single-code services (MatLab,
// Mathematica) leave it null.
export interface ServizioCode {
  label: string | null;
  value: string;
}

export interface Servizio {
  nome: string;
  descrizione: string | null;
  // Absolute Delphi path, e.g. "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp
  // ?Entra=../emailMicrosoft/menuEmail.jsp". "Apri nel portale" links straight to
  // it; the wrapper's transparent /totem/* reverse-proxy serves it with the
  // session attached — no manual copy-paste of URLs into Delphi.
  path: string | null;
  // Activation codes resolved for the service (MatLab's numeric code, Wolfram's
  // claim URL, NI's two LabVIEW/Multisim codes, …). Empty for services whose
  // activation is a flow or status page (Office365, MyCampus) rather than a code.
  codes: ServizioCode[];
  // An on-demand "generate code" action (MyCampusXApp's "Genera codice" button →
  // `richiestaAttivazione.jsp?Genera=si`). Surfaced as a native button: the
  // wrapper triggers it and shows the generated code inline. Null when the
  // service has no such action. `path` is the Genera URL; the code is read from
  // the response. Deliberately NOT auto-run during list load — it's a state-
  // changing action the user invokes explicitly.
  azione: { label: string; path: string } | null;
  // External docs link from the <i>"clicca QUI"</i> tail (e.g. docs.ccd.uniroma2.it).
  infoLink: string | null;
}

export interface ServiziResponse {
  servizi: Servizio[];
}

export interface Certificato {
  nome: string;
  path: string | null;
  parametri: Record<string, string>;
}

export interface CertificatiStudente {
  cognome: string | null;
  nome: string | null;
  matricola: string | null;
  corso: string | null;
  tipologiaCorso: string | null;
  codiceCorso: string | null;
}

export interface CertificatiResponse {
  studente: CertificatiStudente;
  certificati: Certificato[];
  limiteNote: string | null;
}

// ---- Verbali / esami pendenti ----

export interface Verbale {
  numero: number | null;
  nome: string | null;
  docente: string | null;
  annoAccademico: string | null;
  data: string | null; // ISO
  cfu: number | null;
  verbale: string | null;
}

export interface VerbaliResponse {
  header: CarrieraHeader;
  verbali: Verbale[];
}

export interface EsamePendente {
  numero: number | null;
  codice: string | null;
  nome: string | null;
  ssd: string | null;
  annoAccademico: string | null;
  data: string | null; // ISO
  cfu: number | null;
  esito: string | null;
  voto: string | null;
  verbale: string | null;
}

export interface EsamiPendentiResponse {
  header: CarrieraHeader;
  esami: EsamePendente[];
}

// ---- Prenotazioni esami ----

// Form fields Delphi needs to address one booking from the bookings list
// (Dettagli / Ristampa). Opaque to clients: pass them back unchanged.
export interface PrenotazioneRef {
  id: string;
  index: string;
  ordine: string;
}

export interface Prenotazione {
  insegnamento: string | null;
  cfu: number | null;
  codice: string | null;
  docente: string | null;
  annoAccademico: string | null;
  tipologia: string | null;
  finePrenotazione: string | null; // ISO
  dataEsame: string | null; // ISO
  appello: string | null;
  posizione: number | null; // your place in the list of booked students
  prenotati: number | null;
  sede: string | null;
  turno: string | null;
  attiva: boolean;
  verbale: string | null;
  ref: PrenotazioneRef | null;
}

export interface PrenotazioniResponse {
  prenotazioni: Prenotazione[];
}

export interface ModuloPrenotazione {
  nome: string | null;
  docente: string | null;
  ssd: string | null;
  cfu: number | null;
}

export interface PrenotazioneDettaglio {
  insegnamento: string | null;
  docente: string | null;
  annoAccademico: string | null;
  dataEsame: string | null; // ISO
  orario: string | null;
  inizioPrenotazione: string | null; // ISO
  finePrenotazione: string | null; // ISO
  modalita: string | null;
  tipologia: string | null;
  appello: string | null;
  sessione: string | null;
  edificio: string | null;
  aula: string | null;
  comunicazioni: string | null;
  numeroPrenotazione: string | null;
  moduli: ModuloPrenotazione[];
}

// ---- Scheda insegnamento (calendario → info) ----

export interface ModuloInsegnamento {
  nome: string | null;
  cfu: number | null;
  ssd: string | null;
  docente: string | null;
  programma: string | null;
}

// Teacher-provided syllabus. Every text field is null when Delphi shows
// "Non Indicato", which is common.
export interface InfoInsegnamento {
  obiettivi: string | null;
  prerequisiti: string | null;
  metodiInsegnamento: string | null;
  metodiValutazione: string | null;
  // Programme of a course without modules; module programmes are in `moduli`.
  programma: string | null;
  moduli: ModuloInsegnamento[];
}

// ---- Iscrizione ai corsi (Frequenza corsi di insegnamento) ----

export interface CorsoIscrivibile {
  codice: string | null;
  nome: string | null;
  annoAccademico: string | null;
  cfu: number | null;
  docente: string | null;
  sessione: string | null; // "Sessione o Ciclo (o Sede)" column
  classeVirtuale: string | null;
  // Delphi's id for the "Iscriviti" form. Exposed for reference only: the
  // wrapper does not submit enrolments.
  id: string | null;
}

export interface CorsiResponse {
  corsi: CorsoIscrivibile[];
}

// ---- ISEE-U authorization ----

export interface AutorizzazioneIsee {
  annoAccademico: string | null;
  autorizzazione: string | null;
  dataAutorizzazione: string | null; // "DD/MM/YYYY hh:mm:ss" as shown by Delphi
  stato: string | null;
  ultimoAccessoInps: string | null;
  erroreInps: string | null;
  dataElaborazione: string | null;
  protocollo: string | null;
}

export interface IseeResponse {
  autorizzazioni: AutorizzazioneIsee[];
}

// ---- Tasse / bollettini ----

export interface RicevutaRef {
  bollettinoId: string | null;
  rataId: string | null;
  aa: string | null;
}

export interface Bollettino {
  numero: string | null;
  importo: number | null;
  causale: string | null;
  dataPagamento: string | null; // ISO
  iuv: string | null;
  dettaglio: string[];
  convalidatoPagoPa: boolean;
  ricevuta: RicevutaRef | null;
}

export interface Rata {
  numero: string | null;
  importo: number | null;
  scadenza: string | null; // ISO
  saldato: boolean;
  bollettini: Bollettino[];
}

export interface AnnoTasse {
  anno: string;
  isee: string | null;
  rate: Rata[];
}

export interface AltroBollettino {
  causale: string | null;
  importo: number | null;
  dataPagamento: string | null;
  pagato: boolean;
  annoAccademico: string | null;
  descrizione: string | null;
  iuv: string | null;
  ricevuta: RicevutaRef | null;
}

export interface TasseStudente {
  matricola: string | null;
  nome: string | null;
  cognome: string | null;
}

export interface IscrizioneSummary {
  anno: string | null;
  tipo: string | null;
  messaggio: string | null;
}

export interface SituazioneTasse {
  studente: TasseStudente;
  iscrizione: IscrizioneSummary;
  anni: AnnoTasse[];
  altriBollettini: AltroBollettino[];
}

// ---- Session ----

export type SessionState =
  | "logged_out"
  | "logging_in"
  | "logged_in"
  | "expired"
  | "failed";

export interface SessionInfo {
  state: SessionState;
  matricola: string | null;
  since: number | null;
  lastError: string | null;
}
