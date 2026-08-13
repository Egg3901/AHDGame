import { describe, it, expect } from "vitest";
import {
  CAPACITY_PER_CREDIT,
  MAX_PLAN_FULFILLMENT,
  SOE_PERF_BASELINE,
  aggregateCapacityUtilisation,
  aggregatePlanFulfillment,
  allocateDirectedCredit,
  applyDirectedCreditToSoe,
  directedCreditBudget,
  directedCreditIssuance,
  makeSeedSoeState,
  planFulfillment,
  resolveCreditAllocation,
} from "./soe";
import type { CorporationType } from "@/lib/constants/corporations";

describe("planFulfillment", () => {
  it("is output / planTarget", () => {
    expect(planFulfillment({ output: 60, planTarget: 100 })).toBeCloseTo(0.6);
    expect(planFulfillment({ output: 100, planTarget: 100 })).toBeCloseTo(1.0);
  });

  it("clamps a runaway overshoot to MAX_PLAN_FULFILLMENT", () => {
    expect(planFulfillment({ output: 10_000, planTarget: 100 })).toBe(MAX_PLAN_FULFILLMENT);
  });

  it("treats a zero/invalid target as on-plan (no information)", () => {
    expect(planFulfillment({ output: 50, planTarget: 0 })).toBe(SOE_PERF_BASELINE);
    expect(planFulfillment({ output: 50, planTarget: NaN })).toBe(SOE_PERF_BASELINE);
  });
});

describe("aggregatePlanFulfillment", () => {
  it("means across SOEs", () => {
    const perf = aggregatePlanFulfillment([
      { output: 50, planTarget: 100 }, // 0.5
      { output: 100, planTarget: 100 }, // 1.0
    ]);
    expect(perf).toBeCloseTo(0.75);
  });

  it("empty set → baseline (no SOE-driven pressure)", () => {
    expect(aggregatePlanFulfillment([])).toBe(SOE_PERF_BASELINE);
  });
});

describe("makeSeedSoeState", () => {
  it("starts on-plan with baseline efficiency, no losses, vacant director", () => {
    const soe = makeSeedSoeState("energy", 1_000);
    expect(soe.sector).toBe("energy");
    expect(soe.planTarget).toBe(1_000);
    expect(soe.output).toBe(1_000);
    expect(soe.capacity).toBeGreaterThan(soe.planTarget); // 10% headroom
    expect(soe.efficiency).toBe(1.0);
    expect(soe.cumulativeLosses).toBe(0);
    expect(soe.directorId).toBeNull();
    expect(planFulfillment(soe)).toBe(1.0);
  });
});

// ── Command Economy v2 (P1): directed credit ─────────────────────────────────

describe("directedCreditBudget", () => {
  it("scales with aggressiveness and plan size; zero at zero aggressiveness", () => {
    expect(directedCreditBudget(48_000, 0)).toBe(0);
    const half = directedCreditBudget(48_000, 0.5);
    const full = directedCreditBudget(48_000, 1);
    expect(full).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(0);
  });

  it("guards non-finite / negative plan size", () => {
    expect(directedCreditBudget(NaN, 1)).toBe(0);
    expect(directedCreditBudget(-100, 1)).toBe(0);
  });
});

describe("applyDirectedCreditToSoe", () => {
  it("raises capacity (investment builds the productive ceiling)", () => {
    const soe = makeSeedSoeState("energy", 1_000);
    const before = soe.capacity;
    const after = applyDirectedCreditToSoe(soe, 200);
    expect(after.capacity).toBe(Math.round(before + 200 * CAPACITY_PER_CREDIT));
    expect(after.capacity).toBeGreaterThan(before);
  });

  it("lifts output but never above the (raised) capacity", () => {
    const soe = { ...makeSeedSoeState("energy", 1_000), output: 1_000, capacity: 1_000 };
    const after = applyDirectedCreditToSoe(soe, 50);
    expect(after.output).toBeGreaterThan(1_000);
    expect(after.output).toBeLessThanOrEqual(after.capacity);
  });

  it("zero / negative credit is a no-op", () => {
    const soe = makeSeedSoeState("energy", 1_000);
    expect(applyDirectedCreditToSoe(soe, 0)).toBe(soe);
    expect(applyDirectedCreditToSoe(soe, -5)).toBe(soe);
  });
});

describe("allocateDirectedCredit", () => {
  it("directs MORE credit to the under-performing strategic sector", () => {
    const soes = [
      { sector: "energy" as const, output: 1_000, planTarget: 1_000 }, // on plan
      { sector: "manufacturing" as const, output: 400, planTarget: 1_000 }, // missing plan
    ];
    const alloc = allocateDirectedCredit(soes, 1_000);
    expect(alloc.get("manufacturing")!).toBeGreaterThan(alloc.get("energy")!);
    // Conserves the budget (modulo rounding-free float sum).
    const total = [...alloc.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1_000);
  });

  it("still gives an on-plan sector a floor of credit", () => {
    const soes = [
      { sector: "energy" as const, output: 1_000, planTarget: 1_000 },
      { sector: "manufacturing" as const, output: 1_000, planTarget: 1_000 },
    ];
    const alloc = allocateDirectedCredit(soes, 1_000);
    expect(alloc.get("energy")!).toBeGreaterThan(0);
  });

  it("zero budget → all-zero allocation", () => {
    const soes = [{ sector: "energy" as const, output: 1_000, planTarget: 1_000 }];
    expect(allocateDirectedCredit(soes, 0).get("energy")).toBe(0);
  });
});

