// Serialising mutex with a minimum inter-task gap.
//
// Delphi throttles a single session at roughly 1 req/sec; burst past that and
// it starts returning 5xx or stalling. We serialise every outbound request and
// enforce a gap measured between task starts. A task keeps the mutex until it
// settles because several Delphi flows rely on uninterrupted request order.

export interface Throttle {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createThrottle(minGapMs: number): Throttle {
  const queue: Array<() => void> = [];
  let active = false;
  let lastReleaseAt = 0;

  function pump(): void {
    if (active || queue.length === 0) return;
    active = true;
    const now = Date.now();
    const wait = Math.max(0, lastReleaseAt + minGapMs - now);
    setTimeout(async () => {
      const task = queue.shift();
      // Measure the gap from dispatch, but keep the mutex through completion.
      lastReleaseAt = Date.now();
      try {
        await task?.();
      } finally {
        active = false;
        pump();
      }
    }, wait);
  }

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(async () => {
          try {
            resolve(await fn());
          } catch (err) {
            reject(err);
          }
        });
        pump();
      });
    },
  };
}
