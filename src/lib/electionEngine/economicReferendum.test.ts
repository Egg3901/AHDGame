import { describe, it, expect } from "vitest";
import {
  computeEconomicReferendum,
  referendumFatigueMultiplier,
  getReferendumBreakdown,
  applyReferendumShift,
  NATURAL_UNEMPLOYMENT_PCT,
  POVERTY_BASELINE_PCT,
  INFLATION_BAND_PCT,
  UNEMPLOYMENT_SLOPE,
  UNEMPLOYMENT_CAP,
  POVERTY_SLOPE,
  POVERTY_CAP,
  INFLATION_SLOPE,
  INFLATION_CAP,
  INCOME_TREND_SLOPE,
  INCOME_TREND_CAP,
  TOTAL_BONUS_CAP,
  REFERENDUM_SHARE_CLAMP,
  applyResponseCredit,
  CREDIT_FORGIVENESS_MAX,
  CREDIT_WEIGHT_DECAY,
  type ResponseCreditCandidate,
} from "./economicReferendum";

const NEUTRAL = {
  unemploymentRate: NATURAL_UNEMPLOYMENT_PCT,
  povertyRate: POVERTY_BASELINE_PCT,
  inflationRate: 2,
  realIncomeTrendPct: 0,
};

describe("economic referendum constants", () => {
  it("pins the anchors and slopes", () => {
    expect(NATURAL_UNEMPLOYMENT_PCT).toBe(6);
    expect(POVERTY_BASELINE_PCT).toBe(20);
    expect(INFLATION_BAND_PCT).toEqual([1, 4]);
    expect([UNEMPLOYMENT_SLOPE, UNEMPLOYMENT_CAP]).toEqual([0.6, 4]);
    expect([POVERTY_SLOPE, POVERTY_CAP]).toEqual([0.15, 3]);
    expect([INFLATION_SLOPE, INFLATION_CAP]).toEqual([0.4, 3]);
    expect([INCOME_TREND_SLOPE, INCOME_TREND_CAP]).toEqual([0.3, 1.5]);
    expect(TOTAL_BONUS_CAP).toBe(4);
    expect(REFERENDUM_SHARE_CLAMP).toBe(8);
  });
});

describe("computeEconomicReferendum", () => {
  it("is neutral at the anchors", () => {
    const r = computeEconomicReferendum(NEUTRAL, 1);
    expect(r.sharePts).toBe(0);
    expect(r.miseryIndex).toBe(0);
    expect(r.components.every((c) => c.contributionPts === 0)).toBe(true);
  });

  it("prices the live depression scenario at roughly -5 raw", () => {
    const r = computeEconomicReferendum(
      { unemploymentRate: 11.5, povertyRate: 32.5, inflationRate: 4, realIncomeTrendPct: 0 },
      1
    );
    // 5.5pp of excess unemployment x0.6 = -3.3, 12.5pp of excess poverty
    // x0.15 = -1.875, inflation at the top of the band = 0.
    expect(r.sharePts).toBeCloseTo(-5.175, 6);
    expect(r.fatigueMultiplier).toBe(1);
    expect(r.miseryIndex).toBeCloseTo(18, 6);
  });

  it("scales the same depression by term fatigue", () => {
    const inputs = {
      unemploymentRate: 11.5,
      povertyRate: 32.5,
      inflationRate: 4,
      realIncomeTrendPct: 0,
    };
    expect(computeEconomicReferendum(inputs, 2).sharePts).toBeCloseTo(-5.175 * 1.25, 6);
    expect(computeEconomicReferendum(inputs, 3).sharePts).toBeCloseTo(-5.175 * 1.5, 6);
    expect(computeEconomicReferendum(inputs, 9).sharePts).toBeCloseTo(-5.175 * 1.5, 6);
  });

  it("never scales the bonus side by fatigue", () => {
    const good = {
      unemploymentRate: 3,
      povertyRate: 14,
      inflationRate: 2,
      realIncomeTrendPct: 3,
    };
    const second = computeEconomicReferendum(good, 1);
    const fourth = computeEconomicReferendum(good, 3);
    expect(second.sharePts).toBeGreaterThan(0);
    expect(fourth.sharePts).toBe(second.sharePts);
  });

  it("caps each component and the total bonus", () => {
    const boom = computeEconomicReferendum(
      { unemploymentRate: 0, povertyRate: 0, inflationRate: 2, realIncomeTrendPct: 40 },
      1
    );
    const byKey = Object.fromEntries(boom.components.map((c) => [c.key, c.contributionPts]));
    expect(byKey.unemployment).toBeCloseTo(0.6 * 6, 6); // below the anchor, uncapped here
    expect(byKey.poverty).toBeCloseTo(POVERTY_CAP, 6);
    expect(byKey.incomeTrend).toBeCloseTo(INCOME_TREND_CAP, 6);
    expect(boom.sharePts).toBe(TOTAL_BONUS_CAP);
  });

  it("clamps the total penalty to the share clamp", () => {
    const r = computeEconomicReferendum(
      { unemploymentRate: 40, povertyRate: 70, inflationRate: 60, realIncomeTrendPct: -20 },
      4
    );
    expect(r.sharePts).toBe(-REFERENDUM_SHARE_CLAMP);
  });

  it("penalizes deflation as well as high inflation", () => {
    const deflation = computeEconomicReferendum({ ...NEUTRAL, inflationRate: -1 }, 1);
    expect(deflation.sharePts).toBeCloseTo(-0.4 * 2, 6);
    const hot = computeEconomicReferendum({ ...NEUTRAL, inflationRate: 6 }, 1);
    expect(hot.sharePts).toBeCloseTo(-0.4 * 2, 6);
  });

  it("treats a missing income trend as neutral", () => {
    const without = computeEconomicReferendum(
      {
        unemploymentRate: 8,
        povertyRate: 22,
        inflationRate: 2,
      },
      1
    );
    const withZero = computeEconomicReferendum(
      { ...NEUTRAL, unemploymentRate: 8, povertyRate: 22 },
      1
    );
    expect(without.sharePts).toBeCloseTo(withZero.sharePts, 6);
  });
});

