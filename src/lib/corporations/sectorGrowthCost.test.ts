import { describe, expect, it } from "vitest";
import { growthCostFor } from "./sectorGrowthCost";
import {
  calculateDailyGrowthCost,
  acumenGrowthCostMultiplier,
  acumenRateSensitivity,
  GROWTH_RATE_TURNS_PER_YEAR,
  GROWTH_COST_MULTIPLIER,
  TURNS_PER_DAY,
} from "@/lib/constants/corporations";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";

describe("growthCostFor", () => {
  it("matches calculateDailyGrowthCost with perTurnGrowthRate = rate / GROWTH_RATE_TURNS_PER_YEAR", () => {
    const revenue = 1000;
    const ratePct = 6; // growth rate % per game year
    const primeRate = 4;
    const marketShare = 0;
    const expected = calculateDailyGrowthCost(
      revenue,
      ratePct / GROWTH_RATE_TURNS_PER_YEAR,
      primeRate,
      marketShare
    );
    expect(growthCostFor(revenue, ratePct, primeRate, marketShare)).toBe(expected);
  });

  // Clock-alignment regression guard (#3934). Growth ACCRUES on the 48-turn game
  // year (sectorTurn.ts divides the rate by GROWTH_RATE_TURNS_PER_YEAR) but cost
  // is CHARGED on the 24-turn financial day (hourlyGrowthCost = daily cost /
  // TURNS_PER_DAY). If `calculateDailyGrowthCost` converts to daily using 48
  // instead of 24, a sector pays two days of cost per one year of growth and the
  // effective price silently doubles to 6× — which is the bug this locks out.
  it("charges GROWTH_COST_MULTIPLIER× the revenue the growth actually adds", () => {
    const revenue = 100_000;
    const ratePct = 6; // % per game year
    // Neutral prime rate so rateMultiplier is exactly 1, isolating the clocks.
    const dailyCost = growthCostFor(revenue, ratePct, 0, 0);

    // What the sector pays across one full game year of growth.
    const perTurnCost = dailyCost / TURNS_PER_DAY;
    const costOverOneGameYear = perTurnCost * GROWTH_RATE_TURNS_PER_YEAR;

    // Against the nominal gain the ratio is exactly GROWTH_COST_MULTIPLIER.
    const nominalRevenueAdded = revenue * (ratePct / 100);
    expect(costOverOneGameYear / nominalRevenueAdded).toBeCloseTo(GROWTH_COST_MULTIPLIER, 5);

    // Compounding 1/48th of the rate each turn (exactly as sectorTurn.ts does)
    // delivers slightly MORE than the nominal gain, so the realized price is a
    // little below the multiplier — never above it.
    const perTurnGrowthRate = ratePct / GROWTH_RATE_TURNS_PER_YEAR;
    let grown = revenue;
    for (let t = 0; t < GROWTH_RATE_TURNS_PER_YEAR; t++) {
      grown *= 1 + perTurnGrowthRate / 100;
    }
    const compoundedRevenueAdded = grown - revenue;
    expect(compoundedRevenueAdded).toBeGreaterThan(nominalRevenueAdded);

    const realizedPrice = costOverOneGameYear / compoundedRevenueAdded;
    expect(realizedPrice).toBeLessThan(GROWTH_COST_MULTIPLIER);
    expect(realizedPrice).toBeGreaterThan(GROWTH_COST_MULTIPLIER * 0.9);
  });

  it("applies the dominance multiplier via market share", () => {
    const low = growthCostFor(1000, 6, 4, 0);
    const high = growthCostFor(1000, 6, 4, 80);
    expect(high).toBeGreaterThan(low);
  });

  it("defaults to neutral Business Acumen when not provided", () => {
    expect(growthCostFor(1000, 6, 4, 0)).toBe(growthCostFor(1000, 6, 4, 0, NEUTRAL_STAT));
  });

  it("makes growth cheaper for a high-Acumen CEO", () => {
    const lowAcumen = growthCostFor(1000, 6, 4, 0, 1);
    const neutral = growthCostFor(1000, 6, 4, 0, NEUTRAL_STAT);
    const highAcumen = growthCostFor(1000, 6, 4, 0, 10);
    expect(highAcumen).toBeLessThan(neutral);
    expect(neutral).toBeLessThan(lowAcumen);
  });
});

describe("Business Acumen growth-cost helpers", () => {
  it("is neutral (1.0) at the stat pivot", () => {
    expect(acumenGrowthCostMultiplier(NEUTRAL_STAT)).toBeCloseTo(1, 6);
    expect(acumenRateSensitivity(NEUTRAL_STAT)).toBeCloseTo(1, 6);
  });

  it("discounts cost and dampens rate exposure as Acumen rises", () => {
    expect(acumenGrowthCostMultiplier(10)).toBeLessThan(1);
    expect(acumenGrowthCostMultiplier(1)).toBeGreaterThan(1);
    expect(acumenRateSensitivity(10)).toBeLessThan(1);
    expect(acumenRateSensitivity(1)).toBeGreaterThan(1);
  });

  it("lets a high-Acumen CEO feel less of a high prime rate", () => {
    // The cost penalty from raising the prime rate is smaller for a skilled CEO.
    const lowAt0 = calculateDailyGrowthCost(1000, 0.5, 0, 0, 1);
    const lowAt8 = calculateDailyGrowthCost(1000, 0.5, 8, 0, 1);
    const highAt0 = calculateDailyGrowthCost(1000, 0.5, 0, 0, 10);
    const highAt8 = calculateDailyGrowthCost(1000, 0.5, 8, 0, 10);
    // proportional cost increase from a rate hike is smaller for the high-Acumen CEO
    expect(highAt8 / highAt0).toBeLessThan(lowAt8 / lowAt0);
  });
});
