import { describe, it, expect } from "vitest";
import { applyTradeConvergence } from "./convergence";
import { clearAllCommodities, type ByCountryBalances } from "./snapshot";
import { getBaseAffinity } from "./affinity";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

function byCountryOf(
  rows: Array<[CountryId, Partial<Record<CommodityType, [number, number]>>]>
): ByCountryBalances {
  const m: ByCountryBalances = new Map();
  for (const [country, bals] of rows) {
    const inner = new Map<CommodityType, { supply: number; demand: number }>();
    for (const [c, [supply, demand]] of Object.entries(bals) as Array<
      [CommodityType, [number, number]]
    >) {
      inner.set(c, { supply, demand });
    }
    m.set(country, inner);
  }
  return m;
}

const countries: CountryId[] = ["US", "CN"];
const affinityFor = (_c: CommodityType, e: CountryId, i: CountryId) => getBaseAffinity(e, i);

describe("applyTradeConvergence", () => {
  it("is a no-op at k=0", () => {
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0] }],
      ["CN", { steel: [0, 100] }],
    ]);
    const clearing = clearAllCommodities(countries, byCountry, affinityFor);
    applyTradeConvergence(countries, byCountry, clearing, 0);
    expect(byCountry.get("US")!.get("steel")).toEqual({ supply: 100, demand: 0 });
    expect(byCountry.get("CN")!.get("steel")).toEqual({ supply: 0, demand: 100 });
  });

  it("reduces exporter supply and importer demand toward balance at k>0", () => {
    // US surplus 100 steel, CN deficit 100 → cleared 100. k=0.5 relieves half.
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0] }],
      ["CN", { steel: [0, 100] }],
    ]);
    const clearing = clearAllCommodities(countries, byCountry, affinityFor);
    applyTradeConvergence(countries, byCountry, clearing, 0.5);
    // US exported 100 → supply 100 − 0.5×100 = 50.
    expect(byCountry.get("US")!.get("steel")!.supply).toBeCloseTo(50);
    expect(byCountry.get("US")!.get("steel")!.demand).toBe(0);
    // CN imported 100 → demand 100 − 0.5×100 = 50.
    expect(byCountry.get("CN")!.get("steel")!.demand).toBeCloseTo(50);
    expect(byCountry.get("CN")!.get("steel")!.supply).toBe(0);
  });

  it("never drives effective supply or demand negative", () => {
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0] }],
      ["CN", { steel: [0, 100] }],
    ]);
    const clearing = clearAllCommodities(countries, byCountry, affinityFor);
    applyTradeConvergence(countries, byCountry, clearing, 5); // absurd k
    expect(byCountry.get("US")!.get("steel")!.supply).toBeGreaterThanOrEqual(0);
    expect(byCountry.get("CN")!.get("steel")!.demand).toBeGreaterThanOrEqual(0);
  });

  it("leaves balanced commodities untouched", () => {
    const byCountry = byCountryOf([
      ["US", { steel: [50, 50] }],
      ["CN", { steel: [50, 50] }],
    ]);
    const clearing = clearAllCommodities(countries, byCountry, affinityFor);
    applyTradeConvergence(countries, byCountry, clearing, 0.5);
    expect(byCountry.get("US")!.get("steel")).toEqual({ supply: 50, demand: 50 });
  });
});
