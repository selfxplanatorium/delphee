import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as anag from "../src/client/endpoints/anagrafica.js";
import * as carr from "../src/client/endpoints/carriera.js";
import * as boll from "../src/client/endpoints/bollettini.js";
import * as serv from "../src/client/endpoints/servizi.js";
import * as cert from "../src/client/endpoints/certificati.js";
import * as verb from "../src/client/endpoints/verbali.js";
import * as cal from "../src/client/endpoints/calendario.js";
import * as pianoGomp from "../src/client/endpoints/piano-gomp.js";
import * as pend from "../src/client/endpoints/esami-pendenti.js";
import * as pren from "../src/client/endpoints/prenotazioni.js";
import * as isee from "../src/client/endpoints/isee.js";
import * as corsi from "../src/client/endpoints/corsi.js";
import * as infoIns from "../src/client/endpoints/info-insegnamento.js";
import * as pianoPdf from "../src/client/endpoints/piano-pdf.js";
import { filterEsami, summarizeEsami } from "../src/client/endpoints/esami-search.js";

// Tests run against real Delphi HTML captured against two accounts (one
// graduated, one active). The fixtures are the parser contract: if Delphi
// changes its markup, these break first. PII inside the fixtures (names,
// emails, codice fiscale, exact addresses) has been replaced with synthetic
// values; assertions check parser SHAPE and INVARIANTS, not personal data.

const here = dirname(fileURLToPath(import.meta.url));
const BASE = "https://delphi.uniroma2.it";
const fx = (name: string) => readFileSync(join(here, "fixtures", name), "latin1");

describe("anagrafica", () => {
  const a = anag.parse(fx("datiStudente.real.html"), BASE);
  const dash = anag.parseDashboardCarriera(fx("dashboard.real.html"));

  it("extracts personal fields with correct shape", () => {
    expect(a.cognome).toMatch(/^[A-Z]+$/);
    expect(a.nome).toMatch(/^[A-Z]+$/);
    expect(a.codiceFiscale).toMatch(/^[A-Z0-9]{16}$/);
    expect(a.dataNascita).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.email).toMatch(/^[^@]+@[^@]+$/);
    expect(a.nazioneCittadinanza).toBe("ITALIA");
  });
  it("extracts career fields and normalises quirks", () => {
    expect(a.matricola).toMatch(/^\d{7}$/);
    expect(a.codiceCorso).toMatch(/^[A-Z0-9]+$/);
    expect(typeof a.annoCorso).toBe("number");
    expect(a.annoCorso).toBeGreaterThan(0);
    expect(a.annoCorsoLabel).toMatch(/FUORI CORSO|ANNO/);
    expect(a.aaUltimaIscrizione).toMatch(/^\d{4}\/\d{4}$/);
  });
  it("separates residenza and domicilio", () => {
    expect(a.residenza.indirizzo).toMatch(/^VIA /);
    expect(a.residenza.cap).toMatch(/^\d{5}$/);
    expect(a.domicilio.comune).toBeTruthy();
  });
  it("exposes the photo URL", () => {
    expect(a.fotoUrl).toContain("/Foto/visualizzaFoto");
  });
  it("parses laurea + stato from the dashboard", () => {
    expect(dash.statoCarriera).toBe("Carriera studente conclusa");
    expect(dash.laurea?.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dash.laurea?.votazione).toMatch(/^\d{3}\/110$/);
  });
  it("does not mark an active student concluded from the static phrase", () => {
    // The laureati landing page carries the literal "Carriera studente conclusa"
    // even for active students; without a completed laurea, stato must be null.
    const active = anag.parseDashboardCarriera(
      "<body>Carriera studente conclusa — Conseguita laurea triennale in LINGUE</body>",
    );
    expect(active.laurea).toBeNull();
    expect(active.statoCarriera).toBeNull();
  });
});

