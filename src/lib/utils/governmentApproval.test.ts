import { describe, it, expect } from "vitest";
import {
  computeNationalAveragesFromMetrics,
  calculateStateApproval,
  calculateNationalApproval,
  buildStateApprovalBulkOps,
  computeStateApprovalBase,
  dampApprovalStep,
  APPROVAL_MAX_STEP_PER_TURN,
  BASE_APPROVAL,
} from "@/lib/utils/governmentApproval";
import type { StateMetrics } from "@/lib/db/types";

function makeStateMetrics(
  stateId: string,
  overrides: Partial<Record<string, Record<string, { value: number }>>> = {}
): StateMetrics {
  const base: Record<string, Record<string, { value: number }>> = {
    economic: { medianIncome: { value: 50000 }, unemploymentRate: { value: 5 } },
    education: { highSchoolGradRate: { value: 90 } },
    healthcare: { uninsuredRate: { value: 10 } },
    ...overrides,
  };
  return { _id: stateId, ...base } as StateMetrics;
}

describe("computeNationalAveragesFromMetrics", () => {
  it("returns category shells with no metric values for empty input", () => {
    const result = computeNationalAveragesFromMetrics([]);
    // Implementation iterates CATEGORIES and creates empty objects per category
    expect(Object.keys(result).length).toBeGreaterThan(0);
    expect(result.economic).toEqual({});
  });

  it("computes averages across states", () => {
    const metrics = [
      makeStateMetrics("CA", { economic: { medianIncome: { value: 60000 } } }),
      makeStateMetrics("TX", { economic: { medianIncome: { value: 40000 } } }),
    ];
    const result = computeNationalAveragesFromMetrics(metrics);
    expect(result.economic?.medianIncome).toBe(50000);
  });

  it("ignores undefined and non-finite values", () => {
    const metrics = [
      makeStateMetrics("CA", { economic: { medianIncome: { value: 50000 } } }),
      makeStateMetrics("TX", { economic: { medianIncome: { value: NaN } } }),
      makeStateMetrics("NY", { economic: { medianIncome: { value: 70000 } } }),
    ];
    const result = computeNationalAveragesFromMetrics(metrics);
    // Only CA and NY contribute: (50000 + 70000) / 2 = 60000
    expect(result.economic?.medianIncome).toBe(60000);
  });
});

