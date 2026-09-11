// Offline demo user, for UI testing without ever touching Delphi.
//
// Logging in as matricola 0000000 / password "demo" mints a normal session
// whose data comes entirely from the canned fixtures below — no network, no
// real student, no credentials at risk. The seam is deliberately narrow: a
// pre-seeded Session (so registry/status/middleware treat it like any logged-in
// user) plus a DemoApi that overrides every fetching method with static data.
// DemoSession.request() throws, so if a method were ever missed it fails loud
// and offline instead of silently calling the real portal.

import { Fetcher } from "../client/fetcher.js";
import { Session } from "../client/session.js";
import { Api } from "./api.js";
import type { ProxyResponse } from "../client/fetcher.js";
import type {
  Anagrafica,
  Appello,
  CarrieraResponse,
  CertificatiResponse,
  EsamiPendentiResponse,
  Piano,
  RicevutaRef,
  ServiziResponse,
  SituazioneTasse,
  VerbaliResponse,
} from "../types.js";

export const DEMO_MATRICOLA = "0000000";
const DEMO_PASSWORD = "demo";

export function isDemoLogin(matricola: string, password: string): boolean {
  return matricola === DEMO_MATRICOLA && password === DEMO_PASSWORD;
}

// A Session that is logged in from birth and refuses to hit the network.
class DemoSession extends Session {
  async request<T>(): Promise<T> {
    throw new Error("demo session performs no network requests");
  }
}

export function createDemoSession(baseUrl: string): { session: Session; close(): Promise<void> } {
  // The fetcher is never used (DemoApi serves everything), but Session needs one
  // and close() must be valid for the registry. No request is ever issued.
  const fetcher = Fetcher.create(baseUrl, 0);
  const session = new DemoSession(fetcher, { matricola: DEMO_MATRICOLA });
  return { session, close: () => fetcher.close() };
}

/* ----------------------------- canned data ----------------------------- */

const STUDENTE = "Mario Rossi";
const CDL = "Ingegneria Informatica";

const DEMO_CARRIERA: CarrieraResponse = {
  header: { studente: STUDENTE, matricola: DEMO_MATRICOLA, cdl: CDL },
  esami: [
    { numero: 1, codice: "8039245", nome: "Analisi Matematica I", ssd: "MAT/05", annoAccademico: "2021/2022", data: "2022-02-10", cfu: 9, voto: { tipo: "trentesimi", valore: 28, lode: false }, votoLabel: "28", note: null, tipoAttivita: null, verbale: "V-001", stato: "superato", isPartial: false },
    { numero: 2, codice: "8039246", nome: "Fondamenti di Informatica", ssd: "ING-INF/05", annoAccademico: "2021/2022", data: "2022-06-22", cfu: 12, voto: { tipo: "trentesimi", valore: 30, lode: true }, votoLabel: "30 e lode", note: null, tipoAttivita: null, verbale: "V-002", stato: "superato", isPartial: false },
    { numero: 3, codice: "8039247", nome: "Fisica Generale", ssd: "FIS/01", annoAccademico: "2021/2022", data: "2022-09-05", cfu: 9, voto: { tipo: "trentesimi", valore: 25, lode: false }, votoLabel: "25", note: null, tipoAttivita: null, verbale: "V-003", stato: "superato", isPartial: false },
    { numero: 4, codice: "8039248", nome: "Lingua Inglese B2", ssd: null, annoAccademico: "2021/2022", data: "2022-11-03", cfu: 3, voto: { tipo: "qualifica", valore: "IDONEO" }, votoLabel: "IDONEO", note: null, tipoAttivita: null, verbale: "V-004", stato: "idoneo", isPartial: false },
    { numero: 5, codice: "8039249", nome: "Algoritmi e Strutture Dati", ssd: "ING-INF/05", annoAccademico: "2022/2023", data: "2023-02-15", cfu: 9, voto: { tipo: "trentesimi", valore: 27, lode: false }, votoLabel: "27", note: null, tipoAttivita: null, verbale: "V-005", stato: "superato", isPartial: false },
    { numero: 6, codice: "8039250", nome: "Basi di Dati", ssd: "ING-INF/05", annoAccademico: "2022/2023", data: "2023-07-01", cfu: 6, voto: { tipo: "trentesimi", valore: 30, lode: false }, votoLabel: "30", note: null, tipoAttivita: null, verbale: "V-006", stato: "superato", isPartial: false },
    { numero: 7, codice: "8039299", nome: "Reti di Calcolatori", ssd: "ING-INF/03", annoAccademico: "2023/2024", data: null, cfu: 9, voto: null, votoLabel: null, note: null, tipoAttivita: null, verbale: null, stato: "in_corso", isPartial: false },
  ],
  rendimento: {
    esamiValidi: 5,
    cfuEsamiValidi: 45,
    idoneita: 1,
    cfuIdoneita: 3,
    mediaAritmetica: 28.0,
    mediaPonderata: 28.0,
  },
};

