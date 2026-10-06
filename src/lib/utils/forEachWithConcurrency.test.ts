import { describe, expect, it } from "vitest";
import { forEachWithConcurrency } from "./forEachWithConcurrency";

describe("forEachWithConcurrency", () => {
  it("processes every item without exceeding the requested concurrency", async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];
    await forEachWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      completed.push(item);
      active -= 1;
    });
    expect(peak).toBe(2);
    expect(completed.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects and stops scheduling new work after a worker fails", async () => {
    const started: number[] = [];
    await expect(
      forEachWithConcurrency([1, 2, 3, 4], 1, async (item) => {
        started.push(item);
        if (item === 2) throw new Error("failed");
      })
    ).rejects.toThrow("failed");
    expect(started).toEqual([1, 2]);
  });

  it("preserves undefined rejection reasons", async () => {
    await expect(
      forEachWithConcurrency([1], 1, async () => {
        throw undefined;
      })
    ).rejects.toBeUndefined();
  });

  it("falls back to serial work for non-finite concurrency", async () => {
    const completed: number[] = [];
    await forEachWithConcurrency([1, 2], Number.NaN, async (item) => {
      completed.push(item);
    });
    expect(completed).toEqual([1, 2]);
  });
});
