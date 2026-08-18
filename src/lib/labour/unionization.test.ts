import { describe, expect, it } from "vitest";
import {
  unionizationDriftTarget,
  trendUnionization,
  unionPremium,
  realWageIndex,
  UNION_PREMIUM_MAX_PCT,
  UNIONIZATION_BASELINE,
  UNIONIZATION_TREND_STEP_PER_TURN,
  UNIONIZATION_NEUTRAL_UNEMPLOYMENT,
  UNIONIZATION_NEUTRAL_KAITZ,
  UNIONIZATION_REAL_WAGE_WEIGHT,
  UNIONIZATION_UNEMPLOYMENT_WEIGHT,
  UNIONIZATION_MINWAGE_WEIGHT,
  decayUnionizationUnderBan,
  UNIONIZATION_BAN_DECAY_STEP_PER_TURN,
} from "./unionization";
import { STRIKE_UNIONIZATION_THRESHOLD } from "./strikes";

const NEUTRAL = {
  wageLevel: 1,
  costOfLivingIndex: 100,
  unemploymentRate: UNIONIZATION_NEUTRAL_UNEMPLOYMENT,
  minWageKaitzRatio: UNIONIZATION_NEUTRAL_KAITZ,
  unionLawBias: 0,
  // Unrepresented: economic NPC target. Represented shops track approval
  // directly and are tested separately below.
  representingUnionApproval: undefined,
};

