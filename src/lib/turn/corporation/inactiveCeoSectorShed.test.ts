import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector, User } from "@/lib/db/types";
import type { CorporationLookups } from "./types";
import { VACANT_CEO_SECTOR_SHED_RATE } from "./vacantCeoSectorShed";
import {
  INACTIVE_CEO_TURN_THRESHOLD,
  shedInactiveCeoSectorsToUnowned,
} from "./inactiveCeoSectorShed";

vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

const TURN_MS = 60 * 60 * 1000;

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

function makeCorp(opts: Partial<Corporation> & { _id?: ObjectId; userId?: ObjectId }): Corporation {
  return {
    _id: opts._id ?? new ObjectId(),
    ceoId: opts.ceoId ?? new ObjectId(),
    ceoVacant: opts.ceoVacant ?? false,
    userId: opts.userId,
    ceoType: opts.ceoType,
    countryOwnerId: opts.countryOwnerId,
    isNationalized: opts.isNationalized,
    name: opts.name ?? "TestCorp",
    ...opts,
  } as unknown as Corporation;
}

function makeSector(opts: {
  corporationId: ObjectId;
  revenue: number;
  workers: number;
  stateId?: string;
  sectorType?: string;
  countryId?: string;
}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: opts.corporationId,
    stateId: opts.stateId ?? "US-CA",
    countryId: opts.countryId ?? "US",
    sectorType: opts.sectorType ?? "technology",
    revenue: opts.revenue,
    workers: opts.workers,
    updatedAt: new Date(0),
  } as unknown as CorporateSector;
}

describe("shedInactiveCeoSectorsToUnowned", () => {
  let db: MockDb;
  const now = new Date("2026-05-17T12:00:00Z");
  const inactiveCutoff = new Date(now.getTime() - (INACTIVE_CEO_TURN_THRESHOLD + 1) * TURN_MS);
  const activeCutoff = new Date(now.getTime() - (INACTIVE_CEO_TURN_THRESHOLD - 1) * TURN_MS);

  beforeEach(async () => {
    vi.clearAllMocks();
    db = createMockDb();
    db.collection("corporateSectors");
    db.collection("unownedSectors");
    db.collection("users");
    const { getDb } = await import("@/lib/mongodb");
    vi.mocked(getDb).mockResolvedValue(db as unknown as Db);
  });

  function seedUsers(users: Array<Partial<User> & { _id: ObjectId }>): void {
    const usersColl = db.collection("users");
    vi.mocked(usersColl.find).mockReturnValue({
      project: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue(users),
      }),
      toArray: vi.fn().mockResolvedValue(users),
    } as unknown as ReturnType<typeof usersColl.find>);
  }

  it("does not shed when CEO user has been active within the threshold", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([{ _id: userId, lastActivity: activeCutoff, createdAt: new Date(0) }]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
    expect(r.totalRevenueShed).toBe(0);
    expect(db.collectionMocks["corporateSectors"]!.bulkWrite).not.toHaveBeenCalled();
  });

  it("sheds 10% when CEO user has been inactive beyond the threshold", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([{ _id: userId, lastActivity: inactiveCutoff, createdAt: new Date(0) }]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(1);
    expect(r.totalRevenueShed).toBe(Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE));
    expect(sector.revenue).toBe(10_000 - Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE));
    expect(sector.workers).toBe(100 - Math.round(100 * VACANT_CEO_SECTOR_SHED_RATE));
  });

  it("skips vacant corps (handled by vacant shed earlier in pipeline)", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId, ceoVacant: true });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([{ _id: userId, lastActivity: inactiveCutoff, createdAt: new Date(0) }]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
  });

  it("skips state-owned corps", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId, countryOwnerId: "US" });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([{ _id: userId, lastActivity: inactiveCutoff, createdAt: new Date(0) }]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
  });

  it("skips imperial CEOs", async () => {
    const corpId = new ObjectId();
    const corp = makeCorp({ _id: corpId, ceoType: "imperial" });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
  });

  it("skips corps with no userId", async () => {
    const corpId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId: undefined });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
  });

  it("falls back to createdAt when lastActivity is missing — inactive", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([{ _id: userId, lastActivity: undefined, createdAt: inactiveCutoff }]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(1);
  });

  it("falls back to createdAt when lastActivity is missing — active", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([{ _id: userId, lastActivity: undefined, createdAt: activeCutoff }]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
  });

  it("skips corp whose user document is missing", async () => {
    const corpId = new ObjectId();
    const userId = new ObjectId();
    const corp = makeCorp({ _id: corpId, userId });
    const sector = makeSector({ corporationId: corpId, revenue: 10_000, workers: 100 });
    seedUsers([]);

    const lookups = makeMinimalLookups([corp], [sector]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(0);
  });

  it("sheds across multiple corps owned by the same inactive user", async () => {
    const userId = new ObjectId();
    const corpA = makeCorp({ _id: new ObjectId(), userId, name: "A" });
    const corpB = makeCorp({ _id: new ObjectId(), userId, name: "B" });
    const sectorA = makeSector({ corporationId: corpA._id, revenue: 10_000, workers: 100 });
    const sectorB = makeSector({ corporationId: corpB._id, revenue: 20_000, workers: 200 });
    seedUsers([{ _id: userId, lastActivity: inactiveCutoff, createdAt: new Date(0) }]);

    const lookups = makeMinimalLookups([corpA, corpB], [sectorA, sectorB]);
    const r = await shedInactiveCeoSectorsToUnowned(db as unknown as Db, lookups, now);

    expect(r.corporateSectorsUpdated).toBe(2);
    expect(r.totalRevenueShed).toBe(
      Math.round(10_000 * VACANT_CEO_SECTOR_SHED_RATE) +
        Math.round(20_000 * VACANT_CEO_SECTOR_SHED_RATE)
    );
  });
});