describe("referendumFatigueMultiplier", () => {
  it("follows the term schedule", () => {
    expect(referendumFatigueMultiplier(undefined)).toBe(1);
    expect(referendumFatigueMultiplier(0)).toBe(1);
    expect(referendumFatigueMultiplier(1)).toBe(1);
    expect(referendumFatigueMultiplier(2)).toBe(1.25);
    expect(referendumFatigueMultiplier(3)).toBe(1.5);
    expect(referendumFatigueMultiplier(7)).toBe(1.5);
  });
});

describe("getReferendumBreakdown", () => {
  it("returns the components plus a total row", () => {
    const r = computeEconomicReferendum({ ...NEUTRAL, unemploymentRate: 9 }, 1);
    const rows = getReferendumBreakdown(r);
    expect(rows).toHaveLength(r.components.length + 1);
    expect(rows.at(-1)).toEqual({
      key: "total",
      label: "Economic referendum",
      contributionPts: r.sharePts,
    });
  });
});

describe("applyReferendumShift", () => {
  const votes = { inc: 4500, opp: 4000, fringe: 1000, micro: 500 };

  it("conserves the total and moves the incumbent by exactly sharePts", () => {
    const out = applyReferendumShift(votes, ["inc"], -5);
    const total = Object.values(out).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(10000, 6);
    expect((out.inc / total) * 100).toBeCloseTo(45 - 5, 6);
  });

  it("splits the mirror in proportion to pre-shift shares, not equally", () => {
    const out = applyReferendumShift(votes, ["inc"], -5.5);
    const gainedOpp = out.opp - votes.opp;
    const gainedMicro = out.micro - votes.micro;
    // opp is 8x micro pre-shift, so it must absorb 8x the transfer.
    expect(gainedOpp / gainedMicro).toBeCloseTo(8, 6);
    // and no candidate's relative ordering among the opposition changes.
    expect(out.opp).toBeGreaterThan(out.fringe);
  });

  it("splits a multi-candidate incumbent party by its own shares", () => {
    const two = { a: 3000, b: 1000, opp: 6000 };
    const out = applyReferendumShift(two, ["a", "b"], 4);
    expect(out.a - two.a).toBeCloseTo(3 * (out.b - two.b), 6);
    expect(Object.values(out).reduce((s, v) => s + v, 0)).toBeCloseTo(10000, 6);
  });

  it("is a no-op on zero shift, zero totals, or a missing incumbent", () => {
    expect(applyReferendumShift(votes, ["inc"], 0)).toBe(votes);
    expect(applyReferendumShift({ a: 0, b: 0 }, ["a"], -3)).toEqual({ a: 0, b: 0 });
    expect(applyReferendumShift(votes, ["nobody"], -3)).toBe(votes);
  });

  it("never drives a side negative", () => {
    const out = applyReferendumShift({ inc: 100, opp: 50 }, ["inc"], -80);
    expect(out.inc).toBeGreaterThanOrEqual(0);
    expect(out.opp).toBeGreaterThanOrEqual(0);
    expect(out.inc + out.opp).toBeCloseTo(150, 6);
  });
});

