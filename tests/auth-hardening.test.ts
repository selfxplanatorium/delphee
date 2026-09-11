import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { createLoginLimiter, bearerToken } from "../src/server/session-middleware.js";

// The two auth paths that used to be wrong, pinned:
//   - the login limiter shared ONE counter for every caller, so anyone could
//     spend the budget and lock the whole service out of logging in;
//   - logout read only the Authorization header, so a cookie-authenticated
//     logout left the session (and the password it holds) alive in RAM.

function reqWith(body: unknown): Request {
  return { body } as Request;
}

function resSpy(): Response & { statusCode: number; payload: unknown } {
  const res = {
    statusCode: 0,
    payload: undefined as unknown,
    setHeader: () => res,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.payload = payload;
      return res;
    },
  };
  return res as unknown as Response & { statusCode: number; payload: unknown };
}

describe("login rate limiter", () => {
  it("buckets per matricola, so one account cannot lock out another", () => {
    const limit = createLoginLimiter();
    const next = vi.fn();

    // Burn the budget for M1.
    for (let i = 0; i < 5; i++) limit(reqWith({ matricola: "M1" }), resSpy(), next);
    expect(next).toHaveBeenCalledTimes(5);

    const blocked = resSpy();
    limit(reqWith({ matricola: "M1" }), blocked, next);
    expect(blocked.statusCode).toBe(429);
    expect(next).toHaveBeenCalledTimes(5);

    // A different student is unaffected — the old shared counter failed here.
    limit(reqWith({ matricola: "M2" }), resSpy(), next);
    expect(next).toHaveBeenCalledTimes(6);
  });

  it("lets a blocked matricola back in once the window rolls over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limit = createLoginLimiter();
    const next = vi.fn();

    for (let i = 0; i < 5; i++) limit(reqWith({ matricola: "M1" }), resSpy(), next);
    const blocked = resSpy();
    limit(reqWith({ matricola: "M1" }), blocked, next);
    expect(blocked.statusCode).toBe(429);

    vi.setSystemTime(60_001);
    limit(reqWith({ matricola: "M1" }), resSpy(), next);
    expect(next).toHaveBeenCalledTimes(6);
    vi.useRealTimers();
  });
});

describe("bearerToken", () => {
  const req = (headers: Record<string, string>) =>
    ({ header: (n: string) => headers[n.toLowerCase()] }) as Request;

  it("reads the Authorization header", () => {
    expect(bearerToken(req({ authorization: "Bearer abc123" }))).toBe("abc123");
  });

  it("falls back to the dw_token cookie, so logout can invalidate the session", () => {
    expect(bearerToken(req({ cookie: "other=1; dw_token=abc123; x=2" }))).toBe("abc123");
  });

  it("returns null when neither is present", () => {
    expect(bearerToken(req({}))).toBeNull();
    expect(bearerToken(req({ cookie: "unrelated=1" }))).toBeNull();
  });
});
