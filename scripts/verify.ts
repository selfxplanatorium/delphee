import { readFileSync } from "node:fs";
import * as anag from "../src/client/endpoints/anagrafica.js";
import * as carr from "../src/client/endpoints/carriera.js";
import * as boll from "../src/client/endpoints/bollettini.js";
import * as serv from "../src/client/endpoints/servizi.js";
import * as cert from "../src/client/endpoints/certificati.js";
import { summarizeEsami } from "../src/client/endpoints/esami-search.js";

// Parser smoke-check against the live captures. Not a test framework — just a
// fast eyeball of "did every parser pull real data out of real HTML".

const BASE = "https://delphi.uniroma2.it";
const read = (acct: string, name: string) =>
  readFileSync(`captures/${acct}/${name}.html`, "latin1");

for (const acct of ["graduated", "active"]) {
  console.log(`\n========== ${acct} ==========`);

  const a = anag.parse(read(acct, "datiStudente"), BASE);
  const dash = anag.parseDashboardCarriera(read(acct, "dashboard-laureati"));
  console.log("ANAGRAFICA:", {
    nome: `${a.nome} ${a.cognome}`,
    cf: a.codiceFiscale,
    nascita: a.dataNascita,
    email: a.email,
    corso: a.corso,
    codiceCorso: a.codiceCorso,
    anno: a.annoCorsoLabel,
    immatr: a.aaImmatricolazione,
    ultima: a.aaUltimaIscrizione,
    foto: a.fotoUrl ? "yes" : "no",
    residenza: a.residenza.indirizzo,
    stato: dash.statoCarriera,
    laurea: dash.laurea,
  });

  const c = carr.parse(read(acct, "esamiVerbalizzati"));
  const s = summarizeEsami(c.esami);
  console.log("CARRIERA:", { header: c.header, rendimento: c.rendimento, nEsami: c.esami.length });
  console.log("  first 3 esami:", c.esami.slice(0, 3).map((e) => ({ nome: e.nome, voto: e.votoLabel, cfu: e.cfu, stato: e.stato })));
  console.log("  summary:", s);
  const lode = c.esami.find((e) => e.voto?.tipo === "trentesimi" && e.voto.lode);
  const idoneo = c.esami.find((e) => e.stato === "idoneo");
  console.log("  lode sample:", lode?.nome, "| idoneo sample:", idoneo?.nome);

  const t = boll.parse(read(acct, "situazioneRateNew"));
  console.log("TASSE:", {
    studente: t.studente,
    iscrizione: t.iscrizione,
    nAnni: t.anni.length,
    anni: t.anni.map((y) => ({ anno: y.anno, isee: y.isee, rate: y.rate.length, boll: y.rate.reduce((n, r) => n + r.bollettini.length, 0) })),
    altri: t.altriBollettini.length,
  });
  const firstBoll = t.anni.flatMap((y) => y.rate).flatMap((r) => r.bollettini)[0];
  console.log("  first bollettino:", firstBoll && { importo: firstBoll.importo, causale: firstBoll.causale, iuv: firstBoll.iuv, pagoPA: firstBoll.convalidatoPagoPa, dettaglio: firstBoll.dettaglio, ricevuta: firstBoll.ricevuta });

  const sv = serv.parse(read(acct, "sStudentiAttivaServizi"), BASE);
  console.log("SERVIZI:", sv.servizi.map((x) => x.nome));

  const ce = cert.parse(read(acct, "preIndexCertificati"));
  console.log("CERTIFICATI:", { studente: ce.studente.matricola, certs: ce.certificati.map((x) => `${x.nome} (${x.path})`), limite: ce.limiteNote?.slice(0, 60) });
}
