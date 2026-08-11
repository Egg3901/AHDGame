import { describe, expect, it } from "vitest";
import { MACRO_BOUND, MACRO_WEIGHT, macroResidualFor } from "./macroResidual";

const GOOD = { "economic.unemploymentRate": 2, "economic.costOfLiving": 30 };
const BAD = { "economic.unemploymentRate": 22, "economic.costOfLiving": 95 };

describe("macroResidualFor", () => {
  it("is zero for a family with no macro sources", () => {
    expect(macroResidualFor("order.deterrence", 50, GOOD, "JP")).toBe(0);
    expect(macroResidualFor("defense.armedForces", 50, GOOD, "JP")).toBe(0);
  });

  it("is zero when there is no macro data at all", () => {
    expect(macroResidualFor("economy.stability", 50, {}, "JP")).toBe(0);
  });

  it("is POSITIVE when macro reality beats the law-implied target", () => {
    expect(macroResidualFor("economy.stability", 20, GOOD, "JP")).toBeGreaterThan(0);
  });

  it("is NEGATIVE when macro reality trails the law-implied target", () => {
    // The whole point of Bridge B: a depression must drag the board DOWN even
    // when the law book says the country should be stable.
    expect(macroResidualFor("economy.stability", 90, BAD, "JP")).toBeLessThan(0);
  });

  it("never exceeds the bound in either direction", () => {
    expect(macroResidualFor("economy.stability", 0, GOOD, "JP")).toBeLessThanOrEqual(MACRO_BOUND);
    expect(macroResidualFor("economy.stability", 100, BAD, "JP")).toBeGreaterThanOrEqual(
      -MACRO_BOUND
    );
  });

  it("is ~zero when macro sits exactly at the law target — the parity property", () => {
    // Bisect for the target where the term vanishes, rather than assuming where
    // the macro score lands: the clamp makes any fixed probe point fragile.
    // The residual is monotonically decreasing in lawTarget, so this converges.
    // MODERATE, not GOOD: an extreme fixture saturates the underlying metric
    // thresholds to a score of 100, putting the crossing on the boundary where
    // the property is untestable.
    const MODERATE = { "economic.unemploymentRate": 7, "economic.costOfLiving": 60 };
    let lo = 0;
    let hi = 100;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (macroResidualFor("economy.stability", mid, MODERATE, "JP") > 0) lo = mid;
      else hi = mid;
    }
    const crossing = (lo + hi) / 2;
    expect(Math.abs(macroResidualFor("economy.stability", crossing, MODERATE, "JP"))).toBeLessThan(
      0.01
    );
    // And the crossing is a real interior point, not the clamp boundary.
    expect(crossing).toBeGreaterThan(0);
    expect(crossing).toBeLessThan(100);
  });
});
