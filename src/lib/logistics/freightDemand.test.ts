import { describe, expect, it } from "vitest";
import type { CommodityType } from "@/lib/constants/commodities";
import { applyFreightHaulDemand } from "./freightDemand";

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
});
