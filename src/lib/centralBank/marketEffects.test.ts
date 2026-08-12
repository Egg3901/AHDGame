import { describe, expect, it } from "vitest";
import {
  DEPOSIT_RETENTION_FLOOR,
  FX_ADHERENCE_FLOOR,
  SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP,
  domesticDepositRetention,
  interventionAdherenceMultiplier,
  sovereignCredibilitySpread,
} from "@/lib/centralBank/marketEffects";

const SCRUTINY_SWEEP = [0, 1, 10, 25, 33.3, 50, 66.6, 75, 99, 100];
const JUNK = [NaN, Infinity, -Infinity, -50, 150, 1e9];

describe("sovereignCredibilitySpread", () => {
  it("is exactly zero at full credibility so a clean bank changes nothing", () => {
    expect(sovereignCredibilitySpread(0)).toBe(0);
  });

  it("reaches the cap at maximum scrutiny and never exceeds it", () => {
    expect(sovereignCredibilitySpread(100)).toBeCloseTo(SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP, 10);
    for (const value of [...SCRUTINY_SWEEP, ...JUNK]) {
      const spread = sovereignCredibilitySpread(value);
      expect(spread).toBeGreaterThanOrEqual(0);
      expect(spread).toBeLessThanOrEqual(SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP);
    }
  });

  it("is linear in scrutiny", () => {
    expect(sovereignCredibilitySpread(50)).toBeCloseTo(SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP / 2, 10);
    expect(sovereignCredibilitySpread(25)).toBeCloseTo(SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP / 4, 10);
  });

  it("is monotonically non-decreasing in scrutiny", () => {
    for (let i = 1; i < SCRUTINY_SWEEP.length; i += 1) {
      expect(sovereignCredibilitySpread(SCRUTINY_SWEEP[i])).toBeGreaterThan(
        sovereignCredibilitySpread(SCRUTINY_SWEEP[i - 1])
      );
    }
  });

  it("clamps out-of-range and non-finite input instead of producing a wild spread", () => {
    expect(sovereignCredibilitySpread(-50)).toBe(0);
    expect(sovereignCredibilitySpread(NaN)).toBe(0);
    expect(sovereignCredibilitySpread(150)).toBeCloseTo(SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP, 10);
    // Non-finite scrutiny is treated as no scrutiny, matching
    // credibilityFromScrutiny: a corrupt value must not price a punitive spread.
    expect(sovereignCredibilitySpread(Infinity)).toBe(0);
    expect(sovereignCredibilitySpread(-Infinity)).toBe(0);
  });
});

describe("interventionAdherenceMultiplier", () => {
  it("is exactly 1 at full credibility", () => {
    expect(interventionAdherenceMultiplier(0)).toBe(1);
  });

  it("bottoms out at the floor, never below", () => {
    expect(interventionAdherenceMultiplier(100)).toBeCloseTo(FX_ADHERENCE_FLOOR, 10);
    for (const value of [...SCRUTINY_SWEEP, ...JUNK]) {
      const multiplier = interventionAdherenceMultiplier(value);
      expect(multiplier).toBeGreaterThanOrEqual(FX_ADHERENCE_FLOOR);
      expect(multiplier).toBeLessThanOrEqual(1);
    }
  });

  it("is monotonically decreasing in scrutiny", () => {
    for (let i = 1; i < SCRUTINY_SWEEP.length; i += 1) {
      expect(interventionAdherenceMultiplier(SCRUTINY_SWEEP[i])).toBeLessThan(
        interventionAdherenceMultiplier(SCRUTINY_SWEEP[i - 1])
      );
    }
  });

  it("leaves a maximally discredited bank with a working intervention", () => {
    expect(interventionAdherenceMultiplier(100)).toBeGreaterThan(0);
  });

  it("clamps out-of-range and non-finite input", () => {
    expect(interventionAdherenceMultiplier(-50)).toBe(1);
    expect(interventionAdherenceMultiplier(NaN)).toBe(1);
    expect(interventionAdherenceMultiplier(150)).toBeCloseTo(FX_ADHERENCE_FLOOR, 10);
  });
});

describe("domesticDepositRetention", () => {
  it("is exactly 1 at full credibility", () => {
    expect(domesticDepositRetention(0)).toBe(1);
  });

  it("bottoms out at the floor, never below", () => {
    expect(domesticDepositRetention(100)).toBeCloseTo(DEPOSIT_RETENTION_FLOOR, 10);
    for (const value of [...SCRUTINY_SWEEP, ...JUNK]) {
      const retention = domesticDepositRetention(value);
      expect(retention).toBeGreaterThanOrEqual(DEPOSIT_RETENTION_FLOOR);
      expect(retention).toBeLessThanOrEqual(1);
    }
  });

  it("is monotonically decreasing in scrutiny", () => {
    for (let i = 1; i < SCRUTINY_SWEEP.length; i += 1) {
      expect(domesticDepositRetention(SCRUTINY_SWEEP[i])).toBeLessThan(
        domesticDepositRetention(SCRUTINY_SWEEP[i - 1])
      );
    }
  });

  it("clamps out-of-range and non-finite input", () => {
    expect(domesticDepositRetention(-50)).toBe(1);
    expect(domesticDepositRetention(NaN)).toBe(1);
    expect(domesticDepositRetention(150)).toBeCloseTo(DEPOSIT_RETENTION_FLOOR, 10);
  });
});

describe("the three effects together", () => {
  it("all vanish at full credibility, so existing balance is untouched", () => {
    expect(sovereignCredibilitySpread(0)).toBe(0);
    expect(interventionAdherenceMultiplier(0)).toBe(1);
    expect(domesticDepositRetention(0)).toBe(1);
  });

  it("all stay bounded at maximum scrutiny, so the market still functions", () => {
    expect(sovereignCredibilitySpread(100)).toBeLessThanOrEqual(
      SOVEREIGN_CREDIBILITY_SPREAD_MAX_PP
    );
    expect(interventionAdherenceMultiplier(100)).toBeGreaterThanOrEqual(FX_ADHERENCE_FLOOR);
    expect(domesticDepositRetention(100)).toBeGreaterThanOrEqual(DEPOSIT_RETENTION_FLOOR);
  });

  it("keeps deposits the stickiest and expectations the least sticky channel", () => {
    // Ordering is a design decision: reserves buy more adherence than words buy
    // belief, and deposits are stickier still.
    expect(DEPOSIT_RETENTION_FLOOR).toBeGreaterThan(FX_ADHERENCE_FLOOR);
  });
});
