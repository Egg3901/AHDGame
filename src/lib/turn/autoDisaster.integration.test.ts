/**
 * End-to-end integration test: auto-disaster spawner → sector margin penalty → expiry.
 *
 * Approach (bridged, not full buildCorporationLookups):
 *   (a) Run the real spawner (processAutoDisasterTurn) against MockDb. This exercises
 *       the real shouldSpawn / processAutoDisasterSpawn / selectDisasterTemplate paths
 *       and inserts a real crisis document into the mock.
 *   (b) Read the inserted crisis back from MockDb and call `buildDisasterEffectsByState`
 *       (shared with buildLookups.ts) to produce the `activeDisasterEffectsByState` map.
 *       This avoids needing a real Mongo connection for the dozens of other collections
 *       buildCorporationLookups queries.
 *   (c) Feed that map into processSectors via the same CorporationLookups shape used by
 *       sectorCalculations.disaster.test.ts (Task 4).
 *
 * The test asserts:
 *   - At spawn turn: effective margin reduced (~−10pp) → lower income vs baseline.
 *   - At expiry turn (startTurn + durationTurns): penalty is 0 → income matches baseline.
 *   - Stored `corporateSectors.profitMargin` is NEVER mutated (still its original value).
 *
 * Limitation: buildCorporationLookups itself is not called (it needs many real collections).
 * The activeDisasterEffectsByState is built via the shared buildDisasterEffectsByState helper,
 * so loader and test stay in sync automatically.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import { createMockDb, type MockDb } from "@/lib/test-utils/mockDb";
import { processAutoDisasterTurn } from "./autoDisasterTurn";
import { processSectors } from "./corporation/sectorCalculations";
import type { CorporationLookups } from "./corporation/types";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { buildDisasterEffectsByState } from "@/lib/crises/disasterMarginPenalty";
import type { DisasterEffectEntry } from "@/lib/crises/disasterMarginPenalty";
import type { Crisis } from "@/lib/db/types/crisis";

// ── Module mocks (same as sectorCalculations.disaster.test.ts) ───────────────

// Enumeration is covered in countryAccess.test.ts; mock it so the spawner loop
// runs for exactly the one country this end-to-end test seeds (BR).
vi.mock("@/lib/countryAccess", () => ({
  getSimulatedCountryIds: vi.fn().mockResolvedValue(["BR"]),
}));

vi.mock("@/lib/bonds/corporateCredit", () => ({
  sumCorporateSectorConstructionInProgress: vi.fn().mockReturnValue(0),
  computeCorporateCreditAtTurn: vi.fn().mockReturnValue({
    creditRating: { rating: "BBB", compositeScore: 50 },
    totalDebt: 0,
    totalEquity: 1_000_000,
  }),
  isCorporateIssuerBond: vi.fn().mockReturnValue(false),
}));

vi.mock("@/lib/tariffs/tariffEffects", () => ({
  getForeignTariffMarginModifier: vi.fn().mockReturnValue(0),
  getDomesticTariffMalus: vi.fn().mockReturnValue(0),
  getTariffBlendWeights: vi
    .fn()
    .mockReturnValue({ globalWeight: 0.5, nationalWeight: 0.25, localWeight: 0.25 }),
}));

vi.mock("@/lib/constants/corporations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants/corporations")>();
  return {
    ...actual,
    getHomeLocationMarginBonus: vi.fn().mockReturnValue(0),
    getSectorTypeMatchModifier: vi.fn().mockReturnValue(0),
    getSprawlModifier: vi.fn().mockReturnValue(0),
  };
});

vi.mock("@/lib/subsidies/subsidyEffects", () => ({
  getSubsidyMarginModifier: vi.fn().mockReturnValue(0),
}));

vi.mock("@/lib/constants/commodities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants/commodities")>()),
  computeBlendedMarginModifiers: vi.fn().mockReturnValue({ inputMod: 0, surplusMod: 0 }),
}));

vi.mock("@/lib/utils/productionPolicy", () => ({
  trendProductionPolicy: vi.fn().mockImplementation((current: number) => current),
  getRevenueMultiplier: vi.fn().mockReturnValue(1),
}));

vi.mock("@/lib/constants/sectorStrategies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants/sectorStrategies")>();
  return {
    ...actual,
    getEffectiveStrategyRates: vi.fn().mockReturnValue({
      growthRate: 1,
      profitMargin: 0,
      isTransitioning: false,
    }),
  };
});

// ── Constants ─────────────────────────────────────────────────────────────────

const SPAWN_TURN = 144; // exactly at the 144-turn cadence boundary
const COUNTRY_ID = "BR";
const STATE_ID = "S1";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCorp(): Corporation {
  const id = new ObjectId();
  return {
    _id: id,
    name: "DisasterCorp",
    type: "manufacturing",
    secondaryType: null,
    typeSwitchTurn: null,
    countryId: COUNTRY_ID,
    headquartersState: STATE_ID,
    liquidCapital: 1_000_000,
    marketingBudget: 0,
    marketingStrength: 0,
    logisticsBudget: 0,
    logisticsStrength: 0,
    ceoId: new ObjectId(),
    userId: new ObjectId(),
    totalShares: 10_000_000,
    sharePrice: 1.0,
    shareholders: [],
    dividendRate: 0,
    ceoSalary: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as Corporation;
}

function makeSector(corpId: ObjectId, profitMargin = 50): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: COUNTRY_ID,
    stateId: STATE_ID,
    sectorType: "manufacturing",
    revenue: 24_000,
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    profitMargin,
    workers: 100,
    strategyId: "standard",
    transitionFromStrategyId: null,
    transitionStartTurn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as CorporateSector;
}

function makeLookups(
  corp: Corporation,
  sector: CorporateSector,
  disasterEffects: DisasterEffectEntry[]
): CorporationLookups {
  const sectorsByCorp = new Map([[corp._id.toString(), [sector]]]);
  return {
    eraUnitScale: 1,
    corporations: [corp],
    sectorsByCorp,
    corpById: new Map([[corp._id.toString(), corp]]),
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map([[COUNTRY_ID, 3.0]]),
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
    landedPremiumByState: new Map(),
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
    activeDisasterEffectsByState: new Map([[STATE_ID, disasterEffects]]),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("auto-disaster end-to-end: spawner → margin penalty → expiry", () => {
  let db: MockDb;

  beforeEach(() => {
    db = createMockDb();
    ["countryGameStates", "crises", "states"].forEach((c) => db.collection(c));
    vi.clearAllMocks();
  });

  it("spawner inserts an active autoGenerated crisis with a decay profitMargin effect", async () => {
    // Seed: one active country due for a disaster (lastDisasterTurn 0, currentTurn 144)
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: COUNTRY_ID, isActive: true, lastDisasterTurn: 0 }]),
    });
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: COUNTRY_ID,
      lastDisasterTurn: 0,
    });
    db.collectionMocks["crises"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: STATE_ID, countryId: COUNTRY_ID, regionType: "region" }]),
    });

    await processAutoDisasterTurn(db as unknown as Db, SPAWN_TURN, { autoDisastersEnabled: true });

    expect(db.collectionMocks["crises"]!.insertOne).toHaveBeenCalledOnce();
    const inserted = db.collectionMocks["crises"]!.insertOne.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(inserted.autoGenerated).toBe(true);
    expect(inserted.status).toBe("active");
    expect(inserted.countryIds).toContain(COUNTRY_ID);
    expect((inserted.regionIds as string[]).length).toBe(1);
    expect(inserted.durationTurns).toBeGreaterThan(0);

    const effects = inserted.effects as Array<{
      effectType: string;
      targetType: string;
      value: number;
    }>;
    const decayEffect = effects.find(
      (e) => e.effectType === "decay" && e.targetType === "profitMargin"
    );
    expect(decayEffect).toBeDefined();
    // A decay margin penalty is injected. Its magnitude is the default
    // AUTO_DISASTER_MARGIN_PENALTY (−10) for templates without their own margin
    // effect, or the template's own sector-margin value for infrastructure
    // disasters (bridge collapse, port closure, …) — whichever the deterministic
    // pick lands on. Assert the mechanism (a negative decay margin), not a brittle
    // exact value that breaks whenever the eligible-template pool shifts.
    expect(decayEffect!.value).toBeLessThan(0);
  });

  it("sector margin is reduced at spawn turn and restored at expiry turn; stored profitMargin never mutates", async () => {
    // ── Step 1: Run the real spawner ──────────────────────────────────────────
    db.collectionMocks["countryGameStates"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: COUNTRY_ID, isActive: true, lastDisasterTurn: 0 }]),
    });
    db.collectionMocks["countryGameStates"]!.findOne.mockResolvedValue({
      _id: COUNTRY_ID,
      lastDisasterTurn: 0,
    });
    db.collectionMocks["crises"]!.findOne.mockResolvedValue(null);
    db.collectionMocks["states"]!.find.mockReturnValue({
      toArray: vi
        .fn()
        .mockResolvedValue([{ _id: STATE_ID, countryId: COUNTRY_ID, regionType: "region" }]),
    });

    await processAutoDisasterTurn(db as unknown as Db, SPAWN_TURN, { autoDisastersEnabled: true });

    // Confirm a crisis was inserted
    expect(db.collectionMocks["crises"]!.insertOne).toHaveBeenCalledOnce();
    const insertedCrisis = db.collectionMocks["crises"]!.insertOne.mock.calls[0]![0] as Record<
      string,
      unknown
    >;

    // ── Step 2: Bridge — build activeDisasterEffectsByState from the real crisis ──
    const insertedRegionId = (insertedCrisis.regionIds as string[])[0]!;
    const startTurn = insertedCrisis.startTurn as number;
    const durationTurns = insertedCrisis.durationTurns as number;

    // Re-create a sector whose stateId matches the inserted crisis region
    const corp = makeCorp();
    const ORIGINAL_PROFIT_MARGIN = 50;
    const sector: CorporateSector = {
      ...makeSector(corp._id, ORIGINAL_PROFIT_MARGIN),
      stateId: insertedRegionId,
    };

    const disasterEffectsMap = buildDisasterEffectsByState([insertedCrisis as unknown as Crisis]);
    const disasterEffectsForSector = disasterEffectsMap.get(insertedRegionId) ?? [];

    expect(disasterEffectsForSector.length).toBeGreaterThan(0);

    // ── Step 3a: processSectors at the SPAWN TURN (full penalty) ──────────────
    const lookupsOnset: CorporationLookups = {
      ...makeLookups(corp, sector, []),
      activeDisasterEffectsByState: new Map([[insertedRegionId, disasterEffectsForSector]]),
      sectorsByCorp: new Map([[corp._id.toString(), [{ ...sector, stateId: insertedRegionId }]]]),
    };
    const onsetResult = processSectors(lookupsOnset, startTurn, new Date());

    // ── Step 3b: processSectors at the EXPIRY TURN (zero penalty) ────────────
    const expiryTurn = startTurn + durationTurns;
    const lookupsExpiry: CorporationLookups = {
      ...makeLookups(corp, sector, []),
      activeDisasterEffectsByState: new Map([[insertedRegionId, disasterEffectsForSector]]),
      sectorsByCorp: new Map([[corp._id.toString(), [{ ...sector, stateId: insertedRegionId }]]]),
    };
    const expiryResult = processSectors(lookupsExpiry, expiryTurn, new Date());

    // ── Assertions ────────────────────────────────────────────────────────────

    // The sector suffers a penalty at onset → lower income at onset vs expiry
    expect(onsetResult.totalIncomeGenerated).toBeLessThan(expiryResult.totalIncomeGenerated);

    // With revenue=24000, hourlyRevenue=1000/turn, the per-turn income gap equals
    // the onset margin penalty in points × (hourlyRevenue / 100) = |penalty| × 10
    // (e.g. a −10 penalty → 100; a −6 infra-disaster penalty → 60). Derive it from
    // the actual injected decay value so the test is robust to which template the
    // deterministic spawner pick lands on.
    const decayValue = (
      insertedCrisis.effects as Array<{ effectType: string; targetType: string; value: number }>
    ).find((e) => e.effectType === "decay" && e.targetType === "profitMargin")!.value;
    const diff = expiryResult.totalIncomeGenerated - onsetResult.totalIncomeGenerated;
    expect(diff).toBeCloseTo(Math.abs(decayValue) * 10, 0);

    // The stored profitMargin must never have been mutated
    expect(sector.profitMargin).toBe(ORIGINAL_PROFIT_MARGIN);
  });
});
