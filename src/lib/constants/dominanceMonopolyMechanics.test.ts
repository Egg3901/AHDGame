/**
 * Pure-function tests for the four monopoly-pressure mechanics layered on top
 * of the dominance system: margin penalty, regulatory burden, underdog
 * amplifier, and the sustained-negative-production tracker + penalty.
 *
 * No DB, no mocks — just shapes and equations against the constants module.
 */
import { describe, it, expect } from "vitest";
import {
  DOMINANCE_MARKET_SHARE_THRESHOLD,
  DOMINANCE_MARGIN_PENALTY_AT_FULL,
  DOMINANCE_REGULATORY_BURDEN_AT_FULL,
  DOMINANCE_ATTACK_EASE_MULT_AT_FULL,
  DOMINANCE_GROWTH_COST_MULT_AT_FULL,
  DOMINANCE_RAMP_EXPONENT,
  UNDERDOG_AMPLIFIER_MAX,
  UNDERDOG_DEFENDER_MIN_SHARE,
  UNDERDOG_ATTACKER_FULL_BONUS_SHARE,
  UNDERDOG_ATTACKER_NO_BONUS_SHARE,
  SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS,
  SUSTAINED_NEGATIVE_PRODUCTION_FULL_TURNS,
  SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY,
  getDominanceMarginPenalty,
  getDominanceRegulatoryBurden,
  getDominanceAttackEaseMultiplier,
  getDominanceGrowthCostMultiplier,
  getUnderdogAttackAmplifier,
  getSustainedNegativeProductionPenalty,
  nextNegativeProductionCounter,
} from "./corporations";

describe("getDominanceMarginPenalty", () => {
  it("returns 0 at or below the dominance threshold", () => {
    expect(getDominanceMarginPenalty(0)).toBe(0);
    expect(getDominanceMarginPenalty(25)).toBe(0);
    expect(getDominanceMarginPenalty(DOMINANCE_MARKET_SHARE_THRESHOLD)).toBe(0);
  });

  it("returns the full penalty at 100% market share", () => {
    expect(getDominanceMarginPenalty(100)).toBeCloseTo(DOMINANCE_MARGIN_PENALTY_AT_FULL, 5);
  });

  it("scales linearly between threshold and 100%", () => {
    const midpoint = (DOMINANCE_MARKET_SHARE_THRESHOLD + 100) / 2;
    expect(getDominanceMarginPenalty(midpoint)).toBeCloseTo(
      DOMINANCE_MARGIN_PENALTY_AT_FULL / 2,
      5
    );
  });

  it("clamps inputs above 100%", () => {
    expect(getDominanceMarginPenalty(150)).toBeCloseTo(DOMINANCE_MARGIN_PENALTY_AT_FULL, 5);
  });
});

describe("getDominanceRegulatoryBurden", () => {
  it("returns 0 at or below the threshold", () => {
    expect(getDominanceRegulatoryBurden(DOMINANCE_MARKET_SHARE_THRESHOLD)).toBe(0);
    expect(getDominanceRegulatoryBurden(0)).toBe(0);
  });

  it("returns the full burden fraction at 100%", () => {
    expect(getDominanceRegulatoryBurden(100)).toBeCloseTo(DOMINANCE_REGULATORY_BURDEN_AT_FULL, 5);
  });

  it("represents a fraction of revenue (0 < burden < 1 across the curve)", () => {
    const sample = getDominanceRegulatoryBurden(75);
    expect(sample).toBeGreaterThan(0);
    expect(sample).toBeLessThan(1);
  });
});

