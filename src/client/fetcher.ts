import { Client } from "undici";
import { CookieJar } from "./cookie-jar.js";
import { createThrottle, type Throttle } from "../utils/throttle.js";
import {
  withBackoff,
  RetryableError,
  NonRetryableError,
} from "../utils/retry.js";

// The only component that talks to Delphi over the wire. Two non-obvious
// constraints shape it:
//
//  1. undici's automatic redirect dropped our JSESSIONID on the second hop, so
//     we set maxRedirections:0 and follow 3xx ourselves, re-attaching the jar
//     each time (curl -L semantics: 30x downgrades the method to GET).
//  2. Delphi serves windows-1252/iso-8859-1 with spelled-out HTML entities, so
//     we decode bytes as latin1 and let cheerio resolve the entities later.

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) delphi-wrapper/0.1 (student-portal)";
const MAX_REDIRECTS = 5;

export interface FetcherResponse {
  status: number;
  body: string;
  contentType: string;
  finalPath: string;
}

export interface FetcherBinaryResponse {
  status: number;
  body: Buffer;
  contentType: string;
  finalPath: string;
}

interface RawResponse {
  status: number;
  bodyText?: string;
  bodyBuf?: Buffer;
  contentType: string;
  location: string | null;
}

export interface RequestInitLike {
  method?: string;
  body?: string | Buffer;
  headers?: Record<string, string>;
}

export interface ProxyResponse {
  status: number;
  body: Buffer;
  contentType: string;
  location: string | null;
}

export class Fetcher {
  private constructor(
    private readonly client: Client,
    private readonly origin: string,
    private readonly jar: CookieJar,
    private readonly throttle: Throttle,
  ) {}

  static create(baseUrl: string, minGapMs: number): Fetcher {
    const origin = new URL(baseUrl).origin;
    const client = new Client(origin, { keepAliveTimeout: 30_000 });
    return new Fetcher(client, origin, new CookieJar(), createThrottle(minGapMs));
  }

  get jarRef(): CookieJar {
    return this.jar;
  }

  async fetch(path: string, init: RequestInitLike = {}): Promise<FetcherResponse> {
    const res = await this.followRedirects(path, init, false);
    return {
      status: res.status,
      body: res.bodyText ?? "",
      contentType: res.contentType,
      finalPath: res.location ?? path,
    };
  }

  async fetchBinary(
    path: string,
    init: RequestInitLike = {},
  ): Promise<FetcherBinaryResponse> {
    const res = await this.followRedirects(path, init, true);
    return {
      status: res.status,
      body: res.bodyBuf ?? Buffer.alloc(0),
      contentType: res.contentType,
      finalPath: res.location ?? path,
    };
  }

  get(path: string): Promise<FetcherResponse> {
    return this.fetch(path, { method: "GET" });
  }

