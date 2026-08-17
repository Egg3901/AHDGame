/**
 * Unit tests for processSectors, the pure computation core of the corporation turn.
 *
 * processSectors is a pure function (no DB calls) that accepts pre-built lookup
 * maps and returns bulkWrite ops + payment maps. This lets us test the financial
 * logic (dividends, CEO salary, share price, tax, type-switch penalty, strategy
 * transition) without mocking MongoDB.
 */
import { describe, it, expect, vi } from "vitest";
import { ObjectId } from "mongodb";
import { processSectors } from "./sectorCalculations";
import type { CorporationLookups } from "./types";
import type { LabourContext } from "@/lib/labour/laborCost";
import { UNIONIZATION_TREND_STEP_PER_TURN } from "@/lib/labour/unionization";
import { getEffectiveStrategyRates } from "@/lib/constants/sectorStrategies";
import { COMMODITY_TYPES } from "@/lib/constants/commodities";
import { MARKET_DISABLED, type MarketContext } from "@/lib/market/marketContext";
import {
  STRIKE_UNIONIZATION_THRESHOLD,
  STRIKE_DURATION_TURNS,
  STRIKE_COOLDOWN_TURNS,
  STRIKE_REVENUE_THROTTLE,
  STRIKE_WAITOUT_UNIONIZATION_BUMP,
} from "@/lib/labour/strikes";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import {
  TURNS_PER_DAY,
  MIN_SHARE_PRICE,
  softCapEffectiveMargin,
} from "@/lib/constants/corporations";
// Effective margin is soft-capped on the high side, so profitMargin:100 (used
// below as a "zero maintenance" shortcut) now realizes at ~95.2%, not 100%.
// Scale the income expectations by this factor rather than assuming all-profit.
const EFF_MARGIN_100 = softCapEffectiveMargin(100) / 100;
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { STRATEGY_TRANSITION_TURNS } from "@/lib/constants/sectorStrategies";
import type { CurrencyCode } from "@/lib/constants/currencies";

/** Sum all currency amounts for a character from a currency-aware payment map */
function getTotalPayment(map: Map<string, Map<CurrencyCode, number>>, charId: string): number {
  const currMap = map.get(charId);
  if (!currMap) return 0;
  let total = 0;
  for (const amount of currMap.values()) total += amount;
  return total;
}

// ── Mocks for external dependencies ──────────────────────────────────────────
// We mock everything that isn't the pure financial computation so tests focus
// only on the business logic under test.

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

// Mock the location and type-match modifier helpers so tests can control margin arithmetic
// precisely without depending on HQ/sector geography.
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

// ── Test helpers ──────────────────────────────────────────────────────────────

/** Build the minimal lookup map that processSectors requires. */
function baseLookups(corporations: Corporation[], sectors: CorporateSector[]): CorporationLookups {
  const sectorsByCorp = new Map<string, CorporateSector[]>();
  for (const s of sectors) {
    const key = s.corporationId.toString();
    sectorsByCorp.set(key, [...(sectorsByCorp.get(key) ?? []), s]);
  }
  return {
    eraUnitScale: 1,
    corporations,
    sectorsByCorp,
    primeRateSmoothedByCountry: new Map(),
    corpById: new Map(corporations.map((c) => [c._id.toString(), c])),
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
    activeDisasterEffectsByState: new Map(),
    stateInputAvailabilityByState: new Map(),
  };
}

function makeCorp(overrides: Partial<Corporation> = {}): Corporation {
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
    ...overrides,
  } as Corporation;
}

/**
 * Build a minimal sector. Location and type modifiers are mocked to zero
 * (see vi.mock of corporations constants above), so effective margin =
 * profitMargin without any state/geography bonus noise.
 */
function makeSector(corpId: ObjectId, overrides: Partial<CorporateSector> = {}): CorporateSector {
  return {
    _id: new ObjectId(),
    corporationId: corpId,
    countryId: "US",
    stateId: "US-CA",
    sectorType: "manufacturing",
    revenue: 24_000, // $1,000/turn at TURNS_PER_DAY=24
    targetGrowthRate: 0,
    currentGrowthRate: 0, // no growth so revenue stays flat
    currentGrowthCost: 0,
    profitMargin: 50, // 50% margin → maintenance = revenue * 0.5
    workers: 100,
    strategyId: "standard",
    transitionFromStrategyId: null,
    transitionStartTurn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CorporateSector;
}

// ── Zero corporations ─────────────────────────────────────────────────────────

describe("processSectors with no corporations", () => {
  it("returns empty results and zero counters", () => {
    const result = processSectors(baseLookups([], []), 1, new Date());

    expect(result.sectorsProcessed).toBe(0);
    expect(result.totalRevenueGenerated).toBe(0);
    expect(result.totalIncomeGenerated).toBe(0);
    expect(result.sectorOps).toHaveLength(0);
    expect(result.corpOps).toHaveLength(0);
    expect(result.dividendPayments.size).toBe(0);
    expect(result.ceoSalaryPayments.size).toBe(0);
  });
});

// ── Expropriation-risk drag (spec §12.4 feed 1) ─────────────────────────────────

describe("expropriation-risk margin drag", () => {
  it("lowers a private corp's income when investor confidence is below baseline", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });

    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());

    const lowConfidence = baseLookups([corp], [sector]);
    lowConfidence.investorConfidenceByCountry = new Map([["US", 0]]); // worst case
    const dragged = processSectors(lowConfidence, 1, new Date());

    // Lower margin ⇒ higher maintenance ⇒ lower income than baseline confidence.
    expect(dragged.totalIncomeGenerated).toBeLessThan(baseline.totalIncomeGenerated);
  });

  it("exempts state-owned corps from the expropriation drag", () => {
    const soe = makeCorp({ countryOwnerId: "US", ownershipState: "stateOwned" });
    const sector = makeSector(soe._id, { revenue: 24_000, profitMargin: 50 });

    const lookups = baseLookups([soe], [sector]);
    lookups.investorConfidenceByCountry = new Map([["US", 0]]);
    // Should not throw and the SOE path applies the SOE efficiency penalty, not
    // the expropriation drag, exercised here for coverage / no-crash.
    const result = processSectors(lookups, 1, new Date());
    expect(result.sectorsProcessed).toBe(1);
  });
});

describe("total-embargo corporate suppression", () => {
  it("mothballs a foreign-national sector operating in an embargoing country", () => {
    const jpCorp = makeCorp({ countryId: "JP", headquartersState: "JP-13" });
    const usSector = makeSector(jpCorp._id, { countryId: "US", stateId: "US-CA", revenue: 24_000 });

    // Baseline: no embargo → the JP corp's US sector earns normally.
    const baseline = processSectors(baseLookups([jpCorp], [usSector]), 1, new Date());
    expect(baseline.totalRevenueGenerated).toBeGreaterThan(0);

    // US has a TOTAL embargo on JP → the JP corp's US sector is suspended.
    const embargoed = baseLookups([jpCorp], [usSector]);
    embargoed.corporateEmbargoSuppression = new Set(["US|JP"]);
    const result = processSectors(embargoed, 1, new Date());

    expect(result.totalRevenueGenerated).toBe(0);
    expect(result.totalIncomeGenerated).toBe(0);

    const op = result.sectorOps.find((o) => o.updateOne.filter._id.equals(usSector._id));
    expect(op).toBeDefined();
    expect(op!.updateOne.update.$set!.embargoSuspended).toBe(true);
    // Stored revenue is frozen, not wiped, resumes when the embargo lifts.
    expect(op!.updateOne.update.$set!.revenue).toBe(24_000);
  });

  it("does not suppress domestic corps or corps whose nation is not embargoed", () => {
    const usCorp = makeCorp({ countryId: "US" });
    const usSector = makeSector(usCorp._id, { countryId: "US" });
    const lookups = baseLookups([usCorp], [usSector]);
    lookups.corporateEmbargoSuppression = new Set(["US|JP"]); // embargo targets JP, not US
    const result = processSectors(lookups, 1, new Date());

    expect(result.totalRevenueGenerated).toBeGreaterThan(0);
    const op = result.sectorOps.find((o) => o.updateOne.filter._id.equals(usSector._id));
    expect(op!.updateOne.update.$set!.embargoSuspended).toBe(false);
  });

  it("trade-exposure model: keeps domestic sales instead of mothballing", () => {
    const jpCorp = makeCorp({ countryId: "JP", headquartersState: "JP-13" });
    const usSector = makeSector(jpCorp._id, { countryId: "US", stateId: "US-CA", revenue: 24_000 });

    const baseline = processSectors(baseLookups([jpCorp], [usSector]), 1, new Date());

    // Same total embargo, but the trade-exposure model is enabled and the
    // sector exports 50% of its output. It should lose ~half its revenue, not
    // all of it, and keep operating (embargoSuspended flag still set).
    const embargoed = baseLookups([jpCorp], [usSector]);
    embargoed.corporateEmbargoSuppression = new Set(["US|JP"]);
    embargoed.embargoTradeExposureEnabled = true;
    embargoed.exportIntensityByCountry = new Map([
      ["US", new Map(COMMODITY_TYPES.map((c) => [c, 0.5]))],
    ]);
    // The suite's global mock returns no `supply`; give just THIS run's single
    // per-sector call a real recipe so computeExportExposure has weights.
    vi.mocked(getEffectiveStrategyRates).mockReturnValueOnce({
      supply: { steel: 0.4, building_materials: 0.2 },
      demand: {},
      isTransitioning: false,
    });
    const result = processSectors(embargoed, 1, new Date());

    // Not fully mothballed, some revenue survives (contrast with the legacy
    // path above, which drives totalRevenueGenerated to exactly 0).
    expect(result.totalRevenueGenerated).toBeGreaterThan(0);
    // Roughly half lost (exposure 0.5): reduced vs the unembargoed baseline.
    expect(result.totalRevenueGenerated).toBeLessThan(baseline.totalRevenueGenerated);
    expect(result.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated * 0.5, 5);

    const op = result.sectorOps.find((o) => o.updateOne.filter._id.equals(usSector._id));
    expect(op!.updateOne.update.$set!.embargoSuspended).toBe(true);
    expect(op!.updateOne.update.$set!.embargoExportExposure).toBeCloseTo(0.5, 5);
    // The sector still incurs operating cost (not mothballed): with income
    // flowing, some tax/costs move, unlike the legacy path where costs are 0.
    expect(result.sectorsProcessed).toBe(1);
  });
});

describe("nationalization transition snapshot", () => {
  it("uses the per-sector snapshot (not live SOCI) for the digestion shock", () => {
    const soe = makeCorp({ countryOwnerId: "US", ownershipState: "stateOwned" });
    // Both sectors taken THIS turn (turn 1) ⇒ start of digestion; live SOCI is 0
    // (baseLookups default), so any difference comes from the per-sector snapshot.
    const shallow = makeSector(soe._id, {
      revenue: 24_000,
      profitMargin: 100,
      nationalizedAtTurn: 1,
      nationalizationTransitionMultiplier: 1,
    });
    const deep = makeSector(soe._id, {
      revenue: 24_000,
      profitMargin: 100,
      nationalizedAtTurn: 1,
      nationalizationTransitionMultiplier: 2.5,
    });

    const shallowOut = processSectors(
      baseLookups([soe], [shallow]),
      1,
      new Date()
    ).totalRevenueGenerated;
    const deepOut = processSectors(baseLookups([soe], [deep]), 1, new Date()).totalRevenueGenerated;

    // A deeper snapshot ⇒ bigger transition output dip ⇒ less revenue this turn.
    expect(deepOut).toBeLessThan(shallowOut);
  });
});

// ── Revenue & profit calculation ──────────────────────────────────────────────

