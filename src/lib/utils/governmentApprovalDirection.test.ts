import { describe, it, expect } from "vitest";
import {
  computeNationalAveragesFromMetrics,
  computeStateApprovalBase,
} from "@/lib/utils/governmentApproval";
import type { StateMetrics } from "@/lib/db/types";

/**
 * P6d-pre — the approval direction SSOT consolidation. These lower-better
 * metrics (P2–P6 additions) were MISSING from governmentApproval's local
 * IS_HIGHER_BETTER map and fell back to `?? true`, so approval REWARDED bad
 * outcomes. After switching to the metricDefinitions SSOT, a state with worse
 * lower-better values must score LOWER, not higher.
 */

function sm(
  stateId: string,
  overrides: Record<string, Record<string, { value: number }>>
): StateMetrics {
  return { _id: stateId, ...overrides } as StateMetrics;
}

/** Build a "worse" and "better" state for a single lower-better metric and
 * compare their base approval against the two-state national average. */
function worseScoresLower(
  category: string,
  metricId: string,
  worse: number,
  better: number
): {
  worseApproval: number;
  betterApproval: number;
} {
  const a = sm("WORSE", { [category]: { [metricId]: { value: worse } } });
  const b = sm("BETTER", { [category]: { [metricId]: { value: better } } });
  const averages = computeNationalAveragesFromMetrics([a, b]);
  return {
    worseApproval: computeStateApprovalBase(a, averages),
    betterApproval: computeStateApprovalBase(b, averages),
  };
}

describe("approval metric direction (P6d-pre)", () => {
  it.each([
    ["social", "childPoverty", 25, 5],
    ["healthcare", "nhsWaitingTime", 30, 6],
    ["governance", "debtToGdp", 120, 40],
    ["publicSafety", "knifeCrimeRate", 80, 10],
    ["social", "housingAffordability", 70, 20],
  ])("a worse %s.%s scores lower approval", (cat, metric, worse, better) => {
    const { worseApproval, betterApproval } = worseScoresLower(cat, metric, worse, better);
    expect(worseApproval).toBeLessThan(betterApproval);
  });

  it("control: a higher gdpGrowth (higher-better) scores higher approval", () => {
    const a = sm("HIGH", { economic: { gdpGrowth: { value: 5 } } });
    const b = sm("LOW", { economic: { gdpGrowth: { value: 1 } } });
    const averages = computeNationalAveragesFromMetrics([a, b]);
    expect(computeStateApprovalBase(a, averages)).toBeGreaterThan(
      computeStateApprovalBase(b, averages)
    );
  });
});
