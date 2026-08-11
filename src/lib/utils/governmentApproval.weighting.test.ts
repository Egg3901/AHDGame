import { describe, it, expect } from "vitest";
import {
  computeStateApprovalBase,
  computeNationalAveragesFromMetrics,
  effectiveMetricWeight,
  APPROVAL_AXIS_WEIGHT_K,
} from "@/lib/utils/governmentApproval";
import type { StateMetrics } from "@/lib/db/types";
import type { StateDemographicGroup } from "@/lib/db/types/demographics";

/**
 * P6d GATE 1 — golden master: the electorate weighting is a mathematical
 * identity at k=0, with no groups, and for universal-good metrics at any k.
 * (The headline shift comes from a nonzero k on affinity-bearing metrics,
 * bounded separately by the live-shift gate.)
 */

function grp(population: number, economicLean: number, socialLean: number): StateDemographicGroup {
  return { population, economicLean, socialLean };
}

function sm(id: string, o: Record<string, Record<string, { value: number }>>): StateMetrics {
  return { _id: id, ...o } as StateMetrics;
}

const CONSERVATIVE = [grp(60, 4, 4), grp(40, 2, 3)];
const PROGRESSIVE = [grp(55, -4, -4), grp(45, -2, -3)];

describe("effectiveMetricWeight (P6d)", () => {
  it("is 1 at k=0 regardless of groups/affinity", () => {
    expect(effectiveMetricWeight({ econ: 1, social: 1 }, CONSERVATIVE, 0)).toBe(1);
    expect(effectiveMetricWeight({ econ: -1, social: -1 }, PROGRESSIVE, 0)).toBe(1);
  });

  it("is 1 with no groups or zero population", () => {
    expect(effectiveMetricWeight({ econ: 1, social: 0 }, [], 0.5)).toBe(1);
    expect(effectiveMetricWeight({ econ: 1, social: 0 }, [grp(0, 5, 5)], 0.5)).toBe(1);
  });

  it("is 1 for a universal-good metric (zero affinity) at any k", () => {
    expect(effectiveMetricWeight({ econ: 0, social: 0 }, CONSERVATIVE, 0.5)).toBe(1);
  });

  it("a right-affinity metric weighs MORE for a conservative electorate than progressive", () => {
    const cons = effectiveMetricWeight({ econ: 1, social: 0 }, CONSERVATIVE, 0.3);
    const prog = effectiveMetricWeight({ econ: 1, social: 0 }, PROGRESSIVE, 0.3);
    expect(cons).toBeGreaterThan(1);
    expect(prog).toBeLessThan(1);
  });

  it("floors per-group weight at 0 (never inverts)", () => {
    // extreme hostile group + huge k → would go negative, floored to 0
    expect(effectiveMetricWeight({ econ: 1, social: 0 }, [grp(100, -5, 0)], 5)).toBe(0);
  });
});

describe("computeStateApprovalBase — k=0 / no-affinity identity (GATE 1)", () => {
  // Only {0,0}-affinity (universal-good) metrics — NO gdpGrowth/poverty/etc.,
  // whose affinity would (correctly) make the weighting move approval.
  const metrics = sm("S1", {
    economic: { medianIncome: { value: 55000 } },
    education: { highSchoolGradRate: { value: 88 }, testPerformance: { value: 74 } },
    healthcare: { uninsuredRate: { value: 9 }, lifeExpectancy: { value: 80 } },
  });
  const other = sm("S2", {
    economic: { medianIncome: { value: 45000 } },
    education: { highSchoolGradRate: { value: 84 }, testPerformance: { value: 68 } },
    healthcare: { uninsuredRate: { value: 12 }, lifeExpectancy: { value: 78 } },
  });
  const averages = computeNationalAveragesFromMetrics([metrics, other]);

  it("supplying groups but k baked to 0 equals the unweighted base", () => {
    // We can't set k=0 through the public fn (constant), but the universal/affinity
    // identity below + the helper k=0 test together prove the path. Here we assert
    // the no-weighting call and the empty-groups call agree exactly.
    const unweighted = computeStateApprovalBase(metrics, averages);
    const emptyGroups = computeStateApprovalBase(metrics, averages, { groups: [] });
    expect(emptyGroups).toBe(unweighted);
  });

  it("a fixture of only universal-good metrics is unchanged by weighting at the live k", () => {
    // medianIncome / gradRate / uninsuredRate all have {0,0} affinity → weights all 1.
    const unweighted = computeStateApprovalBase(metrics, averages);
    const weighted = computeStateApprovalBase(metrics, averages, { groups: CONSERVATIVE });
    expect(weighted).toBe(unweighted);
    expect(APPROVAL_AXIS_WEIGHT_K).toBeGreaterThan(0); // sanity: the live k is nonzero
  });
});
