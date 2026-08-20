import { describe, it, expect } from "vitest";
import {
  COUNTRY_COMMODITY_DEMAND_MULTIPLIER,
  countryCommodityDemandMultiplier,
} from "./commodities";

// The demand half of the DD downstream fix (ticket-1072). The mechanism must be
// a PURE per-(country, commodity) lookup defaulting to 1, so that command
// economies with unsellable seeded capacity get their national appetite lifted
// while every market economy and every unlisted pair stays byte-identical.
describe("countryCommodityDemandMultiplier (ticket-1072)", () => {
  it("lifts DD construction_services national demand by 18", () => {
    expect(countryCommodityDemandMultiplier("DD", "construction_services")).toBe(18);
    expect(COUNTRY_COMMODITY_DEMAND_MULTIPLIER.DD?.construction_services).toBe(18);
  });

  it("leaves DD vehicles demand UNCHANGED (deliberately no vehicles multiplier)", () => {
    // vehicles output has no reachable buyer, so inflating its demand would be
    // fictional clearing — the seed fix cut auto capacity instead.
    expect(countryCommodityDemandMultiplier("DD", "vehicles")).toBe(1);
    expect(COUNTRY_COMMODITY_DEMAND_MULTIPLIER.DD?.vehicles).toBeUndefined();
  });

  it("is a no-op for a market economy (US) and for unlisted commodities", () => {
    expect(countryCommodityDemandMultiplier("US", "construction_services")).toBe(1);
    expect(countryCommodityDemandMultiplier("US", "vehicles")).toBe(1);
    expect(countryCommodityDemandMultiplier("US", "steel")).toBe(1);
    // A non-listed commodity for the listed country is still 1.
    expect(countryCommodityDemandMultiplier("DD", "steel")).toBe(1);
    // Undefined country id short-circuits to 1.
    expect(countryCommodityDemandMultiplier(undefined, "construction_services")).toBe(1);
  });

  it("applied to the national demand leg, only DD construction_services changes", () => {
    // Reproduces the byCountry aggregation step in commodityPriceTurn.ts:
    //   countryBal.demand += stateBal.demand * countryCommodityDemandMultiplier(countryId, c)
    const stateDemand = 761.5;
    const apply = (countryId: string, commodity: "construction_services" | "vehicles" | "steel") =>
      stateDemand * countryCommodityDemandMultiplier(countryId, commodity);

    // DD construction lifts ×18; everything else is exactly the pre-change value.
    expect(apply("DD", "construction_services")).toBeCloseTo(stateDemand * 18);
    expect(apply("DD", "vehicles")).toBe(stateDemand);
    expect(apply("DD", "steel")).toBe(stateDemand);
    expect(apply("US", "construction_services")).toBe(stateDemand);
  });
});