const DEMO_ANAGRAFICA: Anagrafica = {
  cognome: "Rossi", nome: "Mario", codiceFiscale: "RSSMRA02A01H501Z",
  dataNascita: "2002-01-01", comuneNascita: "Roma", provinciaNascita: "RM",
  nazioneCittadinanza: "ITALIA", cellulare: "+39 333 1234567",
  email: "mario.rossi@students.uniroma2.eu", skype: null,
  residenza: { indirizzo: "Via Roma 1", comune: "Roma", provincia: "RM", cap: "00100", telefono: null },
  domicilio: { indirizzo: "Via del Politecnico 1", comune: "Roma", provincia: "RM", cap: "00133", telefono: null },
  matricola: DEMO_MATRICOLA, facolta: "Ingegneria", corso: CDL,
  tipologiaCorso: "Laurea Triennale", sedeCorso: "Roma", codiceCorso: "H45",
  annoCorso: 3, annoCorsoLabel: "3 anno", aaImmatricolazione: "2021/2022",
  aaUltimaIscrizione: "2023/2024", statoCarriera: "Attiva", laurea: null, fotoUrl: null,
};

const DEMO_TASSE: SituazioneTasse = {
  studente: { matricola: DEMO_MATRICOLA, nome: "Mario", cognome: "Rossi" },
  iscrizione: { anno: "2023/2024", tipo: "In corso", messaggio: "Iscrizione regolare per l'anno accademico 2023/2024." },
  anni: [
    {
      anno: "2023/2024", isee: "18.500",
      rate: [
        { numero: "1", importo: 156.0, scadenza: "2023-10-31", saldato: true, bollettini: [
          { numero: "B-2023-001", importo: 156.0, causale: "Prima rata", dataPagamento: "2023-10-20", iuv: "IT00123456789", dettaglio: [], convalidatoPagoPa: true, ricevuta: { bollettinoId: "1001", rataId: "1", aa: "2023/2024" } },
        ] },
        { numero: "2", importo: 300.0, scadenza: "2024-03-31", saldato: false, bollettini: [] },
      ],
    },
  ],
  altriBollettini: [
    { causale: "Imposta di bollo", importo: 16.0, dataPagamento: "2023-10-20", pagato: true, annoAccademico: "2023/2024", descrizione: null, iuv: "IT00987654321", ricevuta: { bollettinoId: "1002", rataId: null, aa: "2023/2024" } },
  ],
};

