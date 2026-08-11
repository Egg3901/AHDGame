import { describe, it, expect } from "vitest";
import { pushEarningsHistory, normalizedEarningsFromHistory } from "./earningsRollingAverage";
import { FUNDAMENTAL_ROLLING_AVG_TURNS } from "@/lib/constants/corporations";

describe("pushEarningsHistory", () => {
  it("starts a new history when undefined", () => {
    const result = pushEarningsHistory(undefined, 100_000);
    expect(result).toEqual([100_000]);
  });

  it("appends to existing history", () => {
    const result = pushEarningsHistory([50_000], 100_000);
    expect(result).toEqual([50_000, 100_000]);
  });

  it("trims to FUNDAMENTAL_ROLLING_AVG_TURNS entries, keeping most recent", () => {
    const history = [10_000, 20_000, 30_000];
    const result = pushEarningsHistory(history, 40_000);
    expect(result).toHaveLength(FUNDAMENTAL_ROLLING_AVG_TURNS);
    expect(result).toEqual([20_000, 30_000, 40_000]);
  });

  it("does not mutate the input array", () => {
    const original = [10_000, 20_000];
    pushEarningsHistory(original, 30_000);
    expect(original).toEqual([10_000, 20_000]);
  });
});

describe("normalizedEarningsFromHistory", () => {
  it("returns 0 for empty history", () => {
    expect(normalizedEarningsFromHistory([])).toBe(0);
  });

  it("returns the single value when history has one entry", () => {
    expect(normalizedEarningsFromHistory([80_000])).toBe(80_000);
  });

  it("returns the mean of all entries", () => {
    expect(normalizedEarningsFromHistory([60_000, 90_000, 120_000])).toBe(90_000);
  });

  it("handles negative earnings (loss-making corp)", () => {
    expect(normalizedEarningsFromHistory([-50_000, 0, 100_000])).toBeCloseTo(16_667, 0);
  });
});
