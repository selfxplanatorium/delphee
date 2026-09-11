// In-memory data cache. NOTHING is persisted: every cached record is parsed
// Delphi data — names, codici fiscali, addresses, grades, ISEE/payment history —
// i.e. personal data that, in a multi-tenant deployment, must not sit at rest
// (GDPR). Keeping it in RAM only means a restart wipes it and there is no on-disk
// PII to encrypt, guard, or apply a retention policy to. Entries are keyed
// `<matricola>:<field>`; logout / idle-eviction drops that prefix (see
// SessionRegistry.onEvict), so a user's data never outlives their session.
//
// Tension: losing the cache on restart costs a re-fetch from (slow) Delphi — but
// sessions are RAM-only too and die on the same restart, so the cache never
// outlived a session anyway. Persisting it bought a re-fetch saving in exchange
// for a standing PII liability; not worth it.

interface Entry {
  value: string;
  ttlMs: number;
  updatedAt: number;
}

export class CacheStore {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = new Map<string, Promise<unknown>>();

  get(key: string): string | null {
    const e = this.entries.get(key);
    if (!e) return null;
    if (e.ttlMs > 0 && Date.now() > e.updatedAt + e.ttlMs) return null;
    return e.value;
  }

  // Ignores TTL: the stale-fallback path serves the last known value when a live
  // Delphi fetch fails, so an expired entry is kept (not pruned on read) until it
  // is overwritten or the owning session is evicted.
  getStale(key: string): string | null {
    return this.entries.get(key)?.value ?? null;
  }

  set(key: string, value: string, ttlMs: number): void {
    this.entries.set(key, { value, ttlMs, updatedAt: Date.now() });
  }

  // Share one cold load across concurrent requests for the same field. Without
  // this, a double-click or rapid navigation queues duplicate Delphi work.
  coalesce<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const existing = this.pending.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const work = loader().finally(() => this.pending.delete(key));
    this.pending.set(key, work);
    return work;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  // Evict every entry for one account. Keys are `<matricola>:<field>`, so a login
  // refreshes a user's data and a logout / idle-eviction purges it. Deleting
  // during iteration over the live key set is safe in JS Maps.
  deletePrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  close(): void {
    this.entries.clear();
    this.pending.clear();
  }
}
