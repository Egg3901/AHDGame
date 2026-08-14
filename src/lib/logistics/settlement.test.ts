import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { settleFreightNetwork } from "./settlement";

function balances(
  entries: Array<[string, Partial<Record<CommodityType, { supply: number; demand: number }>>]>
) {
  return new Map(
    entries.map(([stateId, values]) => [
      stateId,
      new Map(Object.entries(values) as Array<[CommodityType, { supply: number; demand: number }]>),
    ])
  );
}

function inputs(freightSupply: number) {
  return {
    states: [
      { stateId: "A", countryId: "US" as const },
      { stateId: "B", countryId: "US" as const },
    ],
    byState: balances([
      ["A", { coal: { supply: 100, demand: 0 }, freight: { supply: freightSupply, demand: 0 } }],
      ["B", { coal: { supply: 20, demand: 100 }, freight: { supply: 0, demand: 0 } }],
    ]),
    byCountry: new Map([
      [
        "US",
        new Map([
          ["coal" as CommodityType, { supply: 120, demand: 100 }],
          ["freight" as CommodityType, { supply: freightSupply, demand: 0 }],
        ]),
      ],
    ]),
    statePricesFor: () => ({ A: 100, B: 100 }),
    nationalPricesFor: () => ({}),
    basePriceFor: () => 100,
    freightPrice: 10,
    hops: () => 1,
    tariffRatePct: () => 0,
    isBlocked: () => false,
  };
}

describe("settleFreightNetwork", () => {
  it("turns an interstate route into local delivered input availability", () => {
    const result = settleFreightNetwork(inputs(100));

    expect(result.deliveredSupplyByCommodity.get("coal")?.get("B")).toBe(100);
    expect(result.inputAvailabilityByCommodity.get("coal")?.get("B")).toBe(1);
    expect(result.sourcing.flows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originId: "A", destStateId: "B", units: 80 }),
      ])
    );
  });

  it("makes freight capacity, rather than the origin's spare coal, bind the buyer", () => {
    const result = settleFreightNetwork(inputs(0.2));

    expect(result.deliveredSupplyByCommodity.get("coal")?.get("B")).toBeCloseTo(23.5);
    expect(result.inputAvailabilityByCommodity.get("coal")?.get("B")).toBeCloseTo(0.235);
  });
});
