import { describe, expect, it, vi } from "vitest";
import { createThrottle } from "../src/utils/throttle.js";

describe("createThrottle", () => {
  it("does not overlap queued work", async () => {
    vi.useFakeTimers();
    try {
      const throttle = createThrottle(10);
      const events: string[] = [];
      let releaseFirst!: () => void;
      const firstDone = new Promise<void>((resolve) => { releaseFirst = resolve; });
      const first = throttle.run(async () => {
        events.push("first:start");
        await firstDone;
        events.push("first:end");
      });
      const second = throttle.run(async () => { events.push("second:start"); });
      await vi.advanceTimersByTimeAsync(100);
      expect(events).toEqual(["first:start"]);
      releaseFirst();
      await first;
      await vi.advanceTimersByTimeAsync(10);
      await second;
      expect(events).toEqual(["first:start", "first:end", "second:start"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("continues after a rejected task", async () => {
    const throttle = createThrottle(0);
    await expect(throttle.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(throttle.run(async () => 42)).resolves.toBe(42);
  });
});