describe("sector revenue and income calculation", () => {
  it("computes hourly revenue = daily_revenue / TURNS_PER_DAY", () => {
    const corp = makeCorp();
    // Daily revenue = 24_000, so hourly = 1_000
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 100 }); // 100% margin → all profit
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // Revenue is margin-independent; income = hourly revenue × soft-capped margin.
    expect(result.totalRevenueGenerated).toBeCloseTo(24_000 / TURNS_PER_DAY, 4);
    expect(result.totalIncomeGenerated).toBeCloseTo((24_000 / TURNS_PER_DAY) * EFF_MARGIN_100, 4);
  });

  it("does not scale revenue by Business Acumen (it now affects growth cost only)", () => {
    const revenueFor = (acumen: number) => {
      const corp = makeCorp();
      const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 100 });
      const lookups = baseLookups([corp], [sector]);
      lookups.ceoBusinessAcumenByCorpId = new Map([[corp._id.toString(), acumen]]);
      return processSectors(lookups, 1, new Date()).totalRevenueGenerated;
    };
    // Revenue is identical regardless of the CEO's Business Acumen, the stat no
    // longer multiplies output; its effect moved to growth cost.
    expect(revenueFor(10)).toBeCloseTo(revenueFor(1), 6);
    expect(revenueFor(10)).toBeCloseTo(24_000 / TURNS_PER_DAY, 4);
  });

  it("applies profit margin: 50% margin means half revenue is profit", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // hourlyRevenue = 1000, maintenance = 1000 * 0.5 = 500, growthCost ≈ 0
    // income ≈ 500
    expect(result.totalRevenueGenerated).toBeCloseTo(1_000, 2);
    expect(result.totalIncomeGenerated).toBeCloseTo(500, 2);
  });

  it("applies state sector specialization as an additive margin bonus", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      sectorType: "manufacturing",
      profitMargin: 50,
    });
    const lookups = baseLookups([corp], [sector]);
    lookups.stateSectorSpecializationByState.set("US-CA", {
      primary: "manufacturing",
      secondary: "technology",
    });

    const result = processSectors(lookups, 1, new Date());

    // hourlyRevenue = 1000; 50 base + 10 primary specialization = 60% income.
    expect(result.totalIncomeGenerated).toBeCloseTo(600, 2);
  });

  it("produces zero income when margin is exactly 0 (all revenue consumed by maintenance)", () => {
    const corp = makeCorp();
    // With all margin modifiers mocked to 0, effective margin = profitMargin = 0.
    // maintenance = hourlyRevenue * (1 - 0/100) = hourlyRevenue → profit = 0.
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 0,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // income = hourlyRevenue - maintenance = 1000 - 1000 = 0
    expect(result.totalIncomeGenerated).toBeCloseTo(0, 2);
  });

  it("counts sectorsProcessed across multiple corps", () => {
    const corp1 = makeCorp();
    const corp2 = makeCorp();
    const sector1 = makeSector(corp1._id);
    const sector2 = makeSector(corp2._id);
    const sector3 = makeSector(corp2._id);
    const lookups = baseLookups([corp1, corp2], [sector1, sector2, sector3]);

    const result = processSectors(lookups, 1, new Date());

    expect(result.sectorsProcessed).toBe(3);
  });

  it("passes sector and corporation countries into subsidy qualification", async () => {
    const { getSubsidyMarginModifier } = await import("@/lib/subsidies/subsidyEffects");
    vi.mocked(getSubsidyMarginModifier).mockClear();

    const corp = makeCorp({ headquartersState: "US-CA", countryId: "US" });
    const sector = makeSector(corp._id, {
      stateId: "UK-ENG",
      countryId: "UK",
      strategyId: "standard",
    });
    const lookups = baseLookups([corp], [sector]);
    lookups.activeSubsidies = [
      { scope: "national", countryId: "US" },
    ] as CorporationLookups["activeSubsidies"];

    processSectors(lookups, 1, new Date());

    expect(getSubsidyMarginModifier).toHaveBeenCalledWith(
      lookups.activeSubsidies,
      "US-CA",
      "manufacturing",
      "UK-ENG",
      "standard",
      "UK",
      "US"
    );
  });
});

// ── Corporate tax ─────────────────────────────────────────────────────────────

