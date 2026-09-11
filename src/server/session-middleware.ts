import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";
import { Api } from "./api.js";
import { DEMO_MATRICOLA, DemoApi } from "./demo.js";
import type { SessionRegistry } from "./sessions.js";
import type { Session } from "../client/session.js";
import type { CacheStore } from "../cache/store.js";
import type { AppConfig } from "../config.js";

const LOGIN_RATE_WINDOW_MS = 60_000;
const LOGIN_RATE_MAX = 5;

// Request timing + a final error net. Kept tiny on purpose: structured logging
// lives in pino, and route handlers own their own status codes.

// Resolve the Bearer token to a live session and attach a per-request Api to
// res.locals. The wrapper trusts LINFO (network-gated by Caddy); this token only
// identifies WHICH user's Delphi session a request maps to.
export function requireSession(
  registry: SessionRegistry,
  store: CacheStore,
  config: AppConfig,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const session = registry.get(bearerToken(req) ?? "");
    if (!session) {
      res.status(401).json({ error: "no_session" });
      return;
    }
    res.locals.session = session;
    // An explicit UI refresh means live data, not merely repainting a cache
    // hit. Invalidate only the current view; clearing the whole account here
    // would make every other page cold and slow after one refresh.
    if (req.method === "GET" && req.query.refresh === "1") {
      const matricola = session.info().matricola;
      if (matricola) {
        const baseByPath: Record<string, string> = {
          "/carriera": "carriera",
          "/carriera/esami": "carriera",
          "/piano": "piano",
          "/anagrafica": "anagrafica",
          "/tasse": "bollettini",
          "/servizi": "servizi",
          "/certificati": "certificati",
          "/verbali": "verbali",
          "/esami-pendenti": "esami-pendenti",
        };
        const base = baseByPath[req.path];
        if (base) store.delete(`${matricola}:${base}`);
        else if (req.path === "/appelli") {
          store.deletePrefix(`${matricola}:${req.query.insegnamento ? "appelli:" : "calendario:"}`);
        }
      }
    }
    // The demo user gets the canned-data Api; everyone else hits Delphi.
    res.locals.api = session.info().matricola === DEMO_MATRICOLA
      ? new DemoApi({ session, store, config })
      : new Api({ session, store, config });
    next();
  };
}

export function sessionOf(res: Response): Session {
  return res.locals.session as Session;
}

export function apiOf(res: Response): Api {
  return res.locals.api as Api;
}

// Bearer header for SPA fetches; the `dw_token` cookie for top-level browser
// navigations (new-tab links / the `/totem/*` reverse-proxy can't set an
// Authorization header). Login sets the cookie; both name the same registry
// token.
export function bearerToken(req: Request): string | null {
  const m = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
  if (m) return m[1]!.trim();
  const cm = /(?:^|;\s*)dw_token=([^;]+)/.exec(req.header("cookie") ?? "");
  return cm ? decodeURIComponent(cm[1]!.trim()) : null;
}

// App-wide response headers. The CSP nonce is minted per response and handed to
// the HTML renderers, so the theme bootstrap can stay inline (no flash of the
// wrong theme) without opening script-src to 'unsafe-inline'. Google Fonts is
// pulled by an @import inside styles.css, hence the style-src/font-src entries.
//
// ponytail: the /totem/* mirror relaxes this to frame-ancestors only — a proxied
// Delphi page cannot render under `default-src 'self'`. That mirror shares this
// app's origin, so a script in a portal page runs with our cookie; the real fix
// is a separate hostname for the mirror in Caddy, not a header.
export function securityHeaders(config: AppConfig) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const nonce = randomBytes(16).toString("base64");
    res.locals.nonce = nonce;
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "object-src 'none'",
      ].join("; "),
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    // TLS is terminated by Caddy in front; only claim HSTS where that is true.
    if (config.nodeEnv === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  };
}

export function nonceOf(res: Response): string {
  return (res.locals.nonce as string) ?? "";
}

// One bucket per matricola, not one for the whole process: a single shared
// counter meant any caller could burn the 5/minute budget and lock every other
// student out of logging in, while doing nothing to slow repeated guesses at one
// account. Buckets are pruned once the map grows, so this cannot be used to eat
// memory either.
export function createLoginLimiter() {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const cutoff = now - LOGIN_RATE_WINDOW_MS;
    const body = req.body as { matricola?: unknown } | undefined;
    const who = typeof body?.matricola === "string" ? body.matricola : "";
    const bucket = (hits.get(who) ?? []).filter((t) => t > cutoff);

    if (bucket.length >= LOGIN_RATE_MAX) {
      hits.set(who, bucket);
      const retryAfterMs = bucket[0]! + LOGIN_RATE_WINDOW_MS - now;
      res.setHeader("Retry-After", Math.ceil(retryAfterMs / 1000));
      res.status(429).json({ error: "rate_limited", retryAfterMs });
      return;
    }

    bucket.push(now);
    hits.set(who, bucket);
    if (hits.size > 1000) {
      for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k);
    }
    next();
  };
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info(
      { method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) },
      "request",
    );
  });
  next();
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error({ err }, "unhandled error");
  if (!res.headersSent) {
    res.status(500).json({ error: "internal_error" });
  }
}