describe("calculateStateApproval", () => {
  it("returns BASE_APPROVAL when no metrics match national averages", () => {
    const stateMetrics = makeStateMetrics("CA", {
      economic: { medianIncome: { value: 50000 } },
    });
    const nationalAverages = { economic: { medianIncome: 50000 } };
    const result = calculateStateApproval(
      stateMetrics,
      nationalAverages,
      [],
      undefined,
      "2019-default",
      null
    );
    expect(result).toBe(BASE_APPROVAL);
  });

  it("returns higher approval when state is above average on higher-is-better metrics", () => {
    const stateMetrics = makeStateMetrics("CA", {
      economic: { medianIncome: { value: 70000 } },
    });
    const nationalAverages = { economic: { medianIncome: 50000 } };
    const result = calculateStateApproval(
      stateMetrics,
      nationalAverages,
      [],
      undefined,
      "2019-default",
      null
    );
    expect(result).toBeGreaterThan(BASE_APPROVAL);
  });

  it("returns lower approval when state is below average on higher-is-better metrics", () => {
    const stateMetrics = makeStateMetrics("CA", {
      economic: { medianIncome: { value: 30000 } },
    });
    const nationalAverages = { economic: { medianIncome: 50000 } };
    const result = calculateStateApproval(
      stateMetrics,
      nationalAverages,
      [],
      undefined,
      "2019-default",
      null
    );
    expect(result).toBeLessThan(BASE_APPROVAL);
  });

  it("clamps result to 0-100", () => {
    const stateMetrics = makeStateMetrics("CA", {
      economic: { medianIncome: { value: 0 }, unemploymentRate: { value: 50 } },
    });
    const nationalAverages = {
      economic: { medianIncome: 100000, unemploymentRate: 3 },
    };
    const result = calculateStateApproval(
      stateMetrics,
      nationalAverages,
      [],
      undefined,
      "2019-default",
      null
    );
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  // Regression (fix/region-approval): the `preset` argument must reach the BASE
  // score, not just the named modifiers. Under a pre-2000 preset the
  // era-anachronistic metrics (broadbandAccess, renewables, …) are excluded from
  // the base; scoring them there made the region hero / snapshot / rankings
  // disagree. broadbandAccess is far below its average here — if it scores it
  // drags the base below BASE_APPROVAL; under 1991 it must be excluded → BASE.
  it("forwards preset to the base score so pre-2000 presets exclude anachronistic metrics", () => {
    const stateMetrics = makeStateMetrics("CA", {
      infrastructure: { broadbandAccess: { value: 10 } },
    });
    const nationalAverages = { infrastructure: { broadbandAccess: 90 } };

    const under2019 = calculateStateApproval(
      stateMetrics,
      nationalAverages,
      [],
      undefined,
      "2019-default",
      null
    );
    const under1991 = calculateStateApproval(
      stateMetrics,
      nationalAverages,
      [],
      undefined,
      "1991-default",
      null
    );

    expect(under2019).toBeLessThan(BASE_APPROVAL);
    expect(under1991).toBe(BASE_APPROVAL);
  });
});

describe("calculateNationalApproval", () => {
  it("returns BASE_APPROVAL when total population is 0", () => {
    const result = calculateNationalApproval([]);
    expect(result).toBe(BASE_APPROVAL);
  });

  it("computes population-weighted average", () => {
    const stateApprovals = [
      { stateId: "CA", approval: 60, population: 40_000_000 },
      { stateId: "WY", approval: 40, population: 600_000 },
    ];
    const result = calculateNationalApproval(stateApprovals);
    // Weighted: (60*40M + 40*600K) / (40M + 600K) ≈ 59.7
    expect(result).toBeGreaterThan(59);
    expect(result).toBeLessThan(60);
  });

  it("clamps result to 0-100", () => {
    const stateApprovals = [
      { stateId: "A", approval: 150, population: 1000 },
      { stateId: "B", approval: -10, population: 1000 },
    ];
    const result = calculateNationalApproval(stateApprovals);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });
});

describe("buildStateApprovalBulkOps", () => {
  const now = new Date("2026-06-05T00:00:00.000Z");

  it("builds an upserting updateOne per state with capped history push", () => {
    const ops = buildStateApprovalBulkOps(
      [
        { stateId: "CA", approval: 60 },
        { stateId: "TX", approval: 45 },
      ],
      "US",
      7,
      now
    );
    expect(ops).toHaveLength(2);
    const ca = ops[0].updateOne;
    expect(ca.filter).toEqual({ _id: "CA" });
    expect(ca.upsert).toBe(true);
    expect(ca.update.$set).toMatchObject({
      stateId: "CA",
      countryId: "US",
      approvalRating: 60,
      updatedAt: now,
    });
    // net = approval - (100 - approval) = 2*approval - 100 = 20
    expect(ca.update.$push.history).toEqual({
      $each: [{ turn: 7, approval: 60, net: 20 }],
      $slice: -20,
    });
  });

  it("returns an empty array for no states", () => {
    expect(buildStateApprovalBulkOps([], "US", 1, now)).toEqual([]);
  });
});

describe("budget-sync approval bound (P6d gate)", () => {
  // Both states share identical base metrics that match the national average →
  // those contribute 0, isolating the fiscal effect. Healthy = at the fiscal
  // average; stressed = deep deficit + high debt.
  const nationalAverages = {
    economic: { medianIncome: 50000, unemploymentRate: 5 },
    education: { highSchoolGradRate: 90 },
    healthcare: { uninsuredRate: 10 },
    governance: { debtToGdp: 60, budgetBalance: -2 },
  };

  it("a deep-deficit / high-debt swing lowers approval, base stays bounded in [45,55]", () => {
    const healthy = computeStateApprovalBase(
      makeStateMetrics("DE", {
        governance: { debtToGdp: { value: 60 }, budgetBalance: { value: -2 } },
      }),
      nationalAverages
    );
    const stressed = computeStateApprovalBase(
      makeStateMetrics("DE", {
        governance: { debtToGdp: { value: 120 }, budgetBalance: { value: -8 } },
      }),
      nationalAverages
    );

    // Metric-driven base is a relative-to-peers band by design.
    expect(healthy).toBeGreaterThanOrEqual(45);
    expect(healthy).toBeLessThanOrEqual(55);
    expect(stressed).toBeGreaterThanOrEqual(45);
    expect(stressed).toBeLessThanOrEqual(55);
    // Correct sign: a worse fiscal position is not better for approval (debtToGdp
    // isHigherBetter=false, budgetBalance isHigherBetter=true).
    expect(stressed).toBeLessThan(healthy);
  });
});

describe("dampApprovalStep (#2891 approval volatility)", () => {
  it("adopts the target directly when there is no previous value", () => {
    expect(dampApprovalStep(undefined, 43)).toBe(43);
    expect(dampApprovalStep(Number.NaN, 43)).toBe(43);
  });

  it("passes small moves through unchanged", () => {
    expect(dampApprovalStep(41, 43)).toBe(43);
    expect(dampApprovalStep(43, 41.5)).toBe(41.5);
  });

  it("caps a large upward jump at the per-turn step", () => {
    // The #921 complaint: 37 -> 43 in one recompute. Now steps 2/turn.
    expect(dampApprovalStep(37, 43)).toBe(37 + APPROVAL_MAX_STEP_PER_TURN);
  });

  it("caps a large downward drop symmetrically", () => {
    expect(dampApprovalStep(43, 30)).toBe(43 - APPROVAL_MAX_STEP_PER_TURN);
  });

  it("honors an explicit maxStep override", () => {
    expect(dampApprovalStep(40, 50, 5)).toBe(45);
  });

  it("converges to the target over successive turns", () => {
    let v = 37;
    for (let i = 0; i < 3; i++) v = dampApprovalStep(v, 43);
    expect(v).toBe(43);
  });
});

describe("getApprovalExcludedMetrics 1999-default (audit P2)", () => {
  it("excludes pre-2000 anachronistic metrics for 1999-default when era flag is off", async () => {
    const { getApprovalExcludedMetrics } = await import("./governmentApproval");
    const excluded = getApprovalExcludedMetrics("1999-default", null);
    expect(excluded.has("broadbandAccess")).toBe(true);
    expect(excluded.has("recyclingRate")).toBe(true);
  });
});