describe("corporate tax deduction", () => {
  it("deducts tax from profitable corporation income", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });

    const lookups = baseLookups([corp], [sector]);
    // 20% corporate tax
    lookups.domesticCorpTaxRateByCountry.set("US", 20);

    const result = processSectors(lookups, 1, new Date());

    // Pre-tax income ≈ 1000 × soft-capped margin; net = ×0.8 after 20% tax.
    expect(result.totalIncomeGenerated).toBeCloseTo(1000 * EFF_MARGIN_100 * 0.8, 1);
  });

  it("applies both federal and state tax per-sector (single-country baseline)", () => {
    const corp = makeCorp({ headquartersState: "US-CA", countryId: "US" });
    const sector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);
    // Federal 20%, state 10%
    lookups.domesticCorpTaxRateByCountry.set("US", 20);
    lookups.domesticStateCorpTaxRateByState.set("US-CA", 10);

    const result = processSectors(lookups, 1, new Date());

    // hourlyRevenue = 24000 / 24 = 1000; margin 50% → sectorOpIncome = 500
    // No corp-level costs → sectorNetIncome = 500
    // Federal tax = 500 × 0.20 = 100; state tax = 500 × 0.10 = 50
    const snapshot = result.corpSnapshots[0];
    expect(snapshot.federalTaxPaid).toBeCloseTo(100, 2);
    expect(snapshot.stateTaxPaid).toBeCloseTo(50, 2);
    // Total pre-dividend income after tax = 500 - 150 = 350
    expect(result.totalIncomeGenerated).toBeCloseTo(350, 1);
  });

  it("exempts a state-owned enterprise from corporate income tax", () => {
    // Same sector/rates as the private-corp case above, but state-owned: no tax is charged,
    // because the SOE returns its profit to the state through the remittance instead.
    const corp = makeCorp({
      headquartersState: "US-CA",
      countryId: "US",
      countryOwnerId: "US",
      ownershipState: "stateOwned",
    });
    const sector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);
    lookups.domesticCorpTaxRateByCountry.set("US", 20);
    lookups.domesticStateCorpTaxRateByState.set("US-CA", 10);

    const result = processSectors(lookups, 1, new Date());
    const snapshot = result.corpSnapshots[0];
    // No corporate income tax debited from the SOE...
    expect(snapshot.federalTaxPaid).toBe(0);
    expect(snapshot.stateTaxPaid).toBe(0);
    // ...and the government books no SOE tax revenue (cleared per-country map).
    expect(snapshot.taxPaidByCountry.size).toBe(0);

    // The tax rates have no effect on an SOE's income at all: running the identical corp
    // with the rates zeroed produces the same income (the only difference above would have
    // been tax). This isolates the exemption from the SOE efficiency penalty, which lowers
    // operating profit independently of tax.
    const untaxed = baseLookups([corp], [sector]);
    const control = processSectors(untaxed, 1, new Date());
    expect(result.totalIncomeGenerated).toBeCloseTo(control.totalIncomeGenerated, 6);
  });

  it("applies foreign rate when corp HQ country differs from sector country", () => {
    const corp = makeCorp({ headquartersState: "US-CA", countryId: "US" });
    const usSector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const ukSector = makeSector(corp._id, {
      stateId: "UK-ENG",
      countryId: "UK",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [usSector, ukSector]);
    // Domestic vs foreign rates differ per jurisdiction.
    lookups.domesticCorpTaxRateByCountry.set("US", 20);
    lookups.foreignCorpTaxRateByCountry.set("US", 30); // US foreign rate (unused here, corp is US-HQ)
    lookups.domesticCorpTaxRateByCountry.set("UK", 25); // UK domestic (unused, corp is foreign to UK)
    lookups.foreignCorpTaxRateByCountry.set("UK", 45); // UK foreign rate applies to the US-HQ corp

    const result = processSectors(lookups, 1, new Date());

    // US sector: corp HQ'd in US → domestic → 500 × 0.20 = 100
    // UK sector: corp HQ'd in US (foreign to UK) → foreign → 500 × 0.45 = 225
    const snapshot = result.corpSnapshots[0];
    expect(snapshot.federalTaxPaid).toBeCloseTo(100 + 225, 1);
    // Split maps: US goes to domestic bucket, UK goes to foreign bucket.
    expect(snapshot.taxPaidByCountryDomestic.get("US")).toBeCloseTo(100, 1);
    expect(snapshot.taxPaidByCountryForeign.get("UK")).toBeCloseTo(225, 1);
    // No cross-contamination.
    expect(snapshot.taxPaidByCountryDomestic.has("UK")).toBe(false);
    expect(snapshot.taxPaidByCountryForeign.has("US")).toBe(false);
  });

  it("taxes each sector at its own country's federal rate (cross-border corp)", () => {
    const corp = makeCorp({ headquartersState: "US-CA", countryId: "US" });
    const usSector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const ukSector = makeSector(corp._id, {
      stateId: "UK-ENG",
      countryId: "UK",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [usSector, ukSector]);
    // US fed 20%, UK fed 25%; no state tax
    lookups.domesticCorpTaxRateByCountry.set("US", 20);
    lookups.foreignCorpTaxRateByCountry.set("UK", 25);

    const result = processSectors(lookups, 1, new Date());

    // Each sector opIncome = 500. No corp-level costs.
    // US sector federal: 500 × 0.20 = 100
    // UK sector federal: 500 × 0.25 = 125
    // Total federal = 225. No state tax.
    const snapshot = result.corpSnapshots[0];
    expect(snapshot.federalTaxPaid).toBeCloseTo(225, 2);
    expect(snapshot.stateTaxPaid).toBeCloseTo(0, 2);
  });

  it("consolidated loss offset zeroes tax when the corp runs a net loss (owner decision 2026-08-17)", () => {
    // REVERSES the previous nexus-based rule ("profitable sector pays tax even
    // when corp has net loss"). Observed live t176: per-sector taxation with no
    // loss offset had one diversified corp paying 8x its consolidated revenue
    // in tax. Losses now net against profits across the group; per-sector
    // attribution scales proportionally (see lossOffsetScale).
    // CA sector profitable (margin 50% on 1000/turn → opIncome 500)
    // TX sector low margin (margin 10% on 1000/turn → opIncome 100)
    // Heavy marketing pushes corp-total into loss but CA sector stays net-positive.
    const corp = makeCorp({
      headquartersState: "US-CA",
      countryId: "US",
      marketingBudget: 700 * 24, // daily budget → 700/turn corp-level cost
    });
    const caSector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000, // 1000/turn
      profitMargin: 50, // opIncome 500
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const txSector = makeSector(corp._id, {
      stateId: "US-TX",
      countryId: "US",
      revenue: 24_000, // 1000/turn
      profitMargin: 10, // opIncome 100
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [caSector, txSector]);
    lookups.domesticCorpTaxRateByCountry.set("US", 20);
    lookups.domesticStateCorpTaxRateByState.set("US-CA", 10);
    lookups.domesticStateCorpTaxRateByState.set("US-TX", 0);

    const result = processSectors(lookups, 1, new Date());

    // corpRevenue = 2000, sectorOperatingTotal = 600, corpLevelCosts = 700
    // Revenue share each 0.5 → each sector allocated 350
    // CA net = 500 - 350 = 150; TX net = 100 - 350 = -250
    // Consolidated net = -100 → lossOffsetScale = 0 → no tax anywhere.
    const snapshot = result.corpSnapshots[0];
    expect(snapshot.federalTaxPaid).toBeCloseTo(0, 5);
    expect(snapshot.stateTaxPaid).toBeCloseTo(0, 5);
    // Corp overall: incomePreDividends = 600 - 700 = -100 (net loss)
    expect(snapshot.incomePreDividends).toBeLessThan(0);
  });

  it("partial loss offset scales profitable sectors' tax pro-rata", () => {
    const corp = makeCorp({
      headquartersState: "US-CA",
      countryId: "US",
      marketingBudget: 300 * 24, // daily budget → 300/turn corp-level cost
    });
    const caSector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000, // 1000/turn
      profitMargin: 50, // opIncome 500
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const txSector = makeSector(corp._id, {
      stateId: "US-TX",
      countryId: "US",
      revenue: 24_000, // 1000/turn
      profitMargin: 10, // opIncome 100
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [caSector, txSector]);
    lookups.domesticCorpTaxRateByCountry.set("US", 20);
    lookups.domesticStateCorpTaxRateByState.set("US-CA", 10);
    lookups.domesticStateCorpTaxRateByState.set("US-TX", 0);

    const result = processSectors(lookups, 1, new Date());

    // Each sector allocated 150 of corp costs: CA net = 350, TX net = -50.
    // Consolidated = 300, gross positive = 350 → scale = 6/7.
    // CA taxable = 350 × 6/7 = 300 → fed 60, CA state 30.
    const snapshot = result.corpSnapshots[0];
    expect(snapshot.federalTaxPaid).toBeCloseTo(60, 1);
    expect(snapshot.stateTaxPaid).toBeCloseTo(30, 1);
  });

  it("uses 0% when a sector's state/country rate is missing (fail-open)", () => {
    const corp = makeCorp({ headquartersState: "US-CA", countryId: "US" });
    const sector = makeSector(corp._id, {
      stateId: "US-NV", // NV not in rate map
      countryId: "US",
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);
    lookups.domesticCorpTaxRateByCountry.set("US", 21);
    // domesticStateCorpTaxRateByState empty, NV not registered.

    const result = processSectors(lookups, 1, new Date());
    const snapshot = result.corpSnapshots[0];
    // Federal still applies: 500 × 0.21 = 105. State = 0.
    expect(snapshot.federalTaxPaid).toBeCloseTo(105, 2);
    expect(snapshot.stateTaxPaid).toBeCloseTo(0, 2);
  });

  it("does not charge tax when corporation has no profit (loss protection)", () => {
    const corp = makeCorp({
      // Large marketing drives incomePreDividends negative
      marketingBudget: 2_400_000, // $25k/turn, vs $1k sector revenue → net loss
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100, // 100% margin so sector profit = $1k/turn
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);
    lookups.domesticCorpTaxRateByCountry.set("US", 25);

    const result = processSectors(lookups, 1, new Date());

    // incomePreDividends = 1000 (sector) - 100_000 (marketing) = -99_000/turn → loss
    // corporateTaxOwed = max(0, loss) * rate = 0 → no tax deducted
    // Income should simply equal the negative pre-tax income (no tax on losses)
    expect(result.totalIncomeGenerated).toBeLessThan(0);
  });

  it("accumulates annualized income by country for tax base blending", () => {
    const corp = makeCorp({ countryId: "US" });
    // 100% margin, no modifiers → hourlyRevenue = 1000, incomePreDividends = 1000
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // annualizedIncome = max(0, incomePreDividends) * TURNS_PER_YEAR
    // = 1000 * 48 = 48_000
    const usIncome = result.domesticIncomeByCountry.get("US") ?? 0;
    const hourlyIncome = (24_000 / TURNS_PER_DAY) * EFF_MARGIN_100;
    expect(usIncome).toBeCloseTo(hourlyIncome * TURNS_PER_YEAR, 0);
  });
});

// ── Dividend payouts ──────────────────────────────────────────────────────────

describe("dividend payments to shareholders", () => {
  it("distributes dividends proportionally to shareholders based on share count", () => {
    const charId1 = new ObjectId();
    const charId2 = new ObjectId();
    const corp = makeCorp({
      dividendRate: 50, // 50% of after-tax income paid as dividends
      totalShares: 10_000_000,
      shareholders: [
        { characterId: charId1, shares: 7_500_000 }, // 75% ownership
        { characterId: charId2, shares: 2_500_000 }, // 25% ownership
      ],
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100, // 100% margin → all revenue = profit
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const payment1 = getTotalPayment(result.dividendPayments, charId1.toString());
    const payment2 = getTotalPayment(result.dividendPayments, charId2.toString());

    // Requested 50% is clamped to MAX_DIVIDEND_RATE (25%). Pool = income × 25%,
    // income = 1000 × soft-capped margin. charId1 gets 75%, charId2 25%.
    const pool = 1000 * EFF_MARGIN_100 * 0.25;
    expect(payment1).toBeCloseTo(pool * 0.75, 1);
    expect(payment2).toBeCloseTo(pool * 0.25, 1);
    expect(payment1 / payment2).toBeCloseTo(3, 3); // 75/25 = 3:1 ratio
  });

  it("pays no dividends when income is non-positive (guard on incomePreDividends > 0)", () => {
    const charId = new ObjectId();
    const corp = makeCorp({
      dividendRate: 50,
      totalShares: 10_000_000,
      shareholders: [{ characterId: charId, shares: 10_000_000 }],
      // Large marketing budget drives incomePreDividends negative
      marketingBudget: 240_000_000, // $10M/turn, vastly exceeds sector revenue
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // incomePreDividends = 500 (sector profit) - 10M (marketing) ≪ 0 → dividends not paid
    expect(result.dividendPayments.size).toBe(0);
  });

  it("skips this turn's payout but does NOT persist dividendRate: 0 when income is negative (ticket #919)", () => {
    // Corp has dividendRate > 0 but marketing cost overwhelms all revenue → negative income
    // this turn. Regression for ticket #919: a single loss-making turn used to
    // permanently overwrite the CEO's chosen dividendRate to 0 in corpOps, silently
    // disabling all future dividends even once the corp turned profitable again.
    // The turn-level skip (no payment this turn) is still correct and covered by
    // the "pays no dividends when income is non-positive" test above, only the
    // stored corp.dividendRate must survive.
    const corp = makeCorp({
      dividendRate: 30,
      totalShares: 10_000_000,
      shareholders: [],
      // $25k/turn marketing vs ~$500/turn sector profit → massive net loss
      marketingBudget: 2_400_000, // 2.4M daily / 24 = 25k/turn
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50, // $500/turn profit, dwarfed by marketing
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const corpOp = result.corpOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(corpOp.updateOne.update.$set.dividendRate).toBeUndefined();
    expect(corpOp.updateOne.update.$set.lastDividendChange).toBeUndefined();
    expect(result.dividendPayments.size).toBe(0);
  });

  it("still force-clears dividendRate to 0 while an IMF bailout is active", () => {
    const charId = new ObjectId();
    const corp = makeCorp({
      dividendRate: 30,
      imfBailoutActive: true,
      totalShares: 10_000_000,
      shareholders: [{ characterId: charId, shares: 10_000_000 }],
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const corpOp = result.corpOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(corpOp.updateOne.update.$set.dividendRate).toBe(0);
    expect(result.dividendPayments.size).toBe(0);
  });

  it("distributes bond-coupon-funded dividends even when operating income is negative (#2962)", () => {
    // Regression: a corp with an operating LOSS but bond coupon income large
    // enough to make net income positive must still distribute per its rate.
    // The payout cap uses netIncomeBeforeDividends (incl. coupons), not
    // operating-only afterTaxOperating, otherwise the corp passes the
    // eligibility gate yet is capped to $0, silently paying nothing.
    const charId = new ObjectId();
    const corp = makeCorp({
      dividendRate: 30,
      totalShares: 10_000_000,
      shareholders: [{ characterId: charId, shares: 10_000_000 }],
      // 25k/turn marketing vs ~500/turn sector profit → operating loss.
      marketingBudget: 2_400_000,
      ceoSalary: 0,
    });
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const lookups = baseLookups([corp], [sector]);
    // Held bond: 1,000,000 units @ 10% coupon on ₳1,000 face ≈ 2.08M ₳/turn
    // coupon income, dwarfing the ~24.5k/turn operating loss so
    // netIncomeBeforeDividends > 0 (and shouldClearDividends stays false).
    lookups.bondsHeldByCorpId.set(corp._id.toString(), [
      {
        bond: {
          couponRate: 10,
          currencyCode: "USD",
        } as unknown as import("@/lib/db/types/bond").Bond,
        units: 1_000_000,
      },
    ]);

    const result = processSectors(lookups, 1, new Date());

    // Pre-fix: capped at max(0, afterTaxOperating) = 0 → no payment. Post-fix: pays.
    expect(getTotalPayment(result.dividendPayments, charId.toString())).toBeGreaterThan(0);
  });

  it("skips shareholders without a characterId", () => {
    const charId = new ObjectId();
    const corp = makeCorp({
      dividendRate: 100,
      totalShares: 10_000_000,
      shareholders: [
        { characterId: charId, shares: 5_000_000 }, // valid
        { shares: 5_000_000 }, // no characterId, should be skipped
      ],
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // Only charId should receive dividends; 50% share of 100% rate payout
    expect(result.dividendPayments.size).toBe(1);
    expect(getTotalPayment(result.dividendPayments, charId.toString())).toBeGreaterThan(0);
  });

  it("records corporate shareholder dividends as ₳ anchor amounts for treasury credit", () => {
    const holderCorpId = new ObjectId();
    const corp = makeCorp({
      dividendRate: 100,
      totalShares: 10_000_000,
      shareholders: [{ corporationId: holderCorpId, shares: 10_000_000 }],
      ceoSalary: 0,
      marketingBudget: 0,
    });
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    expect(result.dividendPayments.size).toBe(0);
    expect(result.corpDividendPaymentsAnchorByCorpId.get(holderCorpId.toString())).toBeGreaterThan(
      0
    );
  });

  it("converts character dividend from ₳ to payout country's local currency via FX rate", () => {
    // JP corp with single 100% character shareholder: the ₳ dividend pool must be
    // multiplied by the JPY FX rate before being tagged under "JPY" in the payment
    // map. Without FX conversion, the raw ₳ value would land in the local-currency
    // balance field, see docs/plans/archive/2026-04/2026-04-19-character-payment-fx-conversion.md.
    //
    // Sector storage: sector.revenue is in the sector's HOST-state currency. This
    // sector operates in Japan (countryId "JP" → JPY), matching the JP corp, so the
    // stored figure is JPY. 2_400_000 JPY at rate 100 = 24_000 ₳ daily = 1_000
    // ₳/turn hourly, matching the ₳-equivalent economic activity the pre-migration
    // fixture (24_000 stored as ₳) was modelling.
    const charId = new ObjectId();
    const corp = makeCorp({
      countryId: "JP",
      liquidCurrencyCode: "JPY",
      dividendRate: 100, // 100% payout so pool == afterTaxOperating for easy math
      totalShares: 10_000_000,
      shareholders: [{ characterId: charId, shares: 10_000_000 }],
      ceoSalary: 0,
      marketingBudget: 0,
    });
    const sector = makeSector(corp._id, {
      countryId: "JP",
      stateId: "JP-13",
      revenue: 2_400_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);
    // Live-ish rate: ~100 JPY per 1 ₳. After FX, ₳1000 pool → ¥25,000.
    lookups.exchangeRatesByCurrency.set("JPY", 100);

    const result = processSectors(lookups, 1, new Date());

    const charMap = result.dividendPayments.get(charId.toString());
    expect(charMap).toBeDefined();
    const jpyAmount = charMap!.get("JPY") ?? 0;
    // Pool in ₳ ≈ 1000 ₳/turn. Post-FX at rate 100 ≈ ¥25,000/turn.
    // Raw-₳ (broken) behavior would yield ≈1000. A value > 10_000 proves FX ran.
    expect(jpyAmount).toBeGreaterThan(10_000);
    // Pool 250 ₳ at full margin → ×soft-cap → ×FX 100. ~¥23.8k.
    expect(jpyAmount).toBeCloseTo(250 * EFF_MARGIN_100 * 100, -2);
  });
});

// ── CEO salary ────────────────────────────────────────────────────────────────

describe("CEO salary payments", () => {
  it("tracks CEO salary as per-turn fraction of daily salary", () => {
    const ceoId = new ObjectId();
    const corp = makeCorp({
      ceoId,
      ceoSalary: 240_000, // $240k/day → $10k/turn
    });
    // Revenue high enough that the 1.25x-gross-revenue cap (Bug #0728) does not
    // bind here, this test isolates the per-turn salary fraction, not the cap.
    // 1.25 × (240_000 / 24) = 12_500 ≥ 10_000 requested.
    const sector = makeSector(corp._id, { revenue: 240_000, profitMargin: 100 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const salaryPaid = getTotalPayment(result.ceoSalaryPayments, ceoId.toString());
    expect(salaryPaid).toBeCloseTo(240_000 / TURNS_PER_DAY, 4); // = 10_000
  });

  it("accumulates CEO salary across multiple corporations under the same CEO", () => {
    const ceoId = new ObjectId();
    const corp1 = makeCorp({ ceoId, ceoSalary: 24_000 });
    const corp2 = makeCorp({ ceoId, ceoSalary: 24_000 });
    const sector1 = makeSector(corp1._id);
    const sector2 = makeSector(corp2._id);
    const lookups = baseLookups([corp1, corp2], [sector1, sector2]);

    const result = processSectors(lookups, 1, new Date());

    const salary = getTotalPayment(result.ceoSalaryPayments, ceoId.toString());
    expect(salary).toBeCloseTo(2 * (24_000 / TURNS_PER_DAY), 4);
  });

  it("deducts CEO salary from corporation income before computing share price", () => {
    const ceoId = new ObjectId();
    // Large salary that will significantly reduce income
    const corp = makeCorp({ ceoId, ceoSalary: 24_000_000 }); // $1M/turn!
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 100 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    // Revenue = 1000/turn, ceoSalary = 1_000_000/turn → total loss
    expect(result.totalIncomeGenerated).toBeLessThan(0);
  });

  // Bug #0728: salary capped at 1.25x gross (sector) revenue.
  it("caps CEO salary at 1.25x gross revenue", () => {
    const ceoId = new ObjectId();
    // Requested $10k/turn salary, but gross revenue is only $1k/turn.
    const corp = makeCorp({ ceoId, ceoSalary: 240_000, liquidCapital: 1_000_000 });
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 100 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const salary = getTotalPayment(result.ceoSalaryPayments, ceoId.toString());
    // 1.25 × (24_000 / TURNS_PER_DAY) = 1.25 × 1_000 = 1_250
    expect(salary).toBeCloseTo(1.25 * (24_000 / TURNS_PER_DAY), 0);
  });

  it("pays zero CEO salary when gross revenue is zero (mint exploit)", () => {
    const ceoId = new ObjectId();
    // Huge liquidCapital (e.g. minted via bonds) but no gross revenue.
    const corp = makeCorp({ ceoId, ceoSalary: 240_000_000, liquidCapital: 800_000_000 });
    const sector = makeSector(corp._id, { revenue: 0, profitMargin: 0 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    expect(getTotalPayment(result.ceoSalaryPayments, ceoId.toString())).toBe(0);
  });

  it("excludes bond proceeds (liquidCapital) from the salary cap basis", () => {
    const ceoId = new ObjectId();
    // liquidCapital reflects bond proceeds; gross revenue is still zero.
    const corp = makeCorp({ ceoId, ceoSalary: 1_000_000, liquidCapital: 100_000_000 });
    const sector = makeSector(corp._id, { revenue: 0, profitMargin: 0 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    expect(getTotalPayment(result.ceoSalaryPayments, ceoId.toString())).toBe(0);
  });
});

// ── Share price calculation ───────────────────────────────────────────────────

describe("share price calculation", () => {
  it("respects MIN_SHARE_PRICE floor even for deeply unprofitable corporations", () => {
    const corp = makeCorp({
      liquidCapital: 0,
      sharePrice: 0.01,
      totalShares: 10_000_000,
      // Large salary creates massive loss
      ceoSalary: 240_000_000,
    });
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 0 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const snapshot = result.corpSnapshots[0];
    expect(snapshot.actualSharePrice).toBeGreaterThanOrEqual(MIN_SHARE_PRICE);
  });

  it("fundamental: 100% tangibleBook + 40% earningsPower + 10% growthPremium", () => {
    const liquidCapital = 1_000_000;
    const totalShares = 10_000_000;
    const corp = makeCorp({
      liquidCapital,
      sharePrice: 0.5,
      totalShares,
      dividendRate: 0,
      ceoSalary: 0,
      marketingBudget: 0,
    });
    // 100% margin, 0% growth → hourly income = 1000 (revenue 24_000 / 24)
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 100,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());
    const snapshot = result.corpSnapshots[0];

    // income/turn = 1000, endLiquid ≈ 1_001_000
    // sectorNPV = (1000 * 48) / 0.15 = 320_000
    // tangibleBookPerShare = (1_001_000 + 320_000) / 10_000_000 ≈ 0.132
    // annualIncome = 1000 * 48 = 48_000
    // costOfCapital = 3.0%/100 (US prime) + 0.04 (manufacturing risk) = 0.07
    // earningsPowerPerShare = 48_000 / 0.07 / 10_000_000 ≈ 0.0686
    // growthPremiumPerShare = 0 (sectorGrowthRate = 0)
    // fundamentalValue ≈ 1.00×0.132 + 0.40×0.0686 ≈ 0.159
    expect(snapshot.actualSharePrice).toBeGreaterThan(0.1);
    expect(snapshot.actualSharePrice).toBeLessThan(0.25);
    expect(snapshot.actualSharePrice).toBe(Math.round(snapshot.actualSharePrice * 100) / 100);
  });

  it("is rounded to 2 decimal places", () => {
    const corp = makeCorp({ liquidCapital: 1_234_567, totalShares: 10_000_000, sharePrice: 1.0 });
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());
    const snapshot = result.corpSnapshots[0];

    expect(snapshot.actualSharePrice).toBe(Math.round(snapshot.actualSharePrice * 100) / 100);
  });

  it("subtracts issuedBondDebtByCorpId from balance-sheet equity (bond issuance neutral)", () => {
    // Two corps, identical sectors. corpB has $50M of issued bonds (proceeds already
    // reflected in its higher liquidCapital). After debt subtraction, prices match.
    const corpA = makeCorp({
      name: "A",
      liquidCapital: 50_000_000,
      sharePrice: 0.1,
      totalShares: 10_000_000,
      ceoSalary: 0,
      marketingBudget: 0,
    });
    const corpB = makeCorp({
      name: "B",
      liquidCapital: 100_000_000, // includes $50M bond proceeds
      sharePrice: 0.1,
      totalShares: 10_000_000,
      ceoSalary: 0,
      marketingBudget: 0,
    });
    const lookups = baseLookups([corpA, corpB], []);
    lookups.issuedBondDebtByCorpId.set(corpB._id.toString(), 50_000_000);

    const result = processSectors(lookups, 1, new Date());
    const priceA = result.corpSnapshots.find((s) => s.corpId.equals(corpA._id))!.actualSharePrice;
    const priceB = result.corpSnapshots.find((s) => s.corpId.equals(corpB._id))!.actualSharePrice;

    // Same effective equity after debt subtraction → same price.
    expect(priceB).toBeCloseTo(priceA, 2);
  });

  it("does NOT subtract debt for corps with no entry (natcorp exemption path)", () => {
    // Mirror of previous test, but corpB's debt is NOT in the lookup map (simulates
    // natcorp exclusion done in buildLookups). Result: corpB still shows inflated price
    // because the proceeds count without the offsetting debt. This guards the natcorp
    // exemption, its share-price formula stays the legacy "cash-only" treatment.
    const corpA = makeCorp({
      name: "A",
      liquidCapital: 50_000_000,
      sharePrice: 0.1,
      totalShares: 10_000_000,
      ceoSalary: 0,
      marketingBudget: 0,
    });
    const corpB = makeCorp({
      name: "B",
      liquidCapital: 100_000_000,
      sharePrice: 0.1,
      totalShares: 10_000_000,
      ceoSalary: 0,
      marketingBudget: 0,
    });
    const lookups = baseLookups([corpA, corpB], []);
    // Note: NO entry in issuedBondDebtByCorpId for corpB

    const result = processSectors(lookups, 1, new Date());
    const priceA = result.corpSnapshots.find((s) => s.corpId.equals(corpA._id))!.actualSharePrice;
    const priceB = result.corpSnapshots.find((s) => s.corpId.equals(corpB._id))!.actualSharePrice;

    expect(priceB).toBeGreaterThan(priceA);
  });
});

// ── Type-switch penalty ───────────────────────────────────────────────────────

describe("type-switch margin penalty", () => {
  it("applies TYPE_SWITCH_MARGIN_PENALTY when switch is within penalty window", () => {
    const turn = 100;
    const switchTurn = 90; // switched 10 turns ago, penalty window = 24 → still active

    const corpWithPenalty = makeCorp({ typeSwitchTurn: switchTurn });
    const corpWithout = makeCorp({ typeSwitchTurn: null });

    const sectorWithPenalty = makeSector(corpWithPenalty._id, {
      revenue: 24_000,
      profitMargin: 50,
    });
    const sectorWithout = makeSector(corpWithout._id, { revenue: 24_000, profitMargin: 50 });

    const lookups = baseLookups([corpWithPenalty, corpWithout], [sectorWithPenalty, sectorWithout]);

    const result = processSectors(lookups, turn, new Date());

    // Corp with penalty has lower income because effective margin is reduced by TYPE_SWITCH_MARGIN_PENALTY
    const corpOps = result.corpOps as {
      updateOne: { filter: { _id: ObjectId }; update: { $inc: { liquidCapital: number } } };
    }[];
    const penaltyInc =
      corpOps.find((op) => op.updateOne.filter._id.equals(corpWithPenalty._id))?.updateOne.update
        .$inc.liquidCapital ?? 0;
    const normalInc =
      corpOps.find((op) => op.updateOne.filter._id.equals(corpWithout._id))?.updateOne.update.$inc
        .liquidCapital ?? 0;

    // Penalty should reduce income (more negative liquidCapital increment relative to normal)
    // TYPE_SWITCH_MARGIN_PENALTY = -10, so effective margin = 50 - 10 = 40 instead of 50
    // This reduces the profit (higher maintenance cost) → lower income
    expect(penaltyInc).toBeLessThan(normalInc);
  });

  it("does not apply penalty when switch is outside the penalty window", () => {
    const turn = 200;
    const switchTurn = 100; // switched 100 turns ago, penalty only lasts 24 → expired

    const corp = makeCorp({ typeSwitchTurn: switchTurn });
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const corpNoPenalty = makeCorp({ typeSwitchTurn: null });
    const sectorNoPenalty = makeSector(corpNoPenalty._id, { revenue: 24_000, profitMargin: 50 });

    const lookups = baseLookups([corp, corpNoPenalty], [sector, sectorNoPenalty]);
    const result = processSectors(lookups, turn, new Date());

    const corpOps = result.corpOps as {
      updateOne: { filter: { _id: ObjectId }; update: { $inc: { liquidCapital: number } } };
    }[];
    const expiredInc =
      corpOps.find((op) => op.updateOne.filter._id.equals(corp._id))?.updateOne.update.$inc
        .liquidCapital ?? 0;
    const noSwitchInc =
      corpOps.find((op) => op.updateOne.filter._id.equals(corpNoPenalty._id))?.updateOne.update.$inc
        .liquidCapital ?? 0;

    // After penalty window, both should earn the same income
    expect(expiredInc).toBeCloseTo(noSwitchInc, 4);
  });
});

// ── Strategy transition penalty ───────────────────────────────────────────────

describe("strategy transition margin penalty", () => {
  it("applies STRATEGY_TRANSITION_MARGIN_PENALTY while transitioning", async () => {
    // Override the mock to return isTransitioning: true for this test
    const { getEffectiveStrategyRates } = await import("@/lib/constants/sectorStrategies");
    vi.mocked(getEffectiveStrategyRates)
      .mockReturnValueOnce({ supply: {}, demand: {}, isTransitioning: true }) // transitioning
      .mockReturnValueOnce({ supply: {}, demand: {}, isTransitioning: false }); // not transitioning

    const corp1 = makeCorp();
    const corp2 = makeCorp();
    const sector1 = makeSector(corp1._id, {
      revenue: 24_000,
      profitMargin: 50,
      transitionFromStrategyId: "old",
      transitionStartTurn: 90,
    });
    const sector2 = makeSector(corp2._id, { revenue: 24_000, profitMargin: 50 });

    const lookups = baseLookups([corp1, corp2], [sector1, sector2]);
    const result = processSectors(lookups, 100, new Date());

    const corpOps = result.corpOps as {
      updateOne: { filter: { _id: ObjectId }; update: { $inc: { liquidCapital: number } } };
    }[];
    const transitionInc =
      corpOps.find((op) => op.updateOne.filter._id.equals(corp1._id))?.updateOne.update.$inc
        .liquidCapital ?? 0;
    const normalInc =
      corpOps.find((op) => op.updateOne.filter._id.equals(corp2._id))?.updateOne.update.$inc
        .liquidCapital ?? 0;

    // Transitioning corp should have lower income (margin penalized by STRATEGY_TRANSITION_MARGIN_PENALTY)
    expect(transitionInc).toBeLessThan(normalInc);
  });
});

// ── Strategy transition completion ────────────────────────────────────────────

describe("strategy transition field cleanup", () => {
  it("clears transition fields in sectorOps when transition completes", () => {
    const corp = makeCorp();
    const transitionStartTurn = 100;
    const currentTurn = transitionStartTurn + STRATEGY_TRANSITION_TURNS; // exactly complete
    const sector = makeSector(corp._id, {
      transitionFromStrategyId: "old_strategy",
      transitionStartTurn,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, currentTurn, new Date());

    const sectorOp = result.sectorOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(sectorOp.updateOne.update.$set.transitionFromStrategyId).toBeNull();
    expect(sectorOp.updateOne.update.$set.transitionStartTurn).toBeNull();
    expect(sectorOp.updateOne.update.$set.transitionCooldownUntilTurn).toBeNull();
  });

  it("does NOT clear transition fields before transition completes", () => {
    const corp = makeCorp();
    const transitionStartTurn = 100;
    const currentTurn = transitionStartTurn + STRATEGY_TRANSITION_TURNS - 1; // one turn before
    const sector = makeSector(corp._id, {
      transitionFromStrategyId: "old_strategy",
      transitionStartTurn,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, currentTurn, new Date());

    const sectorOp = result.sectorOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    // Neither field should be nulled out
    expect(sectorOp.updateOne.update.$set.transitionFromStrategyId).toBeUndefined();
    expect(sectorOp.updateOne.update.$set.transitionStartTurn).toBeUndefined();
    expect(sectorOp.updateOne.update.$set.transitionCooldownUntilTurn).toBeUndefined();
  });
});

// ── bulkWrite operation structure ─────────────────────────────────────────────

describe("bulkWrite operation structure", () => {
  it("produces one sectorOp per sector", () => {
    const corp = makeCorp();
    const s1 = makeSector(corp._id, { revenue: 10_000 });
    const s2 = makeSector(corp._id, { revenue: 20_000 });
    const lookups = baseLookups([corp], [s1, s2]);

    const result = processSectors(lookups, 1, new Date());

    expect(result.sectorOps).toHaveLength(2);
  });

  it("produces one corpOp per corporation", () => {
    const corp1 = makeCorp();
    const corp2 = makeCorp();
    const lookups = baseLookups([corp1, corp2], [makeSector(corp1._id), makeSector(corp2._id)]);

    const result = processSectors(lookups, 1, new Date());

    expect(result.corpOps).toHaveLength(2);
  });

  it("sector update $set contains revenue, workers, and updatedAt", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const lookups = baseLookups([corp], [sector]);
    const now = new Date();

    const result = processSectors(lookups, 1, now);

    const sectorOp = result.sectorOps[0] as {
      updateOne: { filter: { _id: ObjectId }; update: { $set: Record<string, unknown> } };
    };
    expect(sectorOp.updateOne.filter._id).toEqual(sector._id);
    expect(sectorOp.updateOne.update.$set.revenue).toBeTypeOf("number");
    expect(sectorOp.updateOne.update.$set.workers).toBeTypeOf("number");
    expect(sectorOp.updateOne.update.$set.updatedAt).toBe(now);
  });

  it("corp update $inc contains liquidCapital and $set contains sharePrice", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id);
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    const corpOp = result.corpOps[0] as {
      updateOne: {
        filter: { _id: ObjectId };
        update: { $inc: Record<string, number>; $set: Record<string, unknown> };
      };
    };
    expect(corpOp.updateOne.filter._id).toEqual(corp._id);
    expect(corpOp.updateOne.update.$inc.liquidCapital).toBeTypeOf("number");
    expect(corpOp.updateOne.update.$set.sharePrice).toBeTypeOf("number");
  });

  it("produces one corpSnapshot per corporation", () => {
    const corp1 = makeCorp();
    const corp2 = makeCorp();
    const lookups = baseLookups([corp1, corp2], [makeSector(corp1._id), makeSector(corp2._id)]);

    const result = processSectors(lookups, 1, new Date());

    expect(result.corpSnapshots).toHaveLength(2);
  });

  it("corp with no sectors still produces corpOp and snapshot", () => {
    const corp = makeCorp();
    const lookups = baseLookups([corp], []); // no sectors

    const result = processSectors(lookups, 1, new Date());

    expect(result.corpOps).toHaveLength(1);
    expect(result.corpSnapshots).toHaveLength(1);
    expect(result.sectorOps).toHaveLength(0);
    // No revenue/income from sectors
    expect(result.totalRevenueGenerated).toBe(0);
  });
});

// ── domesticIncomeByCountry / foreignIncomeByCountry accumulators ────────────

describe("income accumulation for tax base blending", () => {
  it("tracks domestic income only for profitable sectors (clamps at 0)", () => {
    // Sector-level operating income: only profitable sectors (sectorOpIncome > 0) contribute.
    // Corp-level loss (heavy marketing) does not depress sector operating income, the
    // sectors' own profitability is what drives the tax base.
    const profitableCorp = makeCorp({ countryId: "US" });
    const lossyCorp = makeCorp({ countryId: "US", marketingBudget: 240_000_000 });
    const s1 = makeSector(profitableCorp._id, { revenue: 24_000, profitMargin: 100 });
    const s2 = makeSector(lossyCorp._id, { revenue: 24_000, profitMargin: 100 });
    const lookups = baseLookups([profitableCorp, lossyCorp], [s1, s2]);

    const result = processSectors(lookups, 1, new Date());

    // Both sectors produce positive operating income, so both contribute. Both corps are US-HQ
    // with US sectors → all activity lands in domesticIncomeByCountry.
    const totalUsIncome = result.domesticIncomeByCountry.get("US") ?? 0;
    expect(totalUsIncome).toBeGreaterThan(0);
  });

  it("tracks operating-state income keyed by sector.stateId (not HQ)", () => {
    // HQ in US-NY, but the sector operates in US-CA. Operating state is what gets
    // credited with the activity.
    const corp = makeCorp({ headquartersState: "US-NY", countryId: "US" });
    const sector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 100,
    });
    const lookups = baseLookups([corp], [sector]);

    const result = processSectors(lookups, 1, new Date());

    expect(result.domesticIncomeByOperatingState.has("US-CA")).toBe(true);
    expect(result.domesticIncomeByOperatingState.get("US-CA")).toBeGreaterThan(0);
    // HQ state is not credited.
    expect(result.domesticIncomeByOperatingState.has("US-NY")).toBe(false);
  });

  it("splits income across domestic/foreign buckets per sector-vs-corp country (cross-border corp)", () => {
    const corp = makeCorp({ headquartersState: "US-CA", countryId: "US" });
    const usSector = makeSector(corp._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 100,
    });
    const ukSector = makeSector(corp._id, {
      stateId: "UK-ENG",
      countryId: "UK",
      revenue: 12_000,
      profitMargin: 100,
    });
    const lookups = baseLookups([corp], [usSector, ukSector]);

    const result = processSectors(lookups, 1, new Date());

    // US sector: corp HQ'd in US matches sector country → domestic.
    expect(result.domesticIncomeByCountry.get("US")).toBeGreaterThan(0);
    // UK sector: corp HQ'd elsewhere (US) → foreign.
    expect(result.foreignIncomeByCountry.get("UK")).toBeGreaterThan(0);
    // US sector has twice the revenue, so US (domestic) base > UK (foreign) base.
    expect(result.domesticIncomeByCountry.get("US")!).toBeGreaterThan(
      result.foreignIncomeByCountry.get("UK")!
    );
    // Cross-check: UK is never in domestic and US is never in foreign.
    expect(result.domesticIncomeByCountry.has("UK")).toBe(false);
    expect(result.foreignIncomeByCountry.has("US")).toBe(false);
  });

  it("aggregates domestic income across multiple corps in same country", () => {
    const corp1 = makeCorp({ countryId: "US", headquartersState: "US-CA" });
    const corp2 = makeCorp({ countryId: "US", headquartersState: "US-TX" });
    const s1 = makeSector(corp1._id, {
      stateId: "US-CA",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 100,
    });
    const s2 = makeSector(corp2._id, {
      stateId: "US-TX",
      countryId: "US",
      revenue: 24_000,
      profitMargin: 100,
    });
    const lookups = baseLookups([corp1, corp2], [s1, s2]);

    const result = processSectors(lookups, 1, new Date());

    // Both corps are US-HQ with US sectors → all contributions go to domesticIncomeByCountry.
    const usIncome = result.domesticIncomeByCountry.get("US") ?? 0;
    const hourlyOpIncomePerSector = (24_000 / TURNS_PER_DAY) * EFF_MARGIN_100; // soft-capped
    const singleSectorAnnual = hourlyOpIncomePerSector * TURNS_PER_YEAR;
    expect(usIncome).toBeCloseTo(2 * singleSectorAnnual, 0);
  });
});

// ── Local-currency storage equivalence (v0.2.6) ───────────────────────────────
describe("local-currency storage (v0.2.6)", () => {
  it("UK corp at rate=2 produces identical tax/revenue math to a pre-forex ₳ twin", () => {
    // A UK corp storing every value in GBP at rate=2 (GBP-per-₳) must produce
    // identical turn-math outputs to a pre-forex corp storing the same ₳
    // values directly. The whole point of the migration is that corps reflect
    // their country's economy via FX, while the turn-math stays correct.
    //
    // Anchor twin: liquidCurrencyCode = undefined → passthrough → all values
    // interpreted as ₳ directly.
    const anchorCorp = makeCorp({
      countryId: "UK",
      headquartersState: "UK-LDN",
      liquidCurrencyCode: undefined,
      liquidCapital: 500_000,
      marketingBudget: 1_000,
      logisticsBudget: 500,
      ceoSalary: 200,
    });
    const anchorSector = makeSector(anchorCorp._id, {
      stateId: "UK-LDN",
      countryId: "UK",
      revenue: 24_000, // ₳
      currentGrowthCost: 300,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const anchorLookups = baseLookups([anchorCorp], [anchorSector]);

    // Local-currency twin: same ₳-equivalent activity stored as GBP at rate=2.
    const localCorp = makeCorp({
      _id: anchorCorp._id, // same id so per-corp outputs compare
      countryId: "UK",
      headquartersState: "UK-LDN",
      liquidCurrencyCode: "GBP",
      liquidCapital: 1_000_000, // 500_000 ₳ × 2
      marketingBudget: 2_000,
      logisticsBudget: 1_000,
      ceoSalary: 400,
    });
    const localSector = makeSector(localCorp._id, {
      _id: anchorSector._id,
      stateId: "UK-LDN",
      countryId: "UK",
      revenue: 48_000, // GBP = 24_000 ₳ × 2
      currentGrowthCost: 600,
      profitMargin: 50,
      targetGrowthRate: 0,
      currentGrowthRate: 0,
    });
    const localLookups = baseLookups([localCorp], [localSector]);
    localLookups.exchangeRatesByCurrency.set("GBP", 2);

    const anchorResult = processSectors(anchorLookups, 1, new Date());
    const localResult = processSectors(localLookups, 1, new Date());

    // Revenue and income are ₳-denominated in the snapshot, so they match directly.
    expect(localResult.corpSnapshots[0].revenue).toBeCloseTo(
      anchorResult.corpSnapshots[0].revenue,
      5
    );
    expect(localResult.corpSnapshots[0].income).toBeCloseTo(
      anchorResult.corpSnapshots[0].income,
      5
    );
    expect(localResult.corpSnapshots[0].federalTaxPaid).toBeCloseTo(
      anchorResult.corpSnapshots[0].federalTaxPaid,
      5
    );
    // Totals also match (all ₳).
    expect(localResult.totalRevenueGenerated).toBeCloseTo(anchorResult.totalRevenueGenerated, 5);
    expect(localResult.totalIncomeGenerated).toBeCloseTo(anchorResult.totalIncomeGenerated, 5);

    // Persisted sector.revenue diverges by the FX rate: local writes GBP, anchor writes ₳.
    const anchorSectorWrite = (
      anchorResult.sectorOps[0] as unknown as {
        updateOne: { update: { $set: { revenue: number } } };
      }
    ).updateOne.update.$set.revenue;
    const localSectorWrite = (
      localResult.sectorOps[0] as unknown as {
        updateOne: { update: { $set: { revenue: number } } };
      }
    ).updateOne.update.$set.revenue;
    expect(localSectorWrite).toBeCloseTo(anchorSectorWrite * 2, 5);
  });
});

// ── Monopoly mechanics integration ────────────────────────────────────────────
// Pure-function tests for the helpers themselves live in
// src/lib/constants/dominanceMonopolyMechanics.test.ts. These tests verify the
// *plumbing* in processSectors: the dominance margin penalty, regulatory
// burden, and sustained-negative-production penalty all flow through to the
// corp-level income (incomePreDividends) and not just sectorNPV.

describe("processSectors, dominance regulatory burden flows to corp earnings", () => {
  it("regulatoryBurden is deducted from incomePreDividends, not just sectorNPV", () => {
    // Without dominance, baseline income calculation:
    //   hourlyRevenue = 1000, profitMargin = 50% → maintenance = 500 → income = 500
    const baseline = (() => {
      const corp = makeCorp();
      const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
      const lookups = baseLookups([corp], [sector]);
      // No market share entry → sectorMarketSharePct defaults to 0 → no dominance.
      return processSectors(lookups, 1, new Date());
    })();

    // With dominance at 100% share:
    //   - margin penalty: -15pp → effective margin = 35% → maintenance = 650 → margin profit = 350
    //   - regulatory burden: 5% of revenue = 50 → final profit = 350 - 50 = 300
    //   - corp earnings (incomePreDividends) MUST reflect both, not just margin.
    const dominant = (() => {
      const corp = makeCorp();
      const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
      const lookups = baseLookups([corp], [sector]);
      lookups.marketShareBySectorId.set(sector._id.toString(), 100);
      return processSectors(lookups, 1, new Date());
    })();

    // Baseline sanity: income matches the simple margin-only model.
    expect(baseline.totalIncomeGenerated).toBeCloseTo(500, 2);

    // Dominant corp's income must reflect BOTH the margin penalty AND the
    // regulatory burden. Expected: 1000 × 0.35 - 1000 × 0.05 = 350 - 50 = 300.
    expect(dominant.totalIncomeGenerated).toBeCloseTo(300, 2);

    // Snapshot incomePreDividends should match the income (no corp-level overhead).
    const snap = dominant.corpSnapshots[0];
    expect(snap.incomePreDividends).toBeCloseTo(300, 2);

    // sectorNPV reflects post-burden yearly profit (positive, finite).
    expect(snap.sectorNPV).toBeGreaterThan(0);
  });
});

// ── Growth-cost dominance multiplier, SOE exemption ──────────────────────────
// Bug: sandbox-world audit (657-turn run) found command-economy sectors'
// revenue-weighted growth-cost share climbing from 7% to 31% of revenue,
// continuously, for the whole run, the single largest driver behind the
// corporate world's one-way market-cap decline. Root cause: an SOE is exempt
// from the affordability brake (soft budget constraint, state firms don't go
// bankrupt) AND from the dominance MARGIN penalty / regulatory burden ("a
// nationalized industry is a state monopoly by design", Bug #0775), but was
// NOT exempt from the dominance GROWTH-COST multiplier, so a NatCorp (almost
// always the sole national producer, i.e. structurally dominant by design)
// paid up to 3x growth cost for the very monopoly condition the game
// otherwise treats as an intentional, unpenalised feature of state ownership,
// with nothing ever pulling its growth rate back down in response.
describe("processSectors, growth-cost dominance multiplier exempts SOEs", () => {
  function growthCostFromResult(
    result: ReturnType<typeof processSectors>,
    sectorId: ObjectId
  ): number {
    const op = result.sectorOps.find((o) => o.updateOne.filter._id.equals(sectorId));
    expect(op).toBeDefined();
    const growthCost = (op!.updateOne.update.$set as unknown as { currentGrowthCost: number })
      .currentGrowthCost;
    expect(typeof growthCost).toBe("number");
    return growthCost;
  }

  it("still applies the dominance multiplier to a private corp (unchanged behavior)", () => {
    const corp = makeCorp();
    const nonDominant = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      currentGrowthRate: 3,
      targetGrowthRate: 3,
    });
    const baseline = baseLookups([corp], [nonDominant]);
    const baselineResult = processSectors(baseline, 1, new Date());
    const baselineCost = growthCostFromResult(baselineResult, nonDominant._id);

    const dominantCorp = makeCorp();
    const dominantSector = makeSector(dominantCorp._id, {
      revenue: 24_000,
      profitMargin: 50,
      currentGrowthRate: 3,
      targetGrowthRate: 3,
    });
    const dominant = baseLookups([dominantCorp], [dominantSector]);
    dominant.marketShareBySectorId.set(dominantSector._id.toString(), 100);
    const dominantResult = processSectors(dominant, 1, new Date());
    const dominantCost = growthCostFromResult(dominantResult, dominantSector._id);

    // Private (market-economy) firms keep paying the monopoly surcharge, the
    // fix only narrows the SOE exemption gap, it does not remove the
    // mechanism for the corps it was designed to police.
    expect(dominantCost).toBeGreaterThan(baselineCost);
  });

  it("does not surcharge a state-owned corp's growth cost for dominance", () => {
    const soeLowShare = makeCorp({ countryOwnerId: "US", ownershipState: "stateOwned" });
    const lowShareSector = makeSector(soeLowShare._id, {
      revenue: 24_000,
      profitMargin: 50,
      currentGrowthRate: 3,
      targetGrowthRate: 3,
    });
    const lowShareLookups = baseLookups([soeLowShare], [lowShareSector]);
    // No market-share entry ⇒ defaults to 0 (no dominance either way).
    const lowShareResult = processSectors(lowShareLookups, 1, new Date());
    const lowShareCost = growthCostFromResult(lowShareResult, lowShareSector._id);

    const soeHighShare = makeCorp({ countryOwnerId: "US", ownershipState: "stateOwned" });
    const highShareSector = makeSector(soeHighShare._id, {
      revenue: 24_000,
      profitMargin: 50,
      currentGrowthRate: 3,
      targetGrowthRate: 3,
    });
    const highShareLookups = baseLookups([soeHighShare], [highShareSector]);
    highShareLookups.marketShareBySectorId.set(highShareSector._id.toString(), 100);
    const highShareResult = processSectors(highShareLookups, 1, new Date());
    const highShareCost = growthCostFromResult(highShareResult, highShareSector._id);

    // A 100%-share NatCorp pays exactly the same growth cost as one at 0%
    // share, the dominance multiplier is neutral (1x) for SOEs, matching the
    // sibling exemption already applied to the margin penalty and the
    // regulatory burden above.
    expect(highShareCost).toBeCloseTo(lowShareCost, 6);
  });
});

// ── Static-input cost/revenue stability over a simulated horizon ─────────────
// Regression guard for the "market can only fall" defect: a firm whose growth
// target, market share, and margin conditions never change must not see its
// cost/revenue ratio silently drift upward turn over turn. Nothing in
// processSector's own per-turn arithmetic should compound independently of an
// external driver (growth rate, dominance share, macro/commodity mods) that
// this test holds constant throughout.
describe("processSectors, static-input horizon stability", () => {
  it("keeps the cost/revenue ratio flat across 50 turns of unchanging inputs", () => {
    const corp = makeCorp();
    let sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      currentGrowthRate: 2,
      targetGrowthRate: 2,
    });

    const ratios: number[] = [];
    for (let turn = 1; turn <= 50; turn++) {
      const lookups = baseLookups([corp], [sector]);
      // Static market share, static everything else (mocks in this file already
      // zero out location/type/sprawl/commodity modifiers).
      lookups.marketShareBySectorId.set(sector._id.toString(), 20);
      const result = processSectors(lookups, turn, new Date());

      // Use the same revenue/totalCosts pair persisted to corporationHistory
      // (the exact fields the sandbox-world audit compared), pre-tax,
      // pre-dividend, so the ratio isolates the operating-cost mechanism
      // under test instead of unrelated tax/dividend drift.
      const snap = result.corpSnapshots[0];
      expect(snap).toBeDefined();
      ratios.push(snap.totalCosts / snap.revenue);

      const op = result.sectorOps.find((o) => o.updateOne.filter._id.equals(sector._id));
      expect(op).toBeDefined();
      const nextFields = op!.updateOne.update.$set as unknown as Partial<CorporateSector>;
      // Feed the persisted fields forward exactly as the real turn loop would
      // (sector.revenue / currentGrowthRate / targetGrowthRate / profitMargin
      // baseline are read fresh from the "persisted" doc each turn).
      sector = {
        ...sector,
        ...nextFields,
        // `effectiveProfitMargin` is telemetry-only (never read back into the
        // economy, see sectorTurn.ts); the seeded `profitMargin` constant stays
        // the baseline every turn, exactly as production does.
      } as CorporateSector;
    }

    const firstRatio = ratios[0];
    const lastRatio = ratios[ratios.length - 1];
    // Flat within a tight tolerance, no silent multi-turn compounding.
    expect(lastRatio).toBeCloseTo(firstRatio, 2);
  });
});

// ── Per-turn escrow funding (escrow buyback mode) ─────────────────────────────

describe("processSectors, per-turn escrow funding", () => {
  type CorpInc = {
    updateOne: { update: { $inc: { liquidCapital: number; shareEscrowBalance?: number } } };
  };

  it("moves the configured rate from liquidCapital into escrow (escrow mode)", () => {
    // No sectors → income 0, so the only liquidCapital delta is the escrow funding.
    const corp = makeCorp({
      liquidCapital: 1_000_000,
      shareBuybackMode: "escrow",
      escrowFundingPerTurn: 300,
    });
    const result = processSectors(baseLookups([corp], []), 1, new Date());

    const inc = (result.corpOps[0] as CorpInc).updateOne.update.$inc;
    expect(inc.liquidCapital).toBeCloseTo(-300, 5);
    expect(inc.shareEscrowBalance).toBeCloseTo(300, 5);
    // Snapshot liquidCapital reflects the outflow (1_000_000 + 0 income − 300).
    expect(result.corpSnapshots[0].liquidCapital).toBeCloseTo(999_700, 5);
  });

  it("caps the transfer at available liquidCapital (never drives treasury negative)", () => {
    const corp = makeCorp({
      liquidCapital: 100,
      shareBuybackMode: "escrow",
      escrowFundingPerTurn: 1_000,
    });
    const result = processSectors(baseLookups([corp], []), 1, new Date());

    const inc = (result.corpOps[0] as CorpInc).updateOne.update.$inc;
    expect(inc.liquidCapital).toBeCloseTo(-100, 5);
    expect(inc.shareEscrowBalance).toBeCloseTo(100, 5);
  });

  it("does not fund escrow in instant mode even when a rate is set", () => {
    const corp = makeCorp({
      liquidCapital: 1_000_000,
      // shareBuybackMode unset ⇒ instant
      escrowFundingPerTurn: 300,
    });
    const result = processSectors(baseLookups([corp], []), 1, new Date());

    const inc = (result.corpOps[0] as CorpInc).updateOne.update.$inc;
    expect(inc.shareEscrowBalance).toBeUndefined();
    expect(inc.liquidCapital).toBeCloseTo(0, 5); // no income, no funding
  });

  it("records escrowFundingMove + escrowBalanceAfter on the snapshot", () => {
    const corp = makeCorp({
      liquidCapital: 1_000_000,
      shareBuybackMode: "escrow",
      escrowFundingPerTurn: 300,
    });
    const startEscrow = corp.shareEscrowBalance ?? 0;
    const result = processSectors(baseLookups([corp], []), 1, new Date());
    const snap = result.corpSnapshots[0];
    expect(snap.escrowFundingMove).toBeCloseTo(300, 5);
    expect(snap.escrowBalanceAfter).toBeCloseTo(startEscrow + 300, 5);
  });

  it("records a zero escrowFundingMove in instant mode", () => {
    const corp = makeCorp({ liquidCapital: 1_000_000, escrowFundingPerTurn: 300 });
    const result = processSectors(baseLookups([corp], []), 1, new Date());
    expect(result.corpSnapshots[0].escrowFundingMove).toBeCloseTo(0, 5);
  });
});

describe("processSectors, sustained-negative-production tracker", () => {
  it("counter increments and persists to the sectorUpdate", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      productionPolicy: -10,
      productionPolicyLevel: -10,
      negativeProductionSustainedTurns: 5,
    });
    const lookups = baseLookups([corp], [sector]);
    const result = processSectors(lookups, 1, new Date());
    const update = result.sectorOps[0] as unknown as {
      updateOne: { update: { $set: { negativeProductionSustainedTurns: number } } };
    };
    expect(update.updateOne.update.$set.negativeProductionSustainedTurns).toBe(6);
  });

  it("counter decrements when policy returns to non-negative (no free reset)", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      productionPolicy: 0,
      productionPolicyLevel: 0,
      negativeProductionSustainedTurns: 100,
    });
    const lookups = baseLookups([corp], [sector]);
    const result = processSectors(lookups, 1, new Date());
    const update = result.sectorOps[0] as unknown as {
      updateOne: { update: { $set: { negativeProductionSustainedTurns: number } } };
    };
    expect(update.updateOne.update.$set.negativeProductionSustainedTurns).toBe(99);
  });
});

// ── Sector tech-tree bonuses ────────────────────────────────────────────────

describe("sector tech-tree effects", () => {
  it("applies no effect when the feature gate is off (4th arg false)", () => {
    const teched = makeCorp({ unlockedTechNodeIds: ["corp-1999-3"] }); // +2pp margin node
    const techedSector = makeSector(teched._id, { revenue: 24_000, profitMargin: 50 });

    const plain = makeCorp();
    const plainSector = makeSector(plain._id, { revenue: 24_000, profitMargin: 50 });

    const off = processSectors(baseLookups([teched], [techedSector]), 1, new Date(), false);
    const baseline = processSectors(baseLookups([plain], [plainSector]), 1, new Date(), false);
    // Gate off ⇒ identical income to a corp with no unlocked nodes.
    expect(off.totalIncomeGenerated).toBeCloseTo(baseline.totalIncomeGenerated, 5);
  });

  it("lifts income via a margin-bonus node when the gate is on", () => {
    const plain = makeCorp();
    const teched = makeCorp({ unlockedTechNodeIds: ["corp-1999-3"] }); // +2pp margin
    const plainSector = makeSector(plain._id, { revenue: 24_000, profitMargin: 50 });
    const techedSector = makeSector(teched._id, { revenue: 24_000, profitMargin: 50 });

    const base = processSectors(baseLookups([plain], [plainSector]), 1, new Date(), true);
    const lifted = processSectors(baseLookups([teched], [techedSector]), 1, new Date(), true);

    // +2pp margin ⇒ lower maintenance ⇒ higher income.
    expect(lifted.totalIncomeGenerated).toBeGreaterThan(base.totalIncomeGenerated);
  });
});

describe("v3 Phase 5, NPC unionization metric (labourSystemMode ≥ 'unions')", () => {
  function sectorOpSet(
    result: ReturnType<typeof processSectors>,
    sectorId: ObjectId
  ): Record<string, unknown> {
    const op = result.sectorOps.find(
      (o) =>
        (o as { updateOne: { filter: { _id: ObjectId } } }).updateOne.filter._id.toString() ===
        sectorId.toString()
    ) as { updateOne: { update: { $set: Record<string, unknown> } } };
    return op.updateOne.update.$set;
  }

  it("does not write unionization at all when labour is off (default LABOUR_DISABLED)", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id);
    const result = processSectors(baseLookups([corp], [sector]), 1, new Date());
    expect(sectorOpSet(result, sector._id).unionization).toBeUndefined();
  });

  it("does not write unionization when wagesEnabled but unionsEnabled is false (lower tier)", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { wageLevel: 0.8, unionization: 0 });
    const labour: LabourContext = { wagesEnabled: true, unionsEnabled: false };
    const result = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      undefined,
      labour
    );
    expect(sectorOpSet(result, sector._id).unionization).toBeUndefined();
  });

  it("steps unionization toward the drift target by at most UNIONIZATION_TREND_STEP_PER_TURN when unionsEnabled", () => {
    const corp = makeCorp();
    // Low wageLevel (below baseline) ⇒ drift target above the UNIONIZATION_BASELINE
    // neutral (no stateMetrics/minWage data in baseLookups ⇒ those terms are neutral).
    const sector = makeSector(corp._id, { wageLevel: 0.8, unionization: 0 });
    const labour: LabourContext = { wagesEnabled: true, unionsEnabled: true };
    const result = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      undefined,
      labour
    );
    const written = sectorOpSet(result, sector._id).unionization;
    expect(written).toBe(UNIONIZATION_TREND_STEP_PER_TURN); // current 0 -> target > step -> steps by the full cap
  });

  it("a high wageLevel pulls a nonzero unionization DOWN toward the lower target", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { wageLevel: 1.5, unionization: 30 });
    const labour: LabourContext = { wagesEnabled: true, unionsEnabled: true };
    const result = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      undefined,
      labour
    );
    const written = sectorOpSet(result, sector._id).unionization as number;
    expect(written).toBeLessThan(30);
  });

  it("Phase 5 exit criterion: enabling unions has NO economic effect (income identical with unionsEnabled true vs false)", () => {
    const corpA = makeCorp();
    const corpB = makeCorp();
    const sectorA = makeSector(corpA._id, { wageLevel: 0.8, unionization: 0 });
    const sectorB = makeSector(corpB._id, { wageLevel: 0.8, unionization: 0 });
    const wagesOnly: LabourContext = { wagesEnabled: true, unionsEnabled: false };
    const wagesAndUnions: LabourContext = { wagesEnabled: true, unionsEnabled: true };

    const off = processSectors(
      baseLookups([corpA], [sectorA]),
      1,
      new Date(),
      false,
      undefined,
      wagesOnly
    );
    const on = processSectors(
      baseLookups([corpB], [sectorB]),
      1,
      new Date(),
      false,
      undefined,
      wagesAndUnions
    );

    expect(on.totalIncomeGenerated).toBeCloseTo(off.totalIncomeGenerated, 9);
    expect(on.totalRevenueGenerated).toBeCloseTo(off.totalRevenueGenerated, 9);
  });
});

