import { describe, it, expect } from "vitest";
import { computeSupplierCommodityCapacityUnits } from "./supplyAgreementCapacity";
import {
  plantsCapacityScaledUnits,
  commodityMixWeight,
  COMMODITY_BASE_PRICES,
} from "@/lib/constants/commodities";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";

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
