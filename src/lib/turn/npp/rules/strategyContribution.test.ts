import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import { computeInputsCost } from "@/lib/corporations/physicalPnl";
import { PRICE_REALIZATION_MAX, priceRealizationFactor } from "@/lib/market/priceRealization";
import {
  decideExtractionStrategySwitch,
  scoreStrategyExpectedRevenue,
} from "../strategyExpectedRevenue";
import {
  expectedSellableShare,
  forecastStrategyContribution,
  type StrategyContributionContext,
} from "./strategyContribution";

function context(
  overrides: Partial<StrategyContributionContext> = {}
): StrategyContributionContext {
  return {
    mode: "realization",
    priceRatios: {},
    balances: {},
    sellableShares: {},
    headroom: {},
    currentTurn: 300,
    ...overrides,
  };
}

describe("NPP recipe contribution forecasts", () => {
  const iron = { id: "iron", supply: { iron: 0.78 }, demand: { energy: 0.25 } };
  const rare = { id: "rare", supply: { rare_earth: 0.72 }, demand: { energy: 0.25 } };

  it("corrects the audited 20x-versus-3x output ranking with the actual realization kernel", () => {
    // Both legs sit at the realization cap, so the larger output share wins
    // instead of the raw 20x price.
    const prices = { rare_earth: 20, iron: 4 };
    const ctx = context({ priceRatios: prices });
    expect(
      scoreStrategyExpectedRevenue(
        rare.supply,
        (key) => prices[key as keyof typeof prices] ?? null,
        () => 1
      )
    ).toBeCloseTo(14.4);
    expect(priceRealizationFactor(4)).toBe(PRICE_REALIZATION_MAX);
    expect(forecastStrategyContribution(rare, ctx).outputValue).toBeCloseTo(
      0.72 * priceRealizationFactor(20)
    );
    expect(forecastStrategyContribution(iron, ctx).outputValue).toBeCloseTo(
      0.78 * PRICE_REALIZATION_MAX
    );
    expect(forecastStrategyContribution(iron, ctx).score).toBeGreaterThan(
      forecastStrategyContribution(rare, ctx).score
    );
  });

  it("stops increasing the score above the live output-price cap", () => {
    expect(
      forecastStrategyContribution(rare, context({ priceRatios: { rare_earth: 20 } })).score
    ).toBe(
      forecastStrategyContribution(
        rare,
        context({ priceRatios: { rare_earth: PRICE_REALIZATION_MAX ** 2 } })
      ).score
    );
  });

  it.each([null, 0, -2, Number.NaN, Number.POSITIVE_INFINITY])(
    "keeps invalid price %s neutral",
    (ratio) => {
      expect(
        forecastStrategyContribution(iron, context({ priceRatios: { iron: ratio } })).score
      ).toBeCloseTo(0.78);
    }
  );

  it("uses the actual plants input bill without base-price weighting", () => {
    const recipe = { supply: { iron: 0.78 }, demand: { energy: 0.25, vehicles: 0.15 } };
    const ctx = context({
      mode: "plants",
      priceRatios: { energy: 4, vehicles: 0.25 },
      governorCap: 1,
    });
    const forecast = forecastStrategyContribution(recipe, ctx);
    const bill = computeInputsCost({
      nominalDailyRevenue: 1,
      rates: recipe.demand,
      basePrices: COMMODITY_BASE_PRICES,
      priceRatios: new Map([
        ["energy", 4],
        ["vehicles", 0.25],
      ]),
      utilization: 1,
      inputMultiplier: 1,
      turnsPerDay: 1,
    });
    expect(forecast.inputCost).toBeCloseTo(bill.total);
    expect(forecast.inputCost).toBeCloseTo(0.25 * PRICE_REALIZATION_MAX + 0.15 * 0.7);
  });

  it.each(["realization", "ledger", "clearing", "capital"] as const)(
    "does not deduct the plants input bill in %s",
    (mode) => {
      expect(
        forecastStrategyContribution(iron, context({ mode, priceRatios: { energy: 20 } })).inputCost
      ).toBe(0);
    }
  );

  it("can forecast the input bill separately from reachable output prices", () => {
    const recipe = { supply: { iron: 0.78 }, demand: { energy: 0.25 } };
    const result = forecastStrategyContribution(
      recipe,
      context({
        mode: "plants",
        priceRatios: { iron: 4, energy: 20 },
        inputPriceRatios: { energy: 1 },
      })
    );
    expect(result.inputCost).toBeCloseTo(0.25);
    expect(result.outputValue).toBeCloseTo(0.78 * PRICE_REALIZATION_MAX);
  });

  it("uses sellability only from the clearing tier", () => {
    const constraints = { sellableShares: { iron: 0.1 }, clearingStartTurn: 0, governorCap: 1 };
    expect(forecastStrategyContribution(iron, context(constraints)).score).toBeCloseTo(0.78);
    expect(
      forecastStrategyContribution(iron, context({ ...constraints, mode: "clearing" })).score
    ).toBeCloseTo(0.078);
  });

  it("uses the live half-throughput floor after the ramp with a fully open governor", () => {
    const result = forecastStrategyContribution(
      iron,
      context({
        mode: "clearing",
        balances: { energy: { supply: 1, demand: 100 } },
        throughputStartTurn: 0,
        governorCap: 1,
      })
    );
    expect(result.throughput).toBe(0.5);
    expect(result.score).toBeCloseTo(0.39);
  });

  it("keeps the live launch governor and new-sector ramp", () => {
    const constraints = {
      mode: "clearing" as const,
      balances: { energy: { supply: 1, demand: 100 } },
    };
    expect(forecastStrategyContribution(iron, context(constraints)).throughput).toBe(1);
    expect(
      forecastStrategyContribution(iron, context({ ...constraints, throughputStartTurn: 0 }))
        .throughput
    ).toBe(0.85);
  });

  it("uses local delivery for an input and global data for missing local entries", () => {
    const recipe = { supply: { iron: 0.78 }, demand: { energy: 0.25, vehicles: 0.1 } };
    const constraints = {
      mode: "clearing" as const,
      throughputStartTurn: 0,
      governorCap: 1,
      balances: { energy: { supply: 1, demand: 1 }, vehicles: { supply: 0.6, demand: 1 } },
    };
    expect(
      forecastStrategyContribution(
        recipe,
        context({ ...constraints, localInputAvailability: { energy: 0.2 } })
      ).throughput
    ).toBe(0.5);
    expect(
      forecastStrategyContribution(
        recipe,
        context({ ...constraints, localInputAvailability: { energy: 1 } })
      ).throughput
    ).toBe(0.6);
  });

  it("keeps missing input data neutral and excludes unsupported deposits", () => {
    expect(forecastStrategyContribution(iron, context({ mode: "clearing" })).throughput).toBe(1);
    expect(forecastStrategyContribution(iron, context({ headroom: { iron: 0 } })).outputValue).toBe(
      0
    );
  });

  it("preserves switch hysteresis and the primary deposit guard when injecting the forecast", () => {
    const recipes = [
      { id: "current", supply: { iron: 0.5 }, demand: {} },
      { id: "candidate", supply: { rare_earth: 0.58 }, demand: {} },
    ];
    const ctx = context();
    const params: Parameters<typeof decideExtractionStrategySwitch>[0] = {
      currentStrategyId: "current",
      strategies: recipes,
      priceRatioOf: () => 1,
      headroomOf: () => 1,
      scoreOf: (recipe) =>
        forecastStrategyContribution({ supply: recipe.supply, demand: recipe.demand ?? {} }, ctx)
          .score,
    };
    expect(decideExtractionStrategySwitch(params)).toBeNull();
    expect(decideExtractionStrategySwitch({ ...params, soldFraction: 0.2 })?.strategyId).toBe(
      "candidate"
    );
    expect(
      decideExtractionStrategySwitch({ ...params, soldFraction: 0.2, headroomOf: () => 0.01 })
    ).toBeNull();
  });
});

describe("lagged aggregate sellability", () => {
  it("distinguishes observed zero demand, glut, shortage and missing data", () => {
    expect(expectedSellableShare({ supply: 100, demand: 20 })).toBe(0.2);
    expect(expectedSellableShare({ supply: 100, demand: 200 })).toBe(1);
    expect(expectedSellableShare({ supply: 100, demand: 0 })).toBe(0);
    expect(expectedSellableShare({ supply: 0, demand: 20 })).toBe(1);
    expect(expectedSellableShare(undefined)).toBe(1);
    expect(expectedSellableShare({ supply: Number.NaN, demand: 20 })).toBe(1);
  });
});
