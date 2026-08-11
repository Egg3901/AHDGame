import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  ["states", "corporateSectors", "unownedSectors", "corporations", "exchangeRates"].forEach((n) =>
    db.collection(n)
  );
  const { getDb } = await import("@/lib/mongodb");
  vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
});

function mockFind(collection: string, docs: unknown[]) {
  db.collectionMocks[collection]!.find.mockReturnValue({
    toArray: async () => docs,
    project: vi.fn().mockReturnValue({ toArray: async () => docs }),
  });
}

describe("aggregateCountrySectorMix", () => {
  it("aggregates owned + unowned per sector across states and finds the largest state", async () => {
    const corpId = new ObjectId();
    // gdp 0 → GDP-derived fallback 0, so effective market = owned + persisted unowned.
    mockFind("states", [
      { _id: "CA", countryId: "US", name: "California", gdp: 0, population: 30 },
      { _id: "TX", countryId: "US", name: "Texas", gdp: 0, population: 10 },
    ]);
    mockFind("corporateSectors", [
      {
        _id: new ObjectId(),
        corporationId: corpId,
        countryId: "US",
        stateId: "CA",
        sectorType: "energy",
        revenue: 600,
        currentGrowthRate: 3,
        targetGrowthRate: 99,
      },
      {
        _id: new ObjectId(),
        corporationId: corpId,
        countryId: "US",
        stateId: "TX",
        sectorType: "energy",
        revenue: 100,
        currentGrowthRate: 1,
        targetGrowthRate: 99,
      },
    ]);
    mockFind("unownedSectors", [
      { stateId: "CA", countryId: "US", sectorType: "energy", revenue: 400 },
      { stateId: "TX", countryId: "US", sectorType: "energy", revenue: 100 },
      { stateId: "TX", countryId: "US", sectorType: "financial", revenue: 500 },
    ]);
    mockFind("corporations", [{ _id: corpId, liquidCurrencyCode: "USD", countryId: "US" }]);
    mockFind("exchangeRates", [{ _id: "US", currencyCode: "USD", rate: 1 }]);

    const { aggregateCountrySectorMix } = await import("./sectorMix");
    const mix = await aggregateCountrySectorMix(db as unknown as Db, "US");

    const energy = mix.find((s) => s.type === "energy");
    expect(energy).toBeDefined();
    // CA market 600+400=1000, TX market 100+100=200 → national 1200, owned 700
    expect(energy!.totalMarketAnchor).toBe(1200);
    expect(energy!.ownedPercent).toBeCloseTo(58.3, 1);
    expect(energy!.largestState).toEqual({ stateId: "CA", stateName: "California" });
    // mean of the two energy corps' CURRENT growth (3, 1) = 2 — current wins over target (99)
    expect(energy!.avgGrowth).toBe(2);

    const financial = mix.find((s) => s.type === "financial");
    expect(financial!.totalMarketAnchor).toBe(500);
    expect(financial!.ownedPercent).toBe(0);
    expect(financial!.largestState).toEqual({ stateId: "TX", stateName: "Texas" });
    // only unowned market — no corps to average → null
    expect(financial!.avgGrowth).toBeNull();

    // Sectors with no activity still appear, zeroed, so boards stay complete.
    const retail = mix.find((s) => s.type === "retail");
    expect(retail).toBeDefined();
    expect(retail!.totalMarketAnchor).toBe(0);
    expect(retail!.largestState).toBeNull();
    expect(retail!.avgGrowth).toBeNull();
  });

  it("returns a complete zeroed board when the country has no market data", async () => {
    mockFind("states", []);
    mockFind("corporateSectors", []);
    mockFind("unownedSectors", []);
    mockFind("corporations", []);
    mockFind("exchangeRates", []);

    const { aggregateCountrySectorMix } = await import("./sectorMix");
    const mix = await aggregateCountrySectorMix(db as unknown as Db, "US");

    expect(mix.length).toBeGreaterThan(0);
    expect(mix.every((s) => s.totalMarketAnchor === 0 && s.largestState === null)).toBe(true);
  });
});
