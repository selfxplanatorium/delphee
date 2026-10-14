import type { Session } from "../client/session.js";
import { looksLikeLoginPage } from "../client/session.js";
import type { ProxyResponse, FetcherBinaryResponse, RequestInitLike } from "../client/fetcher.js";
import type { CacheStore } from "../cache/store.js";
import type { AppConfig } from "../config.js";
import { CachePolicy } from "../cache/policies.js";
import { NonRetryableError } from "../utils/retry.js";
import { logger } from "../logger.js";

import * as anagraficaParser from "../client/endpoints/anagrafica.js";
import * as carrieraParser from "../client/endpoints/carriera.js";
import * as bollettiniParser from "../client/endpoints/bollettini.js";
import * as serviziParser from "../client/endpoints/servizi.js";
import * as certificatiParser from "../client/endpoints/certificati.js";
import * as pianoParser from "../client/endpoints/piano.js";
import * as pianoGompParser from "../client/endpoints/piano-gomp.js";
import * as pianoPdfParser from "../client/endpoints/piano-pdf.js";
import { GompClient, type GompProxyResponse } from "../client/gomp.js";
import * as appelliParser from "../client/endpoints/appelli.js";
import * as calendarioParser from "../client/endpoints/calendario.js";
import * as verbaliParser from "../client/endpoints/verbali.js";
import * as esamiPendentiParser from "../client/endpoints/esami-pendenti.js";
import * as prenotazioniParser from "../client/endpoints/prenotazioni.js";
import * as iseeParser from "../client/endpoints/isee.js";
import * as corsiParser from "../client/endpoints/corsi.js";
import * as infoInsegnamentoParser from "../client/endpoints/info-insegnamento.js";
import { load } from "../client/endpoints/util.js";
import { calendar, prenotazioniCalendar } from "./ics.js";
import { buildInsights, tentativiPer, type CarrieraInsights, type StoriaEsame } from "../insights/carriera.js";
import { pianificaSessione, type PianoSessione } from "../insights/sessione.js";
import { filterEsami, summarizeEsami } from "../client/endpoints/esami-search.js";

import type {
  Anagrafica,
  CarrieraResponse,
  EsamiFilter,
  EsamiResponse,
  Piano,
  PianoEsame,
  PianoGomp,
  SituazioneTasse,
  ServiziResponse,
  CertificatiResponse,
  Appello,
  AppelloCalendario,
  CalendarioQuery,
  RicevutaRef,
  VerbaliResponse,
  EsamiPendentiResponse,
  PrenotazioniResponse,
  PrenotazioneRef,
  PrenotazioneDettaglio,
  IseeResponse,
  CorsiResponse,
  InfoInsegnamento,
} from "../types.js";

// Paths. Most data lives under /Iscrizioni; certificati and piano under
// /studenti. Piano resolves to GOMP (out of scope) for our accounts, so it
// degrades to an empty piano + a composerUrl the SPA opens in the portal.
const PATH_DASHBOARD = "/totem/jsp/Iscrizioni/sStudentiLaureatiLogin.jsp?language=IT";
const PATH_ANAGRAFICA = "/totem/jsp/Iscrizioni/datiStudente.jsp";
const PATH_CARRIERA = "/totem/jsp/Iscrizioni/esamiVerbalizzati.jsp";
const PATH_TASSE = "/totem/jsp/Iscrizioni/situazioneRateNew.jsp";
const PATH_SERVIZI = "/totem/jsp/Iscrizioni/sStudentiAttivaServizi.jsp";
const PATH_CERTIFICATI = "/totem/jsp/studenti/stampaCertificati/preIndexCertificati.jsp";
const PATH_CERTIFICATI_BASE = "/totem/jsp/studenti/stampaCertificati";
const PATH_PIANO = "/totem/jsp/studenti/pianoDiStudi/index.jsp";
const PATH_GOMP_ELENCO = "/WorkFlow2011/Studenti/Composer/ElencoPiani.aspx";
const PATH_GOMP_COMPOSER = "/WorkFlow2011/Studenti/Composer/Composer.aspx";
const PATH_VERBALI = "/totem/jsp/studenti/esami/verbaliNonChiusi.jsp";
const PATH_ESAMI_PENDENTI = "/totem/jsp/studenti/esami/esamiPendenti.jsp";
const PATH_PRENOTAZIONI_MENU = "/totem/jsp/prenotazioni/menuPrenotazioni.jsp";
const PATH_PRENOTAZIONI_BASE = "/totem/jsp/prenotazioni";
const PATH_ISEE = "/totem/jsp/studenti/autorizzaAccessoInps/autorizzazione.jsp";
const PATH_CORSI_BASE = "/totem/jsp/IscCorsiStudente";
const PATH_DOMANDA_ISCRIZIONE = "/totem/jsp/Iscrizioni/StampaDomandaEngine.jsp";