describe("getDominanceGrowthCostMultiplier (convex ramp, no cliff)", () => {
  it("is 1.0× at or below the threshold", () => {
    expect(getDominanceGrowthCostMultiplier(0)).toBe(1);
    expect(getDominanceGrowthCostMultiplier(DOMINANCE_MARKET_SHARE_THRESHOLD)).toBe(1);
  });

  it("is continuous just above the threshold — no cliff", () => {
    // Pre-fix this jumped to 1.75× the instant share exceeded 50%.
    expect(getDominanceGrowthCostMultiplier(50.01)).toBeCloseTo(1, 2);
  });

  it("reaches the full multiplier at 100% share", () => {
    expect(getDominanceGrowthCostMultiplier(100)).toBeCloseTo(
      DOMINANCE_GROWTH_COST_MULT_AT_FULL,
      5
    );
  });

  it("matches the convex formula in the maintainable band (66%)", () => {
    const t = (66 - DOMINANCE_MARKET_SHARE_THRESHOLD) / (100 - DOMINANCE_MARKET_SHARE_THRESHOLD);
    const expected =
      1 + (DOMINANCE_GROWTH_COST_MULT_AT_FULL - 1) * Math.pow(t, DOMINANCE_RAMP_EXPONENT);
    expect(getDominanceGrowthCostMultiplier(66)).toBeCloseTo(expected, 5);
    // Back-loaded: at 66% the sector pays well under half the full premium.
    expect(getDominanceGrowthCostMultiplier(66)).toBeLessThan(
      1 + (DOMINANCE_GROWTH_COST_MULT_AT_FULL - 1) / 2
    );
  });
});

describe("getDominanceAttackEaseMultiplier (convex ramp, no cliff)", () => {
  it("is 1.0× at the threshold and continuous just above it", () => {
    expect(getDominanceAttackEaseMultiplier(DOMINANCE_MARKET_SHARE_THRESHOLD)).toBe(1);
    expect(getDominanceAttackEaseMultiplier(50.01)).toBeCloseTo(1, 2);
  });

  it("reaches the full multiplier at 100% share", () => {
    expect(getDominanceAttackEaseMultiplier(100)).toBeCloseTo(
      DOMINANCE_ATTACK_EASE_MULT_AT_FULL,
      5
    );
  });

  it("is convex — vulnerability back-loaded toward higher share", () => {
    const mid = getDominanceAttackEaseMultiplier(75);
    const linearMid = 1 + (DOMINANCE_ATTACK_EASE_MULT_AT_FULL - 1) / 2;
    expect(mid).toBeGreaterThan(1);
    expect(mid).toBeLessThan(linearMid);
  });
});

describe("getUnderdogAttackAmplifier", () => {
  it("returns 1.0× when defender is not dominant", () => {
    expect(getUnderdogAttackAmplifier(5, UNDERDOG_DEFENDER_MIN_SHARE - 0.1)).toBe(1);
    expect(getUnderdogAttackAmplifier(5, 30)).toBe(1);
  });

  it("returns 1.0× when attacker is not actually small", () => {
    expect(getUnderdogAttackAmplifier(UNDERDOG_ATTACKER_NO_BONUS_SHARE, 80)).toBe(1);
    expect(getUnderdogAttackAmplifier(40, 80)).toBe(1);
  });

  it("returns the full amplifier when attacker is below the full-bonus threshold and defender is dominant", () => {
    expect(getUnderdogAttackAmplifier(UNDERDOG_ATTACKER_FULL_BONUS_SHARE, 80)).toBeCloseTo(
      UNDERDOG_AMPLIFIER_MAX,
      5
    );
    expect(getUnderdogAttackAmplifier(0, 80)).toBeCloseTo(UNDERDOG_AMPLIFIER_MAX, 5);
  });

  it("tapers linearly between full-bonus and no-bonus attacker thresholds", () => {
    const midpoint = (UNDERDOG_ATTACKER_FULL_BONUS_SHARE + UNDERDOG_ATTACKER_NO_BONUS_SHARE) / 2;
    const expected = 1 + (UNDERDOG_AMPLIFIER_MAX - 1) / 2;
    expect(getUnderdogAttackAmplifier(midpoint, 80)).toBeCloseTo(expected, 5);
  });

  it("does not engage at exactly the defender-min-share boundary", () => {
    expect(getUnderdogAttackAmplifier(5, UNDERDOG_DEFENDER_MIN_SHARE)).toBe(1);
  });
});

