import { describe, expect, it } from "vitest";
import { OPENING, runResetTreasury240 } from "./resetTreasury240";

describe("reset 1991 treasury stress", () => {
  it("uses reconciled opening transfer amounts", () => {
    for (const country of ["US", "UK", "JP"] as const) {
      const opening = OPENING[country];
      expect(opening.operating).toBeGreaterThan(opening.grants);
      expect(opening.regionalOwnRevenue + opening.grants).toBeGreaterThanOrEqual(
        opening.regionalSpending
      );
    }
  });

  it("reconciles every 240-turn run and keeps ordinary openings below the ceiling", () => {
    for (const country of ["US", "UK", "JP"] as const) {
      for (const scenario of ["unchanged", "receipt_shock", "unfunded"] as const) {
        const result = runResetTreasury240(country, scenario);
        expect(result.grantMismatch).toBe(0);
        expect(result.maximumAccountingResidual).toBeLessThan(1);
        expect(result.finalDebt).toBeGreaterThanOrEqual(OPENING[country].debt);
        expect(result.finalNationalArrears).toBeGreaterThanOrEqual(0);
        expect(result.finalRegionalArrears).toBeGreaterThanOrEqual(0);
        if (country !== "US") expect(result.firstUSCrisisRollover).toBeNull();
      }
    }
    const us = runResetTreasury240("US", "unchanged");
    expect(us.firstDebtCeilingCrossing).toBeNull();
    expect(us.firstUSCrisisRollover).toBeNull();
    const expanded = runResetTreasury240("US", "unchanged", 100_000_000_000);
    expect(expanded.firstDebtCeilingCrossing).not.toBeNull();
    expect(expanded.firstUSCrisisRollover).not.toBeNull();
    expect(expanded.firstUSCrisisRollover!).toBeGreaterThanOrEqual(
      expanded.firstDebtCeilingCrossing!
    );
    expect(runResetTreasury240("US", "unfunded").finalNationalArrears).toBeGreaterThan(0);
  });

  it("accepts a staged law schedule and rejects a non-finite turn amount", () => {
    const immediate = runResetTreasury240("US", "unchanged", 100_000_000_000);
    const staged = runResetTreasury240("US", "unchanged", (turn) =>
      turn <= 48 ? 20_000_000_000 : 100_000_000_000
    );
    expect(staged.finalDebt).toBeLessThan(immediate.finalDebt);
    expect(staged.maximumAccountingResidual).toBeLessThan(0.01);
    expect(() => runResetTreasury240("US", "unchanged", () => Number.NaN)).toThrow(
      "Invalid annual law delta"
    );
  });
});