  postForm(
    path: string,
    formData: Record<string, string>,
  ): Promise<FetcherResponse> {
    const body = new URLSearchParams(formData).toString();
    return this.fetch(path, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
  }

  // Single-shot pass-through for the reverse proxy: ONE request, no redirect
  // following (the 3xx + Location is handed back so the browser navigates and
  // keeps its history), and NO throttle/backoff — a page the user is actively
  // viewing fires a burst of asset requests that a 2s gap would make unusable.
  // The jar is still attached/ingested, so the Delphi session rides along.
  async proxy(path: string, init: RequestInitLike = {}): Promise<ProxyResponse> {
    const res = await this.singleRequest(
      path,
      { ...init, headers: { accept: "*/*", ...(init.headers ?? {}) } },
      true,
    );
    return {
      status: res.status,
      body: res.bodyBuf ?? Buffer.alloc(0),
      contentType: res.contentType,
      location: res.location,
    };
  }

  // Single response like proxy(), but scheduled with normal Delphi traffic.
  // Used by server-side flows that need to inspect a redirect without letting
  // the request collide with another operation on the same session.
  async fetchNoRedirect(path: string, init: RequestInitLike = {}): Promise<ProxyResponse> {
    const res = await this.rawRequest(this.toPath(path), init, true);
    return {
      status: res.status,
      body: res.bodyBuf ?? Buffer.alloc(0),
      contentType: res.contentType,
      location: res.location,
    };
  }

  hasCookies(): boolean {
    return this.jar.hasAny();
  }

  clearCookies(): void {
    this.jar.clear();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async followRedirects(
    startPath: string,
    init: RequestInitLike,
    binary: boolean,
  ): Promise<RawResponse> {
    let path = this.toPath(startPath);
    let method = init.method ?? "GET";
    let body = init.body;
    let headers = init.headers;
    let lastPath = path;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await this.rawRequest(path, { method, body, headers }, binary);
      lastPath = path;

      if (res.status >= 300 && res.status < 400 && res.location) {
        path = this.toPath(res.location, path);
        // 30x downgrades to a bodiless GET (curl -L semantics).
        method = "GET";
        body = undefined;
        headers = undefined;
        continue;
      }

      // Classify terminal status into typed errors so callers can react.
      if (res.status >= 500) {
        throw new RetryableError(`delphi ${res.status} at ${lastPath} — ${snippet(res)}`);
      }
      if (res.status === 401 || res.status === 403) {
        throw new NonRetryableError(`auth ${res.status} at ${lastPath}`);
      }
      return { ...res, location: lastPath };
    }
    throw new RetryableError(`too many redirects from ${startPath}`);
  }

  private rawRequest(
    path: string,
    init: RequestInitLike,
    binary: boolean,
  ): Promise<RawResponse> {
    return this.throttle.run(() =>
      withBackoff(() => this.singleRequest(path, init, binary), {
        onRetry: () => {},
      }),
    );
  }

  private async singleRequest(
    path: string,
    init: RequestInitLike,
    binary: boolean,
  ): Promise<RawResponse> {
    const headers: Record<string, string> = {
      "user-agent": USER_AGENT,
      accept: binary
        ? "application/pdf,application/octet-stream,*/*"
        : "text/html,application/xhtml+xml,*/*;q=0.8",
      "accept-language": "it-IT,it;q=0.9,en;q=0.6",
      ...(init.headers ?? {}),
    };
    if (this.jar.hasAny()) headers["cookie"] = this.jar.toHeader();

    let response;
    try {
      response = await this.client.request({
        path,
        method: (init.method ?? "GET") as any,
        headers,
        body: init.body,
        maxRedirections: 0,
      });
    } catch (err) {
      // Network-level failure (reset, timeout) is transient.
      throw new RetryableError(`network error at ${path}`, err);
    }

    this.jar.ingest(response.headers as Record<string, string | string[]>);
    const contentType = String(response.headers["content-type"] ?? "");
    const location = headerStr(response.headers["location"]);

    if (binary) {
      const buf = Buffer.from(await response.body.arrayBuffer());
      return { status: response.statusCode, bodyBuf: buf, contentType, location };
    }
    // Decode latin1: Delphi is windows-1252 with spelled-out entities.
    const buf = Buffer.from(await response.body.arrayBuffer());
    return {
      status: response.statusCode,
      bodyText: buf.toString("latin1"),
      contentType,
      location,
    };
  }

  // Resolve a path/Location against the origin, returning an origin-relative
  // path (undici Client is bound to one origin).
  private toPath(target: string, base?: string): string {
    const baseUrl = base ? new URL(base, this.origin) : new URL(this.origin);
    const resolved = new URL(target, baseUrl);
    return resolved.pathname + resolved.search;
  }
}

function headerStr(v: string | string[] | undefined): string | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// A Delphi 5xx is almost always a JSP error page whose body names the real
// cause (a stack line, or an Italian "sessione scaduta"-style message). We've
// already read that body; surface a short, whitespace-collapsed slice of it on
// the error so the failure log says WHY, not just that a 500 happened. The path
// stays the first token after "at " (no spaces) so upstream-path parsing in
// failure-log still matches; the em-dash separates the snippet.
//
// These snippets reach the operator log (see server/failure-log.ts), and a Delphi
// error page can echo the logged-in student back — a name or matricola in the
// markup. pino redacts the `matricola` FIELD, not text embedded in a message, so
// the digit runs are masked here, at the point the snippet is built.
function snippet(res: RawResponse): string {
  const text = res.bodyText ?? res.bodyBuf?.toString("latin1") ?? "";
  const collapsed = text.replace(/\s+/g, " ").trim().slice(0, 300);
  return collapsed.replace(/\d{6,}/g, "[redacted]") || "(empty body)";
}
