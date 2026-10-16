/** Deterministic rules qualification. Never connects to a database. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { OPERATING_SECTOR_TYPES } from "../../src/lib/constants/corporations";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import {
  getEffectiveStrategyRatesForOperatingModel,
  SECTOR_STRATEGIES,
} from "../../src/lib/constants/sectorStrategies";
import { isStorable } from "../../src/lib/market/inventory";
import {
  advanceProducerEconomy,
  type ProductionPlan,
} from "../../src/lib/market/producerMarket/production";
import { HOUSEHOLD_CONSUMER_BASKET } from "../../src/lib/market/producerMarket/householdRules";
import { isStateScopedCommodity } from "../../src/lib/market/rules/commodityMarketScope";

const book = (commodity: string) =>
  isStateScopedCommodity(commodity as CommodityType) ? "state:fixture" : "world";

function recipeFixture(preset: string): ProductionPlan[] {
  return OPERATING_SECTOR_TYPES.flatMap((lane) =>
    SECTOR_STRATEGIES[lane]
      .filter(
        (strategy) =>
          strategy.minDecade == null || Number(strategy.minDecade) <= Number(preset.slice(0, 4))
      )
      .map((strategy) => {
        const recipe = getEffectiveStrategyRatesForOperatingModel(
          lane,
          strategy.id,
          undefined,
          undefined,
          0,
          undefined,
          undefined,
          preset
        );
        const yieldPerNominal = Object.entries(recipe.supply).reduce(
          (sum, [commodity, rate]) =>
            sum + rate! / COMMODITY_BASE_PRICES[commodity as CommodityType],
          0
        );
        assert(yieldPerNominal > 0, `Missing output recipe: ${lane}`);
        const nominalValue = 10000;
        return {
          id: `${lane}:${strategy.id}`,
          accountId: `${lane}:${strategy.id}`,
          capacityUnits: nominalValue * yieldPerNominal,
          activeFraction: 1,
          outputMultiplier: 1,
          inputs: Object.entries(recipe.demand).map(([commodity, rate]) => ({
            commodity,
            book: book(commodity),
            unitsPerOutput:
              rate! / COMMODITY_BASE_PRICES[commodity as CommodityType] / yieldPerNominal,
            maximumUnitPrice: COMMODITY_BASE_PRICES[commodity as CommodityType] * 1.25,
          })),
          outputs: Object.entries(recipe.supply).map(([commodity, rate]) => ({
            commodity,
            book: book(commodity),
            unitsPerOutput:
              rate! / COMMODITY_BASE_PRICES[commodity as CommodityType] / yieldPerNominal,
            policy: { kind: "automatic" as const, targetMarkup: 0.1 },
            referenceUnitPrice: COMMODITY_BASE_PRICES[commodity as CommodityType],
            storable: isStorable(commodity as CommodityType),
          })),
          // Explicit synthetic payroll and maintenance, never fitted to an old margin.
          labourCost: nominalValue * 0.15,
          otherOperatingCost: nominalValue * 0.03,
          labourRecipientAccountId: "households",
          operatingRecipientAccountId: "operating-payee",
          inputStock: [],
          outputStock: [],
        };
      })
  );
}

function simulate(
  preset: string,
  scenario: "recipe-closure" | "input-shortage" | "low-utilization" | "zero-consumption"
) {
  let plans = recipeFixture(preset);
  if (scenario === "input-shortage") plans = plans.filter((plan) => !plan.id.startsWith("energy:"));
  if (scenario === "low-utilization")
    plans = plans.map((plan) => ({ ...plan, activeFraction: 0.1 }));
  let accounts = [
    ...plans.map((plan) => ({ id: plan.accountId, cash: 1000000 })),
    { id: "households", cash: 0 },
    { id: "operating-payee", cash: 0 },
  ];
  const openingCash = accounts.reduce((sum, account) => sum + account.cash, 0);
  const observations = [];
  for (let turn = 1; turn <= 48; turn++) {
    let result: ReturnType<typeof advanceProducerEconomy>;
    try {
      result = advanceProducerEconomy({
        turn,
        accounts,
        producers: plans,
        households: [
          {
            accountId: "households",
            spendFraction: scenario === "zero-consumption" ? 0 : 0.9,
            products: Object.entries(HOUSEHOLD_CONSUMER_BASKET).map(([commodity, weight]) => ({
              commodity,
              book: book(commodity),
              maximumUnitPrice: COMMODITY_BASE_PRICES[commodity as CommodityType] * 1.25,
              weight: weight!,
            })),
          },
        ],
      });
    } catch (error) {
      if (process.argv[2])
        writeFileSync(
          process.argv[2],
          JSON.stringify(
            { status: "failed", preset, scenario, turn, accounts, plans, error: String(error) },
            null,
            2
          )
        );
      throw error;
    }
    const closingCash = result.accounts.reduce((sum, account) => sum + account.cash, 0);
    assert(Math.abs(closingCash - openingCash) <= openingCash * 1e-12);
    for (const trade of result.trades)
      assert(
        Math.abs(trade.amount - trade.units * trade.unitPrice) <=
          Math.max(1e-8, trade.amount * 1e-12)
      );
    for (const producer of result.producers) {
      assert(producer.deliveredUnits <= producer.offeredUnits + 1e-8);
      assert.equal(
        producer.revenue,
        producer.products.reduce((sum, product) => sum + product.revenue, 0)
      );
      assert(
        Math.abs(
          producer.cashFlow -
            (producer.revenue -
              producer.purchases -
              producer.labourPaid -
              producer.otherOperatingPaid)
        ) < 1e-7
      );
      const plan = plans.find((p) => p.id === producer.id)!;
      plan.inputStock = producer.inputStock;
      plan.outputStock = producer.outputStock;
    }
    accounts = result.accounts;
    observations.push({
      turn,
      cashDrift: closingCash - openingCash,
      produced: result.producers.reduce((sum, producer) => sum + producer.producedUnits, 0),
      delivered: result.producers.reduce((sum, producer) => sum + producer.deliveredUnits, 0),
      revenue: result.producers.reduce((sum, producer) => sum + producer.revenue, 0),
      operatingLossSites: result.producers.filter((producer) => producer.profit < 0).length,
      zeroOutputSites: result.producers.filter((producer) => producer.producedUnits < 1e-8).length,
      arrears: result.producers.reduce((sum, producer) => sum + producer.operatingArrears, 0),
      tradeCount: result.trades.length,
    });
  }
  return {
    preset,
    scenario,
    sites: plans.length,
    turns: observations.length,
    first: observations[0],
    last: observations.at(-1),
    maximumCashDrift: Math.max(...observations.map((row) => Math.abs(row.cashDrift))),
    observations,
  };
}

const scenarios = [
  "recipe-closure",
  "input-shortage",
  "low-utilization",
  "zero-consumption",
] as const;
const report = {
  liveRolloutQualified: false,
  qualificationGaps: [
    "Complete turn-engine, API and UI replacement remains unimplemented.",
    "The synthetic 1991 recipe portfolio loses almost all output over 48 turns despite conserved cash.",
    "Synthetic payroll and site costs do not establish balance for current-world producers.",
    "Contracts, route constraints, quality, inventory decay, fiscal flows and full-world performance remain unqualified.",
  ],
  scope:
    "Pure rules with actual era-available recipe portfolios and synthetic cash, payroll and site costs. This does not execute complete game turns or qualify a live rollout.",
  invariants: [
    "cash conserved",
    "no negative spendable balances",
    "delivered output bounded by input-backed production and retained stock",
    "revenue equals delivered units times trade price",
    "purchases charged once",
    "unpaid bills remain expenses and arrears",
  ],
  results: ["1991-default", "2019-default"].flatMap((preset) =>
    scenarios.map((scenario) => simulate(preset, scenario))
  ),
};
const output = process.argv[2];
if (!output) throw new Error("Usage: tsx scripts/sim/unifiedProducerSettlement.ts <report.json>");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    report.results.map(({ observations: _observations, ...summary }) => summary),
    null,
    2
  )
);
