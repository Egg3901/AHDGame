import { describe, expect, it } from "vitest";
import { minutesSince, nextQuarterAt } from "./MarketTickNote";

describe("market tick note helpers", () => {
  it("counts whole minutes since the last update", () => {
    expect(minutesSince(null, 1_000)).toBeNull();
    expect(minutesSince(0, 59_000)).toBe(0);
    expect(minutesSince(0, 7 * 60_000 + 5)).toBe(7);
    expect(minutesSince(10_000, 0)).toBe(0);
  });

  it("finds the next quarter-hour boundary", () => {
    const base = Date.UTC(2026, 9, 9, 20, 0, 0);
    expect(nextQuarterAt(base)).toBe(base + 15 * 60_000);
    expect(nextQuarterAt(base + 14 * 60_000)).toBe(base + 15 * 60_000);
    expect(nextQuarterAt(base + 31 * 60_000)).toBe(base + 45 * 60_000);
  });
});