describe("carriera", () => {
  const c = carr.parse(fx("esamiVerbalizzati.real.html"));

  it("parses header + rendimento", () => {
    expect(c.header.matricola).toMatch(/^\d{7}$/);
    expect(c.rendimento.esamiValidi).toBeGreaterThan(0);
    expect(c.rendimento.cfuEsamiValidi).toBeGreaterThan(0);
    expect(c.rendimento.mediaAritmetica).toBeGreaterThan(0);
    expect(c.rendimento.mediaAritmetica).toBeLessThan(31);
  });
  it("parses a non-trivial number of esami", () => {
    expect(c.esami.length).toBeGreaterThan(10);
  });
  it("handles 30 e lode", () => {
    const lode = c.esami.find((e) => e.voto?.tipo === "trentesimi" && e.voto.lode);
    expect(lode).toBeTruthy();
    expect(lode?.votoLabel).toBe("30 e lode");
  });
  it("handles idoneità", () => {
    expect(c.esami.some((e) => e.stato === "idoneo")).toBe(true);
  });
  it("classifies giudizio grades (OTTIMO/BUONO) as passed, not in progress", () => {
    const g = c.esami.find((e) => ["OTTIMO", "BUONO", "DISTINTO"].includes(e.votoLabel ?? ""));
    expect(g).toBeTruthy();
    expect(g?.stato).toBe("superato");
    expect(g?.isPartial).toBe(false);
  });
  it("handles failed exams (RITIRATO in note column)", () => {
    expect(c.esami.some((e) => e.stato === "non_superato")).toBe(true);
  });
  it("parses numeric trentesimi labels", () => {
    const first = c.esami[0]!;
    expect(first.votoLabel).toMatch(/^\d{2}\/30$/);
    expect(first.stato).toBe("superato");
  });
});

describe("esami-search", () => {
  const c = carr.parse(fx("esamiVerbalizzati.real.html"));
  it("filters by stato", () => {
    expect(filterEsami(c.esami, { stato: "idoneo" }).every((e) => e.stato === "idoneo")).toBe(true);
  });
  it("summarizes", () => {
    const s = summarizeEsami(c.esami);
    expect(s.totale).toBe(c.esami.length);
    expect(s.superati + s.idonei).toBeGreaterThan(0);
    expect(s.cfuMedia).toBeGreaterThan(0);
  });
});

describe("bollettini", () => {
  const t = boll.parse(fx("situazioneRateNew.real.html"));
  it("parses studente + iscrizione", () => {
    expect(t.studente.matricola).toMatch(/^\d{7}$/);
    expect(t.iscrizione.anno).toMatch(/^\d{4}\/\d{4}$/);
    expect(t.iscrizione.tipo).toBeTruthy();
  });
  it("parses multiple anni accademici with ISEE", () => {
    expect(t.anni.length).toBeGreaterThanOrEqual(2);
    expect(t.anni[0]!.isee).toMatch(/^\d+$/);
  });
  it("parses a paid bollettino with dettaglio + pagoPA + ricevuta", () => {
    const paid = t.anni
      .flatMap((y) => y.rate)
      .flatMap((r) => r.bollettini)
      .find((b) => b.ricevuta?.bollettinoId);
    expect(paid?.importo).toBeGreaterThan(0);
    expect(paid?.convalidatoPagoPa).toBe(true);
    expect(paid?.ricevuta?.bollettinoId).toMatch(/^\d+$/);
    expect(paid?.dettaglio.some((d) => /Tassa regionale/.test(d))).toBe(true);
  });
});

