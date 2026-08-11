import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Db, ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { makeCharacter, makeCorporation } from "@/lib/test-utils/factories";
import {
  DOMINANCE_MARGIN_PENALTY_AT_FULL,
  DOMINANCE_MARKET_SHARE_THRESHOLD,
} from "@/lib/constants/corporations";

vi.mock("@/lib/corporations/turnReferenceData", () => ({
  getTurnReferenceData: vi.fn().mockResolvedValue({
    commodityPrices: [],
    allStates: [{ _id: "CA", name: "California", countryId: "US", gdp: 1 }],
    allTariffs: [],
    activeFtaPairs: [],
    activeSubsidies: [],
    exchangeRateDocs: [{ currencyCode: "USD", rate: 1 }],
    stateBudgetsForTax: [],
  }),
}));
vi.mock("@/lib/db/patreonBorders", () => ({
  fetchBordersByUserIds: vi.fn().mockResolvedValue(new Map()),
}));
// isLabourWagesEnabled opens its own DB handle (getDb) when no preloaded
// config is passed — stub it so the query stays fully MockDb-driven.
vi.mock("@/lib/labour/featureFlag", async () => {
  const actual = await vi.importActual<typeof import("@/lib/labour/featureFlag")>(
    "@/lib/labour/featureFlag"
  );
  return {
    ...actual,
    isLabourWagesEnabled: vi.fn().mockResolvedValue(false),
  };
});
vi.mock("@/lib/corporations/imfPortfolioReceivables", () => ({
  findImfFacilityReceivablesForLender: vi
    .fn()
    .mockResolvedValue({ receivables: [], totalPrincipal: 0 }),
}));
vi.mock("@/lib/currency/corporationCapital", async () => {
  const actual = await vi.importActual<typeof import("@/lib/currency/corporationCapital")>(
    "@/lib/currency/corporationCapital"
  );
  return {
    ...actual,
    loadFxRatesByCurrency: vi.fn().mockResolvedValue(new Map([["USD", 1]])),
  };
});

let db: MockDb;

