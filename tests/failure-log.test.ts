import { describe, it, expect, vi, beforeEach } from "vitest";

// recordFailure records to the operator log stream only — no per-user file, no
// PII at rest. We mock the logger and assert the fields it emits (notably the
// upstream Delphi path pulled out of the error message).

const warn = vi.fn();
vi.mock("../src/logger.js", () => ({ logger: { warn } }));

const { recordFailure } = await import("../src/server/failure-log.js");

describe("recordFailure", () => {
  beforeEach(() => warn.mockClear());

  it("logs the failure and extracts the upstream Delphi path", () => {
    recordFailure(new Error("delphi 503 at /totem/jsp/Iscrizioni/esamiVerbalizzati.jsp"), {
      route: "/carriera",
      method: "GET",
      matricola: "0123456",
      status: 503,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = warn.mock.calls[0]!;
    expect(msg).toBe("delphi request failed");
    expect(fields.route).toBe("/carriera");
    expect(fields.status).toBe(503);
    expect(fields.errMessage).toContain("esamiVerbalizzati.jsp");
    expect(fields.upstream).toBe("/totem/jsp/Iscrizioni/esamiVerbalizzati.jsp");
  });

  it("still extracts upstream when a 5xx body snippet follows the path", () => {
    recordFailure(
      new Error("delphi 500 at /totem/jsp/Iscrizioni/datiStudente.jsp — <html> Errore: sessione scaduta </html>"),
      { route: "/anagrafica", method: "GET", matricola: "0357801", status: 503 },
    );
    const [fields] = warn.mock.calls[0]!;
    expect(fields.upstream).toBe("/totem/jsp/Iscrizioni/datiStudente.jsp");
    expect(fields.errMessage).toContain("sessione scaduta");
  });

  it("handles a failure with no session (matricola null)", () => {
    recordFailure(new Error("invalid_credentials"), {
      route: "/session/login",
      method: "POST",
      matricola: null,
      status: 401,
    });
    const [fields] = warn.mock.calls[0]!;
    expect(fields.status).toBe(401);
    expect(fields.matricola).toBeNull();
  });
});