describe("unionizationDriftTarget", () => {
  it("is exactly UNIONIZATION_BASELINE at fully-neutral conditions", () => {
    expect(unionizationDriftTarget(NEUTRAL)).toBe(UNIONIZATION_BASELINE);
  });

  it("treats all-absent inputs the same as fully-neutral (safe defaults)", () => {
    const out = unionizationDriftTarget({
      wageLevel: undefined,
      costOfLivingIndex: undefined,
      unemploymentRate: undefined,
      minWageKaitzRatio: undefined,
      unionLawBias: undefined,
      representingUnionApproval: undefined,
    });
    expect(out).toBe(UNIONIZATION_BASELINE);
  });

  it("treats a Kaitz ratio of exactly 0 (no minimum-wage policy configured) as neutral, NOT 'min wage maximally lags'", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, minWageKaitzRatio: 0 });
    expect(out).toBe(UNIONIZATION_BASELINE);
  });

  it("treats a non-positive cost-of-living index as neutral (defensive against bad data)", () => {
    expect(unionizationDriftTarget({ ...NEUTRAL, costOfLivingIndex: 0 })).toBe(
      UNIONIZATION_BASELINE
    );
    expect(unionizationDriftTarget({ ...NEUTRAL, costOfLivingIndex: -5 })).toBe(
      UNIONIZATION_BASELINE
    );
  });

  it("a wage cut below cost-of-living raises the target (low real-wage index)", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, wageLevel: 0.8 });
    // realWageIndex 0.8 ; (1-0.8)*40 = 8
    expect(out).toBeCloseTo(UNIONIZATION_BASELINE + 8, 9);
  });

  it("a wage hike above cost-of-living lowers the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, wageLevel: 1.2 });
    expect(out).toBeLessThan(UNIONIZATION_BASELINE);
  });

  it("rising cost-of-living with flat wages raises the target (real-wage index falls)", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, costOfLivingIndex: 120 });
    expect(out).toBeGreaterThan(UNIONIZATION_BASELINE);
  });

  it("low unemployment (worker leverage) raises the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, unemploymentRate: 2 });
    // (5-2)*3 = 9
    expect(out).toBeCloseTo(UNIONIZATION_BASELINE + 9, 9);
  });

  it("high unemployment lowers the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, unemploymentRate: 10 });
    expect(out).toBeLessThan(UNIONIZATION_BASELINE);
  });

  it("a weak minimum wage (low Kaitz ratio) raises the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, minWageKaitzRatio: 0.2 });
    // (0.5-0.2)*20 = 6
    expect(out).toBeCloseTo(UNIONIZATION_BASELINE + 6, 9);
  });

  it("a strong minimum wage (high Kaitz ratio) lowers the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, minWageKaitzRatio: 0.9 });
    expect(out).toBeLessThan(UNIONIZATION_BASELINE);
  });

  it("clamps to [0,100] under extreme stress / extreme generosity", () => {
    const stressed = unionizationDriftTarget({
      wageLevel: 0.5,
      costOfLivingIndex: 300,
      unemploymentRate: 0,
      minWageKaitzRatio: 0,
      unionLawBias: 50,
      representingUnionApproval: 100,
    });
    expect(stressed).toBeLessThanOrEqual(100);
    expect(stressed).toBeGreaterThanOrEqual(0);

    const generous = unionizationDriftTarget({
      wageLevel: 1.5,
      costOfLivingIndex: 40,
      unemploymentRate: 15,
      minWageKaitzRatio: 1,
      unionLawBias: -50,
      representingUnionApproval: 0,
    });
    expect(generous).toBe(0);
  });

  it("v3 Phase 7b: a positive union-law bias (collective bargaining) raises the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, unionLawBias: 20 });
    // 20 * UNIONIZATION_LAW_WEIGHT(0.6) = 12
    expect(out).toBeCloseTo(UNIONIZATION_BASELINE + 12, 9);
  });

  it("v3 Phase 7b: a negative union-law bias (right-to-work) lowers the target", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, unionLawBias: -20 });
    expect(out).toBeCloseTo(UNIONIZATION_BASELINE - 12, 9);
  });

  it("v3 Phase 7b: absent union-law bias is neutral (no law)", () => {
    const out = unionizationDriftTarget({ ...NEUTRAL, unionLawBias: undefined });
    expect(out).toBe(UNIONIZATION_BASELINE);
  });

  it("represented shops track approval, not the economic blend, so a 30% drive does not crash to ~6%", () => {
    const out = unionizationDriftTarget({
      wageLevel: 1.5,
      costOfLivingIndex: 100,
      unemploymentRate: 10,
      minWageKaitzRatio: 0.9,
      unionLawBias: 0,
      representingUnionApproval: 55,
    });
    expect(out).toBe(55);
    const unrepresented = unionizationDriftTarget({
      wageLevel: 1.5,
      costOfLivingIndex: 100,
      unemploymentRate: 10,
      minWageKaitzRatio: 0.9,
      unionLawBias: 0,
      representingUnionApproval: undefined,
    });
    expect(unrepresented).toBeLessThan(20);
    expect(out).toBeGreaterThan(unrepresented);
  });

  it("represented shops at 80 approval settle at 80, wages do not drag them back to baseline", () => {
    expect(unionizationDriftTarget({ ...NEUTRAL, representingUnionApproval: 80 })).toBe(80);
  });

  it("a badly run union (20 approval) pulls its own shops down to 20", () => {
    expect(unionizationDriftTarget({ ...NEUTRAL, representingUnionApproval: 20 })).toBe(20);
  });

  it("unrepresented shops ignore approval and keep the economic NPC target", () => {
    expect(unionizationDriftTarget({ ...NEUTRAL, representingUnionApproval: undefined })).toBe(
      UNIONIZATION_BASELINE
    );
    expect(unionizationDriftTarget({ ...NEUTRAL, representingUnionApproval: 50 })).not.toBe(
      UNIONIZATION_BASELINE
    );
  });

  it("union dues v1: absent representingUnionApproval is the economic baseline (sector unrepresented)", () => {
    expect(unionizationDriftTarget({ ...NEUTRAL, representingUnionApproval: undefined })).toBe(
      UNIONIZATION_BASELINE
    );
  });

  it("the terms are independent and additive (sum of single-deviation effects)", () => {
    const wageOnly = unionizationDriftTarget({ ...NEUTRAL, wageLevel: 0.8 });
    const unempOnly = unionizationDriftTarget({ ...NEUTRAL, unemploymentRate: 2 });
    const both = unionizationDriftTarget({ ...NEUTRAL, wageLevel: 0.8, unemploymentRate: 2 });
    expect(both).toBeCloseTo(wageOnly + unempOnly - UNIONIZATION_BASELINE, 9);
  });

  describe("v3 Phase 7b composed-ceiling invariant (code-review fix #7)", () => {
    it("no single economic or law factor alone crosses STRIKE_UNIONIZATION_THRESHOLD on an unrepresented shop", () => {
      const wageOnly = unionizationDriftTarget({ ...NEUTRAL, wageLevel: 0.8 });
      const unempOnly = unionizationDriftTarget({ ...NEUTRAL, unemploymentRate: 2 });
      const minWageOnly = unionizationDriftTarget({ ...NEUTRAL, minWageKaitzRatio: 0 });
      const lawOnly = unionizationDriftTarget({ ...NEUTRAL, unionLawBias: 50 });
      for (const single of [wageOnly, unempOnly, minWageOnly, lawOnly]) {
        expect(single).toBeLessThan(STRIKE_UNIONIZATION_THRESHOLD);
      }
    });

    it("a well-run union's approval alone can cross the strike threshold on a shop it represents", () => {
      const approvalOnly = unionizationDriftTarget({
        ...NEUTRAL,
        representingUnionApproval: 100,
      });
      expect(approvalOnly).toBe(100);
      expect(approvalOnly).toBeGreaterThan(STRIKE_UNIONIZATION_THRESHOLD);
    });

    it("the real ceiling on a represented shop is the union's approval, clamped to 100", () => {
      const target = unionizationDriftTarget({
        wageLevel: 0.8,
        costOfLivingIndex: 100,
        unemploymentRate: 2,
        minWageKaitzRatio: 0,
        unionLawBias: 50,
        representingUnionApproval: 100,
      });
      expect(target).toBe(100);
    });
  });
});