describe("getSustainedNegativeProductionPenalty", () => {
  it("returns 0 within the grace period", () => {
    expect(getSustainedNegativeProductionPenalty(0, -1)).toBe(0);
    expect(
      getSustainedNegativeProductionPenalty(SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS, -5)
    ).toBe(0);
  });

  it("returns 0 when policy level is non-negative (penalty clears immediately)", () => {
    expect(getSustainedNegativeProductionPenalty(100, 0)).toBe(0);
    expect(getSustainedNegativeProductionPenalty(144, 25)).toBe(0);
    expect(getSustainedNegativeProductionPenalty(10000, 5)).toBe(0);
  });

  it("returns the cap at or beyond the full-turns threshold when policy is negative", () => {
    expect(
      getSustainedNegativeProductionPenalty(SUSTAINED_NEGATIVE_PRODUCTION_FULL_TURNS, -1)
    ).toBeCloseTo(SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY, 5);
    expect(getSustainedNegativeProductionPenalty(10000, -25)).toBeCloseTo(
      SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY,
      5
    );
  });

  it("scales linearly between grace and full thresholds when policy is negative", () => {
    const midpoint =
      (SUSTAINED_NEGATIVE_PRODUCTION_GRACE_TURNS + SUSTAINED_NEGATIVE_PRODUCTION_FULL_TURNS) / 2;
    expect(getSustainedNegativeProductionPenalty(midpoint, -10)).toBeCloseTo(
      SUSTAINED_NEGATIVE_PRODUCTION_MAX_PENALTY / 2,
      5
    );
  });

  it("treats negative inputs as 0", () => {
    expect(getSustainedNegativeProductionPenalty(-5, -1)).toBe(0);
  });
});

describe("nextNegativeProductionCounter", () => {
  it("increments by 1 when policy level is negative", () => {
    expect(nextNegativeProductionCounter(0, -1)).toBe(1);
    expect(nextNegativeProductionCounter(50, -25)).toBe(51);
  });

  it("decrements by 1 (floored at 0) when policy level is non-negative", () => {
    expect(nextNegativeProductionCounter(52, 0)).toBe(51);
    expect(nextNegativeProductionCounter(52, 5)).toBe(51);
    expect(nextNegativeProductionCounter(1, 5)).toBe(0);
    expect(nextNegativeProductionCounter(0, 5)).toBe(0);
  });

  it("treats null/undefined prev as 0", () => {
    expect(nextNegativeProductionCounter(null, -1)).toBe(1);
    expect(nextNegativeProductionCounter(undefined, -1)).toBe(1);
    expect(nextNegativeProductionCounter(null, 0)).toBe(0);
  });

  it("recovery takes the same number of turns as accumulation (no free reset)", () => {
    // Simulate 52 turns negative, then 52 turns positive — the counter must
    // return to 0 only at the end of the recovery window.
    let counter = 0;
    for (let i = 0; i < 52; i++) {
      counter = nextNegativeProductionCounter(counter, -25);
    }
    expect(counter).toBe(52);
    for (let i = 0; i < 52; i++) {
      counter = nextNegativeProductionCounter(counter, 0);
    }
    expect(counter).toBe(0);
  });

  it("partial recovery preserves history (oscillation cannot game the cap)", () => {
    let counter = 0;
    // 100 turns negative → counter at 100, well past the grace window.
    for (let i = 0; i < 100; i++) counter = nextNegativeProductionCounter(counter, -25);
    expect(counter).toBe(100);
    // 30 turns positive → counter at 70 (still above grace, still penalised).
    for (let i = 0; i < 30; i++) counter = nextNegativeProductionCounter(counter, 1);
    expect(counter).toBe(70);
    expect(getSustainedNegativeProductionPenalty(70, -1)).toBeLessThan(0);
    // Resume negative — counter climbs from 70, not 0.
    counter = nextNegativeProductionCounter(counter, -10);
    expect(counter).toBe(71);
  });
});
