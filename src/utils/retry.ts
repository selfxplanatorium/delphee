// Typed errors and exponential backoff.
//
// The distinction that matters: a 5xx/timeout is transient (retry), an
// auth failure is terminal for this attempt (re-login, don't hammer). Mixing
// the two is how scrapers get rate-limited or locked out, so the error class
// drives the control flow.

export class RetryableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "RetryableError";
  }
}

export class NonRetryableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "NonRetryableError";
  }
}

export interface BackoffOptions {
  attempts?: number;
  baseDelayMs?: number;
  multiplier?: number;
  shouldRetry?: (err: unknown) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: BackoffOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const multiplier = opts.multiplier ?? 4;
  const shouldRetry = opts.shouldRetry ?? ((e) => e instanceof RetryableError);
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= attempts || !shouldRetry(err)) throw err;
      const delayMs = baseDelayMs * multiplier ** (attempt - 1);
      opts.onRetry?.(err, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}
