import { describe, expect, it, vi } from "vitest";
import { CacheStore } from "../src/cache/store.js";

describe("CacheStore.coalesce", () => {
  it("shares a concurrent load for the same key", async () => {
    const store = new CacheStore();
    let release!: (value: number) => void;
    const result = new Promise<number>((resolve) => { release = resolve; });
    const loader = vi.fn(() => result);
    const a = store.coalesce("student:carriera", loader);
    const b = store.coalesce("student:carriera", loader);
    expect(loader).toHaveBeenCalledTimes(1);
    release(7);
    await expect(Promise.all([a, b])).resolves.toEqual([7, 7]);
  });

  it("allows retry after a failed load", async () => {
    const store = new CacheStore();
    await expect(store.coalesce("k", async () => { throw new Error("no"); })).rejects.toThrow("no");
    await expect(store.coalesce("k", async () => "yes")).resolves.toBe("yes");
  });
});
