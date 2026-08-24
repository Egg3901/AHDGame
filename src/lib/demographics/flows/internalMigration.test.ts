import { describe, expect, it } from "vitest";
import {
  regionAttractiveness,
  computeInternalNetTargets,
  applyInternalMigration,
  type RegionPullMetrics,
} from "./internalMigration";
import { migrantAgeSexProfile } from "./internationalMigration";
import { synthesizeAgeSexVector } from "../seedSynthesis";
import { totalPopulation, type AgeSexVector } from "../cohortVector";

const neutral: RegionPullMetrics = {
  gdpGrowth: 2.5,
  unemployment: 5,
  medianIncome: 50000,
  costOfLiving: 100,
};

describe("regionAttractiveness", () => {
  it("is higher for stronger growth / lower unemployment", () => {
    const boom = regionAttractiveness({ ...neutral, gdpGrowth: 6, unemployment: 3 }, 50000);
    const bust = regionAttractiveness({ ...neutral, gdpGrowth: -2, unemployment: 12 }, 50000);
    expect(boom).toBeGreaterThan(bust);
  });
  it("rewards income above the country average and penalizes high cost of living", () => {
    const rich = regionAttractiveness({ ...neutral, medianIncome: 70000 }, 50000);
    const poor = regionAttractiveness({ ...neutral, medianIncome: 30000 }, 50000);
    expect(rich).toBeGreaterThan(poor);
    const cheap = regionAttractiveness({ ...neutral, costOfLiving: 30 }, 50000);
    const pricey = regionAttractiveness({ ...neutral, costOfLiving: 80 }, 50000);
    expect(cheap).toBeGreaterThan(pricey);
  });
  it("treats the canonical 100 cost-of-living index as neutral", () => {
    const baseline = regionAttractiveness(neutral, 50000);
    const cheaper = regionAttractiveness({ ...neutral, costOfLiving: 90 }, 50000);
    const pricier = regionAttractiveness({ ...neutral, costOfLiving: 110 }, 50000);
    expect(cheaper - baseline).toBeCloseTo(0.5);
    expect(pricier - baseline).toBeCloseTo(-0.5);
  });
  it("is clamped to a bounded band (no runaway pull)", () => {
    const extreme = regionAttractiveness(
      { gdpGrowth: 100, unemployment: 0, medianIncome: 1e9, costOfLiving: 0 },
      50000
    );
    expect(Math.abs(extreme)).toBeLessThanOrEqual(10 + 1e-9);
  });
});

describe("computeInternalNetTargets", () => {
  const TPY = 48;
  it("sums to ~zero across the country (headcount-conserving, N1)", () => {
    const targets = computeInternalNetTargets(
      new Map([
        ["A", 6],
        ["B", 0],
        ["C", -6],
      ]),
      new Map([
        ["A", 1_000_000],
        ["B", 1_000_000],
        ["C", 1_000_000],
      ]),
      TPY
    );
    const sum = [...targets.values()].reduce((s, v) => s + v, 0);
    expect(Math.abs(sum)).toBeLessThan(1e-6);
  });
  it("sends net INFLOW to above-average regions, OUTFLOW from below-average", () => {
    const targets = computeInternalNetTargets(
      new Map([
        ["A", 6],
        ["C", -6],
      ]),
      new Map([
        ["A", 1_000_000],
        ["C", 1_000_000],
      ]),
      TPY
    );
    expect(targets.get("A")!).toBeGreaterThan(0); // attractive → inflow
    expect(targets.get("C")!).toBeLessThan(0); // unattractive → outflow
  });
  it("a single region (no peers) gets zero net", () => {
    const targets = computeInternalNetTargets(
      new Map([["A", 5]]),
      new Map([["A", 1_000_000]]),
      TPY
    );
    expect(targets.get("A")).toBe(0);
  });
});

