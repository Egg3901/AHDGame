/** Controlled three-country market replay for issue #2327; no database access. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMMODITY_BASE_PRICES, type CommodityType } from "../../src/lib/constants/commodities";
import type { CountryId } from "../../src/lib/constants/countries";
import { computeClearingFactors } from "../../src/lib/market/clearing";
import { clearCommodity } from "../../src/lib/trade/clearing";
import {
  clearAllCommodities,
  valueTradeSnapshot,
  type ByCountryBalances,
} from "../../src/lib/trade/snapshot";
import { applyTradeConvergence } from "../../src/lib/trade/convergence";
import { buildReachableBooks } from "../../src/lib/trade/reachableBook";

const countries: CountryId[] = ["US", "RU", "UK"];
const local: CommodityType[] = [
  "construction_services",
  "healthcare_services",
  "real_estate_services",
  "entertainment_services",
];
const remote: CommodityType[] = ["software", "consulting_services"];
const rows: Array<Record<string, number | string>> = [];
const balance = (commodity: CommodityType, supply: number, demand: number) =>
  new Map<CommodityType, { supply: number; demand: number }>([[commodity, { supply, demand }]]);

for (const commodity of [...local, ...remote]) {
  for (let turn = 1; turn <= 48; turn++) {
    const demandChanged = turn > 24;
    const njDemand = demandChanged ? 25 : 0;
    const azDemand = demandChanged ? 100 : 50;
    const ruDemand = demandChanged ? 175 : 200;
    const byCountry: ByCountryBalances = new Map([
      ["US", balance(commodity, 200, njDemand + azDemand)],
      ["RU", balance(commodity, 100, ruDemand)],
      ["UK", balance(commodity, 100, 100)],
    ]);
    // Control reproduces the former snapshot loop, which passed every
    // commodity to the generic international clearing rule with open lanes.
    const control = clearCommodity({
      countries,
      supply: { US: 200, RU: 100, UK: 100 },
      demand: { US: njDemand + azDemand, RU: ruDemand, UK: 100 },
      affinity: () => 1,
    });
    const controlMap = new Map([[commodity, control]]);
    const treatmentMap = clearAllCommodities(countries, byCountry, () => 1);
    const treatment = treatmentMap.get(commodity)!;
    const base = COMMODITY_BASE_PRICES[commodity];
    const stateMarkets = {
      stateBySector: new Map([
        ["nj", "NJ"],
        ["az", "AZ"],
        ["mos", "RU_MOS"],
        ["sco", "UK_SCO"],
      ]),
      balances: new Map([
        ["NJ", balance(commodity, 100, njDemand)],
        ["AZ", balance(commodity, 100, azDemand)],
        ["RU_MOS", balance(commodity, 100, ruDemand)],
        ["UK_SCO", balance(commodity, 100, 100)],
      ]),
      priceRatios: new Map<string, Map<CommodityType, number>>(),
    };
    const marketInput = {
      sectors: ["nj", "az", "mos", "sco"].map((sectorId) => ({
        sectorId,
        revenue: 100 * base,
        supplyRates: { [commodity]: 1 },
        posture: 0,
      })),
      balances: balance(commodity, 400, njDemand + azDemand + ruDemand + 100),
      groupBySector: new Map([
        ["nj", "US"],
        ["az", "US"],
        ["mos", "RU"],
        ["sco", "UK"],
      ]),
      priceRatioByCommodity: new Map<CommodityType, number>([[commodity, 1]]),
      basePrices: COMMODITY_BASE_PRICES,
    };
    const countryBooks = (clearing: typeof controlMap) =>
      new Map(
        countries.map((country) => {
          const original = byCountry.get(country)!.get(commodity)!;
          const flow = clearing.get(commodity)!.perCountry[country];
          return [
            country,
            balance(
              commodity,
              original.supply,
              Math.max(0, original.demand - flow.imports) + flow.exports
            ),
          ];
        })
      );
    const controlSales = computeClearingFactors({
      ...marketInput,
      balancesByGroup: countryBooks(controlMap),
    });
    const treatmentSales = computeClearingFactors({
      ...marketInput,
      balancesByGroup: countryBooks(new Map([[commodity, treatment]])),
      stateMarkets,
    });
    if (local.includes(commodity)) {
      assert.equal(treatment.clearedVolume, 0);
      assert.equal(treatmentSales.get("nj")!.soldFraction, njDemand / 100);
      assert.equal(treatmentSales.get("az")!.soldFraction, azDemand / 100);
      const books = buildReachableBooks({
        countries,
        balances: byCountry,
        clearing: treatmentMap,
        commodities: [commodity],
        affinity: () => 1,
      });
      for (const country of countries)
        assert.equal(books.get(country)!.get(commodity)!.unmetForeignDemand, 0);
      const converged = new Map(
        [...byCountry].map(([country, book]) => [
          country,
          new Map([...book].map(([key, value]) => [key, { ...value }])),
        ])
      );
      applyTradeConvergence(countries, converged, treatmentMap, 0.5);
      assert.deepEqual(converged, byCountry);
    } else {
      assert.deepEqual(treatment, control);
      assert.deepEqual(treatmentSales, controlSales);
    }
    const snapshot = valueTradeSnapshot(
      countries,
      treatmentMap,
      new Map(),
      new Map([[commodity, base]]),
      turn,
      new Date("2026-01-01T00:00:00Z")
    );
    const exports = countries.reduce(
      (sum, country) => sum + snapshot.national[country]!.exports,
      0
    );
    const imports = countries.reduce(
      (sum, country) => sum + snapshot.national[country]!.imports,
      0
    );
    assert.ok(Math.abs(exports - imports) < 1e-6);
    rows.push({
      commodity,
      turn,
      controlInternationalUnits: control.clearedVolume,
      treatmentInternationalUnits: treatment.clearedVolume,
      controlNjFill: controlSales.get("nj")!.soldFraction,
      treatmentNjFill: treatmentSales.get("nj")!.soldFraction,
      treatmentAzFill: treatmentSales.get("az")!.soldFraction,
    });
  }
}

const output = {
  issue: 2327,
  scope:
    "48-turn controlled three-country market replay with an exogenous demand step at turn 25; no full world or live data",
  control:
    "Former snapshot loop clears every commodity internationally; former sector clearing uses country books",
  treatment:
    "Production clearAllCommodities, reachable books, trade convergence, valuation and state-scoped sector clearing",
  cases: rows.length,
  rows,
};
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
if (outArg) writeFileSync(resolve(outArg.slice(6)), JSON.stringify(output, null, 2) + "\n");
console.log(
  JSON.stringify({ issue: output.issue, cases: output.cases, allAssertionsPassed: true })
);
