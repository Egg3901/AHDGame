/**
 * Qualify physical energy input billing against the actual commodity ledger.
 * Synthetic rules replay only: no database, market feedback or balance forecast.
 * Run with tsx and retain stdout as the qualification receipt.
 */
import assert from "node:assert/strict";
import {
  COMMODITY_BASE_PRICES,
  computeRawSupplyDemand,
  type CommodityType,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import { energyProductivityMultiplier } from "@/lib/corporations/rules/energyProductivityRamp";
import { computeInputsCost } from "@/lib/corporations/physicalPnl";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";

let checkedLines = 0;
const cases: Array<{ preset: string; turn: number; sectorType: string; utilization: number }> = [];
for (const preset of ["1991-default", "1953-default"]) {
  for (const turn of [48, 72, 96, 238]) {
    for (const sectorType of ["energy", "manufacturing"]) {
      for (const utilization of [0, 0.6, 1, 1.2, 1.3, 1.5]) {
        const sector = {
          sectorId: "synthetic-plant",
          sectorType,
          stateId: "CA",
          countryId: "US",
          strategyId: "standard",
          revenue: 1_000_000,
          capacityUnits: 1_000,
          producedUnits: 1_000 * utilization,
        };
        const units = {
          supplyBySector: new Map<string, Map<CommodityType, number>>(),
          inputDemandBySector: new Map<string, Map<CommodityType, number>>(),
        };
        computeRawSupplyDemand(
          [sector],
          undefined,
          undefined,
          turn,
          undefined,
          undefined,
          false,
          undefined,
          false,
          true,
          1,
          undefined,
          1,
          undefined,
          undefined,
          preset,
          units
        );
        const rates = getEffectiveStrategyRatesForOperatingModel(
          sectorType,
          "standard",
          undefined,
          undefined,
          turn,
          undefined,
          undefined,
          preset
        );
        const bill = computeInputsCost({
          nominalDailyRevenue: sector.revenue,
          rates: rates.demand ?? {},
          basePrices: COMMODITY_BASE_PRICES,
          priceRatios: new Map(),
          utilization,
          productivityMultiplier: energyProductivityMultiplier(sectorType, turn, preset),
          inputMultiplier: 1,
          turnsPerDay: TURNS_PER_DAY,
        });
        if (preset !== "1991-default") {
          // Other presets retain their existing bill. Their older standard-recipe
          // ledger fallback is outside this energy-ramp correction.
          const previousBill = computeInputsCost({
            nominalDailyRevenue: sector.revenue,
            rates: rates.demand ?? {},
            basePrices: COMMODITY_BASE_PRICES,
            priceRatios: new Map(),
            utilization,
            inputMultiplier: 1,
            turnsPerDay: TURNS_PER_DAY,
          });
          assert.deepEqual(bill, previousBill);
          cases.push({ preset, turn, sectorType, utilization });
          continue;
        }
        const booked = units.inputDemandBySector.get(sector.sectorId) ?? new Map();
        const billed = new Map(
          bill.lines.map((line) => [line.commodity, line.units * TURNS_PER_DAY])
        );
        for (const commodity of new Set([...booked.keys(), ...billed.keys()])) {
          assert.ok(
            Math.abs((booked.get(commodity) ?? 0) - (billed.get(commodity) ?? 0)) < 1e-7,
            `${preset} turn ${turn} ${sectorType} at ${utilization}: ${commodity} units disagree`
          );
          checkedLines++;
        }
        cases.push({ preset, turn, sectorType, utilization });
      }
    }
  }
}
console.log(
  JSON.stringify(
    {
      verdict: "passed",
      kind: "1991 ledger and invoice unit reconciliation with unchanged other-preset controls",
      scenarios: cases.length,
      checkedLines,
      limitations:
        "No autonomous behavior, price feedback, finance or production balance qualification.",
    },
    null,
    2
  )
);
