import express, { Router, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { SessionRegistry } from "./sessions.js";
import type { CacheStore } from "../cache/store.js";
import type { AppConfig } from "../config.js";
import { requireSession, apiOf, bearerToken, nonceOf } from "./session-middleware.js";
import { recordFailure } from "./failure-log.js";
import { renderShell } from "./static/index.html.js";
import { renderPrivacy, renderProgetto } from "./static/doc.html.js";
import type { Session } from "../client/session.js";
import type { EsamiFilter, Stato, SessionInfo } from "../types.js";

interface RouteDeps {
  registry: SessionRegistry;
  store: CacheStore;
  config: AppConfig;
  version: string;
}

const here = dirname(fileURLToPath(import.meta.url));

// Static assets live next to this file in both dev (src) and prod (dist); the
// .ts shell is compiled but app.js/styles.css are copied verbatim, so we resolve
// against this module's own directory first and fall back to src for tsx runs.
function staticFile(name: string): string | null {
  const candidates = [
    join(here, "static", name),
    join(process.cwd(), "dist", "server", "static", name),
    join(process.cwd(), "src", "server", "static", name),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function send<T>(
  res: Response,
  work: Promise<{ response: T; stale: boolean }>,
): void {
  work
    .then(({ response, stale }) => {
      if (stale) res.setHeader("X-Cache-Stale", "true");
      res.json(response);
    })
    .catch((err) => fail(res, err));
}

function isInvalidCreds(err: unknown): boolean {
  return err instanceof Error && /invalid_credentials/.test(err.message);
}

// Single exit for every upstream failure: classify, record (operator stream +
// per-user log), respond. Invalid creds → 401; everything else collapses to the
// opaque 503 the client shows, but the cause is now captured first. `matricola`
// is taken from the session when there is one; the login route passes the
// attempted matricola explicitly (no session exists yet).
function fail(res: Response, err: unknown, matricola?: string | null): void {
  const status = isInvalidCreds(err) ? 401 : 503;
  const who =
    matricola !== undefined
      ? matricola
      : (res.locals.session as Session | undefined)?.info().matricola ?? null;
  recordFailure(err, { route: res.req.path, method: res.req.method, matricola: who, status });
  res.status(status).json({
    error: status === 401 ? "invalid_credentials" : "delphi_unavailable",
  });
}

const LOGGED_OUT: SessionInfo = {
  state: "logged_out",
  matricola: null,
  since: null,
  lastError: null,
};

function parseStatoFilter(value?: string): Stato[] | undefined {
  if (!value) return undefined;
  const valid: Stato[] = ["superato", "in_corso", "non_superato", "idoneo"];
  const out = value.split(",").map((s) => s.trim()).filter((s) => valid.includes(s as Stato));
  return out.length ? (out as Stato[]) : undefined;
}

function parseBool(value?: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (["true", "1"].includes(value)) return true;
  if (["false", "0"].includes(value)) return false;
  return undefined;
}

function parseIntQuery(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

export function buildRoutes(deps: RouteDeps): Router {
  const r = Router();
  const { registry, store, config, version } = deps;
  const auth = requireSession(registry, store, config);

  r.get("/health", (_req, res) => res.json({ ok: true, version }));
  r.get("/config", (_req, res) => res.json({ version }));

  r.get("/", (_req, res) => {
    res.type("html").send(renderShell(version, nonceOf(res)));
  });

  // Standalone content pages (readable pre-login, own URL). No auth, no data.
  r.get("/privacy", (_req, res) => res.type("html").send(renderPrivacy(nonceOf(res))));
  r.get("/progetto", (_req, res) => res.type("html").send(renderProgetto(nonceOf(res))));

  const TYPES: Record<string, string> = {
    ".css": "text/css",
    ".js": "text/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  for (const asset of ["styles.css", "app.js", "delphee-mark.svg", "unilogo.svg", "film-grain.png"]) {
    r.get(`/static/${asset}`, (_req, res) => {
      const path = staticFile(asset);
      if (!path) return res.status(404).send("not found");
      const ext = asset.slice(asset.lastIndexOf("."));
      res.type(TYPES[ext] ?? "application/octet-stream").sendFile(path);
    });
  }

  // ---- session ----
  // Login mints a token; the client (LINFO) stores it and sends it as
  // `Authorization: Bearer <token>` on every subsequent request.
  r.post("/session/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { matricola?: string; password?: string };
    if (!body.matricola || !body.password) {
      return res.status(400).json({ error: "missing_credentials" });
    }
    try {
      const { token, info } = await registry.login(body.matricola, body.password);
      // A login is the explicit "give me current data" signal: drop this
      // account's forever-cached records so the next fetch re-parses live Delphi
      // (and picks up any parser fix). Keyed by the canonical matricola.
      if (info.matricola) store.deletePrefix(`${info.matricola}:`);
      // Cookie carries the token on top-level browser navigations (the
      // `/totem/*` proxy); the JSON token still serves the SPA's fetch calls.
      res.cookie("dw_token", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.nodeEnv === "production",
        path: "/",
      });
      res.json({ token, ...info });
    } catch (err) {
      fail(res, err, body.matricola ?? null);
    }
  });

  r.get("/session/status", (req, res) => {
    const session = registry.get(bearerToken(req) ?? "");
    res.json(session ? session.info() : LOGGED_OUT);
  });

  r.post("/session/logout", async (req, res) => {
    await registry.logout(bearerToken(req) ?? "");
    res.clearCookie("dw_token", {
      httpOnly: true,
      sameSite: "strict",
      secure: config.nodeEnv === "production",
      path: "/",
    });
    res.json(LOGGED_OUT);
  });

  // ---- data (all token-protected) ----
  r.get("/carriera", auth, (_req, res) => send(res, apiOf(res).getCarriera()));

  r.get("/carriera/esami", auth, (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    const filter: EsamiFilter = {
      nome: q.nome || undefined,
      ssd: q.ssd || undefined,
      annoAccademico: q.aa || undefined,
      stato: parseStatoFilter(q.stato),
      isPartial: parseBool(q.partial),
      cfuMin: parseIntQuery(q.cfuMin),
      cfuMax: parseIntQuery(q.cfuMax),
    };
    send(res, apiOf(res).getEsami(filter));
  });

  // /appelli has two modes: ?insegnamento=X runs the legacy single-course
  // listing; no param runs the calendarioEsami search (anno/sessione/iniziale/
  // datainizio/datafine optional, defaults = current AA + TUTTE + tutte).
  r.get("/appelli", auth, (req, res) => {
    const q = req.query;
    const str = (k: string) => (q[k] as string | undefined)?.trim() || undefined;
    const insegnamento = str("insegnamento");
    if (insegnamento) return send(res, apiOf(res).getAppelli(insegnamento));
    send(res, apiOf(res).getCalendarioEsami({
      anno: str("anno"),
      sessione: str("sessione"),
      iniziale: str("iniziale"),
      datainizio: str("datainizio"),
      datafine: str("datafine"),
    }));
  });

  r.get("/piano", auth, (_req, res) => send(res, apiOf(res).getPiano()));
  r.get("/anagrafica", auth, (_req, res) => send(res, apiOf(res).getAnagrafica()));
  r.get("/tasse", auth, (_req, res) => send(res, apiOf(res).getBollettini()));
  r.get("/servizi", auth, (_req, res) => send(res, apiOf(res).getServizi()));

  r.get("/servizi/dettaglio", auth, async (req, res) => {
    const path = (req.query.path as string | undefined)?.trim();
    if (!path || path.includes("..") || !/^\/totem\/[\w./-]*\.jsp(\?|$)/.test(path)) {
      return res.status(400).json({ error: "invalid_path" });
    }
    try {
      res.json(await apiOf(res).getServizioDettaglio(path));
    } catch (err) {
      fail(res, err);
    }
  });

  // On-demand "Genera codice" (MyCampusXApp): the SPA posts the service's
  // activation page (ctx) + the Genera URL (path); the wrapper runs the stateful
  // flow and returns the generated code. Both must be Delphi /totem/*.jsp paths.
  r.post("/servizi/genera", auth, async (req, res) => {
    const path = (req.query.path as string | undefined)?.trim();
    const ctx = (req.query.ctx as string | undefined)?.trim();
    // `..` is rejected explicitly: the fetcher resolves the path through new URL(),
    // so a traversal would normalize back out of /totem/ into any Delphi endpoint.
    const ok = (p?: string) =>
      !!p && !p.includes("..") && /^\/totem\/[\w./-]*\.jsp(\?|$)/.test(p);
    if (!ok(path) || !ok(ctx)) return res.status(400).json({ error: "invalid_path" });
    try {
      res.json(await apiOf(res).generaCodice(ctx!, path!));
    } catch (err) {
      fail(res, err);
    }
  });
  r.get("/certificati", auth, (_req, res) => send(res, apiOf(res).getCertificati()));
  r.get("/verbali", auth, (_req, res) => send(res, apiOf(res).getVerbali()));
  r.get("/esami-pendenti", auth, (_req, res) => send(res, apiOf(res).getEsamiPendenti()));

  r.get("/tasse/ricevuta", auth, async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.bollettinoId) return res.status(400).json({ error: "missing_bollettinoId" });
    try {
      const { body, contentType } = await apiOf(res).getRicevuta({
        bollettinoId: q.bollettinoId,
        rataId: q.rataId ?? null,
        aa: q.aa ?? null,
      });
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `inline; filename="ricevuta-${q.bollettinoId}.pdf"`,
      );
      res.send(body);
    } catch (err) {
      fail(res, err);
    }
  });

  // Certificato PDF: pass through the stampaCertificati path + its query params.
  r.get("/certificati/stampa", auth, async (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.path) return res.status(400).json({ error: "missing_path" });
    if (!/^[\w-]+\.jsp$/.test(q.path)) {
      return res.status(400).json({ error: "invalid_path" });
    }
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(q)) {
      if (k === "path" || v == null) continue;
      params[k] = v;
    }
    try {
      const { body, contentType, filename } = await apiOf(res).getCertificato(q.path, params);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.send(body);
    } catch (err) {
      fail(res, err);
    }
  });

  // Transparent reverse-proxy of Delphi under the wrapper's own origin. The
  // path mirrors Delphi's (`/totem/*`), so a proxied page's relative links,
  // inline-JS navigation, forms, and the back button all resolve back onto
  // this route and "just work" — the browser sits on a faithful same-origin
  // mirror. Auth is the `dw_token` cookie (top-level navigations can't send a
  // Bearer header). `express.raw` captures form-POST bodies verbatim; GET has
  // none. A 3xx is forwarded with its Location rewritten to a wrapper path so
  // the browser navigates within the mirror.
  // ponytail: assumes Delphi emits relative / root-relative links (true in
  // every captured page); a hardcoded absolute delphi URL would escape the
  // mirror — body-rewrite those only if one ever shows up.
  r.all("/totem/*", auth, express.raw({ type: () => true, limit: "8mb" }), async (req, res) => {
    try {
      const body = Buffer.isBuffer(req.body) && req.body.length ? req.body : undefined;
      const { status, body: out, contentType, location } = await apiOf(res).proxyPage(req.originalUrl, {
        method: req.method,
        body,
        contentType: req.header("content-type") || undefined,
      });
      if (location && status >= 300 && status < 400) {
        return res.status(status).location(location).end();
      }
      res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      if (contentType) res.setHeader("Content-Type", contentType);
      res.status(status).send(out);
    } catch (err) {
      fail(res, err);
    }
  });

  return r;
}
