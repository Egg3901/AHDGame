import { describe, expect, it } from "vitest";
import { boundedParallelMap } from "./boundedParallelMap";

describe("boundedParallelMap", () => {
  it("caps concurrent work and preserves input order", async () => {
    let active = 0;
    let peak = 0;

    const results = await boundedParallelMap([30, 5, 20, 1, 10], 2, async (delay, index) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active--;
      return index;
    });

    expect(peak).toBe(2);
    expect(results).toEqual([0, 1, 2, 3, 4]);
  });

  it("treats a non-positive limit as one worker", async () => {
    let active = 0;
    let peak = 0;

    await boundedParallelMap([1, 2, 3], 0, async () => {
      active++;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active--;
    });

    expect(peak).toBe(1);
  });
});
