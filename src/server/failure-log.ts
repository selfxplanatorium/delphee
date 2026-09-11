import { logger } from "../logger.js";

// Records every upstream Delphi failure (delphi_unavailable / invalid_credentials)
// on the operator log stream, where pino redacts the matricola (see logger.ts).
// We deliberately do NOT write a per-user file: a matricola in a filename is
// personal data at rest, and this service keeps no PII on disk (see
// cache/store.ts). A support diagnosis reads the operator stream / container logs
// — `errMessage`, `cause`, and the extracted upstream path say WHY a request
// failed without naming the student on disk.

export interface FailureContext {
  route: string;
  method: string;
  matricola: string | null;
  status: number;
}

// Pull the upstream Delphi path out of the typed error messages the fetcher
// builds ("delphi 503 at /totem/…", "auth 403 at /totem/…", "network error at
// /totem/…"), so the failing endpoint is a queryable field, not buried in text.
function upstreamPath(message: string): string | undefined {
  return / at (\/\S+)/.exec(message)?.[1];
}

function describe(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    return {
      errName: err.name,
      errMessage: err.message,
      upstream: upstreamPath(err.message),
      cause: cause instanceof Error ? cause.message : cause ? String(cause) : undefined,
    };
  }
  return { errMessage: String(err) };
}

export function recordFailure(err: unknown, ctx: FailureContext): void {
  // ctx.matricola is redacted by pino's config before it reaches any transport.
  logger.warn({ ...ctx, ...describe(err) }, "delphi request failed");
}
