import { describe, it, expect } from "vitest";
import { buildTradeFlowSnapshot, type TradeSnapshotInput } from "./snapshot";
import { getBaseAffinity } from "./affinity";
import type { CommodityType } from "@/lib/constants/commodities";
import type { CountryId } from "@/lib/constants/countries";

/** Build a byCountry map with the given per-commodity supply/demand. */
function byCountryOf(
  rows: Array<[CountryId, Partial<Record<CommodityType, [number, number]>>]>
): Map<string, Map<CommodityType, { supply: number; demand: number }>> {
  const m = new Map<string, Map<CommodityType, { supply: number; demand: number }>>();
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

const NOW = new Date("2026-06-16T00:00:00Z");

const baseInput = (
  byCountry: ReturnType<typeof byCountryOf>,
  nationalPrices: Map<CommodityType, Record<string, number>>,
  globalPrices: Map<CommodityType, number>,
  countries: CountryId[]
): TradeSnapshotInput => ({
  countries,
  byCountry,
  nationalPrices,
  globalPrices,
  affinityFor: (_c, e, i) => getBaseAffinity(e, i),
  turn: 412,
  now: NOW,
});

describe("buildTradeFlowSnapshot", () => {
  it("values a single steel flow in ₳ (units × exporter price)", () => {
    // US surplus 100 steel, CN deficit 100 steel; price $800.
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0] }],
      ["CN", { steel: [0, 100] }],
    ]);
    const nationalPrices = new Map<CommodityType, Record<string, number>>([
      ["steel", { US: 800, CN: 800 }],
    ]);
    const globalPrices = new Map<CommodityType, number>([["steel", 800]]);
    const snap = buildTradeFlowSnapshot(
      baseInput(byCountry, nationalPrices, globalPrices, ["US", "CN"])
    );

    expect(snap.turn).toBe(412);
    expect(snap.updatedAt).toBe(NOW);
    const steel = snap.commodities.steel!;
    expect(steel.flow.US.CN).toBeCloseTo(100 * 800); // 80,000 ₳
    expect(steel.perCountry.US.exports).toBeCloseTo(80000);
    expect(steel.perCountry.US.net).toBeCloseTo(80000);
    expect(steel.perCountry.CN.imports).toBeCloseTo(80000);
    expect(steel.perCountry.CN.net).toBeCloseTo(-80000);
    expect(steel.worldVolume).toBeCloseTo(80000);
  });

  it("rolls national totals across commodities and picks top partners", () => {
    // US exports steel to CN; CN exports electronics to US (smaller).
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0], electronics: [0, 50] }],
      ["CN", { steel: [0, 100], electronics: [50, 0] }],
    ]);
    const nationalPrices = new Map<CommodityType, Record<string, number>>([
      ["steel", { US: 800, CN: 800 }],
      ["electronics", { US: 500, CN: 500 }],
    ]);
    const globalPrices = new Map<CommodityType, number>([
      ["steel", 800],
      ["electronics", 500],
    ]);
    const snap = buildTradeFlowSnapshot(
      baseInput(byCountry, nationalPrices, globalPrices, ["US", "CN"])
    );

    // US: exports 80,000 steel, imports 25,000 electronics → net +55,000.
    expect(snap.national.US!.exports).toBeCloseTo(80000);
    expect(snap.national.US!.imports).toBeCloseTo(25000);
    expect(snap.national.US!.net).toBeCloseTo(55000);
    expect(snap.national.CN!.net).toBeCloseTo(-55000);
    // Top partner for US by bilateral net is CN (surplus side).
    expect(snap.national.US!.topPartnerSurplus?.countryId).toBe("CN");
    expect(snap.national.CN!.topPartnerDeficit?.countryId).toBe("US");
  });

  it("computes world totals with uncleared surplus", () => {
    // US surplus 100 steel, CN deficit 40 → cleared 40, leftover surplus 60.
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0] }],
      ["CN", { steel: [0, 40] }],
    ]);
    const nationalPrices = new Map<CommodityType, Record<string, number>>([
      ["steel", { US: 800, CN: 800 }],
    ]);
    const globalPrices = new Map<CommodityType, number>([["steel", 800]]);
    const snap = buildTradeFlowSnapshot(
      baseInput(byCountry, nationalPrices, globalPrices, ["US", "CN"])
    );

    expect(snap.world.clearedVolume).toBeCloseTo(40 * 800); // 32,000
    expect(snap.world.unclearedSurplus).toBeCloseTo(60 * 800); // 48,000
    expect(snap.world.grossVolume).toBeCloseTo(100 * 800); // 80,000
  });

  it("values imports at the exporter price so exports and imports conserve", () => {
    // US exports steel to CN at the US price ($800). CN's own steel price is
    // different ($900) — but the imported value must equal the traded (exporter)
    // value, so world exports == world imports.
    const byCountry = byCountryOf([
      ["US", { steel: [100, 0] }],
      ["CN", { steel: [0, 100] }],
    ]);
    const nationalPrices = new Map<CommodityType, Record<string, number>>([
      ["steel", { US: 800, CN: 900 }],
    ]);
    const globalPrices = new Map<CommodityType, number>([["steel", 800]]);
    const snap = buildTradeFlowSnapshot(
      baseInput(byCountry, nationalPrices, globalPrices, ["US", "CN"])
    );
    const steel = snap.commodities.steel!;
    expect(steel.flow.US.CN).toBeCloseTo(100 * 800);
    expect(steel.perCountry.US.exports).toBeCloseTo(80000);
    expect(steel.perCountry.CN.imports).toBeCloseTo(80000); // exporter price, not 90,000
    expect(snap.national.US!.exports).toBeCloseTo(snap.national.CN!.imports);
    expect(snap.world.clearedVolume).toBeCloseTo(80000);
  });

  it("falls back to the global price when a national price is missing", () => {
    const byCountry = byCountryOf([
      ["US", { steel: [10, 0] }],
      ["CN", { steel: [0, 10] }],
    ]);
    const nationalPrices = new Map<CommodityType, Record<string, number>>([["steel", {}]]);
    const globalPrices = new Map<CommodityType, number>([["steel", 800]]);
    const snap = buildTradeFlowSnapshot(
      baseInput(byCountry, nationalPrices, globalPrices, ["US", "CN"])
    );
    expect(snap.commodities.steel!.flow.US.CN).toBeCloseTo(10 * 800);
  });

  it("omits commodities with no trade", () => {
    const byCountry = byCountryOf([
      ["US", { steel: [50, 50] }],
      ["CN", { steel: [50, 50] }],
    ]);
    const nationalPrices = new Map<CommodityType, Record<string, number>>([
      ["steel", { US: 800, CN: 800 }],
    ]);
    const globalPrices = new Map<CommodityType, number>([["steel", 800]]);
    const snap = buildTradeFlowSnapshot(
      baseInput(byCountry, nationalPrices, globalPrices, ["US", "CN"])
    );
    expect(snap.commodities.steel).toBeUndefined();
    expect(snap.world.clearedVolume).toBe(0);
  });
});
