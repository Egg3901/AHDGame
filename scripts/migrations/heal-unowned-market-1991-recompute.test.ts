import { describe, it, expect, vi, beforeEach } from "vitest";

import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import {
  computeMarketRescaleRatio,
  planMarketRescale,
  applyMarketRescale,
  type MarketCell,
} from "./heal-unowned-market-1991-recompute";

function cursor(docs: unknown[]) {
  return { toArray: vi.fn().mockResolvedValue(docs) };
}

describe("computeMarketRescaleRatio", () => {
  it("r = canonical / currentTotal", () => {
    expect(computeMarketRescaleRatio(2_050_000, 326_600_000)).toBeCloseTo(
      2_050_000 / 326_600_000,
      12
    );
  });
  it("returns null when there is nothing to scale", () => {
    expect(computeMarketRescaleRatio(1_000_000, 0)).toBeNull();
    expect(computeMarketRescaleRatio(1_000_000, -5)).toBeNull();
  });
  it("a near-correct market yields r ≈ 1 (no-op)", () => {
    const r = computeMarketRescaleRatio(1_060_000, 1_330_000);
    expect(r).not.toBeNull();
    expect(r!).toBeGreaterThan(0.5);
    expect(r!).toBeLessThan(1.2);
  });
});

describe("planMarketRescale", () => {
  it("scales unowned (anchor) and owned (local) by the same ratio, preserving share", () => {
    const cells: MarketCell[] = [
      {
        stateId: "HD",
        sectorType: "logistics",
        canonical: 2_050_000,
        unowned: { _id: "u1", revenueAnchor: 244_620_000 },
        owned: [
          { _id: "s1", revenueLocal: 606_000_000, currentGrowthCost: 0, fxLocalPerAnchor: 7.4 },
        ],
      },
    ];
    const r = 2_050_000 / (244_620_000 + 606_000_000 / 7.4);
    const { unownedOps, ownedOps } = planMarketRescale(cells);
    expect(unownedOps[0]).toEqual({
      id: "u1",
      field: "revenue",
      oldValue: 244_620_000,
      newValue: Math.round(244_620_000 * r),
    });
    expect(ownedOps[0]).toMatchObject({
      id: "s1",
      field: "revenue",
      newValue: Math.max(1, Math.round(606_000_000 * r)),
    });
  });

  it("skips a cell with zero total (nothing to scale)", () => {
    const cells: MarketCell[] = [
      {
        stateId: "ZZ",
        sectorType: "energy",
        canonical: 1_000_000,
        unowned: { _id: "u2", revenueAnchor: 0 },
        owned: [],
      },
    ];
    const { unownedOps, ownedOps } = planMarketRescale(cells);
    expect(unownedOps).toHaveLength(0);
    expect(ownedOps).toHaveLength(0);
  });
});

describe("applyMarketRescale", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("exchangeRates");
    db.collection("corporations");
    db.collection("unownedSectors");
    db.collection("corporateSectors");
    db.collectionMocks.states.find.mockReturnValue(
      cursor([{ _id: "HD", countryId: "CN", gdp: 680_000 }])
    );
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      cursor([{ currencyCode: "CNY", rate: 7.4 }])
    );
    db.collectionMocks.corporations.find.mockReturnValue(
      cursor([{ _id: "c1", countryId: "CN", liquidCurrencyCode: "CNY" }])
    );
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        { _id: "u1", stateId: "HD", sectorType: "logistics", revenue: 244_620_000 },
        { _id: "uOrphan", stateId: "EAST", sectorType: "logistics", revenue: 50_000_000 },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(
      cursor([
        {
          _id: "s1",
          stateId: "HD",
          sectorType: "logistics",
          corporationId: "c1",
          revenue: 606_000_000,
          currentGrowthCost: 0,
        },
      ])
    );
  });

  it("dry-run plans ops + orphan deletes but writes nothing", async () => {
    const res = await applyMarketRescale(db as unknown as Db, {
      dryRun: true,
      includeOwned: true,
      deleteOrphans: true,
    });
    expect(res.unownedOps).toBeGreaterThan(0);
    expect(res.ownedOps).toBeGreaterThan(0);
    expect(res.orphanUnownedToDelete).toBe(1);
    expect(db.collectionMocks.unownedSectors.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
  });

  it("apply writes scaled revenue and deletes orphans", async () => {
    await applyMarketRescale(db as unknown as Db, {
      dryRun: false,
      includeOwned: true,
      deleteOrphans: true,
    });
    expect(db.collectionMocks.unownedSectors.bulkWrite).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.corporateSectors.bulkWrite).toHaveBeenCalledTimes(1);
    expect(db.collectionMocks.unownedSectors.deleteMany).toHaveBeenCalledTimes(1);
  });

  it("skip-owned leaves corporateSectors untouched", async () => {
    await applyMarketRescale(db as unknown as Db, {
      dryRun: false,
      includeOwned: false,
      deleteOrphans: false,
    });
    expect(db.collectionMocks.corporateSectors.bulkWrite).not.toHaveBeenCalled();
    expect(db.collectionMocks.unownedSectors.deleteMany).not.toHaveBeenCalled();
  });
});

describe("applyMarketRescale country scoping", () => {
  let db: MockDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("states");
    db.collection("exchangeRates");
    db.collection("corporations");
    db.collection("unownedSectors");
    db.collection("corporateSectors");
    // Live world spans two countries.
    db.collectionMocks.states.find.mockReturnValue(
      cursor([
        { _id: "HD", countryId: "CN", gdp: 680_000 },
        { _id: "CA", countryId: "US", gdp: 740_000 },
      ])
    );
    db.collectionMocks.exchangeRates.find.mockReturnValue(
      cursor([
        { currencyCode: "CNY", rate: 7.4 },
        { currencyCode: "USD", rate: 1 },
      ])
    );
    db.collectionMocks.corporations.find.mockReturnValue(cursor([]));
    db.collectionMocks.unownedSectors.find.mockReturnValue(
      cursor([
        {
          _id: "uCN",
          stateId: "HD",
          countryId: "CN",
          sectorType: "logistics",
          revenue: 244_620_000,
        },
        {
          _id: "uCNorphan",
          stateId: "EAST",
          countryId: "CN",
          sectorType: "logistics",
          revenue: 5_000_000,
        },
        {
          _id: "uUSlive",
          stateId: "CA",
          countryId: "US",
          sectorType: "logistics",
          revenue: 80_000_000,
        },
        {
          _id: "uUSorphan",
          stateId: "WEST_US",
          countryId: "US",
          sectorType: "logistics",
          revenue: 9_000_000,
        },
      ])
    );
    db.collectionMocks.corporateSectors.find.mockReturnValue(cursor([]));
  });

  it("a --country=CN run only deletes CN orphans and never touches US markets", async () => {
    const res = await applyMarketRescale(db as unknown as Db, {
      dryRun: true,
      includeOwned: true,
      deleteOrphans: true,
      countryIds: ["CN"],
    });
    // Only the CN orphan (EAST) is deleted. The live US market (CA) and the US
    // orphan (WEST_US) are left entirely alone in a CN-scoped run.
    // (Pre-fix this returned 3 — it treated every non-CN doc as an orphan.)
    expect(res.orphanUnownedToDelete).toBe(1);
    // Only the CN live cell (HD) is rescaled; the US cell is out of scope.
    expect(res.unownedOps).toBe(1);
  });
});
