import { describe, expect, it } from "vitest";
import { runSovereignMaturity240, runSovereignMaturityMatrix } from "./resetSovereignMaturity240";

describe("240-turn opening sovereign maturity sensitivity", () => {
  it("covers every country/scenario and starts staggered redemptions quarterly", () => {
    const runs = runSovereignMaturityMatrix();
    expect(runs).toHaveLength(12);
    for (const run of runs) {
      expect(run.turns).toBe(240);
      expect(run.totalMatured).toBeGreaterThanOrEqual(run.openingFace);
      expect(Math.abs(run.totalRolled + run.totalCashGap - run.totalMatured)).toBeLessThan(1);
      expect(run.endingFace).toBeGreaterThan(0);
      expect(run.peakCashGapGdpShare).toBeGreaterThanOrEqual(0);
      expect(run.peakCashGapGdpShare).toBeLessThan(1);
    }
    expect(runSovereignMaturity240("US", "staggered_current_demand").firstMaturityTurn).toBe(12);
  });

  it.each(["US", "UK", "JP"] as const)(
    "%s staggering cuts the peak maturity and broader institutions cut the cash gap",
    (country) => {
      const legacy = runSovereignMaturity240(country, "legacy_bullets_current_demand");
      const staggered = runSovereignMaturity240(country, "staggered_current_demand");
      const institutional = runSovereignMaturity240(country, "staggered_provisional_institutions");
      expect(staggered.peakMaturity).toBeLessThan(legacy.peakMaturity);
      expect(institutional.peakCashGap).toBeLessThan(staggered.peakCashGap);
      expect(institutional.totalCashGap).toBeLessThan(staggered.totalCashGap);
    }
  );

  it("keeps the redemption shock adverse rather than treating institutions as guaranteed buyers", () => {
    const baseline = runSovereignMaturity240("US", "staggered_provisional_institutions");
    const shock = runSovereignMaturity240("US", "staggered_institutional_stress");
    expect(shock.totalCashGap).toBeGreaterThan(baseline.totalCashGap);
    expect(shock.peakCashGap).toBeGreaterThan(baseline.peakCashGap);
  });
});
