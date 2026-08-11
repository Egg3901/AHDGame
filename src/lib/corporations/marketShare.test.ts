import { describe, it, expect, vi } from "vitest";
import {
  effectiveMarketAnchor,
  computeMarketSharePercent,
  gdpDerivedMarketAnchor,
  buildMarketShareBySectorId,
  effectiveMarketUnits,
  sectorCapacityUnits,
  marketUnitsFromAnchor,
} from "./marketShare";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporationType } from "@/lib/constants/corporations";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporateSector, UnownedSector } from "@/lib/db/types";
import {
  computeUnownedHeadroomUnits,
  computeSectorImpliedUnits,
  unownedHeadroomUnitsPerAnchor,
} from "@/lib/market/unownedHeadroom";
import { CAPITAL_SEED_HEADROOM } from "@/lib/market/capital";

describe("effectiveMarketAnchor", () => {
  it("with a persisted unowned pool, the market is owned + unowned", () => {
    expect(effectiveMarketAnchor(800, 200, 50)).toBe(1000);
  });

  it("with a low owned total and no unowned doc, the GDP floor applies", () => {
    expect(effectiveMarketAnchor(30, undefined, 100)).toBe(100);
  });

  // Bug #0775: when a sector-wide nationalization consumes the unowned pool doc,
  // the market fell back to the small GDP floor even though the consolidated
  // owned revenue dwarfed it — producing market shares well over 100%. The
  // effective market can never be smaller than what is already owned in it.
  it("without an unowned doc, the market is never below total owned revenue", () => {
    expect(effectiveMarketAnchor(1000, undefined, 100)).toBe(1000);
  });
});

describe("computeMarketSharePercent over the corrected market", () => {
  it("a sole owner with no unowned doc reads 100%, not >100%", () => {
    const market = effectiveMarketAnchor(1000, undefined, 100);
    expect(computeMarketSharePercent(1000, market)).toBe(100);
  });
});

describe("gdpDerivedMarketAnchor with an unrecognized countryId", () => {
  // Incident 2026-07-22: a sandbox corp/state kept the pre-rename "BY" Belarus
  // code after 348fcf61b renamed it to "BLR" without a data migration.
  // getCountryConfig("BY") returned undefined, and this function crashed on
  // .usdExchangeRate — inside a per-corp/per-sector turn loop, so it took
  // down corporationTurn for every corporation in the world, not just Belarus's.
  it("falls back instead of throwing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => gdpDerivedMarketAnchor(1000, "BY" as CountryId)).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("uses usdExchangeRate=1 as the fallback rate", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Same formula as a recognized country with usdExchangeRate exactly 1 (e.g. US).
    expect(gdpDerivedMarketAnchor(1000, "BY" as CountryId)).toBe(
      gdpDerivedMarketAnchor(1000, "US")
    );
    vi.restoreAllMocks();
  });
});

/* ------------------------------------------------------------------ *
 * Plants tier (buildable-sectors P2 §5, decision D8): market share on the
 * owned-capacity basis instead of revenue.
 * ------------------------------------------------------------------ */

