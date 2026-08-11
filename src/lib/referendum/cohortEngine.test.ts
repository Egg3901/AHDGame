import { describe, it, expect } from "vitest";
import {
  buildReferendumCohorts,
  aggregateYesShare,
  leanFromUnits,
  saturate,
  effLean,
  effTurnout,
} from "./cohortEngine";

const groups = {
  a: { population: 100, economicLean: 0, socialLean: 0, turnout: 60 },
  b: { population: 100, economicLean: 0, socialLean: 0, turnout: 60 },
};

describe("buildReferendumCohorts", () => {
  it("re-centers so the turnout-weighted aggregate equals the region desire", () => {
    const cohorts = buildReferendumCohorts(groups, 55, { a: 40, b: -40 });
    expect(aggregateYesShare(cohorts, [], 0)).toBeCloseTo(55, 5);
  });

  it("preserves the relative spread (a leans more Yes than b)", () => {
    const cohorts = buildReferendumCohorts(groups, 55, { a: 40, b: -40 });
    const ca = cohorts.find((c) => c.groupId === "a")!;
    const cb = cohorts.find((c) => c.groupId === "b")!;
    expect(ca.yesLean).toBeGreaterThan(cb.yesLean);
  });

  it("defaults missing affinities to neutral", () => {
    const cohorts = buildReferendumCohorts(groups, 50, {});
    expect(aggregateYesShare(cohorts, [], 0)).toBeCloseTo(50, 5);
  });
});

describe("aggregateYesShare", () => {
  it("a mobilize modifier amplifies the targeted cohort's lean weight", () => {
    const cohorts = buildReferendumCohorts(groups, 50, { a: 30, b: -30 });
    const base = aggregateYesShare(cohorts, [], 0);
    const mobA = aggregateYesShare(cohorts, [{ groupId: "a", turnoutMod: 20, leanMod: 0 }], 0);
    expect(mobA).toBeGreaterThan(base); // a leans Yes; mobilizing it raises Yes
  });

  it("a uniform lean shift moves every cohort", () => {
    const cohorts = buildReferendumCohorts(groups, 50, {});
    expect(aggregateYesShare(cohorts, [], 5)).toBeCloseTo(55, 5);
  });

  it("clamps the result to [0,100]", () => {
    const cohorts = buildReferendumCohorts(groups, 50, {});
    expect(aggregateYesShare(cohorts, [], 999)).toBe(100);
    expect(aggregateYesShare(cohorts, [], -999)).toBe(0);
  });
});

describe("leanFromUnits", () => {
  it("yes units raise, no units lower, symmetric", () => {
    expect(leanFromUnits(10, 0)).toBeGreaterThan(0);
    expect(leanFromUnits(0, 10)).toBeLessThan(0);
    expect(leanFromUnits(10, 10)).toBeCloseTo(0, 5);
  });
});

describe("saturate (read-time soft cap)", () => {
  it("is 0 at 0 and ≈ identity for small raw", () => {
    expect(saturate(0, 25)).toBe(0);
    expect(saturate(1.5, 25)).toBeCloseTo(1.5, 1); // 25*tanh(0.06)=1.498
  });
  it("asymptotes to the cap and never exceeds it", () => {
    expect(saturate(1000, 25)).toBeGreaterThan(24.9);
    expect(saturate(1000, 25)).toBeLessThanOrEqual(25);
    expect(saturate(-1000, 25)).toBeLessThan(-24.9);
  });
  it("effLean/effTurnout bind the caps", () => {
    expect(effLean(1000)).toBeCloseTo(25, 0);
    expect(effTurnout(1000)).toBeCloseTo(20, 0);
  });
});

describe("aggregateYesShare saturates raw modifiers", () => {
  const cohorts = [
    { groupId: "a", share: 0.5, turnout: 60, yesLean: 40 },
    { groupId: "b", share: 0.5, turnout: 60, yesLean: 60 },
  ];
  it("a small raw leanMod moves the aggregate by ~the raw amount", () => {
    const open = aggregateYesShare(cohorts, [], 0); // 50
    const v = aggregateYesShare(
      cohorts,
      [
        { groupId: "a", turnoutMod: 0, leanMod: 1.5 },
        { groupId: "b", turnoutMod: 0, leanMod: 1.5 },
      ],
      0
    );
    expect(v - open).toBeCloseTo(1.5, 1);
  });
  it("a huge raw leanMod is capped (not linear)", () => {
    const v = aggregateYesShare(cohorts, [{ groupId: "b", turnoutMod: 0, leanMod: 1000 }], 0);
    // b's lean rises by ≤25 (to ≤85), so the aggregate rises by ≤ ~12.5
    expect(v).toBeLessThan(63);
  });
});
