/**
 * Tests that the transient disaster margin penalty is applied in processSectors.
 * Full penalty at onset turn, zero penalty at expiry turn.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { processSectors } from "./sectorCalculations";
import type { CorporationLookups } from "./types";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { DisasterEffectEntry } from "@/lib/crises/disasterMarginPenalty";

// ── Same mocks as the main sectorCalculations.test.ts ──────────────────────

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

vi.mock("@/lib/constants/commodities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/constants/commodities")>();
  return {
    ...actual,
    computeBlendedMarginModifiers: vi.fn().mockReturnValue({ inputMod: 0, surplusMod: 0 }),
  };
});

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCorp(): Corporation {
  const id = new ObjectId();
  return {
    _id: id,
    name: "TestCorp",
    type: "manufacturing",
    secondaryType: null,
    typeSwitchTurn: null,
    countryId: "US",
    headquartersState: "US-CA",
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

function makeSector(corpId: ObjectId): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: "US",
    stateId: "S1",
    sectorType: "manufacturing",
    revenue: 24_000,
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    currentGrowthCost: 0,
    profitMargin: 50,
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
    primeRateSmoothedByCountry: new Map(),
    corpById: new Map([[corp._id.toString(), corp]]),
    ceoBusinessAcumenByCorpId: new Map(),
    bondsByCorpId: new Map(),
    bondsHeldByCorpId: new Map(),
    portfolioAnchorValueByCorpId: new Map(),
    bondAndImfPortfolioAnchorByCorpId: new Map(),
    issuedBondDebtByCorpId: new Map(),
    crossCorpStockHoldingsByHolderCorpId: new Map(),
    primeRateByCountry: new Map([["US", 3.0]]),
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
    activeDisasterEffectsByState: new Map([["S1", disasterEffects]]),
    stateInputAvailabilityByState: new Map(),
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("disaster margin penalty in processSectors", () => {
  it("applies full ~−10pp penalty at onset turn and none at expiry turn", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id);
    const now = new Date();

    // Entry: -10pp at startTurn 100, duration 20 turns → expires at turn 120
    const disasterEntry: DisasterEffectEntry = {
      value: -10,
      startTurn: 100,
      durationTurns: 20,
      sectorType: null,
      strategyId: null,
    };

    const lookupsOnset = makeLookups(corp, sector, [disasterEntry]);
    const lookupsExpiry = makeLookups(corp, sector, [disasterEntry]);

    // At onset (turn 100): full -10pp penalty → effectiveMargin = 50 - 10 = 40
    const onsetResult = processSectors(lookupsOnset, 100, now);
    // At expiry (turn 120): 0 penalty → effectiveMargin = 50
    const expiryResult = processSectors(lookupsExpiry, 120, now);

    // Higher effective margin ⇒ lower maintenance ⇒ higher income.
    // So onset income < expiry income.
    expect(onsetResult.totalIncomeGenerated).toBeLessThan(expiryResult.totalIncomeGenerated);

    // Quantify: revenue = 24000/24 = 1000/turn
    // At 40% margin: maintenance = 1000*(1-0.40) = 600, profit = 400
    // At 50% margin: maintenance = 1000*(1-0.50) = 500, profit = 500
    // Difference should be ~100 per turn (in anchor units)
    const diff = expiryResult.totalIncomeGenerated - onsetResult.totalIncomeGenerated;
    // Derivation: revenue=24000, hourlyRevenue=24000/24=1000
    // onset  effectiveMargin=40 → maintenance=1000*(1-0.40)=600, profit=400
    // expiry effectiveMargin=50 → maintenance=1000*(1-0.50)=500, profit=500
    // No taxes (empty map), no dividends, no bonds → diff = 500-400 = 100 (anchor units)
    // A −1pp bug would yield diff≈10; this assertion distinguishes −10pp from −1pp.
    expect(diff).toBeCloseTo(100, 0);
  });
});
