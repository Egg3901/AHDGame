import { describe, expect, it } from "vitest";
import {
  REGIONAL_BUDGET_PHASE_SLOTS,
  regionalBudgetPhaseDue,
  resolveRegionalBudgetCadence,
} from "./regionalBudgetCadence";

describe("regional budget cadence", () => {
  it("runs every phase exactly once per two consecutive turns", () => {
    for (const phase of Object.keys(REGIONAL_BUDGET_PHASE_SLOTS)) {
      const runs = [10, 11].filter((turn) => regionalBudgetPhaseDue(phase, turn, 2));
      expect(runs, phase).toHaveLength(1);
    }
  });

  it("splits the phases across both slots so no turn carries all of them", () => {
    const even = Object.keys(REGIONAL_BUDGET_PHASE_SLOTS).filter((p) =>
      regionalBudgetPhaseDue(p, 10, 2)
    );
    const odd = Object.keys(REGIONAL_BUDGET_PHASE_SLOTS).filter((p) =>
      regionalBudgetPhaseDue(p, 11, 2)
    );
    expect(even.length).toBeGreaterThan(0);
    expect(odd.length).toBeGreaterThan(0);
    expect(even.length + odd.length).toBe(Object.keys(REGIONAL_BUDGET_PHASE_SLOTS).length);
  });

  it("runs everything every turn when the cadence is 1, and always runs unknown phases", () => {
    expect(regionalBudgetPhaseDue("jpRegionalBudgetProcessing", 11, 1)).toBe(true);
    expect(regionalBudgetPhaseDue("jpRegionalBudgetProcessing", 10, 1)).toBe(true);
    expect(regionalBudgetPhaseDue("somethingElse", 10, 2)).toBe(true);
  });

  it("reads the cadence from the environment, clamped and defaulting on junk", () => {
    expect(resolveRegionalBudgetCadence({})).toBe(2);
    expect(resolveRegionalBudgetCadence({ AHD_REGIONAL_BUDGET_EVERY_TURNS: "1" })).toBe(1);
    expect(resolveRegionalBudgetCadence({ AHD_REGIONAL_BUDGET_EVERY_TURNS: "9" })).toBe(4);
    expect(resolveRegionalBudgetCadence({ AHD_REGIONAL_BUDGET_EVERY_TURNS: "x" })).toBe(2);
  });
});