describe("v3 Phase 6, strikes & unionPremium (labourSystemMode ≥ 'unions')", () => {
  function sectorOpSet(
    result: ReturnType<typeof processSectors>,
    sectorId: ObjectId
  ): Record<string, unknown> {
    const op = result.sectorOps.find(
      (o) =>
        (o as { updateOne: { filter: { _id: ObjectId } } }).updateOne.filter._id.toString() ===
        sectorId.toString()
    ) as { updateOne: { update: { $set: Record<string, unknown> } } };
    return op.updateOne.update.$set;
  }

  const UNIONS: LabourContext = { wagesEnabled: true, unionsEnabled: true };

  it("a sector with an active strike (strikeStartedAtTurn set) has revenue throttled by STRIKE_REVENUE_THROTTLE", () => {
    const corpBase = makeCorp();
    const corpStriking = makeCorp();
    const sectorBase = makeSector(corpBase._id, { wageLevel: 1, unionization: 0 });
    const sectorStriking = makeSector(corpStriking._id, {
      wageLevel: 1,
      unionization: 0,
      strikeStartedAtTurn: 1,
    });

    const base = processSectors(
      baseLookups([corpBase], [sectorBase]),
      2,
      new Date(),
      false,
      undefined,
      UNIONS
    );
    const striking = processSectors(
      baseLookups([corpStriking], [sectorStriking]),
      2,
      new Date(),
      false,
      undefined,
      UNIONS
    );

    expect(striking.totalRevenueGenerated).toBeCloseTo(
      base.totalRevenueGenerated * (1 - STRIKE_REVENUE_THROTTLE),
      6
    );
    // Margin penalty on top of the revenue throttle: income drops MORE than
    // proportionally to revenue (i.e. the income/revenue ratio is lower).
    const baseRatio = base.totalIncomeGenerated / base.totalRevenueGenerated;
    const strikingRatio = striking.totalIncomeGenerated / striking.totalRevenueGenerated;
    expect(strikingRatio).toBeLessThan(baseRatio);
  });

  it("strikeStartedAtTurn is ignored when unionsEnabled is false (no throttle)", () => {
    const corpBase = makeCorp();
    const corpStriking = makeCorp();
    const sectorBase = makeSector(corpBase._id, { wageLevel: 1 });
    const sectorStriking = makeSector(corpStriking._id, { wageLevel: 1, strikeStartedAtTurn: 1 });
    const wagesOnly: LabourContext = { wagesEnabled: true, unionsEnabled: false };

    const base = processSectors(
      baseLookups([corpBase], [sectorBase]),
      2,
      new Date(),
      false,
      undefined,
      wagesOnly
    );
    const striking = processSectors(
      baseLookups([corpStriking], [sectorStriking]),
      2,
      new Date(),
      false,
      undefined,
      wagesOnly
    );

    expect(striking.totalRevenueGenerated).toBeCloseTo(base.totalRevenueGenerated, 9);
  });

  it("triggers a strike when unionization and the worker-expectation gap both qualify", () => {
    const corp = makeCorp();
    // workerExpectationIndex (1.2, "established" from a prior high-pay turn)
    // far above this turn's realWage (wageLevel 0.8 / cost-of-living 100 ⇒ 0.8)
    // ⇒ gap 0.4, well past STRIKE_EXPECTATION_GAP_THRESHOLD. unionization
    // (60) is comfortably above STRIKE_UNIONIZATION_THRESHOLD and a low
    // wageLevel only pushes the drift target higher, so it stays above
    // threshold after this turn's trend step.
    const sector = makeSector(corp._id, {
      wageLevel: 0.8,
      unionization: 60,
      workerExpectationIndex: 1.2,
    });
    const result = processSectors(
      baseLookups([corp], [sector]),
      10,
      new Date(),
      false,
      undefined,
      UNIONS
    );
    expect(sectorOpSet(result, sector._id).strikeStartedAtTurn).toBe(10);
    expect(result.strikeEvents).toContainEqual({
      sectorId: sector._id.toString(),
      sectorType: "manufacturing",
      countryId: "US",
      event: "started",
    });
  });

  it("does not trigger when unionization is below STRIKE_UNIONIZATION_THRESHOLD even with a wide gap", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      wageLevel: 0.8,
      unionization: STRIKE_UNIONIZATION_THRESHOLD - 10,
      workerExpectationIndex: 1.2,
    });
    const result = processSectors(
      baseLookups([corp], [sector]),
      10,
      new Date(),
      false,
      undefined,
      UNIONS
    );
    expect(sectorOpSet(result, sector._id).strikeStartedAtTurn).toBeNull();
    expect(result.strikeEvents).toHaveLength(0);
  });

  it("resolves an active strike via concession when the CEO raises wageLevel to close the gap", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      wageLevel: 1, // raised back to match expectation this turn
      unionization: 60,
      workerExpectationIndex: 1,
      strikeStartedAtTurn: 9, // started 1 turn ago, well before STRIKE_DURATION_TURNS would elapse
    });
    const result = processSectors(
      baseLookups([corp], [sector]),
      10,
      new Date(),
      false,
      undefined,
      UNIONS
    );
    const written = sectorOpSet(result, sector._id);
    expect(written.strikeStartedAtTurn).toBeNull();
    expect(written.strikeCooldownUntilTurn).toBe(10 + STRIKE_COOLDOWN_TURNS);
    expect(result.strikeEvents).toContainEqual({
      sectorId: sector._id.toString(),
      sectorType: "manufacturing",
      countryId: "US",
      event: "resolved_concession",
    });
  });

  it("resolves an active strike via wait-it-out at STRIKE_DURATION_TURNS, bumping unionization by STRIKE_WAITOUT_UNIONIZATION_BUMP", () => {
    const startTurn = 1;
    const turn = startTurn + STRIKE_DURATION_TURNS;

    const corpWaitout = makeCorp();
    const corpCounterfactual = makeCorp();
    // Identical conditions, except the counterfactual sector never went on
    // strike (no strikeStartedAtTurn), isolates the bump from the ordinary
    // unionization drift both sectors undergo this turn.
    const sectorWaitout = makeSector(corpWaitout._id, {
      wageLevel: 0.8,
      unionization: 60,
      workerExpectationIndex: 1.2, // gap stays wide, no concession
      strikeStartedAtTurn: startTurn,
    });
    const sectorCounterfactual = makeSector(corpCounterfactual._id, {
      wageLevel: 0.8,
      unionization: 60,
      workerExpectationIndex: 1.2,
    });

    const waitout = processSectors(
      baseLookups([corpWaitout], [sectorWaitout]),
      turn,
      new Date(),
      false,
      undefined,
      UNIONS
    );
    const counterfactual = processSectors(
      baseLookups([corpCounterfactual], [sectorCounterfactual]),
      turn,
      new Date(),
      false,
      undefined,
      UNIONS
    );

    const writtenWaitout = sectorOpSet(waitout, sectorWaitout._id);
    expect(writtenWaitout.strikeStartedAtTurn).toBeNull();
    expect(writtenWaitout.strikeCooldownUntilTurn).toBe(turn + STRIKE_COOLDOWN_TURNS);
    expect(waitout.strikeEvents).toContainEqual({
      sectorId: sectorWaitout._id.toString(),
      sectorType: "manufacturing",
      countryId: "US",
      event: "resolved_waitout",
    });

    const unionizationWaitout = writtenWaitout.unionization as number;
    const unionizationCounterfactual = sectorOpSet(counterfactual, sectorCounterfactual._id)
      .unionization as number;
    expect(unionizationWaitout - unionizationCounterfactual).toBeCloseTo(
      STRIKE_WAITOUT_UNIONIZATION_BUMP,
      6
    );
  });
});