describe("loadCorporationDetailView", () => {
  beforeEach(() => {
    db = createMockDb();
    vi.clearAllMocks();
    db.collection("corporations");
    db.collection("characters");
    db.collection("corporateSectors");
    db.collection("bonds");
    db.collection("corporationHistory");
  });

  it("returns a stable corporation detail payload for a minimal corporation", async () => {
    const ceo = makeCharacter({
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: "CEO Player",
      sequentialId: 42,
    });
    const corporation = makeCorporation({
      _id: new ObjectId(),
      ceoId: ceo._id,
      userId: ceo.userId,
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      shareholders: [],
      publicFloat: 0,
    });

    db.collectionMocks["characters"]!.findOne.mockResolvedValue(ceo);
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["bonds"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({ income: 0 });

    const { loadCorporationDetailView } = await import("./corporationDetail");
    const result = await loadCorporationDetailView({
      db: db as unknown as Db,
      corporation,
      currentTurn: 10,
      viewerUserId: null,
    });

    expect(result.corporation._id).toBe(corporation._id.toString());
    expect(result.corporation.name).toBe("Test Corp");
    expect(result.corporation.headquartersStateName).toBe("California");
    expect(result.corporation.shareholders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          characterId: ceo._id.toString(),
          name: "CEO Player",
        }),
      ])
    );
    expect(result.ceo).toEqual(
      expect.objectContaining({
        characterId: ceo._id.toString(),
        name: "CEO Player",
      })
    );
    expect(result.sectors).toEqual([]);
    expect(result.financials.totalRevenue).toBe(0);
    expect(result.balanceSheet.assets.cashOnHand).toBe(corporation.liquidCapital);
  });

  it("applies dominance margin penalty for dominant sectors on the corp page", async () => {
    const ceo = makeCharacter({
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: "CEO",
      sequentialId: 1,
    });
    const corporation = makeCorporation({
      _id: new ObjectId(),
      ceoId: ceo._id,
      userId: ceo.userId,
      countryId: "US",
      headquartersState: "CA",
      // Type differs from sector type so the +5 sector-type match bonus and
      // -15 mismatch penalty don't accidentally cancel the dominance penalty.
      // Combined with the +10 home-state bonus, the net non-dominance margin
      // mods sum to -5, leaving the -15 dominance penalty fully visible.
      type: "energy",
      legalStructure: "us_c_corp", // no minimum dividend, isolates the dominance test
      liquidCurrencyCode: "USD",
      marketingBudget: 0,
      logisticsBudget: 0,
      rdBudget: 0,
      ceoSalary: 0,
      dividendRate: 0,
      shareholders: [],
      publicFloat: 0,
    });
    const sectorId = new ObjectId();
    const dominantSector = {
      _id: sectorId,
      corporationId: corporation._id,
      countryId: "US",
      stateId: "CA",
      sectorType: "healthcare",
      profitMargin: 40,
      revenue: 1_000_000,
      workers: 100,
      currentGrowthCost: 0,
      currentGrowthRate: 0,
      growthRate: 0,
      targetGrowthRate: 0,
      productionPolicyLevel: 0,
      productionPolicy: 0,
      negativeProductionSustainedTurns: 0,
      strategyId: "standard",
    };

    db.collectionMocks["characters"]!.findOne.mockResolvedValue(ceo);
    // The corp-detail flow issues several corporateSectors.find() calls:
    //   1. {corporationId}             → this corp's own sectors
    //   2. {} (projection)              → cross-corp lookup for tariff presence
    //   3. {$or: bucketFilter}          → siblings in the same (state, sectorType)
    // The mock returns the same cursor regardless of filter, which is fine
    // for this scenario — every query should observe the single test sector.
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([dominantSector]),
    } as never);
    // No unowned doc → effective market falls back to GDP baseline, which
    // is tiny relative to the corp's revenue → ~100% share.
    db.collection("unownedSectors");
    db.collectionMocks["unownedSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    // Sibling corp lookup happens to share the corporations collection;
    // return empty so the fallback (this corp injected into corpById) is used.
    db.collectionMocks["corporations"]!.find.mockReturnValue({
      project: () => ({ toArray: () => Promise.resolve([]) }),
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["bonds"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({ income: 0 });

    const { loadCorporationDetailView } = await import("./corporationDetail");
    const view = await loadCorporationDetailView({
      db: db as unknown as Db,
      corporation,
      currentTurn: 1,
      viewerUserId: null,
    });
    const sector = view.sectors[0];

    expect(sector).toBeDefined();
    expect(sector!.marketSharePercent).toBeGreaterThan(DOMINANCE_MARKET_SHARE_THRESHOLD);
    // dominance penalty at full = DOMINANCE_MARGIN_PENALTY_AT_FULL (negative).
    // effective margin should be at least that much below profitMargin.
    expect(sector!.effectiveProfitMargin).toBeLessThanOrEqual(
      40 + DOMINANCE_MARGIN_PENALTY_AT_FULL + 0.01
    );
  });

  it("scales displayed revenue down to match the corp's realized (not nameplate) revenue (#2958)", async () => {
    const ceo = makeCharacter({
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: "CEO",
      sequentialId: 2,
    });
    const corporation = makeCorporation({
      _id: new ObjectId(),
      ceoId: ceo._id,
      userId: ceo.userId,
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      marketingBudget: 0,
      logisticsBudget: 0,
      rdBudget: 0,
      ceoSalary: 0,
      dividendRate: 0,
      shareholders: [],
      publicFloat: 0,
    });
    const sector = {
      _id: new ObjectId(),
      corporationId: corporation._id,
      countryId: "US",
      stateId: "CA",
      sectorType: "healthcare",
      profitMargin: 40,
      // Daily nameplate revenue. Hourly nameplate = 1,000,000 / TURNS_PER_DAY(24)
      // ≈ 41,666.67 with productionPolicyLevel 0 (multiplier 1).
      revenue: 1_000_000,
      workers: 100,
      currentGrowthCost: 0,
      currentGrowthRate: 0,
      growthRate: 0,
      targetGrowthRate: 0,
      productionPolicyLevel: 0,
      productionPolicy: 0,
      negativeProductionSustainedTurns: 0,
      strategyId: "standard",
    };

    db.collectionMocks["characters"]!.findOne.mockResolvedValue(ceo);
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([sector]),
    } as never);
    db.collection("unownedSectors");
    db.collectionMocks["unownedSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["corporations"]!.find.mockReturnValue({
      project: () => ({ toArray: () => Promise.resolve([]) }),
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["bonds"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    // The corp only actually realized HALF of nameplate hourly revenue last
    // turn (e.g. market-clearing haircut from an oversupplied sector, same
    // shape as ticket #925 / TELEMOP). Hourly nameplate is ~41,666.67, so
    // realized ~20,833.33 ⇒ expected ratio 0.5.
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({
      income: 0,
      revenue: 20_833.33,
    });

    const { loadCorporationDetailView } = await import("./corporationDetail");
    const view = await loadCorporationDetailView({
      db: db as unknown as Db,
      corporation,
      currentTurn: 10,
      viewerUserId: null,
    });

    // Pre-fix this would have been ~1,000,000 (pure nameplate, no haircut).
    expect(view.financials.totalRevenue).toBeCloseTo(500_000, -2);
    expect(view.sectors[0]!.financialRevenue).toBeCloseTo(500_000, -2);
  });

  it("uses the sector's exact persisted realizedRevenue, ignoring the blended corp ratio (#3001/#3002)", async () => {
    const ceo = makeCharacter({
      _id: new ObjectId(),
      userId: new ObjectId(),
      name: "CEO",
      sequentialId: 2,
    });
    const corporation = makeCorporation({
      _id: new ObjectId(),
      ceoId: ceo._id,
      userId: ceo.userId,
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      marketingBudget: 0,
      logisticsBudget: 0,
      rdBudget: 0,
      ceoSalary: 0,
      dividendRate: 0,
      shareholders: [],
      publicFloat: 0,
    });
    // Two sectors with the SAME nameplate but DIFFERENT realized outcomes: one
    // sold most of its output, one is embargo-suspended at $0. The old blended
    // ratio would smear a single corp-wide fraction across both; the exact
    // per-sector field must keep them distinct.
    const soldSector = {
      _id: new ObjectId(),
      corporationId: corporation._id,
      countryId: "US",
      stateId: "CA",
      sectorType: "healthcare",
      profitMargin: 40,
      revenue: 1_000_000,
      realizedRevenue: 900_000,
      workers: 100,
      currentGrowthCost: 0,
      currentGrowthRate: 0,
      growthRate: 0,
      targetGrowthRate: 0,
      productionPolicyLevel: 0,
      productionPolicy: 0,
      negativeProductionSustainedTurns: 0,
      strategyId: "standard",
    };
    const embargoedSector = {
      ...soldSector,
      _id: new ObjectId(),
      stateId: "TX",
      realizedRevenue: 0,
      embargoSuspended: true,
    };

    db.collectionMocks["characters"]!.findOne.mockResolvedValue(ceo);
    db.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([soldSector, embargoedSector]),
    } as never);
    db.collection("unownedSectors");
    db.collectionMocks["unownedSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["corporations"]!.find.mockReturnValue({
      project: () => ({ toArray: () => Promise.resolve([]) }),
      toArray: () => Promise.resolve([]),
    } as never);
    db.collectionMocks["bonds"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    // A deliberately MISLEADING history ratio: hourly nameplate ≈ 83,333.33
    // (two 1M/day sectors), realized set to imply a ~0.3 blended ratio. If the
    // code still used the blend, both sectors would read ~300k. The exact field
    // must win instead.
    db.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({
      income: 0,
      revenue: 25_000,
    });

    const { loadCorporationDetailView } = await import("./corporationDetail");
    const view = await loadCorporationDetailView({
      db: db as unknown as Db,
      corporation,
      currentTurn: 10,
      viewerUserId: null,
    });

    const byState = new Map(view.sectors.map((s) => [s.stateId, s]));
    // Exact per-sector realized values, NOT the blended ~0.3 ratio.
    expect(byState.get("CA")!.financialRevenue).toBeCloseTo(900_000, -2);
    expect(byState.get("CA")!.realizedRevenue).toBeCloseTo(900_000, -2);
    expect(byState.get("TX")!.financialRevenue).toBe(0);
    expect(byState.get("TX")!.embargoSuspended).toBe(true);
    expect(view.financials.totalRevenue).toBeCloseTo(900_000, -2);
  });
});

