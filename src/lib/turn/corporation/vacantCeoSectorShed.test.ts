import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CorporationLookups } from "./types";
import { VACANT_CEO_SECTOR_SHED_RATE, shedVacantCeoSectorsToUnowned } from "./vacantCeoSectorShed";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

function makeMinimalLookups(
  corporations: Corporation[],
  sectors: CorporateSector[]
): CorporationLookups {
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  const corpById = new Map<string, Corporation>();
  for (const c of corporations) corpById.set(c._id.toString(), c);
  for (const s of sectors) {
    const k = s.corporationId.toString();
    sectorsByCorp.set(k, [...(sectorsByCorp.get(k) ?? []), s]);
  }
  return {
    eraUnitScale: 1,
    corporations,
    sectorsByCorp,
    corpById,
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map(),
    macroInflationByCountry: new Map(),
    investorConfidenceByCountry: new Map(),
    macroDebtToGdpByCountry: new Map(),
    macroDeficitByCountry: new Map(),
    sovereignDefaultMarginByCorpId: new Map(),
    unemploymentByState: new Map(),
    gridReliabilityByState: new Map(),
    corruptionByState: new Map(),
    workforceSkillByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    crimeRateByState: new Map(),
    broadbandByState: new Map(),
    roadConditionByState: new Map(),
    carbonEmissionsByState: new Map(),
    costOfLivingByState: new Map(),
    globalCommodityBalances: new Map(),
    priceRatioByCommodity: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    countryClearingBooks: null,
    exportIntensityByCountry: new Map(),
    rawStateBalances: new Map(),
    sectorPresenceKeys: new Set(),
    allTariffs: [],
    activeFtaPairs: new Set<string>(),
    ftaCoverage: {
      byCountryEconomyWide: new Map(),
      bySectorType: new Map(),
      corpHqByCorpId: new Map(),
      pairs: new Set<string>(),
    },
    activeSubsidies: [],
    federalBudgets: [],
    domesticCorpTaxRateByCountry: new Map(),
    foreignCorpTaxRateByCountry: new Map(),
    domesticStateCorpTaxRateByState: new Map(),
    foreignStateCorpTaxRateByState: new Map(),
    exchangeRatesByCurrency: new Map(),
    stateCountryMap: new Map(),
    stateResourceCapacityByState: new Map(),
    extractionCapacityUtilBySector: new Map(),
    marketShareBySectorId: new Map(),
    stateSectorSpecializationByState: new Map(),
    activeDisasterEffectsByState: new Map(),
  };
}