describe("v3 Phase 7b/8, union-law bias & membership-pressure wiring (labourSystemMode ≥ 'full')", () => {
  function sectorOpSet(
    result: ReturnType<typeof processSectors>,
    sectorId: ObjectId
  ): Record<string, unknown> {
    const op = result.sectorOps.find(
      (o) =>
        (o as { updateOne: { filter: { _id: ObjectId } } }).updateOne.filter._id.toString() ===
        sectorId.toString()
    ) as { updateOne: { update: { $set: Record<string, unknown> } } };
    return op.updateOne.update.$set;
  }

  /**
   * `trendUnionization` is step-limited (≤1.5pp/turn), so a single turn can't
   * distinguish "higher target" once both scenarios' targets are more than
   * one step above the starting value, both simply take the same first
   * step. Iterate until convergence to compare final settled values instead.
   */
  function runUnionizationToConvergence(
    corp: Corporation,
    sector: CorporateSector,
    labour: LabourContext,
    turns = 60
  ): number {
    let current = sector.unionization ?? 0;
    for (let turn = 1; turn <= turns; turn++) {
      const result = processSectors(
        baseLookups([corp], [{ ...sector, unionization: current }]),
        turn,
        new Date(),
        false,
        undefined,
        labour
      );
      const written = sectorOpSet(result, sector._id).unionization as number;
      current = written;
    }
    return current;
  }

  it("a positive union-law bias raises trended unionization relative to no law, when fullEnabled", () => {
    const corpBase = makeCorp();
    const corpLaw = makeCorp();
    const sectorBase = makeSector(corpBase._id, { wageLevel: 1, unionization: 0 });
    const sectorLaw = makeSector(corpLaw._id, { wageLevel: 1, unionization: 0 });

    const withoutLaw: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: true,
    };
    const withLaw: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: true,
      unionLawBiasByCountry: new Map([["US", 30]]),
    };

    const baseUnionization = runUnionizationToConvergence(corpBase, sectorBase, withoutLaw);
    const biasUnionization = runUnionizationToConvergence(corpLaw, sectorLaw, withLaw);
    expect(biasUnionization).toBeGreaterThan(baseUnionization);
  });

  it("union-law bias is ignored when fullEnabled is false, even if the map has an entry", () => {
    const corpBase = makeCorp();
    const corpLaw = makeCorp();
    const sectorBase = makeSector(corpBase._id, { wageLevel: 1, unionization: 0 });
    const sectorLaw = makeSector(corpLaw._id, { wageLevel: 1, unionization: 0 });

    const withoutFull: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: false,
    };
    const withMapButNotFull: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: false,
      unionLawBiasByCountry: new Map([["US", 30]]),
    };

    const base = processSectors(
      baseLookups([corpBase], [sectorBase]),
      1,
      new Date(),
      false,
      undefined,
      withoutFull
    );
    const withMap = processSectors(
      baseLookups([corpLaw], [sectorLaw]),
      1,
      new Date(),
      false,
      undefined,
      withMapButNotFull
    );

    expect(sectorOpSet(withMap, sectorLaw._id).unionization).toBe(
      sectorOpSet(base, sectorBase._id).unionization
    );
  });

  it("a represented sector's high union approval raises trended unionization relative to an unrepresented one", () => {
    const corpBase = makeCorp();
    const corpUnion = makeCorp();
    const unionId = new ObjectId();
    const sectorBase = makeSector(corpBase._id, { wageLevel: 1, unionization: 0 });
    const sectorUnion = makeSector(corpUnion._id, {
      wageLevel: 1,
      unionization: 0,
      representingUnionId: unionId,
    });

    const noUnion: LabourContext = { wagesEnabled: true, unionsEnabled: true, fullEnabled: true };
    // Union dues v1: resolved via CorporateSector.representingUnionId, never a
    // (countryId, sectorType) match, players can found rivals, so the industry
    // pair no longer identifies one union.
    const withUnion: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: true,
      unionsById: new Map([[unionId.toString(), { approval: 90, activeServices: [] }]]),
    };

    const baseUnionization = runUnionizationToConvergence(corpBase, sectorBase, noUnion);
    const approvalUnionization = runUnionizationToConvergence(corpUnion, sectorUnion, withUnion);
    expect(approvalUnionization).toBeGreaterThan(baseUnionization);
  });

  it("a represented sector's LOW union approval lowers trended unionization relative to an unrepresented one, a badly run union bleeds its own density", () => {
    const corpBase = makeCorp();
    const corpUnion = makeCorp();
    const unionId = new ObjectId();
    // Start both above 0 so the low-approval case has room to fall.
    const sectorBase = makeSector(corpBase._id, { wageLevel: 1, unionization: 40 });
    const sectorUnion = makeSector(corpUnion._id, {
      wageLevel: 1,
      unionization: 40,
      representingUnionId: unionId,
    });

    const noUnion: LabourContext = { wagesEnabled: true, unionsEnabled: true, fullEnabled: true };
    const withBadUnion: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: true,
      unionsById: new Map([[unionId.toString(), { approval: 10, activeServices: [] }]]),
    };

    const baseUnionization = runUnionizationToConvergence(corpBase, sectorBase, noUnion);
    const badApprovalUnionization = runUnionizationToConvergence(
      corpUnion,
      sectorUnion,
      withBadUnion
    );
    expect(badApprovalUnionization).toBeLessThan(baseUnionization);
  });

  it("an unrepresented sector (no representingUnionId) is unaffected even when unionsById is populated", () => {
    const corp = makeCorp();
    const unionId = new ObjectId();
    // No representingUnionId on this sector, it must not inherit some other
    // union's approval just because SOME entry exists in the map.
    const sector = makeSector(corp._id, { wageLevel: 1, unionization: 0 });

    const withUnrelatedUnion: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: true,
      unionsById: new Map([[unionId.toString(), { approval: 100, activeServices: [] }]]),
    };
    const noUnion: LabourContext = { wagesEnabled: true, unionsEnabled: true, fullEnabled: true };

    const unaffected = runUnionizationToConvergence(corp, sector, withUnrelatedUnion);
    const base = runUnionizationToConvergence(makeCorp(), { ...sector }, noUnion);
    expect(unaffected).toBe(base);
  });

  it("baseline invariance: fullEnabled with bias 0 and no owned union is a no-op vs unions-only", () => {
    const corpA = makeCorp();
    const corpB = makeCorp();
    const sectorA = makeSector(corpA._id, { wageLevel: 0.8, unionization: 0 });
    const sectorB = makeSector(corpB._id, { wageLevel: 0.8, unionization: 0 });

    const unionsOnly: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: false,
    };
    const fullNeutral: LabourContext = {
      wagesEnabled: true,
      unionsEnabled: true,
      fullEnabled: true,
      unionLawBiasByCountry: new Map(),
      unionsById: new Map(),
    };

    const off = processSectors(
      baseLookups([corpA], [sectorA]),
      1,
      new Date(),
      false,
      undefined,
      unionsOnly
    );
    const on = processSectors(
      baseLookups([corpB], [sectorB]),
      1,
      new Date(),
      false,
      undefined,
      fullNeutral
    );

    expect(on.totalIncomeGenerated).toBeCloseTo(off.totalIncomeGenerated, 9);
    expect(on.totalRevenueGenerated).toBeCloseTo(off.totalRevenueGenerated, 9);
  });
});

