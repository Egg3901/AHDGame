/**
 * Synthetic NPC plant fixture shared by native operation tests and simulations.
 */
import { ObjectId } from "mongodb";
import type { CommodityType } from "@/lib/constants/commodities";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import { buildMarketContext } from "@/lib/market/marketContext";
import { getEffectiveStrategyRatesForOperatingModel } from "@/lib/constants/sectorStrategies";
import { processSector, type SectorTurnEnv } from "@/lib/turn/corporation/sectorTurn";
import type { CorporationLookups } from "@/lib/turn/corporation/types";
const CORP_ID = new ObjectId("000000000000000000000001");
export const SECTOR_ID = new ObjectId("000000000000000000000002");
/** Empty-but-complete lookups: every consumer sees "no data ⇒ neutral". */
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
    labourTightnessByState: new Map(),
    regionalConditionMarginByState: new Map(),
    sectorPresenceKeys: new Set(),
    exportIntensityByCountry: new Map(),
    activeDisasterEffectsByState: new Map(),
    politicalBoardByState: new Map(),
  } as unknown as CorporationLookups;
}

function makeEnv(mode: "capital" | "plants", currentTurn: number): SectorTurnEnv {
  return {
    lookups: makeLookups(),
    turn: currentTurn,
    currentTurn,
    now: new Date("2026-08-01T00:00:00Z"),
    techTreesEnabled: false,
    labour: { wagesEnabled: false },
    market: buildMarketContext(mode),
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps: [],
  } as unknown as SectorTurnEnv;
}

/** The `$set` payload processSector queued for the sector. */
function sectorUpdateOf(env: SectorTurnEnv): Record<string, unknown> {
  const op = env.sectorOps[0] as { updateOne: { update: { $set?: Record<string, unknown> } } };
  return op.updateOne.update.$set ?? {};
}

export function scenario(overrides: Partial<CorporateSector> = {}) {
  const corp = {
    _id: CORP_ID,
    countryId: "US",
    type: "technology",
    ceoType: "npp",
    liquidCapital: 1000000,
  } as Corporation;
  const sector = {
    _id: SECTOR_ID,
    corporationId: CORP_ID,
    countryId: "US",
    stateId: "US-CA",
    sectorType: "technology",
    strategyId: "software",
    revenue: 500000,
    profitMargin: 20,
    currentGrowthRate: 0,
    targetGrowthRate: 0,
    currentGrowthCost: 0,
    capitalStock: 400,
    capacityBookAnchor: 10000,
    buildQueue: [],
    plantsStartTurn: 1,
    producedUnits: 40,
    soldUnits: 40,
    demandThrottleFactor: 0.115,
    plantsPnl: { profit: -100, revenue: 100, turn: 999 },
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
    otherOpexPerUnitAnchor: 10,
    otherOpexAnchorMarginBasis: 0.8,
    plantsUpkeepMarginBasisAnchor: 0.8,
    ...overrides,
  } as CorporateSector;
  const env = makeEnv("plants", 1000);
  env.currentYear = 1994;
  env.lookups.engineSixCountries = new Set(["US"]);
  env.market.explicitPlantCostsEnabled = true;
  env.market.contractProductionTargetBySectorId = new Map();
  const rates = getEffectiveStrategyRatesForOperatingModel(
    "technology",
    "software",
    undefined,
    undefined,
    1000
  );
  for (const commodity of new Set([...Object.keys(rates.supply), ...Object.keys(rates.demand)])) {
    env.lookups.globalCommodityBalances.set(commodity as CommodityType, {
      supply: 1000,
      demand: 500,
    });
  }
  return { corp, sector, env };
}

export function runCase(s: ReturnType<typeof scenario>) {
  processSector(s.env, s.corp, s.sector, 1, undefined, 1);
  return sectorUpdateOf(s.env) as Partial<CorporateSector>;
}
