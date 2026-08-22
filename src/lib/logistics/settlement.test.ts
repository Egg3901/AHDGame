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

  it("lets freight capacity congest rather than wall the buyer off", () => {
    const result = settleFreightNetwork(inputs(0.2));

    // 20 units land locally; the rest hauls up to nominal capacity plus the
    // congestion overflow (freight is a cost, not a wall).
    expect(result.deliveredSupplyByCommodity.get("coal")?.get("B")).toBeCloseTo(27.5);
    expect(result.inputAvailabilityByCommodity.get("coal")?.get("B")).toBeCloseTo(0.275);
  });

  it("placedSupplyByCommodity credits a seller only for output that found a buyer", () => {
    const result = settleFreightNetwork(inputs(100));

    // A produced 100 and hauled 80 to B; the remaining 20 met no demand
    // anywhere, so A is credited with 80, not 100.
    expect(result.placedSupplyByCommodity.get("coal")?.get("A")).toBeCloseTo(80);
    // B's own 20 units were consumed at home, which is placement too.
    expect(result.placedSupplyByCommodity.get("coal")?.get("B")).toBeCloseTo(20);
  });

  it("placedSupplyByCommodity falls with the network, not with demand", () => {
    // Demand is identical to the case above; only the freight supply changed.
    // This is the t225 seam in miniature: A's coal is wanted, and A still
    // cannot place it, so the sell side must not be told the market cleared.
    const result = settleFreightNetwork(inputs(0.2));

    expect(result.placedSupplyByCommodity.get("coal")?.get("A")).toBeCloseTo(7.5);
  });

  it("deliveryLimitedSupplyByCommodity separates a starved network from a full market", () => {
    // Same demand in both runs; only the freight supply differs.
    const healthy = settleFreightNetwork(inputs(100));
    const starved = settleFreightNetwork(inputs(0.2));

    // Healthy network: B is fully served, so A's leftover 20 is a glut. Nobody
    // wanted it, and no amount of freight would have changed that.
    expect(healthy.placedSupplyByCommodity.get("coal")?.get("A")).toBeCloseTo(80);
    expect(healthy.deliveryLimitedSupplyByCommodity.get("coal")?.get("A")).toBe(0);

    // Starved network: B is still 72.5 short while A sits on 92.5 unsold.
    // That part, and only that part, is a delivery failure.
    expect(starved.placedSupplyByCommodity.get("coal")?.get("A")).toBeCloseTo(7.5);
    expect(starved.deliveryLimitedSupplyByCommodity.get("coal")?.get("A")).toBeCloseTo(72.5);
  });

  it("treats unshipped commodities as fully placed: no network, no delivery limit", () => {
    // `freight` itself is never hauled. A holds 100 units of it against zero
    // local demand, which is a demand outcome (soldFraction's job) and must not
    // read as a delivery failure.
    const result = settleFreightNetwork(inputs(100));

    expect(result.placedSupplyByCommodity.get("freight")?.get("A")).toBe(100);
    expect(result.placedSupplyByCommodity.get("freight")?.get("B")).toBe(0);
    // And nothing about a commodity with no network can be delivery-limited.
    expect(result.deliveryLimitedSupplyByCommodity.get("freight")?.get("A")).toBe(0);
  });
});
