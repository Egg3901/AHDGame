import { describe, expect, it } from "vitest";
import {
  computeLaborForce,
  annualizedGrowthRate,
  potentialGrowth,
  LABOR_SHARE,
  CAPITAL_SHARE,
  TFP_BASELINE,
  NEUTRAL_LABOR_PARTICIPATION,
} from "./potentialGrowth";

const TPY = 48;

describe("computeLaborForce", () => {
  it("is civilian working-age × participation share", () => {
    // (1000 working-age − 50 serving) × 62.5% = 593.75
    expect(computeLaborForce(1000, 50, 62.5)).toBeCloseTo(593.75, 4);
  });
  it("subtracts the serving population before scaling (conscription drag)", () => {
    expect(computeLaborForce(1000, 200, 60)).toBeLessThan(computeLaborForce(1000, 0, 60));
  });
  it("never negative; missing participation defaults to neutral", () => {
    expect(computeLaborForce(0, 500, 60)).toBe(0); // serving > working-age → floored
    expect(computeLaborForce(1000, 0, NaN)).toBeCloseTo(
      1000 * (NEUTRAL_LABOR_PARTICIPATION / 100),
      4
    );
  });
});

describe("annualizedGrowthRate", () => {
  it("annualizes the per-turn change", () => {
    expect(annualizedGrowthRate(101, 100, TPY)).toBeCloseTo(0.01 * 100 * TPY, 6); // +1%/turn → ×48 annual
  });
  it("0 when no prior (cold start) or non-finite", () => {
    expect(annualizedGrowthRate(100, 0, TPY)).toBe(0);
    expect(annualizedGrowthRate(100, NaN, TPY)).toBe(0);
  });
});

describe("potentialGrowth", () => {
  it("is the share-weighted Solow sum (αL+αK=1) plus TFP", () => {
    expect(LABOR_SHARE + CAPITAL_SHARE).toBeCloseTo(1, 9);
    expect(potentialGrowth(0, 0, TFP_BASELINE)).toBeCloseTo(TFP_BASELINE, 9);
    expect(potentialGrowth(1, 2, TFP_BASELINE)).toBeCloseTo(
      LABOR_SHARE * 1 + CAPITAL_SHARE * 2 + TFP_BASELINE,
      9
    );
  });
  it("a shrinking workforce drags potential below TFP", () => {
    expect(potentialGrowth(-2, 0, TFP_BASELINE)).toBeLessThan(TFP_BASELINE);
  });
});
