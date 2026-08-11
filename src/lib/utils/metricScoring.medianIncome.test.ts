import { describe, it, expect } from "vitest";
import { scoreMetric } from "./metricScoring";

// Per-country, preset-aware median-income scoring: each country is scored
// against its own realistic local-currency range (no USD normalization), so a
// country at roughly its national median reads "Good" (~69), regardless of
// currency or era.
describe("scoreMetric — medianIncome per-country / preset-aware", () => {
  it("scores a US national-median income (~$72k) as Good", () => {
    expect(scoreMetric("medianIncome", 72000, "US")).toBeCloseTo(69, 0);
  });

  it("scores a JP national-median income (~¥4.4M) as Good against its own range", () => {
    expect(scoreMetric("medianIncome", 4_400_000, "JP")).toBeGreaterThan(60);
    expect(scoreMetric("medianIncome", 4_400_000, "JP")).toBeLessThan(80);
  });

  it("scores a 1991-nominal US income (~$29k) fairly under the 1991 preset", () => {
    // ×0.4 era band → ~$29k reads Good, not 0.
    expect(scoreMetric("medianIncome", 29000, "US", "1991-default")).toBeGreaterThan(60);
  });

  it("still scores a severely compressed live value (~$2,758) very low (pre-reinflation)", () => {
    expect(scoreMetric("medianIncome", 2758, "US")).toBe(0);
  });

  it("falls back to the global band for an unknown country", () => {
    // global best 90k / worst 15k → (50000-15000)/75000 ≈ 46.7
    expect(scoreMetric("medianIncome", 50000, "ZZ")).toBeCloseTo(46.7, 0);
  });
});
