import { describe, expect, it } from "vitest";

import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  CAPACITY_REVENUE_PER_WORKER,
  CAPACITY_SECTOR_TYPES,
  capacityEraLaborIndex,
  capacityEraPriceIndex,
  capacityPricePerUnit,
  capacityUnitYield,
  defaultSupplyRates,
  laborIntensity,
  revenuePerCapacityUnit,
} from "./capacityEconomy";
import {
  CORPORATION_TYPES,
  GROWTH_COST_MULTIPLIER,
  calculateWorkers,
  type CorporationType,
} from "./corporations";
import { COMMODITY_BASE_PRICES, type CommodityType } from "./commodities";
import { impliedOutputUnits } from "@/lib/market/capital";
import { eraLaborMultiplier } from "@/lib/labour/laborCost";

/**
 * Expected values are recomputed here FROM THE SAME SOURCE TABLES the live
 * economy uses (`impliedOutputUnits` over `COMMODITY_BASE_PRICES`,
 * `calculateWorkers`, `GROWTH_COST_MULTIPLIER`) — never copied literals — so a
 * drift in the base tables moves test and implementation together and only a
 * genuine break in the identity fails.
 */

/** Sectors the phase brief names explicitly. */
const ANCHOR_SECTORS: CorporationType[] = ["manufacturing", "retail", "extraction"];

/** Arbitrary reference revenue; every identity below is scale-free in it. */
const REF_REVENUE = 1_000_000;

/** Units the live engine implies for REF_REVENUE on a sector's default mix. */
function liveImpliedUnits(sectorType: CorporationType): number {
  return impliedOutputUnits(REF_REVENUE, defaultSupplyRates(sectorType), COMMODITY_BASE_PRICES, 1);
}

describe("capacityEconomy — source-table wiring", () => {
  it("prices every sector against a real, ungated default output mix", () => {
    for (const type of CORPORATION_TYPES) {
      const supply = defaultSupplyRates(type);
      const commodities = Object.keys(supply) as CommodityType[];
      expect(commodities.length, `${type} has no default supply mix`).toBeGreaterThan(0);
      for (const c of commodities) {
        expect(COMMODITY_BASE_PRICES[c], `${type}/${c} has no base price`).toBeGreaterThan(0);
      }
    }
  });

  it("CAPACITY_REVENUE_PER_WORKER matches calculateWorkers' live behavior", () => {
    // calculateWorkers is neutral (skillMultiplier = 1) at workforceSkill 50.
    expect(calculateWorkers(CAPACITY_REVENUE_PER_WORKER * 1_000, 50)).toBe(1_000);
  });

  it("capacityUnitYield is exactly impliedOutputUnits' per-revenue slope", () => {
    for (const type of CORPORATION_TYPES) {
      expect(capacityUnitYield(type, 1)).toBeCloseTo(liveImpliedUnits(type) / REF_REVENUE, 12);
    }
  });

  it("revenuePerCapacityUnit is the reciprocal unit yield, not the arithmetic mix", () => {
    for (const type of CORPORATION_TYPES) {
      expect(revenuePerCapacityUnit(type, 1)).toBeCloseTo(REF_REVENUE / liveImpliedUnits(type), 6);
    }
  });
});

