// Per-field TTLs (ms). 0 = forever (refreshed only on explicit demand).
//
// Tension: the official record lives on Delphi, so caching forever risks
// staleness — but esami/carriera change a few times a year and Delphi is slow
// and throttled, so we cache the slow-moving record hard and the time-sensitive
// data (appelli, tasse) briefly.

const HOUR = 60 * 60 * 1000;

export const CachePolicy = {
  carriera: 0,
  esami: 0,
  anagrafica: 24 * HOUR,
  piano: 24 * HOUR,
  appelli: 5 * 60 * 1000,
  bollettini: 1 * HOUR,
  servizi: 24 * HOUR,
  certificati: 1 * HOUR,
  verbali: 5 * 60 * 1000,
  esamiPendenti: 5 * 60 * 1000,
} as const;

// A session is dropped after this long without use, which is also the hard cap on
// how long a user's password lives in RAM (the password is held only to silently
// re-login when Delphi's cookie expires — see client/session.ts). 30 minutes
// keeps that exposure window small while surviving a normal browsing session;
// activity slides the window, idleness or a restart ends it.
export const SessionPolicy = {
  defaultTtlMs: 30 * 60 * 1000,
} as const;
