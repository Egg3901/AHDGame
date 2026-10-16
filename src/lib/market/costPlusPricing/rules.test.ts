import { describe, expect, it } from "vitest";
import { computeClearingFactors, costPlusPriceFactor } from "../clearing";
import {
  costPlusFixedDenominatorRevenue,
  inputBasketCostIndex,
  recordCostPlusBasis,
} from "./rules";
import { computeInputsCost } from "@/lib/corporations/physicalPnl";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";

describe("cost-plus offers", () => {
  it("passes through material inflation only on the recipe's input share", () => {
    expect(costPlusPriceFactor(1.5, 0, 0.67, 0.238)).toBeCloseTo(1.243, 10);
    expect(costPlusPriceFactor(100, 0, 0.67, 0.238)).toBeCloseTo(0.238 + 0.67 * 2, 10);
    expect(costPlusPriceFactor(Number.NaN, 0.1, 0.67, 0.238)).toBeCloseTo(0.9988, 10);
    expect(
      inputBasketCostIndex(
        { energy: 0.6, iron: 0.2 },
        new Map([
          ["energy", 2.25],
          ["iron", 1],
        ])
      )
    ).toBeCloseTo(1.375, 10);
  });
  it("quotes actual operating cost at zero markup and retains paid overhead", () => {
    const basis = recordCostPlusBasis({
      inputsCost: 100.5,
      inputCostIndex: 1.5,
      fixedCost: 23.8,
      nominalProducedRevenue: 100,
      turn: 12,
    });
    expect(basis?.inputCostShare).toBeCloseTo(0.67);
    expect(basis?.fixedCostShare).toBeCloseTo(0.238);
    expect(basis?.turn).toBe(12);
    expect(
      costPlusPriceFactor(1.5, 0, basis!.inputCostShare, basis!.fixedCostShare) * 100
    ).toBeCloseTo(124.3);
    expect(
      costPlusPriceFactor(1.5, 0.1, basis!.inputCostShare, basis!.fixedCostShare) * 100
    ).toBeCloseTo(136.73);
    expect(
      recordCostPlusBasis({
        inputsCost: 1,
        inputCostIndex: 1,
        fixedCost: 1,
        nominalProducedRevenue: 0,
        turn: 12,
      })
    ).toBeUndefined();
  });

  it("allocates fixed costs over half capacity at 10% utilisation without diluting inputs", () => {
    const basisAt = (nominalProducedRevenue: number) =>
      recordCostPlusBasis({
        inputsCost: nominalProducedRevenue * 0.67 * 1.5,
        inputCostIndex: 1.5,
        fixedCost: 238,
        nominalProducedRevenue,
        fixedDenominatorRevenue: costPlusFixedDenominatorRevenue(
          1000,
          nominalProducedRevenue,
          1000
        ),
        turn: 12,
      })!;
    const throttled = basisAt(100);
    const half = basisAt(500);
    expect(throttled.fixedCostShare).toBeCloseTo(0.476);
    expect(throttled.fixedCostShare).toBe(half.fixedCostShare);
    expect(throttled.inputCostShare).toBeCloseTo(0.67);
    expect(throttled.inputCostShare).toBeCloseTo(half.inputCostShare);
  });

  it("preserves full-utilisation and omitted fixed denominators", () => {
    const input = {
      inputsCost: 670,
      inputCostIndex: 1,
      fixedCost: 238,
      nominalProducedRevenue: 1000,
      turn: 12,
    };
    expect(
      recordCostPlusBasis({
        ...input,
        fixedDenominatorRevenue: costPlusFixedDenominatorRevenue(1000, 1000, 1000),
      })
    ).toEqual(recordCostPlusBasis(input));
    expect(recordCostPlusBasis({ ...input, fixedDenominatorRevenue: undefined })).toEqual({
      inputCostShare: 0.67,
      fixedCostShare: 0.238,
      turn: 12,
    });
    const zeroCapacityDenominator = costPlusFixedDenominatorRevenue(1000, 0, 0);
    expect(zeroCapacityDenominator).toBe(0);
    expect(
      recordCostPlusBasis({
        ...input,
        nominalProducedRevenue: 0,
        fixedDenominatorRevenue: zeroCapacityDenominator,
      })
    ).toBeUndefined();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid separate fixed denominator %s",
    (fixedDenominatorRevenue) => {
      expect(
        recordCostPlusBasis({
          inputsCost: 67,
          inputCostIndex: 1,
          fixedCost: 23.8,
          nominalProducedRevenue: 100,
          fixedDenominatorRevenue,
          turn: 12,
        })
      ).toBeUndefined();
    }
  );

  it("sells behind a cheaper market offer and charges the indexed price", () => {
    const result = computeClearingFactors({
      sectors: [
        {
          sectorId: "market",
          revenue: 100_000,
          supplyRates: { steel: 1 },
          posture: 0,
          producedUnits: 100,
        },
        {
          sectorId: "indexed",
          revenue: 100_000,
          supplyRates: { steel: 1 },
          posture: 0.1,
          producedUnits: 100,
          inputCostIndex: 1.2,
        },
      ],
      balances: new Map([["steel", { supply: 200, demand: 150 }]]),
      priceRatioByCommodity: new Map([["steel", 1]]),
      basePrices: COMMODITY_BASE_PRICES,
      plantsEnabled: true,
    });
    expect(result.get("market")?.soldFraction).toBe(1);
    expect(result.get("indexed")?.soldFraction).toBe(0.5);
    expect(result.get("indexed")?.factor).toBeCloseTo(0.5 * 1.32, 10);
    expect(result.get("indexed")?.effectivePosture).toBeCloseTo(0.32, 10);
  });

  it("does not compound input and output scarcity prices", () => {
    const result = computeClearingFactors({
      sectors: [
        {
          sectorId: "indexed",
          revenue: 100_000,
          supplyRates: { steel: 1 },
          posture: 0.1,
          producedUnits: 100,
          inputCostIndex: 1.2,
        },
      ],
      balances: new Map([["steel", { supply: 100, demand: 100 }]]),
      priceRatioByCommodity: new Map([["steel", 2.25]]),
      basePrices: COMMODITY_BASE_PRICES,
      plantsEnabled: true,
    });
    expect(result.get("indexed")?.factor).toBeCloseTo(1.32, 10);
  });
  it("quotes the same input inflation the bill charges, so a sold-out plant is not loss-making", () => {
    // Defence-shaped recipe with scarce inputs: rare earth and steel both above
    // 2.25x base, so the damped basket index sits above the old 1.5 quote cap.
    const rates = { rare_earth: 0.3, steel: 0.25 };
    const ratios = new Map<CommodityType, number>([
      ["rare_earth", 3.2],
      ["steel", 3.6],
    ]);
    const nominal = 100_000;
    const bill = computeInputsCost({
      nominalDailyRevenue: nominal,
      rates,
      basePrices: COMMODITY_BASE_PRICES,
      priceRatios: ratios,
      utilization: 1,
      inputMultiplier: 1,
      turnsPerDay: 1,
    }).total;
    const index = inputBasketCostIndex(rates, ratios);
    expect(index).toBeGreaterThan(1.5);
    const fixedCost = 30_000;
    const basis = recordCostPlusBasis({
      inputsCost: bill,
      inputCostIndex: index,
      fixedCost,
      nominalProducedRevenue: nominal,
      turn: 1,
    })!;
    const quote = (markup: number) =>
      costPlusPriceFactor(index, markup, basis.inputCostShare, basis.fixedCostShare) * nominal;
    expect(quote(0)).toBeCloseTo(bill + fixedCost, 6);
    expect(quote(0.05) - (bill + fixedCost)).toBeCloseTo(0.05 * (bill + fixedCost), 6);
  });
});