describe("credit for response", () => {
  const BAD = {
    unemploymentRate: NATURAL_UNEMPLOYMENT_PCT + 4, // -2.4 pts
    povertyRate: POVERTY_BASELINE_PCT + 10, // -1.5 pts
    inflationRate: 10, // -2.4 pts
    realIncomeTrendPct: 0,
  };
  const jobsBill: ResponseCreditCandidate = {
    key: "bill-a",
    title: "Emergency Jobs Act",
    component: "unemployment",
    enactedTurn: 100,
  };

  it("forgives CREDIT_FORGIVENESS_MAX of a component with one qualifying bill", () => {
    const components = computeEconomicReferendum(BAD, 1).components;
    const out = applyResponseCredit(components, [jobsBill]);
    expect(out.forgivenessPts).toBeCloseTo(2.4 * CREDIT_FORGIVENESS_MAX, 6);
    expect(out.creditedBills).toEqual([
      { key: "bill-a", title: "Emergency Jobs Act", component: "unemployment", weight: 1 },
    ]);
  });

  it("decays later bills on the same component and caps the component credit at 1", () => {
    const components = computeEconomicReferendum(BAD, 1).components;
    const out = applyResponseCredit(components, [
      jobsBill,
      { ...jobsBill, key: "bill-b", enactedTurn: 104 },
      { ...jobsBill, key: "bill-c", enactedTurn: 108 },
    ]);
    expect(out.creditedBills.map((b) => b.weight)).toEqual([
      1,
      CREDIT_WEIGHT_DECAY,
      CREDIT_WEIGHT_DECAY ** 2,
    ]);
    // Weights sum to 1.75 but the component credit is capped at 1, so the
    // relief is the same as one bill would have earned.
    expect(out.forgivenessPts).toBeCloseTo(2.4 * CREDIT_FORGIVENESS_MAX, 6);
  });

  it("orders by enactment turn, so the earliest response earns full weight", () => {
    const components = computeEconomicReferendum(BAD, 1).components;
    const out = applyResponseCredit(components, [
      { ...jobsBill, key: "late", enactedTurn: 120 },
      { ...jobsBill, key: "early", enactedTurn: 100 },
    ]);
    expect(out.creditedBills.map((b) => b.key)).toEqual(["early", "late"]);
  });

  it("never forgives more than CREDIT_FORGIVENESS_MAX of the whole penalty", () => {
    const components = computeEconomicReferendum(BAD, 1).components;
    const out = applyResponseCredit(components, [
      jobsBill,
      { ...jobsBill, key: "p", component: "poverty" },
      { ...jobsBill, key: "i", component: "incomeTrend" },
    ]);
    expect(out.forgivenessFrac).toBeLessThanOrEqual(CREDIT_FORGIVENESS_MAX + 1e-9);
    expect(out.forgivenessFrac).toBeCloseTo(
      ((2.4 + 1.5) / (2.4 + 1.5 + 2.4)) * CREDIT_FORGIVENESS_MAX,
      6
    );
  });

  it("ignores bills aimed at a component that is not in penalty", () => {
    const components = computeEconomicReferendum(BAD, 1).components;
    const out = applyResponseCredit(components, [
      { ...jobsBill, key: "inc", component: "incomeTrend" },
    ]);
    expect(out.forgivenessPts).toBe(0);
    expect(out.creditedBills).toEqual([]);
  });

  it("does nothing when the economy is good (no penalty to forgive)", () => {
    const out = applyResponseCredit(computeEconomicReferendum(NEUTRAL, 1).components, [jobsBill]);
    expect(out).toEqual({ forgivenessFrac: 0, forgivenessPts: 0, creditedBills: [] });
  });
});

describe("computeEconomicReferendum with response credit", () => {
  const BAD = {
    unemploymentRate: NATURAL_UNEMPLOYMENT_PCT + 4,
    povertyRate: POVERTY_BASELINE_PCT,
    inflationRate: 2,
    realIncomeTrendPct: 0,
  };
  const jobsBill: ResponseCreditCandidate = {
    key: "bill-a",
    title: "Emergency Jobs Act",
    component: "unemployment",
    enactedTurn: 100,
  };

  it("applies forgiveness before the fatigue multiplier", () => {
    const plain = computeEconomicReferendum(BAD, 3);
    const credited = computeEconomicReferendum(BAD, 3, undefined, [jobsBill]);
    // -2.4 raw; forgiven to -1.44; then x1.5 fatigue = -2.16.
    expect(plain.sharePts).toBeCloseTo(-2.4 * 1.5, 6);
    expect(credited.sharePts).toBeCloseTo(-2.4 * (1 - CREDIT_FORGIVENESS_MAX) * 1.5, 6);
    expect(credited.fatigueMultiplier).toBe(1.5);
  });

  it("reports forgivenessFrac and creditedBills only when credit was earned", () => {
    const credited = computeEconomicReferendum(BAD, 1, undefined, [jobsBill]);
    expect(credited.forgivenessFrac).toBeCloseTo(CREDIT_FORGIVENESS_MAX, 6);
    expect(credited.creditedBills?.[0]?.title).toBe("Emergency Jobs Act");

    const plain = computeEconomicReferendum(BAD, 1);
    expect(plain.forgivenessFrac).toBeUndefined();
    expect(plain.creditedBills).toBeUndefined();
  });

  it("leaves the bonus side untouched", () => {
    const good = {
      unemploymentRate: NATURAL_UNEMPLOYMENT_PCT,
      povertyRate: POVERTY_BASELINE_PCT,
      inflationRate: 2,
      realIncomeTrendPct: 3,
    };
    expect(computeEconomicReferendum(good, 1, undefined, [jobsBill]).sharePts).toBeCloseTo(
      computeEconomicReferendum(good, 1).sharePts,
      6
    );
  });
});
