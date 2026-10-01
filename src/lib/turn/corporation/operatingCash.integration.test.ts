/** Stateful accounting of real sector operating cash, including losses. */
import { describe, expect, it, vi } from "vitest";
import { ObjectId, type Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CorporationLookups } from "./types";
import { processSectors } from "./sectorCalculations";
import { emitCorporationTurnTx } from "./corporationTurnPhases";
import { createInMemoryDb } from "@/lib/test-utils/inMemoryDb";
import { getDb } from "@/lib/mongodb";
import { resetLedgerShadowFlagCache } from "@/lib/ledger/featureFlag";
import { reconcileLedger } from "@/lib/ledger/reconcile";
import type { LedgerEntry } from "@/lib/ledger/types";
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));

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
    labourTightnessByState: new Map(),
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

describe("corporate operating cash stock-flow", () => {
  it.each([
    { currency: "USD", rate: 1, logistics: 48000, revenue: 24000, loss: true },
    { currency: "USD", rate: 1.25, logistics: 48000.13, revenue: 24000.37, loss: true },
    { currency: "GBP", rate: 0.57, logistics: 48000.13, revenue: 24000.37, loss: true },
    { currency: "ITL", rate: 639.12, logistics: 48000.13, revenue: 24000.37, loss: true },
    { currency: "JPY", rate: 100.5, logistics: 48000.13, revenue: 24000.37, loss: true },
    { currency: "USD", rate: 1.25, logistics: 0, revenue: 12345.678, loss: false },
  ])(
    "witnesses $currency rate $rate loss $loss through the real cash writer",
    async ({ currency, rate, logistics, revenue, loss }) => {
      const corp = makeCorp({
        liquidCurrencyCode: currency as CurrencyCode,
        logisticsBudget: logistics * rate,
        liquidCapital: 1_000_000 * rate,
      });
      const sector = makeSector(corp._id, { revenue });
      const lookups = baseLookups([corp], [sector]);
      lookups.exchangeRatesByCurrency.set(currency as CurrencyCode, rate);
      const memory = createInMemoryDb();
      memory.seed("corporations", [{ ...corp }]);
      memory.seed("gameConfig", [{ _id: "default", ledgerShadow: true }]);
      memory.seed("exchangeRates", [{ _id: currency, currencyCode: currency, rate }]);
      const db = memory as unknown as Db;
      vi.mocked(getDb).mockResolvedValue(db);
      resetLedgerShadowFlagCache();
      const now = new Date("2026-01-01T00:00:00Z");
      const result = processSectors(lookups, 1, now);
      await db.collection<Corporation>("corporations").bulkWrite(result.corpOps);
      await emitCorporationTurnTx({
        db,
        lookups,
        ...result,
        dividendTaxPaidByCountry: new Map(),
        turn: 1,
        now,
        thresholds: {},
      });
      const close = Number(memory.collection("corporations").docs[0].liquidCapital);
      if (loss) expect(close).toBeLessThan(corp.liquidCapital);
      else expect(close).toBeGreaterThan(corp.liquidCapital);
      const report = reconcileLedger({
        turn: 1,
        openingBalances: { [`corporation:${corp._id}:${currency}`]: corp.liquidCapital / rate },
        closingBalances: { [`corporation:${corp._id}:${currency}`]: close / rate },
        entries: memory.collection("ledgerEntries").docs as unknown as LedgerEntry[],
      });
      expect(report.stockVsFlow.divergentCount, JSON.stringify(report.stockVsFlow)).toBe(0);
      expect(report.trialBalance.status).toBe("green");
      expect(report.unattributed).toEqual([]);
    }
  );
});