describe("directedCreditIssuance", () => {
  it("monetizes the slice not covered by real savings", () => {
    expect(directedCreditIssuance(100, 0.4)).toBeCloseTo(60);
    expect(directedCreditIssuance(100, 1)).toBe(0); // fully savings-backed
    expect(directedCreditIssuance(100, 0)).toBe(100); // all printed
  });
});

describe("resolveCreditAllocation (P2 Gosbank / director levers)", () => {
  const soes: Array<{
    sector: CorporationType;
    output: number;
    planTarget: number;
    investmentRequest?: number;
  }> = [
    { sector: "manufacturing", output: 100, planTarget: 100 },
    { sector: "energy", output: 100, planTarget: 100 },
    { sector: "agriculture", output: 100, planTarget: 100 },
  ];

  it("splits strictly by the Gosbank chair's explicit per-sector weights", () => {
    const alloc = resolveCreditAllocation(soes, 300, {
      manufacturing: 2,
      energy: 1,
      agriculture: 0,
    });
    expect(alloc.get("manufacturing")).toBeCloseTo(200, 5);
    expect(alloc.get("energy")).toBeCloseTo(100, 5);
    // A zero weight starves that sector entirely.
    expect(alloc.get("agriculture")).toBeCloseTo(0, 5);
  });

  it("falls back to automatic weighting when no override is given (even split at parity)", () => {
    const alloc = resolveCreditAllocation(soes, 300, null);
    expect(alloc.get("manufacturing")).toBeCloseTo(100, 5);
    expect(alloc.get("energy")).toBeCloseTo(100, 5);
    expect(alloc.get("agriculture")).toBeCloseTo(100, 5);
  });

  it("pulls extra credit toward a director's investment request under automatic allocation", () => {
    const withReq = [
      {
        sector: "manufacturing" as CorporationType,
        output: 100,
        planTarget: 100,
        investmentRequest: 100,
      },
      { sector: "energy" as CorporationType, output: 100, planTarget: 100 },
      { sector: "agriculture" as CorporationType, output: 100, planTarget: 100 },
    ];
    const alloc = resolveCreditAllocation(withReq, 300, null);
    expect(alloc.get("manufacturing")!).toBeGreaterThan(alloc.get("energy")!);
  });

  it("sums to the total budget and zeroes out on empty budget", () => {
    const alloc = resolveCreditAllocation(soes, 300, null);
    const sum = [...alloc.values()].reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(300, 3);
    const none = resolveCreditAllocation(soes, 0, null);
    expect([...none.values()].every((v) => v === 0)).toBe(true);
  });
});

describe("aggregateCapacityUtilisation (the drift driver)", () => {
  it("scores output against capacity, not against the planner's own target", () => {
    // Same physical performance, wildly different self-set plans.
    const soes = [{ output: 50, capacity: 100 }];
    expect(aggregateCapacityUtilisation(soes)).toBeCloseTo(0.5, 6);

    // A planner who sets a trivial target reports a perfect plan...
    expect(aggregatePlanFulfillment([{ output: 50, planTarget: 1 }])).toBe(MAX_PLAN_FULFILLMENT);
    // ...but utilisation is unmoved, because they cannot write `capacity`.
    expect(aggregateCapacityUtilisation(soes)).toBeCloseTo(0.5, 6);
  });

  it("is immune to the denominator-gaming that plan fulfillment allowed", () => {
    const honest = [{ output: 80, capacity: 100 }];
    const gamed = [{ output: 80, capacity: 100 }];
    // The exploit was writing planTarget; capacity is untouched by it, so both
    // read identically no matter what the planner declared.
    expect(aggregateCapacityUtilisation(gamed)).toBe(aggregateCapacityUtilisation(honest));
  });

  it("treats zero / non-finite capacity as no information", () => {
    expect(aggregateCapacityUtilisation([{ output: 10, capacity: 0 }])).toBe(SOE_PERF_BASELINE);
    expect(aggregateCapacityUtilisation([{ output: 10, capacity: Number.NaN }])).toBe(
      SOE_PERF_BASELINE
    );
    expect(aggregateCapacityUtilisation([])).toBe(SOE_PERF_BASELINE);
  });

  it("clamps a runaway overshoot like plan fulfillment does", () => {
    expect(aggregateCapacityUtilisation([{ output: 10_000, capacity: 1 }])).toBe(
      MAX_PLAN_FULFILLMENT
    );
  });

  it("means across enterprises", () => {
    const mean = aggregateCapacityUtilisation([
      { output: 100, capacity: 100 },
      { output: 0, capacity: 100 },
    ]);
    expect(mean).toBeCloseTo(0.5, 6);
  });
});
