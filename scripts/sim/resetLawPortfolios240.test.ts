import { describe, expect, it } from "vitest";
import { runResetLawPortfolios240 } from "./resetLawPortfolios240";

describe("provisional combined national-law portfolio stress", () => {
  const runs = runResetLawPortfolios240();

  it("exercises 51 families in each country under four mixes and two rollouts", () => {
    expect(runs).toHaveLength(24);
    expect(runs.every((run) => run.provisions === 51)).toBe(true);
    expect(runs.every((run) => Math.abs(run.accountDeltaResidual) < 0.01)).toBe(true);
    expect(runs.every((run) => run.maximumAccountingResidual < 0.1)).toBe(true);
  });

  it("preserves the 1991 booked source and shows staged debt pressure", () => {
    for (const country of ["US", "UK", "JP"] as const) {
      const countryRuns = runs.filter((run) => run.country === country);
      expect(new Set(countryRuns.map((run) => run.previousAnnualAllocation)).size).toBe(1);
      const immediate = countryRuns.find(
        (run) => run.portfolio === "all_far_left" && run.rollout === "immediate"
      )!;
      const staged = countryRuns.find(
        (run) => run.portfolio === "all_far_left" && run.rollout === "staged"
      )!;
      expect(immediate.annualLawDelta).toBeGreaterThan(0);
      expect(staged.annualLawDelta).toBe(immediate.annualLawDelta);
      expect(staged.finalDebt).toBeLessThan(immediate.finalDebt);
      expect(immediate.firstDebtCeilingCrossing).not.toBeNull();
      expect(staged.firstDebtCeilingCrossing).not.toBeNull();
      expect(staged.firstDebtCeilingCrossing!).toBeGreaterThan(immediate.firstDebtCeilingCrossing!);
    }
  });
});
