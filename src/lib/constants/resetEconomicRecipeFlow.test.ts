import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES, computeRawSupplyDemand, dollarsToUnits } from "./commodities";
import { computeSectorCommodityUnits } from "@/lib/corporations/corpCommodityFlows";
import { computeSupplyAgreementBuyerDemand } from "@/lib/turn/corporation/settleSupplyAgreements";
import { getEffectiveStrategyRates } from "./sectorStrategies";
import { computeInputsCost } from "@/lib/corporations/physicalPnl";

// Exercise all demand consumers, including the production ledger's legacy
// standard-recipe fallback, on a partially utilized plant.
describe("1991 input rails agree while legacy presets retain their original values", () => {
  it.each([
    ["1953-default", 0.15, 0.18],
    ["1991-default", 0.16, 0.16],
    ["2019-default", 0.15, 0.18],
  ] as const)(
    "uses the qualified %s input basket on all rails",
    (preset, ledgerEnergyRate, energyRate) => {
      const sector = {
        sectorType: "manufacturing" as const,
        strategyId: "standard",
        stateId: "HOST",
        corporationId: "corp",
        revenue: 100_000,
        revenueAnchor: 100_000,
        producedUnits: 60,
        capacityUnits: 100,
      };
      const expected = dollarsToUnits(100_000 * energyRate, COMMODITY_BASE_PRICES.energy) * 0.6;
      const ledger = computeRawSupplyDemand(
        [sector],
        undefined,
        undefined,
        49,
        undefined,
        undefined,
        false,
        undefined,
        false,
        true,
        1,
        undefined,
        0,
        COMMODITY_BASE_PRICES,
        undefined,
        preset
      );
      const display = computeSectorCommodityUnits(sector, 49, { plantsEnabled: true, preset });
      const contracts = computeSupplyAgreementBuyerDemand({
        sectors: [sector],
        currentTurn: 49,
        unitScale: 1,
        plantsEnabled: true,
        preset,
      });
      expect(ledger.productionInputDemandByState.get("HOST")?.get("energy")).toBeCloseTo(
        dollarsToUnits(100_000 * ledgerEnergyRate, COMMODITY_BASE_PRICES.energy) * 0.6,
        8
      );
      expect(display.demand.get("energy")).toBeCloseTo(expected, 8);
      expect(contracts.get("corp")?.get("energy")).toBeCloseTo(expected, 8);
    }
  );
});

describe("phased hardware demand reaches all physical input rails", () => {
  it.each([0, 1, 6, 12, 24])(
    "keeps ledger, contracts, display and bill aligned after %i turns",
    (elapsed) => {
      const turn = 219 + elapsed;
      const sector = {
        sectorType: "technology" as const,
        strategyId: "hardware",
        stateId: "HOST",
        corporationId: "corp",
        revenue: 100_000,
        revenueAnchor: 100_000,
        producedUnits: 60,
        capacityUnits: 100,
      };
      const ledger = computeRawSupplyDemand(
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
        0,
        COMMODITY_BASE_PRICES,
        undefined,
        "1991-default",
        undefined,
        undefined,
        0,
        219
      );
      const context = {
        plantsEnabled: true,
        preset: "1991-default",
        hardwareInputReliefStartTurn: 219,
      };
      const display = computeSectorCommodityUnits(sector, turn, context);
      const contracts = computeSupplyAgreementBuyerDemand({
        sectors: [sector],
        currentTurn: turn,
        unitScale: 1,
        ...context,
      });
      const rates = getEffectiveStrategyRates(
        "technology",
        "hardware",
        null,
        null,
        turn,
        undefined,
        "1991-default",
        219
      );
      const bill = computeInputsCost({
        nominalDailyRevenue: 100_000,
        rates: rates.demand,
        basePrices: COMMODITY_BASE_PRICES,
        priceRatios: new Map(),
        utilization: 0.6,
        inputMultiplier: 1,
        turnsPerDay: 24,
      });
      for (const line of bill.lines) {
        const expectedDailyUnits = line.units * 24;
        expect(ledger.productionInputDemandByState.get("HOST")?.get(line.commodity)).toBeCloseTo(
          expectedDailyUnits,
          8
        );
        expect(display.demand.get(line.commodity)).toBeCloseTo(expectedDailyUnits, 8);
        expect(contracts.get("corp")?.get(line.commodity)).toBeCloseTo(expectedDailyUnits, 8);
      }
    }
  );
});
