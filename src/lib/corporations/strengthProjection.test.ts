import { describe, expect, it } from "vitest";
import { calcLogisticsGrowth, calcMarketingGrowth } from "@/lib/constants/corporations";
import { calculateCorpStrengthProjection } from "./strengthProjection";

describe("calculateCorpStrengthProjection", () => {
  it("normalizes local-currency budgets before projecting strength gains", () => {
    const projection = calculateCorpStrengthProjection(
      {
        liquidCurrencyCode: "JPY",
        marketingBudget: 2_400_000,
        marketingStrength: 2.5,
        logisticsBudget: 1_200_000,
        logisticsStrength: 10,
      },
      133.2808416448283
    );

    expect(projection.marketingStrengthGrowth).toBeCloseTo(
      calcMarketingGrowth(2_400_000 / 133.2808416448283, 2.5),
      8
    );
    expect(projection.marketingStrengthGrowth).not.toBeCloseTo(
      calcMarketingGrowth(2_400_000, 2.5),
      2
    );
    expect(projection.logisticsStrengthNetChange).toBeCloseTo(
      calcLogisticsGrowth(1_200_000 / 133.2808416448283) - 10 * 0.05,
      8
    );
  });

  it("passes through pre-forex anchor budgets", () => {
    const projection = calculateCorpStrengthProjection(
      {
        marketingBudget: 100_000,
        marketingStrength: 10,
        logisticsBudget: 100_000,
        logisticsStrength: 0,
      },
      150
    );

    expect(projection.marketingStrengthGrowth).toBeCloseTo(calcMarketingGrowth(100_000, 10), 8);
    expect(projection.logisticsStrengthNetChange).toBeCloseTo(calcLogisticsGrowth(100_000), 8);
  });
});
