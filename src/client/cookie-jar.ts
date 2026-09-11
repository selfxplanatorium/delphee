// Minimal cookie jar: a name→value map. We only ever talk to one host
// (the configured baseUrl), so domain/path matching is unnecessary — keeping
// it minimal avoids an entire class of cross-domain leakage bugs.

type UndiciHeaders = Record<string, string | string[] | undefined>;

export class CookieJar {
  private jar = new Map<string, string>();

  ingest(headers: Headers | UndiciHeaders): void {
    const lines = extractSetCookie(headers);
    for (const line of lines) {
      const pair = line.split(";", 1)[0]?.trim();
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }

  toHeader(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  hasAny(): boolean {
    return this.jar.size > 0;
  }

  clear(): void {
    this.jar.clear();
  }

  // Replace the whole jar from a stored `Cookie:` header value.
  loadFromHeader(header: string): void {
    this.clear();
    for (const part of header.split(";")) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name) this.jar.set(name, value);
    }
  }
}

function extractSetCookie(headers: Headers | UndiciHeaders): string[] {
  // Web Headers (fetch): use getSetCookie when available.
  if (typeof (headers as Headers).getSetCookie === "function") {
    return (headers as Headers).getSetCookie();
  }
  // undici plain-object headers.
  const raw = (headers as UndiciHeaders)["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}
