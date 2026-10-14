import { Client } from "undici";
import { CookieJar } from "./cookie-jar.js";

// GOMP (uniroma2studenti.gomp.it) hosts the piano di studi composer. The
// bridge is pure SSO: Delphi's pianoDiStudi/index.jsp 302s to
// Logon.aspx?SSO=<token> on the GOMP origin, and that first hop sets the
// Gomp2011Logon session cookie. From there, ElencoPiani.aspx lists the
// student's piani. The wrapper never drives the WebForms __doPostBack
// machinery itself; the composer runs in the browser through the /gomp mirror
// (proxy() below, see docs/architecture.md#gomp-study-plans).

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) delphi-wrapper/0.1 (student-portal)";

export interface GompProxyResponse {
  status: number;
  body: Buffer;
  contentType: string;
  location: string | null;
}

export class GompClient {
  private constructor(
    private readonly client: Client,
    private readonly jar: CookieJar,
  ) {}

  // `ssoUrl` is the absolute Location Delphi redirected to. Throws if GOMP
  // refuses the token (no session cookie → the bridge failed).
  static async sso(ssoUrl: string): Promise<GompClient> {
    const u = new URL(ssoUrl);
    const g = new GompClient(new Client(u.origin, { keepAliveTimeout: 30_000 }), new CookieJar());
    await g.get(u.pathname + u.search);
    if (!g.jar.hasAny()) throw new Error("gomp SSO refused: no session cookie");
    return g;
  }

  async getText(path: string): Promise<string> {
    return (await this.get(path)).body.toString("utf-8");
  }

  // Composer.aspx?PS=<uuid> answers with the plan rendered as a PDF.
  async getBinary(path: string): Promise<{ body: Buffer; contentType: string }> {
    return this.get(path);
  }

  // Single request for the browser mirror: no redirect following, so the
  // browser sees each 3xx and keeps its history. `headers` carries the few
  // request headers WebForms needs (content-type, the ASP.NET AJAX markers).
  async proxy(
    path: string,
    init: { method?: string; body?: Buffer; headers?: Record<string, string> } = {},
  ): Promise<GompProxyResponse> {
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "*/*", ...init.headers };
    if (this.jar.hasAny()) headers["cookie"] = this.jar.toHeader();
    const res = await this.client.request({
      path,
      method: (init.method ?? "GET") as "GET",
      headers,
      body: init.body,
      maxRedirections: 0,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS * 3),
    });
    this.jar.ingest(res.headers as Record<string, string | string[]>);
    const location = res.headers["location"];
    return {
      status: res.statusCode,
      body: Buffer.from(await res.body.arrayBuffer()),
      contentType: String(res.headers["content-type"] ?? ""),
      location: location ? String(Array.isArray(location) ? location[0] : location) : null,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async get(startPath: string): Promise<{ body: Buffer; contentType: string }> {
    let path = startPath;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      };
      if (this.jar.hasAny()) headers["cookie"] = this.jar.toHeader();
      const res = await this.client.request({
        path,
        method: "GET",
        headers,
        maxRedirections: 0,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      this.jar.ingest(res.headers as Record<string, string | string[]>);
      const body = Buffer.from(await res.body.arrayBuffer());
      const location = res.headers["location"];
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        const loc = String(Array.isArray(location) ? location[0] : location);
        const resolved = new URL(loc, "https://dummy.invalid");
        path = resolved.pathname + resolved.search;
        continue;
      }
      if (res.statusCode >= 400) throw new Error(`gomp ${res.statusCode} at ${path}`);
      return { body, contentType: String(res.headers["content-type"] ?? "") };
    }
    throw new Error(`gomp: too many redirects from ${startPath}`);
  }
}
