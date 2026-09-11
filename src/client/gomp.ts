import { Client } from "undici";
import { CookieJar } from "./cookie-jar.js";

// GOMP (uniroma2studenti.gomp.it) hosts the piano di studi composer. The
// bridge is pure SSO: Delphi's pianoDiStudi/index.jsp 302s to
// Logon.aspx?SSO=<token> on the GOMP origin, and that first hop sets the
// Gomp2011Logon session cookie. From there, ElencoPiani.aspx lists the
// student's piani. Read-only by design — no WebForms __doPostBack machinery
// (see docs/architecture.md#gomp-study-plans); the composer itself is left to
// the browser.

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 10_000;

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
    return this.get(path);
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  private async get(startPath: string): Promise<string> {
    let path = startPath;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const headers: Record<string, string> = {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) delphi-wrapper/0.1 (student-portal)",
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
      return body.toString("utf-8");
    }
    throw new Error(`gomp: too many redirects from ${startPath}`);
  }
}