describe("plants tier — unit-denominated market share", () => {
  const STATE_ID = "S1";
  const TYPE: CorporationType = "energy";

  const state = { _id: STATE_ID, gdp: 0, countryId: "US" as CountryId };
  const stateById = (gdp = 0) => new Map([[STATE_ID, { ...state, gdp }]]);
  const fx = new Map<CurrencyCode, number>([["USD" as CurrencyCode, 1]]);

  const sector = (id: string, revenue: number, capitalStock?: number): CorporateSector =>
    ({
      _id: id,
      stateId: STATE_ID,
      sectorType: TYPE,
      countryId: "US",
      revenue,
      capitalStock,
    }) as unknown as CorporateSector;

  const unowned = (revenue: number, headroomUnits?: number): UnownedSector =>
    ({ stateId: STATE_ID, sectorType: TYPE, revenue, headroomUnits }) as unknown as UnownedSector;

  const build = (
    sectors: CorporateSector[],
    unownedSectors: UnownedSector[],
    opts: { plantsEnabled?: boolean; gdp?: number } = {}
  ) =>
    buildMarketShareBySectorId({
      sectors,
      stateById: stateById(opts.gdp ?? 0),
      unownedSectors,
      exchangeRatesByCurrency: fx,
      plantsEnabled: opts.plantsEnabled,
    });

  it("shares are ownedCapacityUnits / (Σ capacity + headroomUnits)", () => {
    // Capacities 300 + 100, headroom 100 → market 500 units.
    const shares = build(
      [sector("a", 1_000_000, 300), sector("b", 1, 100)],
      [unowned(999_999, 100)],
      { plantsEnabled: true }
    );
    expect(shares.get("a")).toBeCloseTo(60, 10);
    expect(shares.get("b")).toBeCloseTo(20, 10);
  });

  it("(a) a sector with no capitalStock contributes revenue-implied units", () => {
    const impliedB = computeUnownedHeadroomUnits(TYPE, 1000, 1);
    const shares = build([sector("a", 1, 300), sector("b", 1000)], [unowned(0, 100)], {
      plantsEnabled: true,
    });
    const market = 300 + impliedB + 100;
    expect(shares.get("a")).toBeCloseTo((300 / market) * 100, 10);
    expect(shares.get("b")).toBeCloseTo((impliedB / market) * 100, 10);
  });

  it("(b) an unowned doc with no headroomUnits derives headroom from its revenue", () => {
    const derivedHeadroom = computeUnownedHeadroomUnits(TYPE, 2000, 1);
    const shares = build([sector("a", 1, 300)], [unowned(2000)], { plantsEnabled: true });
    expect(shares.get("a")).toBeCloseTo((300 / (300 + derivedHeadroom)) * 100, 10);
  });

  it("(c) falls back to the legacy revenue path when no units can be derived", () => {
    // Degenerate market: nothing owned, no unowned doc, no GDP → the unit
    // denominator is 0, so the bucket is scored on the legacy basis instead of
    // producing NaN/Infinity.
    expect(effectiveMarketUnits(0, undefined, 0)).toBe(0);
    const plants = build([sector("a", 0)], [], { plantsEnabled: true });
    const legacy = build([sector("a", 0)], []);
    expect(plants.get("a")).toBe(legacy.get("a"));
    expect(Number.isFinite(plants.get("a")!)).toBe(true);
  });

  it("the GDP floor still applies, converted to the same unit basis", () => {
    // No unowned doc → floor = GDP-derived market anchor, in units.
    const gdp = 1_000_000;
    const gdpAnchor = gdpDerivedMarketAnchor(gdp, "US");
    const floorUnits = computeUnownedHeadroomUnits(TYPE, gdpAnchor, 1);
    const shares = build([sector("a", 1, 5)], [], { plantsEnabled: true, gdp });
    expect(floorUnits).toBeGreaterThan(5);
    expect(shares.get("a")).toBeCloseTo((5 / floorUnits) * 100, 10);
  });

  it("never exceeds 100% when one owner holds all capacity and there is no unowned doc", () => {
    const shares = build([sector("a", 1000, 500)], [], { plantsEnabled: true, gdp: 0 });
    expect(shares.get("a")).toBe(100);
  });

  // Rank preservation matters more than absolute values: the dominance
  // growth-cost multiplier is banded, so what must not change across the flip
  // is the ORDER of sectors within a market.
  it("preserves ordering vs the revenue basis when capacity ∝ revenue", () => {
    const revenues = [900, 150, 4000, 30, 1200];
    const sectors = revenues.map((r, i) =>
      // Mixed estate: even indices already flipped (capitalStock seeded at the
      // flip identity, implied units × headroom), odd indices not yet flipped
      // (fallback (a) derives the same implied units).
      sector(
        `s${i}`,
        r,
        i % 2 === 0 ? computeUnownedHeadroomUnits(TYPE, r, 1) * CAPITAL_SEED_HEADROOM : undefined
      )
    );
    const unownedDocs = [unowned(2000, computeUnownedHeadroomUnits(TYPE, 2000, 1))];
    const unitShares = build(sectors, unownedDocs, { plantsEnabled: true });
    const revShares = build(sectors, unownedDocs);
    const order = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order(unitShares)).toEqual(order(revShares));
  });

  it("is byte-identical to the legacy path when plants is off (default)", () => {
    const sectors = [sector("a", 1000, 5), sector("b", 3000, 900)];
    const unownedDocs = [unowned(500, 42)];
    const withDefault = build(sectors, unownedDocs);
    const explicitOff = build(sectors, unownedDocs, { plantsEnabled: false });
    // Legacy revenue math: market = 1000 + 3000 + 500.
    expect(withDefault.get("a")).toBeCloseTo((1000 / 4500) * 100, 10);
    expect(withDefault.get("b")).toBeCloseTo((3000 / 4500) * 100, 10);
    expect([...explicitOff.entries()]).toEqual([...withDefault.entries()]);
  });
});