describe("servizi", () => {
  const s = serv.parse(fx("sStudentiAttivaServizi.real.html"), BASE);
  it("parses the graduated student's three services with activation hrefs", () => {
    expect(s.servizi.length).toBe(3);
    expect(s.servizi.every((x) => x.path && x.path.startsWith("/totem/") && x.path.endsWith(".jsp"))).toBe(true);
    expect(s.servizi.some((x) => /Office365/i.test(x.nome))).toBe(true);
    expect(s.servizi.some((x) => /Mathematica/i.test(x.nome))).toBe(true);
    const office = s.servizi.find((x) => /Office365/i.test(x.nome));
    expect(office?.infoLink).toMatch(/^https?:\/\//);
  });
  it("parses the active student's five services and surfaces the docs link", () => {
    const active = serv.parse(fx("sStudentiAttivaServizi.active.real.html"), BASE);
    expect(active.servizi.length).toBe(5);
    const office = active.servizi.find((x) => /Office365/i.test(x.nome));
    expect(office?.descrizione).toMatch(/e-mail/);
    expect(office?.infoLink).toMatch(/^https?:\/\//);
    const matlab = active.servizi.find((x) => /MatLab/i.test(x.nome));
    expect(matlab?.descrizione).toBeNull();
    expect(matlab?.infoLink).toBeNull();
    expect(matlab?.path).toMatch(/OperazioneOK\.jsp/);
    // The active capture's MatLab href carries message= in the URL → code
    // is extracted at parse time, no fetch needed.
    expect(matlab?.codes).toHaveLength(1);
    expect(matlab?.codes[0]!.value).toMatch(/^[\d-]+$/);
    expect(matlab?.codes[0]!.label).toBeNull();
  });
  it("extracts the activation code from the activation page when not in the URL", () => {
    expect(serv.extractCodes(fx("attivazioneMatlab.real.html"))).toEqual([
      { label: null, value: expect.stringMatching(/^[\d-]+$/) },
    ]);
  });
  it("extracts the Wolfram activation URL from Mathematica's page", () => {
    expect(serv.extractCodes(fx("attivazioneMathematica.real.html"))).toEqual([
      { label: null, value: expect.stringMatching(/^https:\/\/user\.wolfram\.com\//) },
    ]);
  });
  it("extracts both labelled codes from the National Instruments sub-list", () => {
    const codes = serv.extractCodes(fx("attivazioneNationalInstruments.real.html"));
    expect(codes).toHaveLength(2);
    expect(codes.map((c) => c.value)).toEqual([expect.stringMatching(/^D11L\d+$/), expect.stringMatching(/^D11L\d+$/)]);
    expect(codes[0]!.label).toMatch(/LabVIEW/i);
    expect(codes[1]!.label).toMatch(/Multisim/i);
  });
  it("detects the MyCampusXApp 'Genera codice' action and resolves its path", () => {
    const page = fx("mycampusAttivazione.real.html");
    expect(serv.extractCodes(page)).toEqual([]); // no static code on the page
    const az = serv.extractAzione(page, BASE);
    expect(az?.label).toMatch(/genera/i);
    expect(az?.path).toBe("/totem/jsp/myCampus/richiestaAttivazione.jsp?Genera=si");
  });
  it("reads the generated code off the Genera result page", () => {
    expect(serv.extractGeneratedCode(fx("mycampusGenera.real.html"))).toMatch(/^[A-Z0-9]+$/);
  });
});

describe("certificati", () => {
  const c = cert.parse(fx("preIndexCertificati.real.html"));
  it("parses studente + certificate list", () => {
    expect(c.studente.matricola).toMatch(/^\d{7}$/);
    expect(c.certificati.length).toBe(3);
    const storico = c.certificati.find((x) => /storico/i.test(x.nome));
    expect(storico?.parametri.tipo).toBe("2");
  });
  it("parses the limit note", () => {
    expect(c.limiteNote).toMatch(/Attenzione/i);
  });
  it("parses the active student's single cert", () => {
    const active = cert.parse(fx("preIndexCertificati.active.real.html"));
    expect(active.studente.matricola).toMatch(/^\d{7}$/);
    expect(active.certificati.length).toBe(1);
    expect(active.certificati[0]!.path).toBe("certificatoIscrizione.jsp");
    expect(active.certificati[0]!.parametri.tipo).toBe("1");
  });
});

describe("calendario", () => {
  const rows = cal.parse(fx("calendarioEsami.real.html"));

  it("flattens the rowspan grouping into one row per appello", () => {
    expect(rows.length).toBeGreaterThan(200);
    const gruppi = new Set(rows.map((r) => r.idCorIns));
    expect(gruppi.size).toBe(30);
    // Every appello of a group inherits the group's insegnamento/docente.
    expect(rows.every((r) => r.insegnamento.length > 0)).toBe(true);
  });

  it("parses dates, codes and the traffic-light stato", () => {
    const first = rows[0]!;
    expect(first.dataEsame).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.inizioPrenotazione).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.finePrenotazione).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.codice).toMatch(/^\d+$/);
    expect(first.ora).toMatch(/^\d{2}:\d{2}$/);
    expect(["aperto", "chiuso", "sconosciuto"]).toContain(first.stato);
    // The fixture (captured in July) has at least one open appello estivo.
    expect(rows.some((r) => r.stato === "aperto")).toBe(true);
  });

  it("returns [] when Delphi renders no results table", () => {
    expect(cal.parse("<html><body><table><tr><td>foo</td></tr></table></body></html>")).toEqual([]);
  });
});

describe("piano-gomp", () => {
  const ELENCO = "https://uniroma2studenti.gomp.it/WorkFlow2011/Studenti/Composer/ElencoPiani.aspx";
  const piani = pianoGomp.parse(fx("elencoPiani.gomp.real.html"), ELENCO);

  it("parses the piano listing rows", () => {
    expect(piani).toHaveLength(1);
    const p = piani[0]!;
    expect(p.aa).toMatch(/^\d{4}\/\d{4}$/);
    expect(p.ultimaModifica).toMatch(/^\d{2}\/\d{2}\/\d{4}/);
    expect(p.denominazione).toBeTruthy();
    expect(p.status).toBe("Approvato");
    expect(p.ps).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("resolves the page-relative composer link against the listing URL", () => {
    expect(piani[0]!.composerUrl).toBe(
      "https://uniroma2studenti.gomp.it/WorkFlow2011/Studenti/Composer/Composer.aspx?PS=11111111-1111-1111-1111-111111111111&CodiceAteneo=",
    );
  });

  it("returns [] on the GOMP login page (SSO failed)", () => {
    expect(pianoGomp.parse("<html><body><form>UserName</form></body></html>", ELENCO)).toEqual([]);
  });
});

describe("verbali", () => {
  const v = verb.parse(fx("verbaliNonChiusi.real.html"));
  it("parses the riepilogo header", () => {
    expect(v.header.matricola).toMatch(/^\d{7}$/);
    expect(v.header.studente).toMatch(/^[A-Z]+ [A-Z]+$/);
    expect(v.header.cdl).toBeTruthy();
  });
  it("parses the single open verbale", () => {
    expect(v.verbali.length).toBe(1);
    const row = v.verbali[0]!;
    expect(row.nome).toBeTruthy();
    expect(row.docente).toMatch(/^[A-Z]+ [A-Z]+$/); // "Prof." prefix stripped
    expect(row.annoAccademico).toMatch(/^\d{4}\/\d{4}$/);
    expect(row.data).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row.cfu).toBeGreaterThan(0);
    expect(row.verbale).toMatch(/^[A-Z0-9-]+$/);
  });
});

describe("esami pendenti", () => {
  const p = pend.parse(fx("esamiPendenti.real.html"));
  it("parses the riepilogo header", () => {
    expect(p.header.matricola).toMatch(/^\d{7}$/);
    expect(p.header.cdl).toBeTruthy();
  });
  it("returns an empty list when the page says 'Non ci sono esami'", () => {
    expect(p.esami.length).toBe(0);
  });
});

describe("prenotazioni", () => {
  const p = pren.parse(fx("visualizzaPrenotazioni.real.html"));
  it("parses every booking row", () => {
    expect(p.prenotazioni.length).toBe(11);
  });
  it("extracts dates, position, and the Dettagli/Ristampa form fields", () => {
    const first = p.prenotazioni[0]!;
    expect(first.insegnamento).toBe("LINGUA POLACCA 2 (UNICO)");
    expect(first.cfu).toBe(12);
    expect(first.annoAccademico).toBe("2025/2026");
    expect(first.dataEsame).toBe("2026-06-17");
    expect(first.finePrenotazione).toBe("2026-06-14");
    expect(first.posizione).toBe(2);
    expect(first.prenotati).toBe(2);
    expect(first.attiva).toBe(false);
    expect(first.verbale).toMatch(/^LETT-\d+$/);
    expect(first.ref).toEqual({ id: "4824144", index: "0", ordine: "2" });
  });
  it("maps the '---' verbale marker to null", () => {
    expect(p.prenotazioni.some((x) => x.verbale === null)).toBe(true);
  });
  it("returns an empty list when the page says 'Non risultano prenotazioni'", () => {
    expect(pren.parse(fx("visualizzaPrenotazioni.empty.real.html")).prenotazioni).toEqual([]);
  });
});

describe("prenotazione dettaglio", () => {
  const d = pren.parseDettaglio(fx("dettagliPrenotazione.real.html"));
  it("reads the label/value rows", () => {
    expect(d.insegnamento).toBe("LINGUA POLACCA 2 (UNICO)");
    expect(d.dataEsame).toBe("2026-06-17");
    expect(d.orario).toBe("11:00");
    expect(d.modalita).toBe("ORALE");
    expect(d.sessione).toBe("ESTIVA");
    expect(d.edificio).toBe("B");
    expect(d.aula).toBe("STUDIO 38");
    expect(d.comunicazioni).toBeNull();
  });
  it("reads the moduli table", () => {
    expect(d.moduli).toHaveLength(2);
    expect(d.moduli[0]).toMatchObject({ ssd: "L-LIN/21", cfu: 6 });
  });
});

describe("isee", () => {
  const i = isee.parse(fx("autorizzazioneIsee.real.html"));
  it("reads one authorization per academic year and skips the header row", () => {
    expect(i.autorizzazioni).toHaveLength(1);
    expect(i.autorizzazioni[0]).toMatchObject({
      annoAccademico: "2026/2027",
      erroreInps: null,
      protocollo: "INPS-ISEE-2026-00000000X-00",
    });
    expect(i.autorizzazioni[0]!.stato).toMatch(/tasse calcolate/);
  });
});

describe("corsi iscrivibili", () => {
  const c = corsi.parse(fx("visualizzaIscrivibili.real.html")).corsi;
  it("parses every course row", () => {
    expect(c).toHaveLength(18);
  });
  it("splits the code from the name and reads the Iscriviti id", () => {
    expect(c[0]).toEqual({
      codice: "804001392",
      nome: "ABILITA' INFORMATICHE E TELEMATICHE",
      annoAccademico: "2025/2026",
      cfu: 2,
      docente: "BARANIELLO VINCENZO",
      sessione: "UNICO",
      classeVirtuale: "Attivata",
      id: "12719",
    });
  });
  it("ignores markup nested in the description cell", () => {
    expect(c[3]!.nome).toBe("LETTERATURA INGLESE 1");
  });
});

describe("info insegnamento", () => {
  it("reads a course without modules, including textarea and iframe values", () => {
    const i = infoIns.parse(fx("infoEsame.real.html"));
    expect(i.obiettivi).toMatch(/^OBIETTIVI FORMATIVI/);
    expect(i.prerequisiti).toBe("Buona conoscenza della Lingua italiana.\nConoscenza di base della Letteratura italiana.");
    expect(i.metodiInsegnamento).toBe("FRONTALE");
    expect(i.metodiValutazione).toBe("ORALE");
    expect(i.programma).toContain("valido per 12 cfu per i corsi di laurea in:");
    expect(i.moduli).toEqual([]);
  });
  it("reads module headers and maps 'Non Indicato' to null", () => {
    const i = infoIns.parse(fx("infoEsame.moduli.real.html"));
    expect(i.obiettivi).toBeNull();
    expect(i.programma).toBeNull();
    expect(i.moduli).toHaveLength(2);
    expect(i.moduli[0]).toEqual({ nome: "LETTERATURA ANGLO-AMERICANA 1 A", cfu: 6, ssd: "L-LIN/11", docente: "MARINO ELISABETTA", programma: null });
  });
});

describe("piano pdf", () => {
  // Positioned text items from a real GOMP plan PDF (extractItems output);
  // the header and footer, which carry the student's name, are replaced.
  const esami = pianoPdf.parse(JSON.parse(readFileSync(join(here, "fixtures", "pianoPdf.items.json"), "utf8")));
  it("reads every exam and the full 180 CFU", () => {
    expect(esami).toHaveLength(20);
    expect(esami.reduce((s, e) => s + (e.cfu ?? 0), 0)).toBe(180);
  });
  it("assigns year, group, TAF, and SSD", () => {
    expect(esami[0]).toEqual({
      codice: "8048033", nome: "LETTERATURA ITALIANA", cfu: 12, annoCorso: "1",
      ssd: "L-FIL-LET/10", taf: "A", gruppo: "Insegnamenti obbligatori",
    });
    expect(esami.filter((e) => e.annoCorso === "3").map((e) => e.codice)).toContain("804001080");
  });
  it("joins names that wrap onto a second line", () => {
    expect(esami.find((e) => e.codice === "8047674")!.nome).toBe("FONDAMENTI DI GLOTTOLOGIA E LINGUISTICA");
  });
  it("keeps elective groups that continue on the next page under their year", () => {
    const quadro7 = esami.find((e) => e.gruppo?.startsWith("QUADRO 7"))!;
    expect(quadro7).toMatchObject({ codice: "8047851", annoCorso: "1", cfu: 6 });
  });
  it("leaves the SSD empty for activities without one", () => {
    expect(esami.find((e) => e.codice === "804001080")).toMatchObject({ taf: "E", ssd: null, cfu: 6 });
  });
});
