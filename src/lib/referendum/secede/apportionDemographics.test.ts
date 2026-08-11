import { describe, it, expect } from "vitest";
import {
  apportionDemographicShares,
  type DemographicGroups,
  type DemographicPattern,
} from "./apportionDemographics";

const g = (population: number, economicLean = 0, socialLean = 0, turnout = 60): DemoGroupShape => ({
  population,
  economicLean,
  socialLean,
  turnout,
});
type DemoGroupShape = DemographicGroups[string];

describe("apportionDemographicShares", () => {
  // Live aggregate: 3 groups, sums to 100.
  const agg: DemographicGroups = {
    left: g(50, -3, -1, 65),
    centre: g(30, 0, 0, 60),
    right: g(20, 3, 2, 70),
  };
  // Region A skews left, region B skews right (patterns sum to 100 each).
  const pattern: DemographicPattern = {
    A: { left: 60, centre: 30, right: 10 },
    B: { left: 30, centre: 30, right: 40 },
  };

  it("makes each sub-region's shares sum to the aggregate total", () => {
    const out = apportionDemographicShares(agg, pattern, { A: 0.5, B: 0.5 });
    for (const r of ["A", "B"]) {
      const sum = Object.values(out[r]).reduce((s, x) => s + x.population, 0);
      expect(sum).toBe(100);
    }
  });

  it("preserves the live aggregate as the population-weighted average (equal weights)", () => {
    const out = apportionDemographicShares(agg, pattern, { A: 0.5, B: 0.5 });
    for (const grp of ["left", "centre", "right"]) {
      const wAvg = 0.5 * out.A[grp].population + 0.5 * out.B[grp].population;
      expect(wAvg).toBeCloseTo(agg[grp].population, 0);
    }
  });

  it("preserves the live aggregate under uneven population weights", () => {
    const weights = { A: 0.7, B: 0.3 };
    const out = apportionDemographicShares(agg, pattern, weights);
    for (const grp of ["left", "centre", "right"]) {
      const wAvg = 0.7 * out.A[grp].population + 0.3 * out.B[grp].population;
      expect(wAvg).toBeCloseTo(agg[grp].population, 0);
    }
  });

  it("differentiates regions per the pattern tilt (A leans left of B)", () => {
    const out = apportionDemographicShares(agg, pattern, { A: 0.5, B: 0.5 });
    expect(out.A.left.population).toBeGreaterThan(out.B.left.population);
    expect(out.B.right.population).toBeGreaterThan(out.A.right.population);
  });

  it("inherits per-group lean/turnout from the live aggregate", () => {
    const out = apportionDemographicShares(agg, pattern, { A: 0.5, B: 0.5 });
    expect(out.A.left.economicLean).toBe(-3);
    expect(out.A.left.turnout).toBe(65);
    expect(out.B.right.socialLean).toBe(2);
  });

  it("preserves optional per-group fields (e.g. nameRecognition) from the aggregate", () => {
    const withExtra: DemographicGroups = {
      left: { ...agg.left, nameRecognition: 42 },
      centre: agg.centre,
      right: agg.right,
    };
    const out = apportionDemographicShares(withExtra, pattern, { A: 0.5, B: 0.5 });
    expect(out.A.left.nameRecognition).toBe(42);
    expect(out.B.left.nameRecognition).toBe(42);
  });

  it("clamps negative shares (large tilt on a small aggregate share)", () => {
    const out = apportionDemographicShares(
      { x: g(5), y: g(95) },
      { A: { x: 40, y: 60 }, B: { x: 0, y: 100 } },
      { A: 0.5, B: 0.5 }
    );
    for (const r of ["A", "B"]) {
      for (const grp of ["x", "y"]) expect(out[r][grp].population).toBeGreaterThanOrEqual(0);
      expect(Object.values(out[r]).reduce((s, v) => s + v.population, 0)).toBe(100);
    }
  });
});