describe("identity A (labour): workers per unit/day of capacity", () => {
  it.each(ANCHOR_SECTORS)(
    "%s at the anchor year equals calculateWorkers ÷ impliedOutputUnits",
    (type) => {
      const workers = calculateWorkers(REF_REVENUE, 50); // neutral skill ⇒ mult 1
      const units = liveImpliedUnits(type);
      const expected = workers / units;

      expect(laborIntensity(type, CAPACITY_ANCHOR_YEAR, 1)).toBeCloseTo(expected, 6);
    }
  );

  it("is scale-free in the representative revenue", () => {
    // The Δrevenue cancels out of workers ÷ units, so any reference revenue
    // reproduces the same anchor. Rounding in calculateWorkers is why this uses
    // the unrounded revenue/REVENUE_PER_WORKER form directly.
    for (const type of ANCHOR_SECTORS) {
      for (const revenue of [10_000, REF_REVENUE, 100 * REF_REVENUE]) {
        const units = impliedOutputUnits(
          revenue,
          defaultSupplyRates(type),
          COMMODITY_BASE_PRICES,
          1
        );
        const derived = revenue / CAPACITY_REVENUE_PER_WORKER / units;
        expect(derived).toBeCloseTo(laborIntensity(type, CAPACITY_ANCHOR_YEAR, 1), 6);
      }
    }
  });

  it("equals RPU ÷ REVENUE_PER_WORKER at the anchor year for every sector", () => {
    for (const type of CORPORATION_TYPES) {
      expect(laborIntensity(type, CAPACITY_ANCHOR_YEAR, 1)).toBeCloseTo(
        revenuePerCapacityUnit(type, 1) / CAPACITY_REVENUE_PER_WORKER,
        9
      );
    }
  });
});

describe("identity B (price): ₳ per unit/day of capacity", () => {
  it.each(ANCHOR_SECTORS)(
    "%s at the anchor year equals the legacy growth charge ÷ the capacity it buys",
    (type) => {
      // Legacy growth path: over one game year, growing at g% costs
      // GROWTH_COST_MULTIPLIER × the revenue it adds (post-#3934 clock fix).
      const growthPercent = 5;
      const deltaRevenue = REF_REVENUE * (growthPercent / 100);
      const legacyCash = GROWTH_COST_MULTIPLIER * deltaRevenue;

      // That extra revenue implies this much extra capacity in the same map
      // capital.ts uses.
      const deltaUnits = impliedOutputUnits(
        deltaRevenue,
        defaultSupplyRates(type),
        COMMODITY_BASE_PRICES,
        1
      );

      expect(capacityPricePerUnit(type, CAPACITY_ANCHOR_YEAR, 1)).toBeCloseTo(
        legacyCash / deltaUnits,
        6
      );
    }
  );

  it("equals GROWTH_COST_MULTIPLIER × RPU at the anchor year for every sector", () => {
    for (const type of CORPORATION_TYPES) {
      expect(capacityPricePerUnit(type, CAPACITY_ANCHOR_YEAR, 1)).toBeCloseTo(
        GROWTH_COST_MULTIPLIER * revenuePerCapacityUnit(type, 1),
        6
      );
    }
  });

  it("A and B stay mutually consistent: price ÷ labour = GROWTH_COST_MULTIPLIER × CAPACITY_REVENUE_PER_WORKER at the anchor", () => {
    for (const type of CORPORATION_TYPES) {
      const ratio =
        capacityPricePerUnit(type, CAPACITY_ANCHOR_YEAR, 1) /
        laborIntensity(type, CAPACITY_ANCHOR_YEAR, 1);
      expect(ratio).toBeCloseTo(GROWTH_COST_MULTIPLIER * CAPACITY_REVENUE_PER_WORKER, 3);
    }
  });
});