// ── Price realization (marketSystemMode >= "realization", audit t806 Fix 1) ──

describe("price realization", () => {
  it("is inert when the market mode is off (default param)", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const lookups = baseLookups([corp], [sector]);
    // Shortage prices present, but mode off → identical revenue.
    lookups.priceRatioByCommodity = new Map([["electronics", 1.69]]);

    const off = processSectors(lookups, 1, new Date());
    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());
    expect(off.totalRevenueGenerated).toBe(baseline.totalRevenueGenerated);
    // Telemetry field is never written when the mode is off.
    const op = off.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    expect(op.updateOne.update.$set.priceRealization).toBeUndefined();
  });

  it("scales realized revenue by the lagged output price when enabled", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const lookups = baseLookups([corp], [sector]);
    lookups.priceRatioByCommodity = new Map([["electronics", 1.69]]);

    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());
    // Sector sells only electronics, priced at 1.69× base → realization √1.69 = 1.3.
    vi.mocked(getEffectiveStrategyRates).mockReturnValueOnce({
      growthRate: 1,
      profitMargin: 0,
      isTransitioning: false,
      supply: { electronics: 1 },
    } as unknown as ReturnType<typeof getEffectiveStrategyRates>);
    const realized = processSectors(lookups, 1, new Date(), false, undefined, undefined, {
      ...MARKET_DISABLED,
      realizationEnabled: true,
    });

    expect(realized.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated * 1.3, 6);
    const op = realized.sectorOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(op.updateOne.update.$set.priceRealization).toBeCloseTo(1.3, 3);
  });

  it("leaves revenue unchanged when enabled but outputs are priced at base", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());
    // Priced at base (empty ratio map → factor 1) with a real output mix.
    vi.mocked(getEffectiveStrategyRates).mockReturnValueOnce({
      growthRate: 1,
      profitMargin: 0,
      isTransitioning: false,
      supply: { electronics: 1 },
    } as unknown as ReturnType<typeof getEffectiveStrategyRates>);
    const enabled = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      undefined,
      undefined,
      { ...MARKET_DISABLED, realizationEnabled: true }
    );
    expect(enabled.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated, 6);
    const op = enabled.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    expect(op.updateOne.update.$set.priceRealization).toBe(1);
  });
});

