import { describe, it, expect } from "vitest";
import {
  BOOK_DEPRECIATION_FACTOR,
  sectorBookValueAnchor,
  sectorConstructionInProgressAnchor,
  sectorDailyProfitAnchor,
  sumConstructionInProgressAnchor,
  sumSectorBookValueAnchor,
} from "./sectorProfitBasis";
import {
  calculateDailyGrowthCost,
  GROWTH_COST_MULTIPLIER,
  GROWTH_RATE_TURNS_PER_YEAR,
} from "@/lib/constants/corporations";
import {
  CAPACITY_ANCHOR_YEAR,
  capacityPricePerUnit,
  revenuePerCapacityUnit,
} from "@/lib/constants/capacityEconomy";
import { DISSOLUTION_SECTOR_SALVAGE_FRACTION } from "@/lib/constants/corporations";

const PRIME = 5;

const sector = {
  revenue: 1_000_000,
  realizedRevenue: 800_000,
  profitMargin: 35,
  currentGrowthRate: 4,
  currentGrowthCost: 12_345,
};

describe("sectorDailyProfitAnchor", () => {
  it("reproduces the legacy recomputed expression below plants", () => {
    const basis = sectorDailyProfitAnchor(sector, {
      plantsEnabled: false,
      growthCost: { kind: "recomputed", primeRate: PRIME },
    });
    // Realized-preferring: 800k, not the 1m nameplate.
    expect(basis.revenueAnchor).toBe(800_000);
    const legacyGrowthCost = calculateDailyGrowthCost(
      800_000,
      sector.currentGrowthRate / GROWTH_RATE_TURNS_PER_YEAR,
      PRIME
    );
    expect(basis.growthCostAnchor).toBeCloseTo(legacyGrowthCost, 8);
    expect(basis.dailyProfitAnchor).toBeCloseTo(800_000 * 0.35 - legacyGrowthCost, 6);
  });

  it("reproduces the legacy stored-growth-cost expression below plants", () => {
    const basis = sectorDailyProfitAnchor(sector, {
      plantsEnabled: false,
      growthCost: { kind: "stored" },
    });
    expect(basis.growthCostAnchor).toBe(12_345);
    expect(basis.dailyProfitAnchor).toBeCloseTo(800_000 * 0.35 - 12_345, 6);
  });

  it("drops the phantom growth deduction under plants (both bases)", () => {
    for (const growthCost of [
      { kind: "recomputed", primeRate: PRIME } as const,
      { kind: "stored" } as const,
    ]) {
      const basis = sectorDailyProfitAnchor(sector, { plantsEnabled: true, growthCost });
      expect(basis.growthCostAnchor).toBe(0);
      expect(basis.dailyProfitAnchor).toBeCloseTo(800_000 * 0.35, 6);
    }
  });

  it("under plants a sector is worth strictly MORE than under the legacy basis", () => {
    const legacy = sectorDailyProfitAnchor(sector, {
      plantsEnabled: false,
      growthCost: { kind: "recomputed", primeRate: PRIME },
    });
    const plants = sectorDailyProfitAnchor(sector, {
      plantsEnabled: true,
      growthCost: { kind: "recomputed", primeRate: PRIME },
    });
    expect(plants.dailyProfitAnchor).toBeGreaterThan(legacy.dailyProfitAnchor);
  });

  it("honours the caller's FX discipline on revenue AND stored growth cost", () => {
    const basis = sectorDailyProfitAnchor(sector, {
      plantsEnabled: false,
      growthCost: { kind: "stored" },
      currencyCode: "GBP",
      fxRate: 2,
    });
    expect(basis.revenueAnchor).toBe(400_000);
    expect(basis.growthCostAnchor).toBe(12_345 / 2);
  });

  it("excludeGrowthCost zeroes the deduction independently of the mode", () => {
    const basis = sectorDailyProfitAnchor(sector, {
      plantsEnabled: false,
      excludeGrowthCost: true,
      growthCost: { kind: "recomputed", primeRate: PRIME },
    });
    expect(basis.growthCostAnchor).toBe(0);
  });

  it("falls back to a 35% margin on a sector doc with no profitMargin", () => {
    const basis = sectorDailyProfitAnchor(
      { revenue: 100, profitMargin: undefined },
      { plantsEnabled: true, growthCost: { kind: "stored" } }
    );
    expect(basis.dailyProfitAnchor).toBeCloseTo(35, 8);
  });
});

