import { describe, it, expect } from "vitest";
import {
  computeSupplierCommodityAchievableUnits,
  computeSupplierCommodityCapacityUnits,
} from "./supplyAgreementCapacity";
import {
  plantsCapacityScaledUnits,
  commodityMixWeight,
  COMMODITY_BASE_PRICES,
} from "@/lib/constants/commodities";
import {
  MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR,
  PLANNED_ECONOMY_MEDIA_OUTPUT,
  PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR,
  applyPlannedEconomyOutputMix,
  getEffectiveStrategyRates,
} from "@/lib/constants/sectorStrategies";

describe("computeSupplierCommodityCapacityUnits", () => {
  it("is zero when every plant is mothballed", () => {
    expect(
      computeSupplierCommodityCapacityUnits({
        sectors: [
          {
            sectorType: "manufacturing",
            capitalStock: 10_000,
            mothballed: true,
            productionPolicyLevel: 0,
          },
        ],
        commodity: "steel",
        isNatcorp: false,
        turn: 10,
      })
    ).toBe(0);
  });

  it("matches plantsCapacityScaledUnits times the steel mix weight for a standard mill", () => {
    const capitalStock = 10_000;
    const scaled =
      plantsCapacityScaledUnits({
        capacityUnits: capitalStock,
        isNatcorp: false,
        productionPolicyLevel: 0,
      }) ?? 0;
    const rates = getEffectiveStrategyRates("manufacturing", "standard", null, null, 10);
    const expected = scaled * commodityMixWeight(rates.supply, COMMODITY_BASE_PRICES, "steel");
    expect(
      computeSupplierCommodityCapacityUnits({
        sectors: [
          {
            sectorType: "manufacturing",
            capitalStock,
            strategyId: "standard",
            productionPolicyLevel: 0,
          },
        ],
        commodity: "steel",
        isNatcorp: false,
        turn: 10,
      })
    ).toBeCloseTo(expected, 10);
  });

  it("returns 0 for a commodity the plant does not make", () => {
    expect(
      computeSupplierCommodityCapacityUnits({
        sectors: [
          {
            sectorType: "manufacturing",
            capitalStock: 10_000,
            strategyId: "standard",
            productionPolicyLevel: 0,
          },
        ],
        commodity: "food",
        isNatcorp: false,
        turn: 10,
      })
    ).toBe(0);
  });
});

describe("computeSupplierCommodityCapacityUnits — parity with the production sink", () => {
  // The validator's whole job is to size volumeCap against what the settlement
  // will later credit as produced. Any leg the sink applies and this does not
  // becomes a shortfall the supplier can never close, and damages are assessed
  // on it every turn.
  it("applies the media supply derate the production sink applies", () => {
    const capitalStock = 10_000;
    const scaled =
      plantsCapacityScaledUnits({
        capacityUnits: capitalStock,
        isNatcorp: false,
        productionPolicyLevel: 0,
      }) ?? 0;
    const rates = getEffectiveStrategyRates("media", "standard", null, null, 10);

    const units = computeSupplierCommodityCapacityUnits({
      sectors: [{ sectorType: "media", capitalStock, productionPolicyLevel: 0, countryId: "US" }],
      commodity: "advertising",
      isNatcorp: false,
      turn: 10,
    });

    expect(units).toBeCloseTo(
      scaled *
        commodityMixWeight(rates.supply, COMMODITY_BASE_PRICES, "advertising") *
        MARKET_ECONOMY_MEDIA_SUPPLY_FACTOR,
      4
    );
  });

  it("sizes a command economy's media on what it actually makes", () => {
    const capitalStock = 10_000;
    const scaled =
      plantsCapacityScaledUnits({
        capacityUnits: capitalStock,
        isNatcorp: false,
        productionPolicyLevel: 0,
      }) ?? 0;
    const rates = getEffectiveStrategyRates("media", "standard", null, null, 10);
    const remapped = applyPlannedEconomyOutputMix("media", rates.supply, true);
    const args = {
      sectors: [
        { sectorType: "media" as const, capitalStock, productionPolicyLevel: 0, countryId: "RU" },
      ],
      isNatcorp: false,
      turn: 10,
      currentYear: 1953,
      commandEconomyEnabled: true,
    };

    // It makes state information, so that is what it can contract...
    expect(
      computeSupplierCommodityCapacityUnits({ ...args, commodity: PLANNED_ECONOMY_MEDIA_OUTPUT })
    ).toBeCloseTo(
      scaled *
        commodityMixWeight(remapped, COMMODITY_BASE_PRICES, PLANNED_ECONOMY_MEDIA_OUTPUT) *
        PLANNED_ECONOMY_MEDIA_SUPPLY_FACTOR,
      4
    );
    // ...and it cannot contract advertising, a thing its economy does not sell.
    expect(computeSupplierCommodityCapacityUnits({ ...args, commodity: "advertising" })).toBe(0);
  });
});

describe("computeSupplierCommodityAchievableUnits", () => {
  it("preserves a measured zero ceiling", () => {
    expect(
      computeSupplierCommodityAchievableUnits({
        sectors: [
          {
            sectorType: "manufacturing",
            contractAchievableUnits: 0,
          },
        ],
        commodity: "steel",
        isNatcorp: false,
        turn: 10,
      })
    ).toBe(0);
  });

  it("returns unknown when a contributing sector has no telemetry", () => {
    expect(
      computeSupplierCommodityAchievableUnits({
        sectors: [{ sectorType: "manufacturing" }],
        commodity: "steel",
        isNatcorp: false,
        turn: 10,
      })
    ).toBeNull();
  });
});
