/** Deterministic rules qualification. Never connects to a database. */
import { producerTrades } from "../../src/lib/market/producerMarket/rules";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import { advanceProducerEconomy } from "../../src/lib/market/producerMarket/production";
import { HOUSEHOLD_CONSUMER_BASKET } from "../../src/lib/market/producerMarket/householdRules";
import { makeProducerRecipeFixture, producerFixtureBook } from "./fixtures/producerEconomy";

function simulate(
  preset: string,
  scenario: "recipe-closure" | "input-shortage" | "low-utilization" | "zero-consumption"
) {
  let plans = makeProducerRecipeFixture(preset);
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
              book: producerFixtureBook(commodity),
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
    for (const trade of producerTrades(result.tradeReceipt))
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
      tradeCount: result.tradeReceipt.tradeCount,
    });
  }
  if (scenario === "recipe-closure")
    assert(
      observations.at(-1)!.produced >= observations[0].produced * 0.999999,
      `${preset} supplier network collapsed`
    );
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