describe("applyInternalMigration", () => {
  const profile = migrantAgeSexProfile(0.5);
  function region(pop: number): AgeSexVector {
    return synthesizeAgeSexVector({
      adultShares: { young: 25, mid: 27, mature: 30, senior: 18 },
      medianAge: 38,
      birthRate: 50,
      population: pop,
    });
  }
  function nationalTotal(vs: Map<string, AgeSexVector>) {
    let t = 0;
    for (const v of vs.values()) t += totalPopulation(v);
    return t;
  }

  it("conserves total population (zero-sum, N1) and keeps every cell ≥ 0 (F-B)", () => {
    const vectors = new Map([
      ["A", region(1_000_000)],
      ["B", region(1_000_000)],
    ]);
    const before = nationalTotal(vectors);
    const { vectors: after } = applyInternalMigration(
      vectors,
      new Map([
        ["A", 5000],
        ["B", -5000],
      ]),
      profile,
      0.05
    );
    expect(nationalTotal(after)).toBeCloseTo(before, 0);
    for (const v of after.values())
      for (const cell of [...v.male, ...v.female]) expect(cell).toBeGreaterThanOrEqual(0);
  });

  it("moves people from the outflow region to the inflow region", () => {
    const vectors = new Map([
      ["A", region(1_000_000)],
      ["B", region(1_000_000)],
    ]);
    const { vectors: after } = applyInternalMigration(
      vectors,
      new Map([
        ["A", 5000],
        ["B", -5000],
      ]),
      profile,
      0.05
    );
    expect(totalPopulation(after.get("A")!)).toBeGreaterThan(1_000_000);
    expect(totalPopulation(after.get("B")!)).toBeLessThan(1_000_000);
  });

  it("sparsity-damps out-migration from a region far below the country average (anti-depopulation)", () => {
    // B is small (100k) vs A (1M) → mean 550k, floor threshold 0.3×550k = 165k.
    // B's out-migration (within the circuit-breaker cap) is tapered below target.
    const vectors = new Map([
      ["A", region(1_000_000)],
      ["B", region(100_000)],
    ]);
    const { vectors: after } = applyInternalMigration(
      vectors,
      new Map([
        ["A", 3000],
        ["B", -3000],
      ]),
      profile,
      0.05
    );
    const bLoss = 100_000 - totalPopulation(after.get("B")!);
    expect(bLoss).toBeGreaterThan(0); // still sheds some
    expect(bLoss).toBeLessThan(3000); // but DAMPED below the target (sticky small region)
    // national conserved despite the damping (inflow matches the damped outflow)
    expect(totalPopulation(after.get("A")!) + totalPopulation(after.get("B")!)).toBeCloseTo(
      1_100_000,
      0
    );
  });

  it("does NOT damp out-migration from a region at/above the country average", () => {
    // Both at the mean → no sparsity damping; B sheds its full (capped) target.
    const vectors = new Map([
      ["A", region(1_000_000)],
      ["B", region(1_000_000)],
    ]);
    const { vectors: after } = applyInternalMigration(
      vectors,
      new Map([
        ["A", 3000],
        ["B", -3000],
      ]),
      profile,
      0.05
    );
    const bLoss = 1_000_000 - totalPopulation(after.get("B")!);
    expect(bLoss).toBeCloseTo(3000, -2); // full target shed (no damping at the mean)
  });

  it("when inflow capacity is too small to absorb the shed pool, the fallback returns the remainder (Σ still 0)", () => {
    // A is tiny (cap = 5% × 10k = 500) but wants a huge inflow; B is large and
    // sheds ~50k. A can only take 500 → the rest must return to B so Σ == 0.
    const vectors = new Map([
      ["A", region(10_000)],
      ["B", region(1_000_000)],
    ]);
    const before = nationalTotal(vectors);
    const { vectors: after, circuitBreakerTrips } = applyInternalMigration(
      vectors,
      new Map([
        ["A", 50_000],
        ["B", -50_000],
      ]),
      profile,
      0.05
    );
    expect(circuitBreakerTrips).toBeGreaterThan(0); // A's inflow was capped
    expect(nationalTotal(after)).toBeCloseTo(before, 0); // conserved despite the fallback
    for (const v of after.values())
      for (const cell of [...v.male, ...v.female]) expect(cell).toBeGreaterThanOrEqual(0);
    // A grew by at most its cap (~500), so it stays near its original size.
    expect(totalPopulation(after.get("A")!)).toBeLessThan(11_000);
  });

  it("the circuit-breaker caps an extreme net and reports a trip, still N1/F-B safe", () => {
    const vectors = new Map([
      ["A", region(1_000_000)],
      ["B", region(1_000_000)],
    ]);
    const { vectors: after, circuitBreakerTrips } = applyInternalMigration(
      vectors,
      new Map([
        ["A", 500_000],
        ["B", -500_000],
      ]),
      profile,
      0.05
    );
    expect(circuitBreakerTrips).toBeGreaterThan(0);
    expect(nationalTotal(after)).toBeCloseTo(2_000_000, 0);
    for (const v of after.values())
      for (const cell of [...v.male, ...v.female]) expect(cell).toBeGreaterThanOrEqual(0);
  });
});