// A flipped sector's `capitalStock` is seeded from its OWN strategy's supply mix
// (seedCapitalStock -> getEffectiveStrategyRates). Converting an UNFLIPPED
// sibling's revenue through the DEFAULT "standard" mix therefore compared two
// different unit bases. For a focused specialist the gap is not a rounding
// error: at extraction, standard implies ~11.2 units per 1000 ₳ while
// rare_earth_mining implies ~0.034 — a ~327x understatement of that sector's
// share. This is a live defect under plants, not a cosmetic one.
describe("sectorCapacityUnits — strategy-aware revenue conversion", () => {
  const REVENUE = 1000;

  it("converts an unflipped sector on its own strategy mix, not the default", () => {
    const own = sectorCapacityUnits("extraction", undefined, REVENUE, "rare_earth_mining", 1);
    const asDefault = sectorCapacityUnits("extraction", undefined, REVENUE, "standard", 1);

    expect(own).toBeCloseTo(
      computeSectorImpliedUnits("extraction", REVENUE, "rare_earth_mining", 1),
      8
    );
    expect(own).not.toBeCloseTo(asDefault, 8);
    // The specialist's mix is far narrower than the generic one.
    expect(own).toBeLessThan(asDefault);
  });

  it("matches the basis capitalStock was seeded on for the same strategy", () => {
    // A flipped sector reports its stored capacity verbatim; an unflipped one
    // must land on the same unit scale so the two are summable.
    const flipped = sectorCapacityUnits("extraction", 500, REVENUE, "oil_gas", 1);
    expect(flipped).toBe(500);

    const unflipped = sectorCapacityUnits("extraction", undefined, REVENUE, "oil_gas", 1);
    expect(unflipped).toBeCloseTo(
      computeSectorImpliedUnits("extraction", REVENUE, "oil_gas", 1),
      8
    );
  });

  it("falls back to the default mix when strategyId is absent or unknown", () => {
    const viaDefault = computeSectorImpliedUnits("extraction", REVENUE, "standard", 1);
    expect(sectorCapacityUnits("extraction", undefined, REVENUE, null, 1)).toBeCloseTo(
      viaDefault,
      8
    );
    expect(sectorCapacityUnits("extraction", undefined, REVENUE, undefined, 1)).toBeCloseTo(
      viaDefault,
      8
    );
    // getStrategy falls back to the type's first strategy for an unknown id.
    expect(
      sectorCapacityUnits("extraction", undefined, REVENUE, "no_such_strategy", 1)
    ).toBeGreaterThan(0);
  });

  // The denominator side is deliberately NOT strategy-aware: neither the GDP
  // floor nor an unowned pool is a specific operator, so converting them through
  // some particular sector's specialism would make the market size depend on
  // which sector happened to be asking.
  it("leaves the GDP floor and unowned headroom on the generic default mix", () => {
    expect(marketUnitsFromAnchor("extraction", REVENUE, 1)).toBeCloseTo(
      computeSectorImpliedUnits("extraction", REVENUE, "standard", 1),
      8
    );
    expect(computeUnownedHeadroomUnits("extraction", REVENUE, 1)).toBeCloseTo(
      computeSectorImpliedUnits("extraction", REVENUE, "standard", 1),
      8
    );
  });
});

// headroomUnits is maintained inside Mongo update pipelines (where the JS helper
// cannot run) by multiplying revenue by a per-anchor constant. That is only
// sound because impliedOutputUnits is strictly linear in revenue.
describe("unownedHeadroomUnitsPerAnchor", () => {
  it("reproduces computeUnownedHeadroomUnits by simple multiplication", () => {
    for (const type of ["extraction", "manufacturing"] as CorporationType[]) {
      const k = unownedHeadroomUnitsPerAnchor(type, 1);
      for (const revenue of [1, 250, 10_000, 987_654]) {
        expect(revenue * k).toBeCloseTo(computeUnownedHeadroomUnits(type, revenue, 1), 6);
      }
    }
  });
});
