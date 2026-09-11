import type { Fetcher } from "./fetcher.js";
import { NonRetryableError, RetryableError, withBackoff } from "../utils/retry.js";
import { logger } from "../logger.js";
import type { SessionInfo, SessionState } from "../types.js";

// A response carrying a password input field is Delphi's login form, not an
// authenticated page. Authenticated captures contain no such field, so this is
// a reliable "we are NOT logged in" signal — used both to verify a fresh login
// actually took and to detect a session that silently died mid-flight (Delphi
// answers data requests with the login page instead of a 401). See
// docs/architecture.md#upstream-access.
export function looksLikeLoginPage(html: string): boolean {
  return /name=["']?password["']?/i.test(html);
}

// Owns the Delphi login lifecycle for ONE user. The two-step GET→POST flow and
// the manual redirect after POST are Delphi quirks (see
// docs/architecture.md#upstream-access).
//
// Multi-tenant model: the password is held in RAM for the life of this object so
// we can transparently re-login when Delphi's short-lived cookie expires —
// Delphi's session token is unstable and short-lived, so it can't be relied on
// to renew a session; replaying the password is the only dependable way to renew.
// Nothing is persisted: process restart drops the session and the user
// re-authenticates. One Session owns one Fetcher (one cookie jar), so concurrent
// users never share a jar.

const PATH_WARMUP = "/totem/jsp/Iscrizioni/autenticazione.jsp?language=IT";
const PATH_LOGIN = "/totem/jsp/Iscrizioni/sStudentiLoginIntro.jsp";

export interface Credentials {
  matricola: string;
  password: string;
}

export class Session {
  private state: SessionState = "logged_out";
  private since: number | null = null;
  private lastError: string | null = null;
  private matricola: string | null = null;
  private creds: Credentials | null = null;
  private loginInFlight: Promise<void> | null = null;

  // `seed` pre-authenticates the session without any network handshake — used
  // only by the offline demo user (see server/demo.ts). Real sessions pass no
  // seed and go through login().
  constructor(private readonly fetcher: Fetcher, seed?: { matricola: string }) {
    if (seed) {
      this.state = "logged_in";
      this.matricola = seed.matricola;
      this.since = Date.now();
    }
  }

  info(): SessionInfo {
    return {
      state: this.state,
      matricola: this.matricola,
      since: this.since,
      lastError: this.lastError,
    };
  }

  isLoggedIn(): boolean {
    return this.state === "logged_in";
  }

  async login(creds: Credentials): Promise<void> {
    // Collapse concurrent logins onto one in-flight attempt.
    if (this.loginInFlight) return this.loginInFlight;
    this.loginInFlight = this.doLogin(creds).finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async doLogin(creds: Credentials): Promise<void> {
    this.state = "logging_in";
    try {
      // Retry the whole handshake: a half-login (cookie set but Delphi still
      // serves the login form) is a transient server-side hiccup, not bad
      // credentials, and used to mint a zombie session that 503'd every page.
      await withBackoff(() => this.attemptLogin(creds), { attempts: 3, baseDelayMs: 500 });

      // Hold the creds in RAM so we can silently re-login on expiry.
      this.creds = creds;
      this.state = "logged_in";
      this.matricola = creds.matricola;
      this.since = Date.now();
      this.lastError = null;
      logger.info("session established");
    } catch (err) {
      this.state = "failed";
      this.lastError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  // One login handshake. Distinguishes three outcomes by inspecting the POST
  // response, not just "is there a cookie": authenticated (no login form) →
  // success; login form WITH an error message → bad credentials (terminal);
  // login form WITHOUT an error → the handshake didn't establish a session
  // (retryable). The last case is the zombie-session bug: we now reject it so
  // withBackoff retries instead of declaring success.
  private async attemptLogin(creds: Credentials): Promise<void> {
    this.fetcher.clearCookies();
    await this.fetcher.get(PATH_WARMUP);

    const res = await this.fetcher.postForm(PATH_LOGIN, {
      login: creds.matricola,
      password: creds.password,
      entra: "Entra",
    });

    const onLoginPage = looksLikeLoginPage(res.body);
    const credError = /credenziali errate|password errata|non.*corrett/i.test(res.body);

    if (!this.fetcher.hasCookies() || (onLoginPage && credError)) {
      throw new NonRetryableError("invalid_credentials");
    }
    if (onLoginPage) {
      throw new RetryableError("login form returned after POST; session not established");
    }
  }

  logout(): void {
    this.fetcher.clearCookies();
    this.creds = null;
    this.state = "logged_out";
    this.matricola = null;
    this.since = null;
  }

  // Run a Delphi operation, logging in first if needed and re-logging once on an
  // auth failure mid-flight using this session's own stored credentials.
  async request<T>(fn: (f: Fetcher) => Promise<T>): Promise<T> {
    if (!this.isLoggedIn()) {
      if (!this.creds) throw new NonRetryableError("invalid_credentials");
      await this.login(this.creds);
    }
    try {
      return await fn(this.fetcher);
    } catch (err) {
      if (
        err instanceof NonRetryableError &&
        err.message !== "invalid_credentials" &&
        this.creds
      ) {
        this.state = "expired";
        logger.info("session expired mid-request; re-logging in");
        await this.login(this.creds);
        return fn(this.fetcher);
      }
      throw err;
    }
  }
}
