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
  let payables: Parameters<typeof advanceProducerEconomy>[0]["payables"] = [];
  for (let turn = 1; turn <= 48; turn++) {
    let result: ReturnType<typeof advanceProducerEconomy>;
    try {
      result = advanceProducerEconomy({
        turn,
        accounts,
        payables,
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
    const openingDebt: number = (payables ?? []).reduce((sum, claim) => sum + claim.amount, 0);
    const paidDebt = result.payablePayments.reduce((sum, claim) => sum + claim.amount, 0);
    const newDebt = result.producers.reduce((sum, producer) => sum + producer.operatingArrears, 0);
    const closingDebt = result.payables.reduce((sum, claim) => sum + claim.amount, 0);
    assert(Math.abs(closingDebt - (openingDebt - paidDebt + newDebt)) <= 1e-7);
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
              producer.otherOperatingPaid -
              producer.arrearsPaid)
        ) < 1e-7
      );
      for (const product of producer.products) {
        const carried =
          producer.outputStock.find(
            (stock) => stock.commodity === product.commodity && stock.book === product.book
          )?.units ?? 0;
        assert(
          Math.abs(product.offeredUnits - product.deliveredUnits - carried - product.lostUnits) <=
            Math.max(1e-7, product.offeredUnits * 1e-12)
        );
      }
      const plan = plans.find((p) => p.id === producer.id)!;
      const openingInputValue = plan.inputStock.reduce((sum, stock) => sum + stock.value, 0);
      const closingInputValue = producer.inputStock.reduce((sum, stock) => sum + stock.value, 0);
      assert(
        Math.abs(
          closingInputValue -
            (openingInputValue +
              producer.purchases -
              producer.inputsConsumed -
              producer.inventoryWriteOff)
        ) <= Math.max(1e-7, openingInputValue * 1e-12)
      );
      assert(
        Math.abs(
          producer.profit -
            (producer.revenue -
              producer.inputsConsumed -
              producer.inventoryWriteOff -
              plan.labourCost -
              plan.otherOperatingCost)
        ) <= 1e-7
      );
      plan.inputStock = producer.inputStock;
      plan.outputStock = producer.outputStock;
    }
    accounts = result.accounts;
    payables = result.payables;
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
    "Active turn-engine and forecasts remain incomplete; migrated pricing controls still need end-to-end qualification.",
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
    "unpaid claims reconcile across turns; paying old bills is not a new expense",
    "input acquisition value reconciles across purchases, consumption, carry loss and closing stock",
    "output reconciles across delivery, carry loss and retained stock",
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