// ── Throughput coupling (marketSystemMode >= "clearing", audit t806 D1) ──

describe("throughput coupling", () => {
  it("throttles realized revenue when an input is scarce (ramped from start turn)", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      // Ramp anchored 120 turns ago → 50% progress toward full throttle.
      throughputStartTurn: 1,
    } as Partial<CorporateSector>);
    const lookups = baseLookups([corp], [sector]);
    lookups.globalCommodityBalances = new Map([["steel", { supply: 60, demand: 100 }]]);

    const baseline = processSectors(baseLookups([corp], [sector]), 121, new Date());
    // Sector consumes steel; market supplies only 60% of steel demand.
    vi.mocked(getEffectiveStrategyRates).mockReturnValueOnce({
      growthRate: 1,
      profitMargin: 0,
      isTransitioning: false,
      demand: { steel: 0.3 },
    } as unknown as ReturnType<typeof getEffectiveStrategyRates>);
    const throttled = processSectors(lookups, 121, new Date(), false, undefined, undefined, {
      ...MARKET_DISABLED,
      throughputEnabled: true,
    });

    // rampProgress = 120/240 = 0.5 → raw factor = 1 − 0.5×(1−0.6) = 0.8, then the
    // launch-safety governor floors the throughput haircut at 1 − 0.15 = 0.85.
    expect(throttled.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated * 0.85, 6);
    const op = throttled.sectorOps[0] as {
      updateOne: { update: { $set: Record<string, unknown> } };
    };
    expect(op.updateOne.update.$set.throughputFactor).toBeCloseTo(0.85, 3);
    expect(op.updateOne.update.$set.throughputBindingInput).toBe("steel");
  });

  it("is inert when the mode is off, even with scarce inputs", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const lookups = baseLookups([corp], [sector]);
    lookups.globalCommodityBalances = new Map([["steel", { supply: 1, demand: 100 }]]);

    const off = processSectors(lookups, 121, new Date());
    const baseline = processSectors(baseLookups([corp], [sector]), 121, new Date());
    expect(off.totalRevenueGenerated).toBe(baseline.totalRevenueGenerated);
    const op = off.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    expect(op.updateOne.update.$set.throughputFactor).toBeUndefined();
  });
});