describe("loadCorporationDetailView — plants-tier physicals", () => {
  let pdb: MockDb;

  function sectorDoc(corporationId: ObjectId, partial: Record<string, unknown> = {}) {
    return {
      _id: new ObjectId(),
      corporationId,
      stateId: "CA",
      countryId: "US",
      sectorType: "manufacturing",
      targetGrowthRate: 0,
      currentGrowthRate: 0,
      currentGrowthCost: 0,
      revenue: 1_000,
      profitMargin: 20,
      workers: 10,
      capitalStock: 5_000,
      producedUnits: 4_000,
      soldUnits: 1_200,
      constructionInProgressAnchor: 250_000,
      mothballed: true,
      buildQueue: [{ unitsOrdered: 800, costPaidAnchor: 250_000, startTurn: 4, onlineTurn: 52 }],
      ...partial,
    };
  }

  async function load(marketSystemMode: string | undefined) {
    pdb = createMockDb();
    vi.clearAllMocks();
    for (const name of [
      "corporations",
      "characters",
      "corporateSectors",
      "bonds",
      "corporationHistory",
      "gameConfig",
    ]) {
      pdb.collection(name);
    }
    const ceo = makeCharacter({ _id: new ObjectId(), userId: new ObjectId(), name: "CEO" });
    const corporation = makeCorporation({
      _id: new ObjectId(),
      ceoId: ceo._id,
      userId: ceo.userId,
      countryId: "US",
      headquartersState: "CA",
      liquidCurrencyCode: "USD",
      shareholders: [],
      publicFloat: 0,
    });
    pdb.collectionMocks["characters"]!.findOne.mockResolvedValue(ceo);
    pdb.collectionMocks["gameConfig"]!.findOne.mockResolvedValue(
      marketSystemMode ? { _id: "default", marketSystemMode } : null
    );
    const sectors = [sectorDoc(corporation._id)];
    pdb.collectionMocks["corporateSectors"]!.find.mockReturnValue({
      toArray: () => Promise.resolve(sectors),
    } as never);
    pdb.collectionMocks["bonds"]!.find.mockReturnValue({
      toArray: () => Promise.resolve([]),
    } as never);
    pdb.collectionMocks["corporationHistory"]!.findOne.mockResolvedValue({ income: 0 });

    const { loadCorporationDetailView } = await import("./corporationDetail");
    return loadCorporationDetailView({
      db: pdb as unknown as Db,
      corporation,
      currentTurn: 40,
      viewerUserId: null,
    });
  }

  it("publishes capacity, output, sales, queue and CIP under plants", async () => {
    const result = await load("plants");
    expect(result.corporation.plantsMode).toBe(true);

    const row = result.sectors[0]!;
    expect(row.capacityUnits).toBe(5_000);
    expect(row.producedUnits).toBe(4_000);
    expect(row.soldUnits).toBe(1_200);
    expect(row.constructionInProgressAnchor).toBe(250_000);
    expect(row.mothballed).toBe(true);
    // 1200/4000 = 0.3 → "low". Fill is the number a rival most wants, so the
    // exact ratio and the band are both computed here and the API layer decides
    // which of them a given viewer keeps.
    expect(row.fillRate).toBeCloseTo(0.3, 10);
    expect(row.fillRateBand).toBe("low");
    expect(row.buildQueueSummary).toEqual({
      orders: 1,
      unitsOrdered: 800,
      unitsRemaining: 800,
      nextOnlineTurn: 52,
      turnsRemaining: 12,
    });
  });

  it("rolls the physicals up to corp level, with fill as a ratio of totals", async () => {
    const result = await load("plants");
    expect(result.corporation.physical).toEqual({
      capacityUnits: 5_000,
      producedUnits: 4_000,
      soldUnits: 1_200,
      fillRate: 0.3,
      constructionInProgressAnchor: 250_000,
      unitsOnOrder: 800,
      buildingSectorCount: 1,
      mothballedSectorCount: 1,
      sectorCount: 1,
    });
  });

  it("reports nothing physical outside plants, and never removes a legacy field", async () => {
    // A capital-tier world must be byte-identical apart from the new null keys:
    // the fields exist so a client never has to branch on their presence, but
    // they carry no value that could be mistaken for a real reading.
    const result = await load("capital");
    expect(result.corporation.plantsMode).toBe(false);
    expect(result.corporation.physical).toBeNull();

    const row = result.sectors[0]!;
    expect(row.capacityUnits).toBeNull();
    expect(row.producedUnits).toBeNull();
    expect(row.soldUnits).toBeNull();
    expect(row.fillRate).toBeNull();
    expect(row.fillRateBand).toBeNull();
    expect(row.buildQueueSummary).toBeNull();
    expect(row.mothballed).toBe(false);
    // Legacy fields survive untouched.
    expect(row.revenue).toBe(1_000);
    expect(row.workers).toBeGreaterThan(0);
  });

  it("treats an absent market mode as off, not as plants", async () => {
    const result = await load(undefined);
    expect(result.corporation.plantsMode).toBe(false);
  });
});
