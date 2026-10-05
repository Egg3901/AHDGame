import { describe, expect, it } from "vitest";
import { runResetLawPriceGrid240 } from "./resetLawPriceGrid240";

describe("1991 national law-price grid, 240 turns per option", () => {
  const runs = runResetLawPriceGrid240();

  it("exercises all five levels of all 51 families in three countries", () => {
    expect(runs).toHaveLength(765);
    for (const country of ["US", "UK", "JP"] as const) {
      expect(runs.filter((run) => run.country === country)).toHaveLength(255);
    }
    expect(
      runs.every(
        (run) =>
          Number.isFinite(run.annualLawDelta) &&
          Number.isFinite(run.finalDebt) &&
          Number.isFinite(run.peakNationalArrears) &&
          run.maximumAccountingResidual < 0.01
      )
    ).toBe(true);
  });

  it("preserves the JP local allocation transfer when testing a fiscal-framework level", () => {
    const center = runs.find(
      (run) => run.country === "JP" && run.familyId === "L08" && run.choice === "center"
    )!;
    expect(center.previousAnnualAllocation).toBe(23_932_000_000_000);
    expect(center.proposedAnnualAllocation).toBe(23_932_000_000_000);
    expect(center.annualLawDelta).toBe(0);
  });

  it("avoids an immediate modeled ceiling breach from any single proposed level", () => {
    expect(
      runs.filter(
        (run) => run.firstDebtCeilingCrossing !== null && run.firstDebtCeilingCrossing <= 48
      )
    ).toEqual([]);
  });
});