// Current academic year in Delphi's "aaaa/aaaa" form (AA starts in September).
function currentAA(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}/${y + 1}` : `${y - 1}/${y}`;
}

// A GOMP request that lands on a login page instead of content: either GOMP's
// own Logon.aspx (expired session) or Delphi's login form (GOMP refused the
// student, as it does for graduated accounts).
function isGompLoginBounce(res: GompProxyResponse): boolean {
  return res.status >= 300 && res.status < 400 && /logon\.aspx|sStudentiLogin/i.test(res.location ?? "");
}

// GOMP and Delphi both live under the wrapper's origin (the GOMP mirror and
// /totem/*), so an absolute Location on either host becomes a local path.
function mirrorLocation(location: string, delphiBaseUrl: string): string {
  try {
    const u = new URL(location, "https://uniroma2studenti.gomp.it");
    if (u.hostname.endsWith("gomp.it") || u.origin === new URL(delphiBaseUrl).origin) {
      return u.pathname + u.search;
    }
    return u.href;
  } catch {
    return location;
  }
}

export interface ApiDeps {
  session: Session;
  store: CacheStore;
  config: AppConfig;
}

type CacheOutcome<T> = { kind: "ok" | "stale"; data: T };

export class Api {
  constructor(private readonly deps: ApiDeps) {}

  // Cache keys MUST be namespaced by account, or a second user serves the first
  // user's cached data (carriera/esami are cached forever). The Api is only
  // built for an authenticated session, so the matricola is always present.
  private key(base: string): string {
    const m = this.deps.session.info().matricola;
    if (!m) throw new Error("api used without an authenticated session");
    return `${m}:${base}`;
  }

  static isInvalidCredentials(err: unknown): boolean {
    return err instanceof NonRetryableError && err.message === "invalid_credentials";
  }

  // Cache → loader → stale-fallback. The stale flag becomes X-Cache-Stale.
  private async withCache<T>(
    key: string,
    ttlMs: number,
    loader: () => Promise<T>,
  ): Promise<CacheOutcome<T>> {
    const hit = this.deps.store.get(key);
    if (hit) {
      try {
        return { kind: "ok", data: JSON.parse(hit) as T };
      } catch {
        this.deps.store.delete(key);
      }
    }
    try {
      const data = await this.deps.store.coalesce(key, async () => {
        const loaded = await loader();
        this.deps.store.set(key, JSON.stringify(loaded), ttlMs);
        return loaded;
      });
      return { kind: "ok", data };
    } catch (err) {
      if (Api.isInvalidCredentials(err)) throw err;
      const stale = this.deps.store.getStale(key);
      if (stale) {
        // Log the field only, never the full key — its `<matricola>:` prefix is
        // PII and pino's redaction (matricola path) does not cover the `key`
        // field name.
        logger.warn({ err, field: key.slice(key.indexOf(":") + 1) }, "live fetch failed; serving stale cache");
        return { kind: "stale", data: JSON.parse(stale) as T };
      }
      throw err;
    }
  }

  // All HTML data pages flow through here. The login-page check runs INSIDE
  // session.request's callback so that a silently-dead Delphi session (which
  // answers with the login form instead of a 401) is seen as an auth failure
  // and triggers the session's re-login-and-retry path, rather than being
  // parsed as "empty" and surfaced as a spurious delphi_unavailable.
  private fetchBody(path: string): Promise<string> {
    return this.deps.session.request(async (f) => {
      const res = await f.get(path);
      if (looksLikeLoginPage(res.body)) {
        throw new NonRetryableError("session_lost");
      }
      return res.body;
    });
  }

  // Binary sibling of fetchBody, for the PDF endpoints. Delphi answers a dropped
  // session with the HTML login form even when a PDF was requested, so a
  // text/html body on a binary endpoint means we were bounced — surface it as a
  // lost session (re-login + retry) instead of streaming a login page to the
  // browser as a corrupt download. application/pdf responses skip the decode.
  private fetchBinaryAuthed(
    path: string,
    init?: RequestInitLike,
  ): Promise<FetcherBinaryResponse> {
    return this.deps.session.request(async (f) => {
      const res = await f.fetchBinary(path, init);
      if (/text\/html/i.test(res.contentType) && looksLikeLoginPage(res.body.toString("latin1"))) {
        throw new NonRetryableError("session_lost");
      }
      return res;
    });
  }

  // The student photo sits behind the Delphi session, so the browser can't load
  // it directly. Fetch it server-side and inline it as a data URI (cached with
  // the rest of anagrafica). Returns null on failure rather than breaking the
  // whole response.
  private async embedFoto(url: string): Promise<string | null> {
    try {
      const res = await this.deps.session.request((f) => f.fetchBinary(url));
      if (!res.body.length) return null;
      return `data:${res.contentType || "image/jpeg"};base64,${res.body.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async getAnagrafica(): Promise<{ response: Anagrafica; stale: boolean }> {
    const { kind, data } = await this.withCache<Anagrafica>(
      this.key("anagrafica"),
      CachePolicy.anagrafica,
      async () => {
        const datiHtml = await this.fetchBody(PATH_ANAGRAFICA);
        // The graduates' dashboard carried the career status and degree. Delphi
        // now redirects it to homeStudenti.jsp for both account types, and
        // following that redirect leaves the Delphi session broken: every
        // later page answers 500 until the next login. So the redirect is never
        // followed and the page is parsed only when Delphi serves it directly.
        const dash = await this.deps.session.request((f) => f.fetchNoRedirect(PATH_DASHBOARD));
        const extra = dash.status === 200
          ? anagraficaParser.parseDashboardCarriera(dash.body.toString("latin1"))
          : { statoCarriera: null, laurea: null };
        const base = anagraficaParser.parse(datiHtml, this.deps.config.baseUrl);
        if (!base.cognome && !base.matricola) {
          throw new NonRetryableError("empty anagrafica");
        }
        const fotoUrl = base.fotoUrl ? await this.embedFoto(base.fotoUrl) : null;
        return { ...base, fotoUrl, statoCarriera: extra.statoCarriera, laurea: extra.laurea };
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  async getCarriera(): Promise<{ response: CarrieraResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<CarrieraResponse>(
      this.key("carriera"),
      CachePolicy.carriera,
      async () => {
        const html = await this.fetchBody(PATH_CARRIERA);
        const parsed = carrieraParser.parse(html);
        if (parsed.esami.length === 0 && !parsed.header.matricola) {
          throw new NonRetryableError("empty carriera");
        }
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  async getEsami(filter: EsamiFilter): Promise<{ response: EsamiResponse; stale: boolean }> {
    const { response, stale } = await this.getCarriera();
    const esami = filterEsami(response.esami, filter);
    return { response: { esami, summary: summarizeEsami(esami) }, stale };
  }

  async getBollettini(): Promise<{ response: SituazioneTasse; stale: boolean }> {
    const { kind, data } = await this.withCache<SituazioneTasse>(
      this.key("bollettini"),
      CachePolicy.bollettini,
      async () => {
        const html = await this.fetchBody(PATH_TASSE);
        const parsed = bollettiniParser.parse(html);
        if (!parsed.studente.matricola && parsed.anni.length === 0) {
          throw new NonRetryableError("empty bollettini");
        }
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Servizi Forniti: activation links (Office365, MatLab, Mathematica, …)
  // plus the descriptive text. The list itself is cheap to fetch; the
  // per-service activation page may carry a code that the user wants to copy.
  // Those pages are resolved on demand; MatLab-style services whose `?message=`
  // URL already contains the code need no extra fetch.
  async getServizi(): Promise<{ response: ServiziResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<ServiziResponse>(
      this.key("servizi"),
      CachePolicy.servizi,
      async () => {
        const html = await this.fetchBody(PATH_SERVIZI);
        const parsed = serviziParser.parse(html, this.deps.config.baseUrl);
        if (parsed.servizi.length === 0) throw new NonRetryableError("empty servizi");
        // Activation pages used to be fetched eagerly here. That costs two
        // stateful Delphi requests per service, even when the user needs none
        // of the codes. Return the list immediately and resolve details on
        // demand through getServizioDettaglio instead.
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  async getServizioDettaglio(path: string): Promise<{
    codes: import("../types.js").ServizioCode[];
    azione: { label: string; path: string } | null;
  }> {
    await this.fetchBody(PATH_SERVIZI); // establish the stateful list context
    const res = await this.deps.session.request((f) => f.fetchBinary(path));
    const html = res.body.toString("latin1");
    const codes = serviziParser.extractCodes(html);
    const azione = codes.length
      ? null
      : serviziParser.extractAzione(html, this.deps.config.baseUrl);
    return { codes, azione };
  }

  async getCertificati(): Promise<{ response: CertificatiResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<CertificatiResponse>(
      this.key("certificati"),
      CachePolicy.certificati,
      async () => {
        const html = await this.fetchBody(PATH_CERTIFICATI);
        const parsed = certificatiParser.parse(html);
        if (parsed.certificati.length === 0 && !parsed.studente.matricola) {
          throw new NonRetryableError("empty certificati");
        }
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Piano di studi. Delphi 302s the piano index to GOMP with an SSO token;
  // we bridge (GompClient) and parse the ElencoPiani listing. Accounts where
  // Delphi renders the listing itself (no gomp Location) fall back to the
  // static-table parser. Any failure degrades to an empty piano + composerUrl
  // (the SPA's "Apri nel portale" link) rather than erroring.
  async getPiano(): Promise<{ response: Piano; stale: boolean }> {
    const composerUrl = new URL(PATH_PIANO, this.deps.config.baseUrl).toString();
    const empty: Piano = { cdl: null, annoCorso: null, esami: [], piani: [], composerUrl, esamiDa: null };
    const { kind, data } = await this.withCache<Piano>(
      this.key("piano"),
      CachePolicy.piano,
      async () => {
        try {
          const hop = await this.pianoHop();
          if (!hop.location?.includes("gomp.it")) {
            const html = hop.body.toString("latin1");
            return pianoParser.parse(html, composerUrl);
          }
          const gomp = await GompClient.sso(hop.location);
          try {
            const elenco = new URL(PATH_GOMP_ELENCO, hop.location).toString();
            const html = await gomp.getText(PATH_GOMP_ELENCO);
            const piani = pianoGompParser.parse(html, elenco);
            return { ...empty, piani, ...(await this.pianoEsami(gomp, piani)) };
          } finally {
            await gomp.close();
          }
        } catch (err) {
          if (Api.isInvalidCredentials(err)) throw err;
          logger.info({ err }, "piano unavailable (GOMP bridge failed); returning empty");
          return empty;
        }
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Exams of the student's current plan, read from its PDF. "Current" is the
  // newest plan that was submitted (GOMP lists newest first), so a pending plan
  // wins over an older approved one: it is what the student intends to do.
  // Status comes from the exam record by code. Best-effort: any failure keeps
  // the plan list and returns no exams.
  private async pianoEsami(
    gomp: GompClient,
    piani: PianoGomp[],
  ): Promise<Pick<Piano, "esami" | "esamiDa">> {
    const piano = piani.find((p) => p.ps && !/bozza|respint|annullat/i.test(p.status ?? "")) ?? null;
    if (!piano?.ps) return { esami: [], esamiDa: null };
    try {
      const pdf = await gomp.getBinary(`${PATH_GOMP_COMPOSER}?PS=${encodeURIComponent(piano.ps)}&CodiceAteneo=`);
      if (!/pdf/i.test(pdf.contentType)) return { esami: [], esamiDa: null };
      const righe = pianoPdfParser.parse(await pianoPdfParser.extractItems(pdf.body));
      const { response: carriera } = await this.getCarriera();
      const stati = new Map<string, PianoEsame["stato"]>();
      for (const e of carriera.esami) {
        if (!e.codice) continue;
        if (e.stato === "superato" || e.stato === "idoneo") stati.set(e.codice, "superato");
        else if (e.stato === "in_corso" && stati.get(e.codice) !== "superato") stati.set(e.codice, "in_corso");
      }
      return {
        esami: righe.map((r) => ({ ...r, stato: (r.codice && stati.get(r.codice)) || "da_fare" })),
        esamiDa: { aa: piano.aa, status: piano.status },
      };
    } catch (err) {
      if (Api.isInvalidCredentials(err)) throw err;
      logger.info({ err }, "plan pdf unreadable; returning the plan list without exams");
      return { esami: [], esamiDa: null };
    }
  }

  // Single-shot: read Delphi's redirect to GOMP without following it. The
  // Location carries a one-time SSO token.
  private pianoHop(): Promise<ProxyResponse> {
    return this.deps.session.request((f) => f.fetchNoRedirect(PATH_PIANO));
  }

  // One plan as GOMP renders it: Composer.aspx?PS=<id> answers with a PDF. The
  // browser has no GOMP session, so the wrapper opens one per download.
  async getPianoPdf(ps: string): Promise<{ body: Buffer; contentType: string }> {
    const hop = await this.pianoHop();
    if (!hop.location?.includes("gomp.it")) throw new NonRetryableError("piano is not on gomp");
    const gomp = await GompClient.sso(hop.location);
    try {
      const res = await gomp.getBinary(`${PATH_GOMP_COMPOSER}?PS=${encodeURIComponent(ps)}&CodiceAteneo=`);
      if (!/pdf/i.test(res.contentType)) throw new NonRetryableError("gomp piano is not a pdf");
      return res;
    } finally {
      await gomp.close();
    }
  }

  // GOMP mirror (routes `GOMP_PREFIXES`): the browser uses GOMP's own pages,
  // including the WebForms plan composer, on Delphee's origin. The wrapper
  // keeps the GOMP session on the user's Session and re-opens it through
  // Delphi's SSO when GOMP bounces a GET to a login page. Bodies are passed
  // through untouched: GOMP links are relative or root-relative, and the
  // mirror serves the same root paths. Only Location is rewritten.
  async proxyGomp(
    path: string,
    init: { method?: string; body?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<GompProxyResponse> {
    const open = () => this.openGomp();
    let res = await (await this.deps.session.useGomp(open)).proxy(path, init);
    if ((init.method ?? "GET") === "GET" && isGompLoginBounce(res)) {
      res = await (await this.deps.session.useGomp(open, true)).proxy(path, init);
    }
    return { ...res, location: res.location ? mirrorLocation(res.location, this.deps.config.baseUrl) : null };
  }

  private async openGomp(): Promise<GompClient> {
    const hop = await this.pianoHop();
    if (!hop.location?.includes("gomp.it")) throw new NonRetryableError("piano is not on gomp");
    return GompClient.sso(hop.location);
  }

  // Calendario prove d'esame: cross-insegnamento search (the "killer" search).
  // Stateful three-step (like the servizi Entra flow): menu → Entra → POST —
  // skipping the menu GET makes the POST 500, for both account types. Works
  // for graduated accounts too once the menu step is in. Any remaining Delphi
  // error degrades to [] like the other best-effort routes, not a 5xx.
  async getCalendarioEsami(q: CalendarioQuery): Promise<{ response: AppelloCalendario[]; stale: boolean }> {
    const anno = q.anno ?? currentAA();
    const sessione = q.sessione ?? "TUTTE";
    const iniziale = q.iniziale ?? "-1";
    const datainizio = q.datainizio ?? "";
    const datafine = q.datafine ?? "";
    const { kind, data } = await this.withCache<AppelloCalendario[]>(
      this.key(`calendario:${anno}:${sessione}:${iniziale}:${datainizio}:${datafine}`),
      CachePolicy.appelli,
      async () => {
        try {
          await this.deps.session.request((f) =>
            f.get("/totem/jsp/prenotazioni/menuPrenotazioni.jsp"),
          );
          await this.deps.session.request((f) =>
            f.get("/totem/jsp/prenotazioni/menuPrenotazioni.jsp?Entra=calendarioEsami.jsp"),
          );
          const res = await this.deps.session.request((f) =>
            f.postForm("/totem/jsp/prenotazioni/calendarioEsami.jsp", {
              iniziale,
              anno,
              sessione,
              datainizio,
              datafine,
              Avanti: "Avanti",
            }),
          );
          return calendarioParser.parse(res.body);
        } catch (err) {
          if (Api.isInvalidCredentials(err)) throw err;
          logger.info({ err }, "calendario unavailable (graduated account or Delphi error); returning []");
          return [];
        }
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Syllabus of one course from the calendar ("info" link, idCorIns from
  // /appelli). Needs the calendar's menu context like the search itself.
  async getInfoInsegnamento(idCorIns: string): Promise<{ response: InfoInsegnamento; stale: boolean }> {
    const { kind, data } = await this.withCache<InfoInsegnamento>(
      this.key(`info-insegnamento:${idCorIns}`),
      CachePolicy.infoInsegnamento,
      async () => {
        await this.fetchBody(PATH_PRENOTAZIONI_MENU);
        await this.fetchBody(`${PATH_PRENOTAZIONI_MENU}?Entra=calendarioEsami.jsp`);
        const html = await this.fetchBody(
          `${PATH_PRENOTAZIONI_BASE}/calendarioEsami.jsp?info=si&pagina=1&idCorIns=${encodeURIComponent(idCorIns)}`,
        );
        if (!/Informazioni didattiche/i.test(html)) throw new NonRetryableError("info insegnamento page not found");
        return infoInsegnamentoParser.parse(html);
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Appelli: the legacy single-insegnamento page; returns [] when Delphi has no
  // such listing for the account (the modern flow is the calendar search).
  async getAppelli(insegnamento: string): Promise<{ response: Appello[]; stale: boolean }> {
    const { kind, data } = await this.withCache<Appello[]>(
      this.key(`appelli:${insegnamento}`),
      CachePolicy.appelli,
      async () => {
        const path = `/totem/jsp/prenotazioni/preVisualizzaPrenotabili.jsp?insegnamento=${encodeURIComponent(insegnamento)}`;
        try {
          const res = await this.deps.session.request((f) => f.get(path));
          return appelliParser.parse(res.body);
        } catch {
          return [];
        }
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Ricevuta PDF: POST the bollettino ids back to the tasse page; stream binary.
  async getRicevuta(ref: RicevutaRef): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.fetchBinaryAuthed(PATH_TASSE, {
      method: "POST",
      body: new URLSearchParams({
        ricevutaBollettino: "Ricevuta",
        bollettinoId: ref.bollettinoId ?? "",
        rataId: ref.rataId ?? "",
        AA: ref.aa ?? "",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    return { body: res.body, contentType: res.contentType || "application/pdf" };
  }

  // Verbali non chiusi: open grade records. The list is usually short (0–few
  // per AA) and changes only when a prof closes a verbale, so a 5-min TTL is
  // generous. Returns the empty list for graduated students (the path 404s).
  async getVerbali(): Promise<{ response: VerbaliResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<VerbaliResponse>(
      this.key("verbali"),
      CachePolicy.verbali,
      async () => {
        const html = await this.fetchBody(PATH_VERBALI);
        const parsed = verbaliParser.parse(html);
        if (!parsed.header.matricola) throw new NonRetryableError("empty verbali");
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Esami in corso di verbalizzazione: in-flight exams the prof hasn't yet
  // chiuso. Same TTL rationale as verbali. Empty for graduated students.
  async getEsamiPendenti(): Promise<{ response: EsamiPendentiResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<EsamiPendentiResponse>(
      this.key("esami-pendenti"),
      CachePolicy.esamiPendenti,
      async () => {
        const html = await this.fetchBody(PATH_ESAMI_PENDENTI);
        const parsed = esamiPendentiParser.parse(html);
        if (!parsed.header.matricola) throw new NonRetryableError("empty esami pendenti");
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Prenotazioni: every booking the student has made, active or past. Stateful
  // Entra flow like the calendar: menu → submenu → list. Opening the list
  // directly bounces to the portal home page.
  private async openPrenotazioni(): Promise<string> {
    await this.fetchBody(PATH_PRENOTAZIONI_MENU);
    await this.fetchBody(`${PATH_PRENOTAZIONI_MENU}?Entra=submenuPrenotazioni.jsp`);
    return this.fetchBody(
      `${PATH_PRENOTAZIONI_BASE}/submenuPrenotazioni.jsp?Entra=visualizzaPrenotazioni.jsp&attiva=no`,
    );
  }

  async getPrenotazioni(): Promise<{ response: PrenotazioniResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<PrenotazioniResponse>(
      this.key("prenotazioni"),
      CachePolicy.prenotazioni,
      async () => prenotazioniParser.parse(await this.openPrenotazioni()),
    );
    return { response: data, stale: kind === "stale" };
  }

  // Dettagli and Ristampa are buttons on the list page and address a booking by
  // its position in the list the session last rendered, so both reopen the
  // list before posting.
  private prenotazioneForm(ref: PrenotazioneRef, azione: "Dettagli" | "Ristampa"): RequestInitLike {
    return {
      method: "POST",
      body: new URLSearchParams({
        azione,
        com_doc: "",
        attiva: "no",
        ordine: ref.ordine,
        indexPrenotazione: ref.index,
        idPrenotazioneSeguita: ref.id,
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    };
  }

  async getPrenotazioneDettaglio(ref: PrenotazioneRef): Promise<{ response: PrenotazioneDettaglio; stale: boolean }> {
    const { kind, data } = await this.withCache<PrenotazioneDettaglio>(
      this.key(`prenotazione:${ref.id}`),
      CachePolicy.prenotazioni,
      async () => {
        await this.openPrenotazioni();
        const res = await this.deps.session.request((f) =>
          f.fetch(`${PATH_PRENOTAZIONI_BASE}/visualizzaPrenotazioni.jsp`, this.prenotazioneForm(ref, "Dettagli")),
        );
        const parsed = prenotazioniParser.parseDettaglio(res.body);
        if (!parsed.insegnamento) throw new NonRetryableError("empty prenotazione dettaglio");
        return parsed;
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Career analysis for the Statistiche page. Only the exam record is
  // required; every other source is best-effort and simply contributes
  // nothing when Delphi or GOMP fails.
  async getInsights(now = new Date()): Promise<{ response: CarrieraInsights; stale: boolean }> {
    const { response: carriera, stale } = await this.getCarriera();
    const optional = async <T>(load: () => Promise<{ response: T }>): Promise<T | null> => {
      try {
        return (await load()).response;
      } catch (err) {
        if (Api.isInvalidCredentials(err)) throw err;
        return null;
      }
    };
    const response = buildInsights({
      carriera,
      piano: await optional(() => this.getPiano()),
      prenotazioni: await optional(() => this.getPrenotazioni()),
      tasse: await optional(() => this.getBollettini()),
      anagrafica: await optional(() => this.getAnagrafica()),
      isee: await optional(() => this.getIsee()),
      oggi: now.toISOString().slice(0, 10),
    });
    return { response, stale };
  }

  // Exam sittings from the calendars of the current and the previous academic
  // year: in autumn the current year's calendar is still empty while the
  // previous year's late sessions are ahead.
  private async appelliFuturi(now: Date): Promise<AppelloCalendario[]> {
    const aa = currentAA(now);
    const y = Number(aa.slice(0, 4));
    const out: AppelloCalendario[] = [];
    for (const anno of [`${y - 1}/${y}`, aa]) {
      out.push(...(await this.getCalendarioEsami({ anno })).response);
    }
    return out;
  }

  async getSessione(escludi: Set<string>, now = new Date()): Promise<{ response: PianoSessione; stale: boolean }> {
    const { response: piano, stale } = await this.getPiano();
    const prenotazioni = (await this.getPrenotazioni()).response.prenotazioni;
    const response = pianificaSessione({
      mancanti: piano.esami.filter((e) => e.stato !== "superato"),
      appelli: await this.appelliFuturi(now),
      prenotazioni,
      oggi: now.toISOString().slice(0, 10),
      escludi,
    });
    return { response, stale };
  }

  async getSessioneIcs(escludi: Set<string>, now = new Date()): Promise<string> {
    const { response } = await this.getSessione(escludi, now);
    return calendar(
      "Sessione pianificata",
      response.pianificati.map((p) => ({
        uid: `sessione-${p.codice}-${p.appello.dataEsame}`,
        date: p.appello.dataEsame!,
        time: p.appello.ora,
        summary: `${p.prenotato ? "Esame" : "Esame (da prenotare)"}: ${p.nome}`,
        location: p.appello.aula,
        description: [
          p.appello.appello ? `Appello ${p.appello.appello}` : null,
          p.appello.docente ? `Docente: ${p.appello.docente}` : null,
          p.appello.inizioPrenotazione && p.appello.finePrenotazione
            ? `Prenotazioni dal ${p.appello.inizioPrenotazione} al ${p.appello.finePrenotazione}`
            : null,
        ].filter(Boolean).join("\n") || null,
      })),
      now,
    );
  }

  // Everything about one booked exam in one response: booking details, past
  // attempts, and the syllabus (found through the calendar entry with the
  // same code). The extra parts are best-effort.
  async getDossier(ref: PrenotazioneRef, now = new Date()): Promise<{
    response: {
      dettaglio: PrenotazioneDettaglio;
      tentativi: StoriaEsame | null;
      info: InfoInsegnamento | null;
      giorni: number | null;
    };
    stale: boolean;
  }> {
    const oggi = now.toISOString().slice(0, 10);
    const { response: dettaglio, stale } = await this.getPrenotazioneDettaglio(ref);
    const { response: lista } = await this.getPrenotazioni();
    const codice = lista.prenotazioni.find((p) => p.ref?.id === ref.id)?.codice ?? null;
    let tentativi: StoriaEsame | null = null;
    let info: InfoInsegnamento | null = null;
    if (codice) {
      const { response: carriera } = await this.getCarriera();
      tentativi = tentativiPer(codice, { carriera, prenotazioni: lista, oggi });
      try {
        const idCorIns = (await this.appelliFuturi(now)).find((a) => a.codice === codice && a.idCorIns)?.idCorIns;
        if (idCorIns) info = (await this.getInfoInsegnamento(idCorIns)).response;
      } catch (err) {
        if (Api.isInvalidCredentials(err)) throw err;
      }
    }
    const giorni = dettaglio.dataEsame
      ? Math.round((Date.parse(dettaglio.dataEsame) - Date.parse(oggi)) / 86_400_000)
      : null;
    return { response: { dettaglio, tentativi, info, giorni }, stale };
  }

  // Upcoming bookings as an iCalendar file. "Upcoming" is by exam date, not by
  // the list's green/red light: that light did not match the booking state in
  // the captured details (a red row showed "Stato prenotazione: si"). Details
  // add the time and room; a booking whose details fail still gets an all-day
  // event.
  async getPrenotazioniIcs(now = new Date()): Promise<string> {
    const today = now.toISOString().slice(0, 10);
    const { response } = await this.getPrenotazioni();
    const upcoming = response.prenotazioni.filter((p) => p.dataEsame && p.dataEsame >= today);
    const items = [];
    for (const prenotazione of upcoming) {
      let dettaglio: PrenotazioneDettaglio | null = null;
      if (prenotazione.ref) {
        try {
          dettaglio = (await this.getPrenotazioneDettaglio(prenotazione.ref)).response;
        } catch (err) {
          if (Api.isInvalidCredentials(err)) throw err;
        }
      }
      items.push({ prenotazione, dettaglio });
    }
    return prenotazioniCalendar(items, now);
  }

  // Booking receipt PDF. The Ristampa POST answers with an HTML page that links
  // a session-bound stampa.pdf; the PDF itself is a separate GET.
  async getPrenotazioneRicevuta(ref: PrenotazioneRef): Promise<{ body: Buffer; contentType: string }> {
    await this.openPrenotazioni();
    await this.deps.session.request((f) =>
      f.fetch(`${PATH_PRENOTAZIONI_BASE}/visualizzaPrenotazioni.jsp`, this.prenotazioneForm(ref, "Ristampa")),
    );
    const res = await this.fetchBinaryAuthed("/totem/jsp/stampa.pdf?tipoStampa=16");
    if (!/pdf/i.test(res.contentType)) throw new NonRetryableError("prenotazione ricevuta is not a pdf");
    return { body: res.body, contentType: res.contentType };
  }

  // Courses open for enrolment (Frequenza corsi di insegnamento). Stateful
  // Entra flow like prenotazioni, plus an email step: Delphi asks for a
  // contact address before listing. The wrapper resubmits the address Delphi
  // pre-fills (the one on record), so nothing on the account changes. Search
  // tipo=1 is "ordina per nome corso", i.e. the full list.
  async getCorsi(): Promise<{ response: CorsiResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<CorsiResponse>(
      this.key("corsi"),
      CachePolicy.corsi,
      async () => {
        await this.fetchBody(`${PATH_CORSI_BASE}/menuIscrizioni.jsp`);
        const emailPage = await this.fetchBody(
          `${PATH_CORSI_BASE}/menuIscrizioni.jsp?Entra=preVisualizzaIscrivibiliEmail.jsp`,
        );
        const email = load(emailPage)('input[name="email"]').attr("value")?.trim() ?? "";
        await this.deps.session.request((f) =>
          f.postForm(`${PATH_CORSI_BASE}/preVisualizzaIscrivibiliEmail.jsp`, { email, avanti: "Avanti" }),
        );
        const res = await this.deps.session.request((f) =>
          f.postForm(`${PATH_CORSI_BASE}/preVisualizzaIscrivibili.jsp`, {
            tipo: "1",
            esame: "",
            docente: "",
            mostra: "Avanti",
            clic: "1",
          }),
        );
        return corsiParser.parse(res.body);
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Reprint of the enrolment application (Ristampa domanda di iscrizione /
  // immatricolazione). Same two-step print pattern as the booking receipt.
  async getDomandaIscrizione(): Promise<{ body: Buffer; contentType: string }> {
    await this.fetchBody(PATH_DOMANDA_ISCRIZIONE);
    const res = await this.fetchBinaryAuthed("/totem/jsp/stampa.pdf?tipoStampa=5");
    if (!/pdf/i.test(res.contentType)) throw new NonRetryableError("domanda iscrizione is not a pdf");
    return { body: res.body, contentType: res.contentType };
  }

  // ISEE-U authorizations (Acquisizione Isee-Università). Delphi answers 500 for
  // accounts without the page (graduated students), so failures degrade to an
  // empty list like the other best-effort routes.
  async getIsee(): Promise<{ response: IseeResponse; stale: boolean }> {
    const { kind, data } = await this.withCache<IseeResponse>(
      this.key("isee"),
      CachePolicy.isee,
      async () => {
        try {
          return iseeParser.parse(await this.fetchBody(PATH_ISEE));
        } catch (err) {
          if (Api.isInvalidCredentials(err)) throw err;
          logger.info({ err }, "isee unavailable; returning empty");
          return { autorizzazioni: [] };
        }
      },
    );
    return { response: data, stale: kind === "stale" };
  }

  // Certificato PDF: GET the stampaCertificati/certificatoXxx.jsp endpoint with
  // its query params. Delphi returns a PDF inline. No caching (the binary is
  // one-shot and the user re-prints the same day if needed).
  async getCertificato(path: string, params: Record<string, string>): Promise<{ body: Buffer; contentType: string; filename: string }> {
    const qs = new URLSearchParams(params).toString();
    const target = `${PATH_CERTIFICATI_BASE}/${path}${qs ? `?${qs}` : ""}`;
    const res = await this.fetchBinaryAuthed(target);
    const filename = `certificato-${path.replace(/\.jsp.*/, "")}${params.tipo ? `-${params.tipo}` : ""}.pdf`;
    return { body: res.body, contentType: res.contentType || "application/pdf", filename };
  }

  // Transparent reverse-proxy of one Delphi request on behalf of the browser
  // (see routes `/totem/*`). The session's cookie jar is attached so Delphi
  // serves the authenticated page/asset; nothing is rewritten in the body —
  // the wrapper mirrors Delphi's path structure, so the page's own relative
  // links resolve back onto the proxy. We only rewrite a same-origin redirect
  // Location into a wrapper-relative `/totem/...` path so the browser stays on
  // the mirror; a cross-origin redirect (rare) is left absolute. Not cached.
  async proxyPage(
    path: string,
    init: { method?: string; body?: Buffer; contentType?: string } = {},
  ): Promise<ProxyResponse> {
    const headers: Record<string, string> = {};
    if (init.contentType) headers["content-type"] = init.contentType;
    const res = await this.deps.session.request((f) =>
      f.proxy(path, { method: init.method, body: init.body, headers }),
    );
    let location = res.location;
    if (location) {
      try {
        const origin = new URL(this.deps.config.baseUrl).origin;
        const u = new URL(location, origin + path);
        location = u.origin === origin ? u.pathname + u.search : u.href;
      } catch { /* unparseable Location — pass through untouched */ }
    }
    return { ...res, location };
  }

  // Trigger a service's "Genera codice" action and read back the generated code.
  // Stateful, like the rest of the Entra= flow: list → the service's activation
  // page (so the Genera button's context exists) → the Genera URL itself. Each
  // call regenerates on Delphi's side, so this runs only on an explicit user
  // click, never during list load.
  async generaCodice(ctxPath: string, azionePath: string): Promise<{ code: string | null }> {
    await this.fetchBody(PATH_SERVIZI);
    await this.deps.session.request((f) => f.fetchBinary(ctxPath));
    const res = await this.deps.session.request((f) => f.fetchBinary(azionePath));
    return { code: serviziParser.extractGeneratedCode(res.body.toString("latin1")) };
  }
}