const DEMO_SERVIZI: ServiziResponse = {
  servizi: [
    { nome: "Office 365 Education", descrizione: "Suite Microsoft per studenti.", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp?Entra=demoOffice", codes: [], azione: null, infoLink: null },
    { nome: "MATLAB", descrizione: "Licenza campus MathWorks.", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp?Entra=demoMatlab", codes: [{ label: null, value: "DEMO-MATLAB-1234" }], azione: null, infoLink: "https://www.mathworks.com" },
    { nome: "MyCampusXApp", descrizione: "Codice di attivazione su richiesta.", path: "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp?Entra=demoMyCampus", codes: [], azione: { label: "Genera codice", path: "/totem/jsp/Iscrizioni/richiestaAttivazione.jsp?Genera=si" }, infoLink: null },
  ],
};

const DEMO_CERTIFICATI: CertificatiResponse = {
  studente: { cognome: "Rossi", nome: "Mario", matricola: DEMO_MATRICOLA, corso: CDL, tipologiaCorso: "Laurea Triennale", codiceCorso: "H45" },
  certificati: [
    { nome: "Certificato di iscrizione", path: "certificatoIscrizione.jsp", parametri: { tipo: "N" } },
    { nome: "Certificato esami sostenuti", path: "certificatoEsami.jsp", parametri: { tipo: "N" } },
  ],
  limiteNote: "Certificati fittizi (utente demo).",
};

const DEMO_VERBALI: VerbaliResponse = {
  header: { studente: STUDENTE, matricola: DEMO_MATRICOLA, cdl: CDL },
  verbali: [
    { numero: 42, nome: "Reti di Calcolatori", docente: "Prof. Bianchi", annoAccademico: "2023/2024", data: "2024-06-10", cfu: 9, verbale: "V-2024-042" },
  ],
};

const DEMO_PENDENTI: EsamiPendentiResponse = {
  header: { studente: STUDENTE, matricola: DEMO_MATRICOLA, cdl: CDL },
  esami: [
    { numero: 1, codice: "8039299", nome: "Reti di Calcolatori", ssd: "ING-INF/03", annoAccademico: "2023/2024", data: "2024-06-10", cfu: 9, esito: "Superato", voto: "29", verbale: null },
  ],
};

const DEMO_PIANO: Piano = {
  cdl: CDL, annoCorso: "3",
  esami: [
    { codice: "8039245", nome: "Analisi Matematica I", cfu: 9, annoCorso: "1", stato: "superato" },
    { codice: "8039299", nome: "Reti di Calcolatori", cfu: 9, annoCorso: "3", stato: "in_corso" },
    { codice: "8039300", nome: "Ingegneria del Software", cfu: 9, annoCorso: "3", stato: "da_fare" },
  ],
  piani: [
    { aa: "2024/2025", ultimaModifica: "04/10/2024 09:47:21", denominazione: "Curriculum unico", status: "Approvato", composerUrl: "https://uniroma2studenti.gomp.it" },
  ],
  composerUrl: "https://delphi.uniroma2.it",
};

const DEMO_APPELLI: Appello[] = [
  { codice: "8039299", insegnamento: "Reti di Calcolatori", data: "2024-07-15", postiDisponibili: 48, postiTotali: 60, iscritti: 12, stato: "aperto" },
];

// A minimal but valid single-page PDF with correct xref offsets, so the demo's
// "Ricevuta" / "Stampa" buttons render a real document inline.
function demoPdf(text: string): Buffer {
  const objs = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 140]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  const stream = `BT /F1 16 Tf 36 90 Td (${text}) Tj ET`;
  objs.push(`<</Length ${stream.length}>>stream\n${stream}\nendstream`);
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj${o}endobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<</Size ${objs.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/* ------------------------------- DemoApi ------------------------------- */

// Overrides every fetching method of Api with static data. getEsami is left to
// the base class: it calls this.getCarriera() (overridden here) and runs the
// real filter/summary logic on the canned exams.
export class DemoApi extends Api {
  async getCarriera() { return { response: DEMO_CARRIERA, stale: false }; }
  async getAnagrafica() { return { response: DEMO_ANAGRAFICA, stale: false }; }
  async getBollettini() { return { response: DEMO_TASSE, stale: false }; }
  async getServizi() { return { response: DEMO_SERVIZI, stale: false }; }
  async getServizioDettaglio(_path: string) {
    return { codes: [], azione: null };
  }
  async getCertificati() { return { response: DEMO_CERTIFICATI, stale: false }; }
  async getVerbali() { return { response: DEMO_VERBALI, stale: false }; }
  async getEsamiPendenti() { return { response: DEMO_PENDENTI, stale: false }; }
  async getPiano() { return { response: DEMO_PIANO, stale: false }; }
  async getAppelli(_insegnamento: string) { return { response: DEMO_APPELLI, stale: false }; }

  async getRicevuta(_ref: RicevutaRef): Promise<{ body: Buffer; contentType: string }> {
    return { body: demoPdf("Delphee demo - ricevuta fittizia"), contentType: "application/pdf" };
  }

  async getCertificato(path: string, _params: Record<string, string>): Promise<{ body: Buffer; contentType: string; filename: string }> {
    return { body: demoPdf("Delphee demo - certificato fittizio"), contentType: "application/pdf", filename: `demo-${path.replace(/\.jsp.*/, "")}.pdf` };
  }

  async generaCodice(_ctxPath: string, _azionePath: string): Promise<{ code: string | null }> {
    return { code: "DEMO-A1B2C3" };
  }

  async proxyPage(): Promise<ProxyResponse> {
    const body = Buffer.from(
      "<!doctype html><meta charset=utf-8><body style=\"font-family:sans-serif;padding:2rem\"><h1>Demo</h1><p>L'utente demo non apre pagine reali del portale Delphi.</p>",
      "utf8",
    );
    return { status: 200, body, contentType: "text/html; charset=utf-8", location: null };
  }
}