// ── Posted-price clearing (marketSystemMode >= "clearing", Fix 2) ──

describe("market clearing", () => {
  it("applies the pre-pass clearing factor to realized revenue and persists telemetry", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });
    const lookups = baseLookups([corp], [sector]);

    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());
    const cleared = processSectors(lookups, 1, new Date(), false, undefined, undefined, {
      ...MARKET_DISABLED,
      realizationEnabled: true, // must be subsumed, not stacked
      clearingEnabled: true,
      clearingBySectorId: new Map([
        // Premium seller in a shortage: sold out at +10% → factor 1.1 (>= 1, no ramp).
        [sector._id.toString(), { factor: 1.1, soldFraction: 1, effectivePosture: 0.1 }],
      ]),
    });

    // Launch-safety governor: divergence from the ledger baseline ramps in from
    // 0 over 240 turns. This upside sector has no clearingStartTurn anchor (only
    // sub-1 factors stamp it), so λ = 0 → the flip is a no-op on realized revenue
    // (== baseline) even though the raw 1.1 factor is still persisted to telemetry.
    expect(cleared.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated, 6);
    const op = cleared.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    expect(op.updateOne.update.$set.clearingFactor).toBeCloseTo(1.1, 3);
    expect(op.updateOne.update.$set.soldFraction).toBe(1);
    expect(op.updateOne.update.$set.effectivePosture).toBeCloseTo(0.1, 3);
    // Realization is replaced by clearing, never written alongside a stacked copy.
    expect(op.updateOne.update.$set.priceRealization).toBeUndefined();
  });

  it("ramps sub-1 clearing factors from the sector's anchor turn", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      clearingStartTurn: 1, // 120 turns ago → 50% ramp progress
    } as Partial<CorporateSector>);
    const lookups = baseLookups([corp], [sector]);

    const baseline = processSectors(baseLookups([corp], [sector]), 121, new Date());
    const cleared = processSectors(lookups, 121, new Date(), false, undefined, undefined, {
      ...MARKET_DISABLED,
      clearingEnabled: true,
      clearingBySectorId: new Map([
        // Glut, premium posture: only 40% sold → raw factor 0.44.
        [sector._id.toString(), { factor: 0.44, soldFraction: 0.4, effectivePosture: 0.1 }],
      ]),
    });

    // Launch-safety governor (clearing leg). C8: the cap WIDENS with the ramp,
    // capEffective(0.15, λ) = 0.15 / (1 − λ), which is 0.30 at λ = 120/240 = 0.5.
    // The effective market factor (0.72 after the posture leg) now sits INSIDE
    // that ±30% band, so it survives the clamp untouched and only the ramp
    // applies: 1 + 0.5 × (0.72 − 1) = 0.86.
    //
    // Under the old constant ±15% cap the same factor was clamped to 0.85
    // before ramping, giving 0.925, the clamp was doing the work the market
    // signal was supposed to do, and it never released.
    expect(cleared.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated * 0.86, 6);
  });
});

// ── Capital tier (marketSystemMode >= "capital", Fix 4 v1) ──

describe("capital tier", () => {
  const CAPITAL_ON: MarketContext = {
    ...MARKET_DISABLED,
    capitalEnabled: true,
  };

  it("is a no-op at first exposure (seeded with headroom) and persists the stock", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { revenue: 24_000, profitMargin: 50 });

    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());
    vi.mocked(getEffectiveStrategyRates).mockReturnValueOnce({
      growthRate: 1,
      profitMargin: 0,
      isTransitioning: false,
      supply: { electronics: 1 },
    } as unknown as ReturnType<typeof getEffectiveStrategyRates>);
    const seeded = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      undefined,
      undefined,
      CAPITAL_ON
    );

    expect(seeded.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated, 6);
    const op = seeded.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    expect(op.updateOne.update.$set.capitalStock as number).toBeGreaterThan(0);
    expect(op.updateOne.update.$set.capitalUtilization).toBe(1);
  });

  it("gates realized revenue when capacity has decayed below implied output", () => {
    const corp = makeCorp();
    // 24000 revenue at electronics rate 1, base 500 → implied 48 units/day.
    // Stock of 24 units → utilization 0.5.
    const sector = makeSector(corp._id, {
      revenue: 24_000,
      profitMargin: 50,
      capitalStock: 24,
    } as Partial<CorporateSector>);

    const baseline = processSectors(baseLookups([corp], [sector]), 1, new Date());
    vi.mocked(getEffectiveStrategyRates).mockReturnValueOnce({
      growthRate: 1,
      profitMargin: 0,
      isTransitioning: false,
      supply: { electronics: 1 },
    } as unknown as ReturnType<typeof getEffectiveStrategyRates>);
    const gated = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      undefined,
      undefined,
      CAPITAL_ON
    );

    // Stock advances ~24×(1−dep) ≈ 23.99 → factor ≈ 23.99/48 ≈ 0.4998
    const op = gated.sectorOps[0] as { updateOne: { update: { $set: Record<string, unknown> } } };
    const factor = op.updateOne.update.$set.capitalUtilization as number;
    expect(factor).toBeGreaterThan(0.49);
    expect(factor).toBeLessThan(0.51);
    // factor is persisted rounded to 3dp; compare within ±0.5 revenue.
    expect(gated.totalRevenueGenerated).toBeCloseTo(baseline.totalRevenueGenerated * factor, 0);
  });
});

describe("O1c: paid growth cost per operating state", () => {
  it("accumulates a growing sector's paid growth cost, keyed by stateId", () => {
    const corp = makeCorp();
    // Positive growth ⇒ non-zero growth cost that flows to the operating state.
    const sector = makeSector(corp._id, {
      stateId: "US-CA",
      currentGrowthRate: 5,
      targetGrowthRate: 5,
    });
    const result = processSectors(baseLookups([corp], [sector]), 1, new Date());
    expect(result.growthInvestmentByOperatingState.get("US-CA") ?? 0).toBeGreaterThan(0);
  });

  it("a flat (zero-growth) sector contributes no investment", () => {
    const corp = makeCorp();
    const sector = makeSector(corp._id, { currentGrowthRate: 0, targetGrowthRate: 0 });
    const result = processSectors(baseLookups([corp], [sector]), 1, new Date());
    expect(result.growthInvestmentByOperatingState.get("US-CA") ?? 0).toBe(0);
  });
});

// ── Soft budget constraint: the affordability brake and planned economies ─────

describe("affordability brake vs the soft budget constraint", () => {
  /** Pull the persisted targetGrowthRate out of the sector bulkWrite ops. */
  function targetFrom(result: ReturnType<typeof processSectors>): number | undefined {
    type UpdateOneOp = { updateOne?: { update?: { $set?: Record<string, unknown> } } };
    for (const op of result.sectorOps as unknown as UpdateOneOp[]) {
      const set = op?.updateOne?.update?.$set;
      if (set && typeof set.targetGrowthRate === "number") return set.targetGrowthRate;
    }
    return undefined;
  }

  /** A sector whose prior growth cost eats more than half its margin. */
  function unaffordable(countryId: string) {
    const corp = makeCorp({ countryId } as Partial<Corporation>);
    const sector = makeSector(corp._id, {
      countryId,
      revenue: 24_000,
      // 12% margin is what SOEs seed at; growth cost at 20% of revenue is far
      // past the half-margin threshold, so a market sector brakes here.
      profitMargin: 12,
      effectiveProfitMargin: 12,
      currentGrowthCost: 4_800,
      targetGrowthRate: 6,
      currentGrowthRate: 6,
    } as Partial<CorporateSector>);
    return { corp, sector };
  }

  it("brakes an unaffordable MARKET sector's target", () => {
    const { corp, sector } = unaffordable("US");
    const r = processSectors(baseLookups([corp], [sector]), 1, new Date(), false, 1953);
    expect(targetFrom(r)).toBeLessThan(6);
  });

  it("sets a command-economy target from the PLAN, never braking it down", () => {
    // Regression: SOEs seed at a 12% margin against a 35% market margin, so the
    // brake's half-margin test is 6% for them versus 17.5%, and their authored
    // 6% era growth target was unaffordable BY CONSTRUCTION. In a live 1953 run
    // that drove 58 of 136 Soviet sectors to exactly zero growth, silently
    // recreating the frozen Soviet production base by a different route.
    const { corp, sector } = unaffordable("RU");
    const r = processSectors(
      baseLookups([corp], [sector]),
      1,
      new Date(),
      false,
      1953,
      undefined,
      undefined,
      false,
      true // commandEconomyEnabled
    );
    // The plan sets the target: era trend for the year, weighted by the sector's
    // Group A / Group B priority. Manufacturing is a favoured producer-goods
    // sector, so it lands ABOVE the 6.0 national trend rather than being braked
    // below it. The point of the assertion is the direction: an unaffordable
    // command sector must not be pulled down.
    const planned = targetFrom(r);
    expect(planned).toBeDefined();
    expect(planned as number).toBeGreaterThanOrEqual(6);
  });

  it("disperses planned targets across sectors instead of one flat rate", () => {
    // 136 Soviet sectors all carrying an identical target is the "a field with no
    // variation across a world is a finding, not a value" case. Producer goods
    // must outrank consumer goods, as they did under the plan.
    const targets = new Map();
    for (const sectorType of ["defense", "manufacturing", "retail", "agriculture"] as const) {
      const corp = makeCorp({ countryId: "RU" });
      const sector = makeSector(corp._id, {
        countryId: "RU",
        sectorType,
        revenue: 24_000,
        profitMargin: 12,
        effectiveProfitMargin: 12,
        currentGrowthCost: 4_800,
        targetGrowthRate: 6,
        currentGrowthRate: 6,
      });
      const r = processSectors(
        baseLookups([corp], [sector]),
        1,
        new Date(),
        false,
        1953,
        undefined,
        undefined,
        false,
        true
      );
      targets.set(sectorType, targetFrom(r));
    }
    expect(new Set([...targets.values()]).size).toBeGreaterThan(1);
    expect(targets.get("defense")).toBeGreaterThan(targets.get("retail"));
    expect(targets.get("manufacturing")).toBeGreaterThan(targets.get("agriculture"));
  });

  it("still brakes a command country when the feature flag is OFF", () => {
    const { corp, sector } = unaffordable("RU");
    const r = processSectors(baseLookups([corp], [sector]), 1, new Date(), false, 1953);
    expect(targetFrom(r)).toBeLessThan(6);
  });
});
