import { randomBytes } from "node:crypto";
import { Fetcher } from "../client/fetcher.js";
import { Session, type Credentials } from "../client/session.js";
import { SessionPolicy } from "../cache/policies.js";
import { logger } from "../logger.js";
import { isDemoLogin, createDemoSession } from "./demo.js";
import type { SessionInfo } from "../types.js";

// In-RAM registry of logged-in users, keyed by an opaque token handed back to
// the LINFO host app. Each entry owns its own Fetcher (cookie jar), so concurrent
// users never collide. Nothing is persisted — a restart drops every session.
//
// Tension: holding passwords in memory (inside Session) is the price of silent
// re-login against a portal with no refresh token. We bound that exposure by
// evicting idle sessions, so an abandoned token's password doesn't linger
// forever.

// Live validation against both test account shapes showed Delphi remains stable
// at 1.2s while avoiding the large queue penalty of the former 2s gap.
const THROTTLE_GAP_MS = 1200;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

interface RegisteredSession {
  session: Session;
  close(): Promise<void>;
}

// Builds a logged-in session for the given creds. Swappable so tests can avoid
// the network. Throws on invalid credentials (and cleans up the fetcher).
export type SessionFactory = (creds: Credentials) => Promise<RegisteredSession>;

interface Entry {
  session: Session;
  close(): Promise<void>;
  lastUsed: number;
}

export interface SessionRegistryOptions {
  idleTtlMs?: number;
  factory?: SessionFactory;
  // Called with the matricola whenever a session leaves the registry (logout or
  // idle-eviction). Wired to the cache so a user's cached data is purged when
  // their session ends — nothing personal lingers past the session.
  onEvict?: (matricola: string) => void;
}

export class SessionRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly idleTtlMs: number;
  private readonly factory: SessionFactory;
  private readonly onEvict?: (matricola: string) => void;
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(baseUrl: string, opts: SessionRegistryOptions = {}) {
    this.idleTtlMs = opts.idleTtlMs ?? SessionPolicy.defaultTtlMs;
    this.factory = opts.factory ?? defaultFactory(baseUrl);
    this.onEvict = opts.onEvict;
    this.sweeper = setInterval(() => this.evictIdle(), SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  private fireEvict(e: Entry): void {
    const m = e.session.info().matricola;
    if (m && this.onEvict) this.onEvict(m);
  }

  async login(
    matricola: string,
    password: string,
  ): Promise<{ token: string; info: SessionInfo }> {
    const reg = await this.factory({ matricola, password });
    const token = randomBytes(32).toString("base64url");
    this.entries.set(token, { ...reg, lastUsed: Date.now() });
    return { token, info: reg.session.info() };
  }

  get(token: string): Session | null {
    const e = this.entries.get(token);
    if (!e) return null;
    e.lastUsed = Date.now();
    return e.session;
  }

  async logout(token: string): Promise<void> {
    const e = this.entries.get(token);
    if (!e) return;
    this.entries.delete(token);
    this.fireEvict(e);
    e.session.logout();
    await e.close();
  }

  // Drop sessions untouched beyond the idle TTL. Public so the boot timer and
  // tests share one code path.
  evictIdle(now: number = Date.now()): void {
    const cutoff = now - this.idleTtlMs;
    for (const [token, e] of this.entries) {
      if (e.lastUsed < cutoff) {
        this.entries.delete(token);
        this.fireEvict(e);
        e.session.logout();
        void e.close();
        logger.info("evicted idle session");
      }
    }
  }

  size(): number {
    return this.entries.size;
  }

  async closeAll(): Promise<void> {
    clearInterval(this.sweeper);
    await Promise.all([...this.entries.values()].map((e) => e.close()));
    this.entries.clear();
  }
}

function defaultFactory(baseUrl: string): SessionFactory {
  return async (creds) => {
    // Offline demo user: a pre-authenticated session backed by canned data,
    // no Delphi handshake (see server/demo.ts).
    if (isDemoLogin(creds.matricola, creds.password)) return createDemoSession(baseUrl);
    const fetcher = Fetcher.create(baseUrl, THROTTLE_GAP_MS);
    const session = new Session(fetcher);
    try {
      await session.login(creds);
    } catch (err) {
      await fetcher.close();
      throw err;
    }
    return { session, close: () => fetcher.close() };
  };
}
