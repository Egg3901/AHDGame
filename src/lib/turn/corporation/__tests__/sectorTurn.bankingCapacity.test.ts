import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { BankCharter } from "@/lib/db/types/bank";
import { buildMarketContext } from "@/lib/market/marketContext";
import type { CorporationLookups } from "../types";
import { processSector, type SectorTurnEnv } from "../sectorTurn";

const CORP_ID = new ObjectId();
const SECTOR_ID = new ObjectId();
const CAPACITY = 250;

/** Empty-but-complete lookups: every consumer sees "no data => neutral". */
function makeLookups(): CorporationLookups {
  return {
    corporations: [],
    sectorsByCorp: new Map(),
    corpById: new Map(),
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
    marketShareBySectorId: new Map(),
    allTariffs: [],
    activeFtaPairs: new Set(),
    ftaCoverage: { byCountryEconomyWide: new Map(), bySectorType: new Map() },
    activeSubsidies: [],
    priceRatioByCommodity: new Map(),
    globalCommodityBalances: new Map(),
    stateInputAvailabilityByState: new Map(),
    nationalCommodityBalancesByCountry: new Map(),
    rawStateBalances: new Map(),
    extractionCapacityUtilBySector: new Map(),
    stateResourceCapacityByState: new Map(),
    stateSectorSpecializationByState: new Map(),
    rawWorkforceSkillByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
    eraUnitScale: 1,
  } as unknown as CorporationLookups;
}

function makeEnv(privateBankingEnabled: boolean): SectorTurnEnv {
  return {
    lookups: makeLookups(),
    turn: 100,
    currentTurn: 100,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    currentYear: 2019,
    labour: { wagesEnabled: false },
    market: buildMarketContext("plants", { rampTurns: 0 }),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
    privateBankingEnabled,
  } as unknown as SectorTurnEnv;
}

function makeCorp(charter?: BankCharter): Corporation {
  return {
    _id: CORP_ID,
    name: "Finco",
    countryId: "US",
    type: "financial",
    liquidCapital: 10_000_000,
    headquartersState: "CA",
    bankCharter: charter,
    createdAt: new Date(),
  } as unknown as Corporation;
}

function makeSector(): CorporateSector {
  return {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    sectorType: "financial",
    stateId: "CA",
    countryId: "US",
    revenue: CAPACITY * 4000,
    capitalStock: CAPACITY,
    plantsStartTurn: 1,
    strategyId: "standard",
    targetGrowthRate: 0,
    currentGrowthRate: 0,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 100,
    createdAt: new Date(),
  } as unknown as CorporateSector;
}

describe("processSector banking capacity split", () => {
  const charter: BankCharter = {
    type: "retail",
    status: "active",
    currency: "USD",
    charteredTurn: 1,
    postedCapital: 10_000_000,
    depositOffset: 0,
    lendingOffset: 0,
    branchCapacityShare: 0.4,
  };

  it("scales financial output by (1 - branchShare) only when chartered and flag on", () => {
    const run = (enabled: boolean, charter?: BankCharter) => {
      const env = makeEnv(enabled);
      processSector(env, makeCorp(charter), makeSector(), 1, undefined, 1);
      const op = env.sectorOps[0] as {
        updateOne: { update: { $set?: { producedUnits?: number } } };
      };
      return op.updateOne.update.$set?.producedUnits ?? 0;
    };

    const charteredOn = run(true, charter);
    const charteredOff = run(false, charter);
    const uncharteredOn = run(true, undefined);

    expect(charteredOff).toBeGreaterThan(0);
    expect(uncharteredOn).toBeCloseTo(charteredOff, 2);
    // producedUnits is persisted rounded to 2dp
    expect(charteredOn).toBeCloseTo(charteredOff * 0.6, 1);
  });
});
