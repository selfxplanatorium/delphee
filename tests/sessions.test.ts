import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionRegistry, type SessionFactory } from "../src/server/sessions.js";
import type { Session } from "../src/client/session.js";

// Registry behaviour without touching the network: a stub factory stands in for
// the real Delphi login. Covers token issue/lookup, logout, lastUsed bump, and
// idle eviction (the one branch that bounds in-RAM password lifetime).

function fakeSession(matricola: string): Session {
  return {
    info: () => ({ state: "logged_in", matricola, since: 1, lastError: null }),
    logout: () => {},
  } as unknown as Session;
}

const factory: SessionFactory = async ({ matricola }) => ({
  session: fakeSession(matricola),
  close: async () => {},
});

describe("SessionRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("issues a token, resolves it, and logs out", async () => {
    const reg = new SessionRegistry("http://x", { idleTtlMs: 1000, factory });
    const { token, info } = await reg.login("M1", "pw");
    expect(token).toMatch(/^[\w-]+$/);
    expect(info.matricola).toBe("M1");
    expect(reg.get(token)?.info().matricola).toBe("M1");
    expect(reg.get("bogus")).toBeNull();

    await reg.logout(token);
    expect(reg.get(token)).toBeNull();
    expect(reg.size()).toBe(0);
  });

  it("evicts idle sessions past the TTL but keeps touched ones", async () => {
    const reg = new SessionRegistry("http://x", { idleTtlMs: 1000, factory });
    const { token } = await reg.login("M1", "pw"); // lastUsed = 0

    vi.setSystemTime(800);
    expect(reg.get(token)).not.toBeNull(); // bumps lastUsed → 800

    vi.setSystemTime(1500);
    reg.evictIdle(); // cutoff 500; 800 > 500 → kept
    expect(reg.size()).toBe(1);

    vi.setSystemTime(2000);
    reg.evictIdle(); // cutoff 1000; 800 < 1000 → evicted
    expect(reg.size()).toBe(0);
  });

  it("fires onEvict with the matricola on logout and on idle-eviction", async () => {
    const onEvict = vi.fn();
    const reg = new SessionRegistry("http://x", { idleTtlMs: 1000, factory, onEvict });

    const { token } = await reg.login("M1", "pw");
    await reg.logout(token);
    expect(onEvict).toHaveBeenLastCalledWith("M1");

    await reg.login("M2", "pw");
    vi.setSystemTime(5000);
    reg.evictIdle();
    expect(onEvict).toHaveBeenLastCalledWith("M2");
    expect(onEvict).toHaveBeenCalledTimes(2);
  });
});