describe("shedVacantCeoSectorsToUnowned", () => {
  let db: MockDb;
  const now = new Date("2026-01-01T00:00:00Z");

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporateSectors");
    db.collection("unownedSectors");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  it("does nothing when no corporations qualify", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      ceoId: new ObjectId(),
      ceoVacant: false,
    } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      stateId: "US-CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 10_000,
      workers: 100,
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
    expect(r.unownedSectorsUpdated).toBe(0);
    expect(r.totalRevenueShed).toBe(0);
    expect(db.collectionMocks["corporateSectors"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("sheds 10% revenue and workers from vacant CEO corps into unowned pool", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      ceoId: null,
      ceoVacant: true,
    } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      stateId: "US-CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 10_000,
      workers: 100,
      updatedAt: new Date(0),
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(1);
    expect(r.unownedSectorsUpdated).toBe(1);
    expect(r.totalRevenueShed).toBe(Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE));

    expect(sector.revenue).toBe(10_000 - Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE));
    expect(sector.workers).toBe(100 - Math.round(100 * VACANT_CEO_SECTOR_SHED_RATE));

    const sectorBulk = db.collectionMocks["corporateSectors"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc: { revenue: number; workers: number } } };
    }>;
    expect(sectorBulk[0].updateOne.update.$inc.revenue).toBe(
      -Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE)
    );
    expect(sectorBulk[0].updateOne.update.$inc.workers).toBe(
      -Math.round(100 * VACANT_CEO_SECTOR_SHED_RATE)
    );

    const unownedBulk = db.collectionMocks["unownedSectors"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: {
        filter: { stateId: string; sectorType: string };
        update: { $inc: { revenue: number } };
      };
    }>;
    expect(unownedBulk[0].updateOne.filter.stateId).toBe("US-CA");
    expect(unownedBulk[0].updateOne.filter.sectorType).toBe("technology");
    expect(unownedBulk[0].updateOne.update.$inc.revenue).toBe(
      Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE)
    );
  });

  it("under plants sheds CAPACITY units to pool headroom and never touches revenue", async () => {
    const corpId = new ObjectId();
    const corp = { _id: corpId, ceoId: null, ceoVacant: true } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      stateId: "US-CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 10_000,
      capitalStock: 500,
      // Already flipped: `capitalStock` is authoritative. Without this the shed
      // correctly DEFERS (see the flip-turn test below) and nothing moves.
      plantsStartTurn: 1,
      workers: 100,
      updatedAt: new Date(0),
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now, true);

    const expectedUnits = 500 * VACANT_CEO_SECTOR_SHED_RATE;
    expect(r.totalRevenueShed).toBe(0);
    expect(r.totalCapacityUnitsShed).toBeCloseTo(expectedUnits, 6);
    // Capacity moved; the derived revenue nameplate was left to the engine.
    expect(sector.capitalStock).toBeCloseTo(500 - expectedUnits, 6);
    expect(sector.revenue).toBe(10_000);

    const sectorBulk = db.collectionMocks["corporateSectors"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc: Record<string, number> } };
    }>;
    expect(sectorBulk[0].updateOne.update.$inc.capitalStock).toBeCloseTo(-expectedUnits, 2);
    expect(sectorBulk[0].updateOne.update.$inc.revenue).toBeUndefined();

    // The pool is credited in UNITS, through a self-healing pipeline.
    const unownedBulk = db.collectionMocks["unownedSectors"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { filter: Record<string, string>; update: unknown[] };
    }>;
    expect(unownedBulk[0].updateOne.filter.stateId).toBe("US-CA");
    expect(Array.isArray(unownedBulk[0].updateOne.update)).toBe(true);
    expect(JSON.stringify(unownedBulk[0].updateOne.update)).toContain("headroomUnits");
  });

  /**
   * FLIP-TURN CONSERVATION.
   *
   * The shed runs BEFORE `processSectors`, and it is `sectorTurn` that performs
   * the lazy per-sector flip migration. On the flip turn (`plantsStartTurn ==
   * null`) `capitalStock` is not yet authoritative, and `sectorTurn`'s adoption
   * step takes `max(storedCapacity, seedCapitalStock(nameplate))` off a revenue
   * this path deliberately never touches — the PRE-shed level. So a shed here
   * was credited to the pool and then silently restored on the corp in the same
   * turn: a one-off market-share MINT on every vacant-CEO sector in the world,
   * on the turn plants is switched on.
   *
   * Capacity shedding is therefore deferred one turn. Workers still shed.
   */
  it("defers the capacity shed on the flip turn, but still sheds workers", async () => {
    const corpId = new ObjectId();
    const corp = { _id: corpId, ceoId: null, ceoVacant: true } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      stateId: "US-CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 10_000,
      capitalStock: 500,
      // The flip has NOT happened yet.
      plantsStartTurn: undefined,
      workers: 100,
      updatedAt: new Date(0),
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now, true);

    // No capacity left the corp and none reached the pool.
    expect(r.totalCapacityUnitsShed).toBe(0);
    expect(r.totalRevenueShed).toBe(0);
    expect(sector.capitalStock).toBe(500);
    expect(sector.revenue).toBe(10_000);
    expect(db.collectionMocks["unownedSectors"]!.bulkWrite).not.toHaveBeenCalled();

    // Workers still shed — unchanged from the behaviour when `capitalStock` was
    // simply absent, which is the case this sector is indistinguishable from
    // until the migration runs.
    const sectorBulk = db.collectionMocks["corporateSectors"]!.bulkWrite.mock.calls[0][0] as Array<{
      updateOne: { update: { $inc: Record<string, number> } };
    }>;
    expect(sectorBulk[0].updateOne.update.$inc.capitalStock).toBe(-0);
    expect(sectorBulk[0].updateOne.update.$inc.workers).toBe(
      -Math.round(100 * VACANT_CEO_SECTOR_SHED_RATE)
    );
    expect(sectorBulk[0].updateOne.update.$inc.revenue).toBeUndefined();
  });

  it("skips state-owned corporations", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      ceoId: null,
      ceoVacant: true,
      countryOwnerId: "US",
    } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      stateId: "US-CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 10_000,
      workers: 100,
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
    expect(db.collectionMocks["corporateSectors"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("sheds the corp but does NOT spawn unowned in a state-nationalized bucket", async () => {
    // A private holder that wandered into a nationalized sector still sheds (its
    // own row shrinks), but the freed capacity must NOT be released back to the
    // market as unowned — that's the re-fragmentation the protection prevents.
    const natId = new ObjectId();
    const privId = new ObjectId();
    const natCorp = { _id: natId, countryOwnerId: "CN" } as unknown as Corporation;
    const privCorp = { _id: privId, ceoId: null, ceoVacant: true } as unknown as Corporation;
    const natSector = {
      _id: new ObjectId(),
      corporationId: natId,
      stateId: "HD",
      countryId: "CN",
      sectorType: "telecommunications",
      revenue: 5_000_000,
      workers: 1000,
      nationalizedAtTurn: 331,
    } as unknown as CorporateSector;
    const privSector = {
      _id: new ObjectId(),
      corporationId: privId,
      stateId: "HD",
      countryId: "CN",
      sectorType: "telecommunications",
      revenue: 10_000,
      workers: 100,
      updatedAt: new Date(0),
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([natCorp, privCorp], [natSector, privSector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    // The private corp's sector still sheds...
    expect(r.corporateSectorsUpdated).toBe(1);
    expect(db.collectionMocks["corporateSectors"]!.bulkWrite).toHaveBeenCalled();
    // ...but no unowned pool is created in the nationalized bucket.
    expect(r.unownedSectorsUpdated).toBe(0);
    expect(db.collectionMocks["unownedSectors"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("skips suspended corporations (e.g. a privatization-auction shell)", async () => {
    const corpId = new ObjectId();
    const corp = {
      _id: corpId,
      ceoId: null,
      ceoVacant: true,
      suspended: true,
    } as unknown as Corporation;
    const sector = {
      _id: new ObjectId(),
      corporationId: corpId,
      stateId: "US-CA",
      countryId: "US",
      sectorType: "technology",
      revenue: 10_000,
      workers: 100,
    } as unknown as CorporateSector;

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedVacantCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
    expect(db.collectionMocks["corporateSectors"]!.bulkWrite).not.toHaveBeenCalled();
  });
});
