import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import type { Db } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { aggregateCountrySectorMix } from "./sectorMix";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

let db: MockDb;

beforeEach(async () => {
  vi.clearAllMocks();
  db = createMockDb();
  [
    "states",
    "corporateSectors",
    "unownedSectors",
    "corporations",
    "exchangeRates",
    "commodityPrices",
    "gameConfig",
    "gameState",
  ].forEach((n) => db.collection(n));
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

    const mix = await aggregateCountrySectorMix(db as unknown as Db, "US");

    expect(mix.length).toBeGreaterThan(0);
    expect(mix.every((s) => s.totalMarketAnchor === 0 && s.largestState === null)).toBe(true);
  });

  it("sizes plants markets from built capacity plus unmet commodity demand", async () => {
    mockFind("states", [{ _id: "CA", countryId: "US", name: "California", gdp: 0 }]);
    mockFind("corporateSectors", [
      {
        _id: new ObjectId(),
        corporationId: new ObjectId(),
        countryId: "US",
        stateId: "CA",
        sectorType: "automobiles",
        // The owned nameplate is deliberately much smaller than the open
        // market. A plants board must not mistake ownership for the whole
        // industry.
        revenue: 10_000,
        realizedRevenue: 0,
        capitalStock: 2,
        operatingCapacityUnits: 2,
        strategyId: "standard",
        mothballed: false,
        currentGrowthRate: 0,
      },
    ]);
    mockFind("unownedSectors", [
      {
        stateId: "CA",
        countryId: "US",
        sectorType: "automobiles",
        // This authored row is intentionally stale and must not set the plants
        // market denominator.
        revenue: 999_999,
        headroomUnits: 20,
      },
    ]);
    mockFind("commodityPrices", [
      {
        commodity: "vehicles",
        basePrice: 25_000,
        globalPrice: 25_000,
        globalSupply: 0,
        globalDemand: 40,
        demandTruncatedUnits: 10,
        nationalSupply: { US: 0 },
        nationalDemand: { US: 40 },
        stateSupply: { CA: 0 },
        stateDemand: { CA: 40 },
        turn: 1,
      },
      {
        commodity: "entertainment_services",
        basePrice: 600,
        globalPrice: 600,
        globalSupply: 0,
        globalDemand: 1_000,
        nationalSupply: { US: 0 },
        nationalDemand: { US: 1_000 },
        stateSupply: { CA: 0 },
        stateDemand: { CA: 1_000 },
        turn: 1,
      },
    ]);
    mockFind("corporations", []);
    mockFind("exchangeRates", []);
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ marketSystemMode: "plants" });

    const mix = await aggregateCountrySectorMix(db as unknown as Db, "US");
    const automobiles = mix.find((s) => s.type === "automobiles")!;

    // Two built automobile capacity units are $100,000 of plant nameplate.
    // The vehicle ledger has another 40 visible units plus 10 units that were
    // capped out of the price pass. On the automobile capacity basis, those
    // 50 units are $2.5M of latent demand.
    // The stale authored unowned row must not affect this result.
    expect(automobiles.totalMarketAnchor).toBe(2_600_000);
    expect(automobiles.ownedPercent).toBeCloseTo(3.8, 1);

    const entertainment = mix.find((s) => s.type === "media_entertainment")!;
    // Media and entertainment has no plant yet, but its consumer-service demand
    // still creates a real latent market.
    // The unified standard mix values entertainment alongside advertising, so
    // 1,000 latent service units imply $2M of sector
    // capacity on the same basis.
    expect(entertainment.totalMarketAnchor).toBe(2_000_000);
    expect(entertainment.ownedPercent).toBe(0);
    expect(db.collectionMocks.unownedSectors!.find).not.toHaveBeenCalled();
    // Plants has no persisted target-growth signal; exposing 0.00% here would
    // claim a measured contraction/expansion that did not occur.
    expect(automobiles.avgGrowth).toBeNull();
  });

  it("books no latent market in a surplus scope of a truncated commodity", async () => {
    mockFind("states", [{ _id: "CA", countryId: "US", name: "California", gdp: 0 }]);
    mockFind("corporateSectors", [
      {
        _id: new ObjectId(),
        corporationId: new ObjectId(),
        countryId: "US",
        stateId: "CA",
        sectorType: "automobiles",
        revenue: 10_000,
        realizedRevenue: 0,
        capitalStock: 2,
        operatingCapacityUnits: 2,
        strategyId: "standard",
        mothballed: false,
        currentGrowthRate: 0,
      },
    ]);
    mockFind("unownedSectors", []);
    // Globally capped (60 units truncated) but locally clearing: true uncapped
    // demand is 10 + 60 = 70 against 100 supply, so the market has no latent
    // leg. Restoring the truncated share outside the max(0, demand - supply)
    // floor would book 60 phantom vehicle units ($3M) here instead.
    mockFind("commodityPrices", [
      {
        commodity: "vehicles",
        basePrice: 25_000,
        globalPrice: 25_000,
        globalSupply: 100,
        globalDemand: 10,
        demandTruncatedUnits: 60,
        nationalSupply: { US: 100 },
        nationalDemand: { US: 10 },
        stateSupply: { CA: 100 },
        stateDemand: { CA: 10 },
        turn: 1,
      },
    ]);
    mockFind("corporations", []);
    mockFind("exchangeRates", []);
    db.collectionMocks.gameConfig!.findOne.mockResolvedValue({ marketSystemMode: "plants" });

    const mix = await aggregateCountrySectorMix(db as unknown as Db, "US");
    const automobiles = mix.find((s) => s.type === "automobiles")!;

    // Owned nameplate only: two built units are $100,000 of plant.
    expect(automobiles.totalMarketAnchor).toBe(100_000);
    expect(automobiles.ownedPercent).toBe(100);
  });
});
