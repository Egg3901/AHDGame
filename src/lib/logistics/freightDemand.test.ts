import { describe, expect, it } from "vitest";
import { COMMODITY_BASE_PRICES, type CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";
import { computeClearingFactors } from "@/lib/market/clearing";
import { applyFreightHaulDemand } from "./freightDemand";
import { runSourcingPass } from "./sourcing";

type Balance = { supply: number; demand: number };

const bal = (supply: number, demand: number): Balance => ({ supply, demand });

function freightMap(supply: number, demand: number): Map<CommodityType, Balance> {
  return new Map<CommodityType, Balance>([["freight", bal(supply, demand)]]);
}

describe("applyFreightHaulDemand", () => {
  it("books haul TEU into state, country and global freight demand", () => {
    const global = freightMap(1000, 500);
    const byState = new Map([
      ["NY", freightMap(100, 40)],
      ["CA", freightMap(200, 10)],
    ]);
    const byCountry = new Map([["US", freightMap(300, 50)]]);
    const stateToCountry = new Map([
      ["NY", "US"],
      ["CA", "US"],
    ]);

    applyFreightHaulDemand(
      new Map([
        ["NY", { bulk: 3, special: 1, grid: 0 }],
        ["CA", { bulk: 0, special: 0.5, grid: 0 }],
      ]),
      { global, byState, byCountry, stateToCountry }
    );

    expect(byState.get("NY")!.get("freight")!.demand).toBe(44);
    expect(byState.get("CA")!.get("freight")!.demand).toBe(10.5);
    expect(byCountry.get("US")!.get("freight")!.demand).toBe(54.5);
    expect(global.get("freight")!.demand).toBe(504.5);
    // Supply untouched everywhere.
    expect(byState.get("NY")!.get("freight")!.supply).toBe(100);
    expect(global.get("freight")!.supply).toBe(1000);
  });

  it("skips zero haul and tolerates missing state or country entries", () => {
    const global = freightMap(10, 10);
    const byState = new Map<string, Map<CommodityType, Balance>>();
    const byCountry = new Map<string, Map<CommodityType, Balance>>();
    const stateToCountry = new Map<string, string>();

    applyFreightHaulDemand(
      new Map([
        ["ZZ", { bulk: 2, special: 0, grid: 0 }],
        ["YY", { bulk: 0, special: 0, grid: 0 }],
      ]),
      { global, byState, byCountry, stateToCountry }
    );

    // Global still sees the haul from the unknown state; nothing throws.
    expect(global.get("freight")!.demand).toBe(12);
  });

  it("books NY's price-tolerant haul need into the NY freight book", () => {
    const nyFreightSupply = 10;
    const cargoUnits = 2500;
    const byState = new Map([
      [
        "NY",
        new Map<CommodityType, Balance>([
          ["coal", bal(cargoUnits, 0)],
          ["freight", bal(nyFreightSupply, 0)],
        ]),
      ],
      [
        "NJ",
        new Map<CommodityType, Balance>([
          ["coal", bal(0, cargoUnits)],
          ["freight", bal(0, 0)],
        ]),
      ],
    ]);
    const byCountry = new Map([
      [
        "US",
        new Map<CommodityType, Balance>([
          ["coal", bal(cargoUnits, cargoUnits)],
          ["freight", bal(nyFreightSupply, 0)],
        ]),
      ],
    ]);
    const global = new Map<CommodityType, Balance>([
      ["coal", bal(cargoUnits, cargoUnits)],
      ["freight", bal(nyFreightSupply, 0)],
    ]);
    const stateToCountry = new Map([
      ["NY", "US"],
      ["NJ", "US"],
    ]);

    const sourcing = runSourcingPass({
      states: [
        { stateId: "NY", countryId: "US" as CountryId },
        { stateId: "NJ", countryId: "US" as CountryId },
      ],
      byState,
      byCountry,
      statePricesFor: () => ({ NY: 100, NJ: 100 }),
      nationalPricesFor: () => ({ US: 100 }),
      basePriceFor: () => 100,
      freightPrice: 100,
      hops: (_country, from, to) => (from === to ? 0 : 1),
      tariffRatePct: () => 0,
      isBlocked: () => false,
    });
    expect(sourcing.deliveryLimitedSupplyByState.get("coal")?.get("NY")).toBeGreaterThan(0);

    // Consumed load is only 15 TEU, while the price-tolerant NY request is
    // 2,500 bulk units * 0.04 TEU * 1 hop = 100 TEU.
    expect(sourcing.freightTeuByState.get("NY")!.bulk).toBeCloseTo(15);
    applyFreightHaulDemand(sourcing.freightDemandTeuByState, {
      global,
      byState,
      byCountry,
      stateToCountry,
    });

    expect(byState.get("NY")!.get("freight")!.demand).toBeCloseTo(100);

    // A measured offer is deliberately larger than the lagged supply ledger,
    // reproducing the realUnits exemption's amplification of a thin booking.
    // The local seller must still clear against the full NY freight request.
    const clearing = computeClearingFactors({
      sectors: [
        {
          sectorId: "ny-logistics",
          revenue: 0,
          producedUnits: 100,
          supplyRates: { freight: 1 },
          posture: 0,
        },
      ],
      balances: global,
      priceRatioByCommodity: new Map([["freight", 1]]),
      basePrices: COMMODITY_BASE_PRICES,
      plantsEnabled: true,
      stateMarkets: {
        stateBySector: new Map([["ny-logistics", "NY"]]),
        balances: byState,
        priceRatios: new Map(),
      },
    });
    expect(clearing.get("ny-logistics")!.soldByCommodity?.freight).toBeCloseTo(1);
  });

  it("clears a proportional share of NY freight against NY haul demand", () => {
    const global = freightMap(100, 0);
    const byState = new Map([["NY", freightMap(100, 0)]]);
    const byCountry = new Map([["US", freightMap(100, 0)]]);

    applyFreightHaulDemand(new Map([["NY", { bulk: 40, special: 0, grid: 0 }]]), {
      global,
      byState,
      byCountry,
      stateToCountry: new Map([["NY", "US"]]),
    });

    const clearing = computeClearingFactors({
      sectors: [
        {
          sectorId: "ny-logistics",
          revenue: 0,
          producedUnits: 100,
          supplyRates: { freight: 1 },
          posture: 0,
        },
      ],
      balances: global,
      priceRatioByCommodity: new Map([["freight", 1]]),
      basePrices: COMMODITY_BASE_PRICES,
      plantsEnabled: true,
      stateMarkets: {
        stateBySector: new Map([["ny-logistics", "NY"]]),
        balances: byState,
        priceRatios: new Map(),
      },
    });

    expect(byState.get("NY")!.get("freight")!.demand).toBe(40);
    expect(clearing.get("ny-logistics")!.soldByCommodity?.freight).toBeCloseTo(0.4);
  });
});