describe("trendUnionization", () => {
  it("steps toward the target by at most UNIONIZATION_TREND_STEP_PER_TURN", () => {
    const out = trendUnionization(20, 50);
    expect(out).toBe(20 + UNIONIZATION_TREND_STEP_PER_TURN);
  });

  it("steps down toward a lower target", () => {
    const out = trendUnionization(20, 0);
    expect(out).toBe(20 - UNIONIZATION_TREND_STEP_PER_TURN);
  });

  it("never overshoots when the remaining distance is smaller than the step", () => {
    const out = trendUnionization(49.5, 50);
    expect(out).toBe(50);
  });

  it("is a no-op exactly at the target", () => {
    expect(trendUnionization(50, 50)).toBe(50);
  });

  it("clamps the target to [0,100] before stepping", () => {
    const out = trendUnionization(0, -10);
    expect(out).toBe(0);
  });

  it("clamps the stepped result to [0,100]", () => {
    const out = trendUnionization(99.9, 200);
    expect(out).toBeLessThanOrEqual(100);
  });
});

describe("realWageIndex", () => {
  it("is 1.0 at baseline (wageLevel 1, cost-of-living 100)", () => {
    expect(realWageIndex(1, 100)).toBe(1);
  });

  it("falls when wages lag cost-of-living", () => {
    expect(realWageIndex(0.8, 100)).toBeCloseTo(0.8, 9);
    expect(realWageIndex(1, 200)).toBeCloseTo(0.5, 9);
  });

  it("treats a non-finite/absent cost-of-living index as neutral (100)", () => {
    expect(realWageIndex(1, undefined)).toBe(1);
    expect(realWageIndex(1, NaN)).toBe(1);
  });

  it("treats a non-positive cost-of-living index as neutral (defensive against bad data)", () => {
    expect(realWageIndex(1, 0)).toBe(1);
    expect(realWageIndex(1, -5)).toBe(1);
  });
});

describe("unionPremium (Phase 6: standing labor-cost surcharge)", () => {
  it("is 0 at unionization 0 (baseline-invariant)", () => {
    expect(unionPremium(0)).toBe(0);
  });

  it("is linear in unionization", () => {
    expect(unionPremium(50)).toBeCloseTo(UNION_PREMIUM_MAX_PCT / 2, 9);
  });

  it("caps at UNION_PREMIUM_MAX_PCT at unionization 100", () => {
    expect(unionPremium(100)).toBe(UNION_PREMIUM_MAX_PCT);
  });

  it("clamps out-of-range / non-finite input", () => {
    expect(unionPremium(-10)).toBe(0);
    expect(unionPremium(150)).toBe(UNION_PREMIUM_MAX_PCT);
    expect(unionPremium(NaN)).toBe(0);
  });
});

describe("weight constants are wired as documented", () => {
  it("UNIONIZATION_REAL_WAGE_WEIGHT / UNEMPLOYMENT_WEIGHT / MINWAGE_WEIGHT are positive", () => {
    expect(UNIONIZATION_REAL_WAGE_WEIGHT).toBeGreaterThan(0);
    expect(UNIONIZATION_UNEMPLOYMENT_WEIGHT).toBeGreaterThan(0);
    expect(UNIONIZATION_MINWAGE_WEIGHT).toBeGreaterThan(0);
  });
});

describe("decayUnionizationUnderBan (union ban, player suggestion #93)", () => {
  it("decays by the accelerated ban step each turn (faster than normal drift)", () => {
    expect(UNIONIZATION_BAN_DECAY_STEP_PER_TURN).toBeGreaterThan(UNIONIZATION_TREND_STEP_PER_TURN);
    expect(decayUnionizationUnderBan(50)).toBe(50 - UNIONIZATION_BAN_DECAY_STEP_PER_TURN);
  });

  it("never overshoots below 0", () => {
    expect(decayUnionizationUnderBan(1)).toBe(0);
    expect(decayUnionizationUnderBan(0)).toBe(0);
  });

  it("clamps out-of-range and non-finite inputs before decaying", () => {
    expect(decayUnionizationUnderBan(150)).toBe(100 - UNIONIZATION_BAN_DECAY_STEP_PER_TURN);
    expect(decayUnionizationUnderBan(-5)).toBe(0);
    expect(decayUnionizationUnderBan(Number.NaN)).toBe(0);
  });

  it("rounds to one decimal like trendUnionization", () => {
    expect(decayUnionizationUnderBan(10.44)).toBe(7.4);
  });

  it("a fully-organized sector reaches 0 in ceil(100/step) turns", () => {
    let u = 100;
    let turns = 0;
    while (u > 0 && turns < 200) {
      u = decayUnionizationUnderBan(u);
      turns++;
    }
    expect(u).toBe(0);
    expect(turns).toBe(Math.ceil(100 / UNIONIZATION_BAN_DECAY_STEP_PER_TURN));
  });
});