describe("era lookup", () => {
  it("both era columns are exactly 1.0 at the 1953 anchor (flip is a no-op)", () => {
    expect(capacityEraPriceIndex(CAPACITY_ANCHOR_YEAR)).toBe(1);
    expect(capacityEraLaborIndex(CAPACITY_ANCHOR_YEAR)).toBeCloseTo(1, 12);
  });

  it("steps on the monetaryEra span boundaries, holding flat inside a span", () => {
    // 1953 span runs up to (not including) 1971.
    expect(capacityEraPriceIndex(1900)).toBe(capacityEraPriceIndex(1953));
    expect(capacityEraPriceIndex(1970)).toBe(capacityEraPriceIndex(1953));
    expect(capacityEraPriceIndex(1971)).toBeGreaterThan(capacityEraPriceIndex(1970));
    expect(capacityEraPriceIndex(1978)).toBe(capacityEraPriceIndex(1971));
    expect(capacityEraPriceIndex(1979)).toBeGreaterThan(capacityEraPriceIndex(1978));
    expect(capacityEraPriceIndex(1991)).toBeGreaterThan(capacityEraPriceIndex(1990));
    expect(capacityEraPriceIndex(1999)).toBeGreaterThan(capacityEraPriceIndex(1998));
    expect(capacityEraPriceIndex(2100)).toBe(capacityEraPriceIndex(1999));
  });

  it("price index is monotonically non-decreasing across 1900-2100", () => {
    let prev = 0;
    for (let year = 1900; year <= 2100; year++) {
      const idx = capacityEraPriceIndex(year);
      expect(idx).toBeGreaterThanOrEqual(prev);
      prev = idx;
    }
  });

  it("labour index is the renormalized eraLaborMultiplier curve, and falls over time", () => {
    for (const year of [1900, 1953, 1970, 1991, 2007, 2100]) {
      expect(capacityEraLaborIndex(year)).toBeCloseTo(
        eraLaborMultiplier(year) / eraLaborMultiplier(CAPACITY_ANCHOR_YEAR),
        12
      );
    }
    // Later eras need fewer workers per unit of capacity.
    expect(capacityEraLaborIndex(2007)).toBeLessThan(capacityEraLaborIndex(1991));
    expect(capacityEraLaborIndex(1991)).toBeLessThan(capacityEraLaborIndex(1953));
    // Pre-1953 is the most labour-intensive.
    expect(capacityEraLaborIndex(1900)).toBeGreaterThan(1);

    let prev = Infinity;
    for (let year = 1900; year <= 2100; year++) {
      const idx = capacityEraLaborIndex(year);
      expect(idx).toBeLessThanOrEqual(prev);
      prev = idx;
    }
  });

  it("scales both anchors by their era column", () => {
    for (const type of ANCHOR_SECTORS) {
      for (const year of [1953, 1975, 1985, 1995, 2050]) {
        expect(capacityPricePerUnit(type, year, 1)).toBeCloseTo(
          capacityPricePerUnit(type, CAPACITY_ANCHOR_YEAR, 1) * capacityEraPriceIndex(year),
          6
        );
        expect(laborIntensity(type, year, 1)).toBeCloseTo(
          laborIntensity(type, CAPACITY_ANCHOR_YEAR, 1) * capacityEraLaborIndex(year),
          9
        );
      }
    }
  });
});

describe("totality: every sector type, every year 1900-2100", () => {
  it("returns finite, positive values", () => {
    expect(CAPACITY_SECTOR_TYPES).toEqual(CORPORATION_TYPES);
    for (const type of CORPORATION_TYPES) {
      for (let year = 1900; year <= 2100; year++) {
        const price = capacityPricePerUnit(type, year, 1);
        const labour = laborIntensity(type, year, 1);
        expect(Number.isFinite(price), `${type}@${year} price`).toBe(true);
        expect(price, `${type}@${year} price`).toBeGreaterThan(0);
        expect(Number.isFinite(labour), `${type}@${year} labour`).toBe(true);
        expect(labour, `${type}@${year} labour`).toBeGreaterThan(0);
      }
    }
  });
});

describe("CAPACITY_BUILD_TURNS (provisional)", () => {
  it("covers every sector type with a positive whole number of turns", () => {
    for (const type of CORPORATION_TYPES) {
      const turns = CAPACITY_BUILD_TURNS(type);
      expect(Number.isInteger(turns), `${type}`).toBe(true);
      expect(turns).toBeGreaterThan(0);
    }
  });

  it("orders heavy industry slower than asset-light retail", () => {
    expect(CAPACITY_BUILD_TURNS("energy")).toBeGreaterThan(CAPACITY_BUILD_TURNS("manufacturing"));
    expect(CAPACITY_BUILD_TURNS("extraction")).toBeGreaterThan(
      CAPACITY_BUILD_TURNS("manufacturing")
    );
    expect(CAPACITY_BUILD_TURNS("manufacturing")).toBeGreaterThan(CAPACITY_BUILD_TURNS("retail"));
    expect(CAPACITY_BUILD_TURNS("technology")).toBeGreaterThan(CAPACITY_BUILD_TURNS("retail"));
  });
});
