import { describe, it, expect } from "vitest";
import { Session, looksLikeLoginPage } from "../src/client/session.js";
import { Api } from "../src/server/api.js";
import { NonRetryableError } from "../src/utils/retry.js";
import type { Fetcher, FetcherResponse, FetcherBinaryResponse } from "../src/client/fetcher.js";

// Drives the real Session against a scripted fetcher (no network). Covers the
// zombie-session fix: a half-login must retry, bad creds must not, and a session
// that dies mid-flight (login form in place of data) must re-login and retry.

const LOGIN_PAGE = `<form><input type="password" name="password"/></form>`;
const DASHBOARD = `<html><body>Benvenuto studente</body></html>`;
const DATA = `<table><td class="riepilogo">Matricola 0123456</td></table>`;

function reply(body: string): FetcherResponse {
  return { status: 200, body, contentType: "text/html", finalPath: "/" };
}

// Fake fetcher: postForm returns the next scripted login response; get returns
// the next scripted data response. `cookies` tracks clear/has so the "no cookie"
// branch can be exercised.
function fakeFetcher(opts: {
  postBodies: string[];
  getBodies?: string[];
  binaries?: Array<{ body: string; contentType: string }>;
  cookieAfterPost?: boolean;
}): Fetcher {
  const posts = [...opts.postBodies];
  const gets = [...(opts.getBodies ?? [])];
  const bins = [...(opts.binaries ?? [])];
  let cookie = false;
  return {
    clearCookies: () => { cookie = false; },
    hasCookies: () => cookie,
    get: async () => reply(gets.shift() ?? DATA),
    postForm: async () => {
      cookie = opts.cookieAfterPost ?? true;
      return reply(posts.shift() ?? DASHBOARD);
    },
    fetchBinary: async (): Promise<FetcherBinaryResponse> => {
      const next = bins.shift() ?? { body: "%PDF-1.4", contentType: "application/pdf" };
      return {
        status: 200,
        body: Buffer.from(next.body, "latin1"),
        contentType: next.contentType,
        finalPath: "/",
      };
    },
  } as unknown as Fetcher;
}

const creds = { matricola: "0123456", password: "pw" };

describe("looksLikeLoginPage", () => {
  it("flags the login form and clears real data pages", () => {
    expect(looksLikeLoginPage(LOGIN_PAGE)).toBe(true);
    expect(looksLikeLoginPage(DATA)).toBe(false);
    expect(looksLikeLoginPage(DASHBOARD)).toBe(false);
  });
});

describe("Session.login", () => {
  it("retries a half-login (cookie set, still on login form) then succeeds", async () => {
    const s = new Session(fakeFetcher({ postBodies: [LOGIN_PAGE, DASHBOARD] }));
    await s.login(creds);
    expect(s.isLoggedIn()).toBe(true);
  });

  it("rejects bad credentials without retrying", async () => {
    const s = new Session(
      fakeFetcher({ postBodies: ["credenziali errate " + LOGIN_PAGE] }),
    );
    await expect(s.login(creds)).rejects.toThrow("invalid_credentials");
    expect(s.isLoggedIn()).toBe(false);
  });
});

describe("Session.request recovery", () => {
  it("re-logs in and retries when a data fetch returns the login page", async () => {
    const s = new Session(fakeFetcher({ postBodies: [DASHBOARD, DASHBOARD] }));
    await s.login(creds);

    let calls = 0;
    const out = await s.request(async (f) => {
      calls++;
      const res = await f.get("/totem/x");
      // First call simulates the zombie session: server returns the login page.
      if (calls === 1) throw new NonRetryableError("session_lost");
      return res.body;
    });
    expect(calls).toBe(2);
    expect(out).toBe(DATA);
  });

  it("recovers a PDF download when the session drops mid-request", async () => {
    // First fetchBinary returns the login form as HTML (dropped session); after
    // re-login the second returns the real PDF.
    const s = new Session(
      fakeFetcher({
        postBodies: [DASHBOARD, DASHBOARD],
        binaries: [
          { body: LOGIN_PAGE, contentType: "text/html" },
          { body: "%PDF-1.4 real", contentType: "application/pdf" },
        ],
      }),
    );
    await s.login(creds);

    const api = new Api({ session: s, store: {} as never, config: { baseUrl: "http://x" } as never });
    const out = await api.getCertificato("certificatoIscrizione.jsp", {});
    expect(out.contentType).toBe("application/pdf");
    expect(out.body.toString("latin1")).toContain("real");
  });
});