describe("construction in progress", () => {
  it("treats absent / negative / non-finite CIP as zero", () => {
    expect(sectorConstructionInProgressAnchor({})).toBe(0);
    expect(sectorConstructionInProgressAnchor({ constructionInProgressAnchor: null })).toBe(0);
    expect(sectorConstructionInProgressAnchor({ constructionInProgressAnchor: -5 })).toBe(0);
    expect(sectorConstructionInProgressAnchor({ constructionInProgressAnchor: NaN })).toBe(0);
    expect(sectorConstructionInProgressAnchor({ constructionInProgressAnchor: 42 })).toBe(42);
  });

  it("sums across sectors and tolerates an undefined list", () => {
    expect(sumConstructionInProgressAnchor(undefined)).toBe(0);
    expect(
      sumConstructionInProgressAnchor([
        { constructionInProgressAnchor: 10 },
        {},
        { constructionInProgressAnchor: 5 },
      ])
    ).toBe(15);
  });
});

describe("sectorBookValueAnchor (D11)", () => {
  const CAPACITY = 250;

  it("prices a flip-identity sector at 3.0 × RPU × capacity at the anchor year", () => {
    const book = sectorBookValueAnchor(
      { sectorType: "manufacturing", capitalStock: CAPACITY },
      CAPACITY_ANCHOR_YEAR,
      1
    );
    // GROWTH_COST_MULTIPLIER is the 3.0 in "a unit of capacity costs 3x the
    // revenue it yields" — the identity the legacy growth path priced on.
    expect(book).toBeCloseTo(
      GROWTH_COST_MULTIPLIER * revenuePerCapacityUnit("manufacturing", 1) * CAPACITY,
      6
    );
    expect(GROWTH_COST_MULTIPLIER).toBe(3.0);
  });

  it("adds construction in progress on top of built capacity", () => {
    const built = sectorBookValueAnchor(
      { sectorType: "retail", capitalStock: CAPACITY },
      CAPACITY_ANCHOR_YEAR,
      1
    );
    const withCip = sectorBookValueAnchor(
      { sectorType: "retail", capitalStock: CAPACITY, constructionInProgressAnchor: 1_000 },
      CAPACITY_ANCHOR_YEAR,
      1
    );
    expect(withCip - built).toBeCloseTo(1_000, 8);
  });

  it("is zero for a sector with no capacity and nothing in flight", () => {
    expect(sectorBookValueAnchor({ sectorType: "retail" }, CAPACITY_ANCHOR_YEAR, 1)).toBe(0);
    expect(
      sectorBookValueAnchor({ sectorType: "retail", capitalStock: -10 }, CAPACITY_ANCHOR_YEAR, 1)
    ).toBe(0);
  });

  it("prices at the era index, not the anchor year, for a later era", () => {
    const anchor = sectorBookValueAnchor(
      { sectorType: "energy", capitalStock: CAPACITY },
      CAPACITY_ANCHOR_YEAR,
      1
    );
    const modern = sectorBookValueAnchor({ sectorType: "energy", capitalStock: CAPACITY }, 2019, 1);
    expect(modern / anchor).toBeCloseTo(
      capacityPricePerUnit("energy", 2019, 1) /
        capacityPricePerUnit("energy", CAPACITY_ANCHOR_YEAR, 1),
      8
    );
  });

  it("sums across a corp's sectors", () => {
    const sectors = [
      { sectorType: "retail" as const, capitalStock: 10 },
      { sectorType: "retail" as const, capitalStock: 20, constructionInProgressAnchor: 7 },
    ];
    expect(sumSectorBookValueAnchor(sectors, CAPACITY_ANCHOR_YEAR, 1)).toBeCloseTo(
      sectorBookValueAnchor(sectors[0], CAPACITY_ANCHOR_YEAR, 1) +
        sectorBookValueAnchor(sectors[1], CAPACITY_ANCHOR_YEAR, 1),
      8
    );
    expect(sumSectorBookValueAnchor(undefined, CAPACITY_ANCHOR_YEAR, 1)).toBe(0);
  });

  it("NO MINT: dissolution salvage is strictly less than what the capacity cost to build", () => {
    // Build-then-dissolve must always be a loss. Exercised across every era
    // index so an era-priced build cannot be salvaged at a richer era's price.
    for (const year of [CAPACITY_ANCHOR_YEAR, 1979, 2019]) {
      const buildCost = CAPACITY * capacityPricePerUnit("manufacturing", year, 1);
      const book = sectorBookValueAnchor(
        { sectorType: "manufacturing", capitalStock: CAPACITY },
        year,
        1
      );
      const salvage = DISSOLUTION_SECTOR_SALVAGE_FRACTION * book;
      expect(book).toBeLessThanOrEqual(buildCost * BOOK_DEPRECIATION_FACTOR);
      expect(salvage).toBeLessThan(buildCost);
      expect(salvage).toBeCloseTo(DISSOLUTION_SECTOR_SALVAGE_FRACTION * buildCost, 6);
    }
  });
});
