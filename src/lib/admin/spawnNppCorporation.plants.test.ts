/**
 * P3b: the SEED/ADMIN spawn path under plants.
 *
 * Unlike a player's `expandSector` (or the NPP turn behaviour), this path grants
 * capacity directly into `capitalStock` rather than queueing a build: a world is
 * seeded at t0, there is no turn on which a queue could drain, and a spawned
 * corp whose plants were all still under construction would start a world
 * producing nothing.
 *
 * It also fixes a leak present in BOTH modes: the spawn captured ₳ revenue out
 * of the unowned pool while leaving `headroomUnits` at its pre-capture figure,
 * so every spawned corp permanently inflated the headroom of the market it had
 * just taken a bite out of.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { DEFAULT_SECTOR_STARTING_REVENUE } from "@/lib/constants/corporations";
import { computeUnownedHeadroomUnits } from "@/lib/market/unownedHeadroom";
import { capacityRescaleRatio } from "@/lib/constants/capacityEconomy";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/npp/generator", () => ({
  createNPP: vi.fn().mockResolvedValue({ _id: new ObjectId(), name: "Spawned NPP" }),
}));
vi.mock("@/lib/corporations/tickerSymbol", () => ({
  generateTickerSymbol: vi.fn().mockResolvedValue("SPWN"),
}));
vi.mock("@/lib/db/sequentialId", () => ({
  getNextSequentialId: vi.fn().mockResolvedValue(42),
}));
vi.mock("@/lib/currency/gdpAnchorRate", () => ({
  loadWorldPreset: vi.fn().mockResolvedValue("1953-default"),
  getGdpAnchorRate: vi.fn().mockReturnValue(1),
  loadWorldEraUnitScale: vi.fn().mockResolvedValue(1),
}));
vi.mock("@/lib/constants/sectorSeedEra", () => ({
  getEraNominalScale: vi.fn().mockReturnValue(1),
  // Modern share base (scale 1), matching getEraNominalScale above.
  getEraFounderShares: vi.fn((shares: number) => shares),
}));
vi.mock("./nppCorpCeoSelection", () => ({
  buildCeoAffiliations: vi.fn().mockReturnValue([]),
  chooseNppCorpCeo: vi.fn().mockReturnValue({ kind: "new", party: null }),
}));
vi.mock("@/lib/admin/seed/seedUnownedSectors", () => ({
  computeUnownedSeedRevenue: vi.fn().mockReturnValue(0),
}));
vi.mock("@/lib/market/featureFlag", () => ({
  getMarketSystemModeForDb: vi.fn().mockResolvedValue("plants"),
  marketAtLeast: vi.fn().mockReturnValue(true),
}));

const POOL_REVENUE = 40_000_000;
const POOL_UNITS = computeUnownedHeadroomUnits("manufacturing", POOL_REVENUE, 1);
// The spawn captures a quarter of the pool, floored at the default starter size.
const CAPTURE_REVENUE = Math.max(Math.round(POOL_REVENUE * 0.25), DEFAULT_SECTOR_STARTING_REVENUE);
const CAPTURE_UNITS = computeUnownedHeadroomUnits("manufacturing", CAPTURE_REVENUE, 1);

describe("spawnNppCorporation — plants", () => {
  let db: MockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    for (const name of [
      "states",
      "npps",
      "corporations",
      "corporateSectors",
      "unownedSectors",
      "politicalParties",
    ]) {
      db.collection(name);
      const cursor = {
        toArray: vi.fn().mockResolvedValue([]),
        project: vi.fn(() => cursor),
        sort: vi.fn(() => cursor),
        limit: vi.fn(() => cursor),
      };
      db.collectionMocks[name]!.find = vi.fn().mockReturnValue(cursor);
    }
    db.collectionMocks.states!.findOne.mockResolvedValue({
      _id: "CA",
      countryId: "US",
      name: "California",
      gdp: 1_000_000_000,
    });
    db.collectionMocks.unownedSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      stateId: "CA",
      countryId: "US",
      sectorType: "manufacturing",
      revenue: POOL_REVENUE,
      headroomUnits: POOL_UNITS,
    });
  });

  async function spawn(plants: boolean) {
    const { marketAtLeast } = await import("@/lib/market/featureFlag");
    vi.mocked(marketAtLeast).mockReturnValue(plants);
    const { spawnNppCorporation } = await import("./spawnNppCorporation");
    await spawnNppCorporation(db as unknown as Db, {
      name: "Spawnco",
      type: "manufacturing",
      countryId: "US",
      headquartersState: "CA",
    });
    return {
      sector: db.collectionMocks.corporateSectors!.insertOne.mock.calls[0][0] as Record<
        string,
        unknown
      >,
      poolSet: (
        db.collectionMocks.unownedSectors!.updateOne.mock.calls[0][1] as {
          $set: Record<string, number>;
        }
      ).$set,
    };
  }

  it("grants capacity directly into capitalStock, in UNITS", async () => {
    const { sector } = await spawn(true);
    expect(sector.capitalStock).toBeCloseTo(CAPTURE_UNITS, 6);
    // Seed context: instant, so nothing is queued.
    expect(sector.buildQueue).toBeUndefined();
    expect(sector.plantsStartTurn).toBe(0);
  });

  it("founds a focused extraction sector with strategy-normalized capacity", async () => {
    const extractionPoolUnits = computeUnownedHeadroomUnits("extraction", POOL_REVENUE, 1);
    db.collectionMocks.unownedSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      stateId: "CA",
      countryId: "US",
      sectorType: "extraction",
      revenue: POOL_REVENUE,
      headroomUnits: extractionPoolUnits,
    });
    const { spawnNppCorporation } = await import("./spawnNppCorporation");
    await spawnNppCorporation(db as unknown as Db, {
      name: "Iron Mine",
      type: "extraction",
      countryId: "US",
      headquartersState: "CA",
      initialStrategyId: "iron_mining",
      foundedAtTurn: 10,
    });
    const sector = db.collectionMocks.corporateSectors!.insertOne.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const corporation = db.collectionMocks.corporations!.insertOne.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const poolSet = (
      db.collectionMocks.unownedSectors!.updateOne.mock.calls[0][1] as {
        $set: Record<string, number>;
      }
    ).$set;
    const expectedStandardUnits = computeUnownedHeadroomUnits("extraction", CAPTURE_REVENUE, 1);

    expect(sector.strategyId).toBe("iron_mining");
    expect(corporation.ceoType).toBe("npp");
    expect((corporation.userId as ObjectId).toString()).toBe("000000000000000000000000");
    expect(sector.capitalStock).toBeCloseTo(
      expectedStandardUnits * capacityRescaleRatio("extraction", "standard", "iron_mining"),
      6
    );
    expect(sector.plantsStartTurn).toBe(10);
    expect(poolSet.headroomUnits).toBeCloseTo(extractionPoolUnits - expectedStandardUnits, 6);
  });

  it("decrements the pool's headroom by exactly what it granted", async () => {
    const { poolSet } = await spawn(true);
    expect(poolSet.headroomUnits).toBeCloseTo(POOL_UNITS - CAPTURE_UNITS, 6);
    expect(poolSet.revenue).toBe(Math.max(0, POOL_REVENUE - CAPTURE_REVENUE));
  });

  it("never drives the pool negative", async () => {
    db.collectionMocks.unownedSectors!.findOne.mockResolvedValue({
      _id: new ObjectId(),
      stateId: "CA",
      sectorType: "manufacturing",
      revenue: 1,
      headroomUnits: 1,
    });
    const { poolSet } = await spawn(true);
    expect(poolSet.headroomUnits).toBe(0);
    expect(poolSet.revenue).toBe(0);
  });

  it("decrements headroom on the non-plants path too (derived-field leak)", async () => {
    const { sector, poolSet } = await spawn(false);
    // No capacity grant off plants — the legacy revenue line is untouched.
    expect(sector.capitalStock).toBeUndefined();
    expect(sector.plantsStartTurn).toBeUndefined();
    // But headroomUnits must never disagree with the revenue it derives from.
    expect(poolSet.revenue).toBe(Math.max(0, POOL_REVENUE - CAPTURE_REVENUE));
    expect(poolSet.headroomUnits).toBeCloseTo(POOL_UNITS - CAPTURE_UNITS, 6);
  });
});
