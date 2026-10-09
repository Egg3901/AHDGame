import { describe, expect, it } from "vitest";
import { KeyedQueue, runInLanes } from "./settlementLanes";

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

describe("KeyedQueue", () => {
  it("runs work sharing a key in call order and lets disjoint keys overlap", async () => {
    const lock = new KeyedQueue();
    const log: string[] = [];
    let active = 0;
    let peak = 0;
    const job = (name: string, keys: string[]) =>
      lock.run(keys, async () => {
        active++;
        peak = Math.max(peak, active);
        log.push(`start ${name}`);
        await tick();
        log.push(`end ${name}`);
        active--;
      });
    await Promise.all([
      job("us-1", ["budget:US", "fund:A"]),
      job("uk-1", ["budget:UK"]),
      job("us-2", ["budget:US"]),
      job("de-1", ["budget:DE", "fund:A"]),
    ]);
    expect(log.indexOf("start us-2")).toBeGreaterThan(log.indexOf("end us-1"));
    // A holder shared across countries orders those settlements too.
    expect(log.indexOf("start de-1")).toBeGreaterThan(log.indexOf("end us-1"));
    expect(peak).toBeGreaterThan(1);
  });
});

describe("runInLanes", () => {
  it("awaits every started task and rethrows the earliest failure", async () => {
    const finished: number[] = [];
    await expect(
      runInLanes([0, 1, 2, 3, 4, 5], 3, async (n) => {
        await tick();
        if (n === 1 || n === 2) throw new Error(`fail ${n}`);
        finished.push(n);
      })
    ).rejects.toThrow("fail 1");
    // Tasks already in flight when the failure landed still ran to completion.
    expect(finished).toContain(0);
    expect(finished.length).toBeLessThan(6);
  });
});
