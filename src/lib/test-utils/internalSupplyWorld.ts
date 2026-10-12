/** Synthetic internal supply qualification fixture. No DB, network or player data. */
import { prepareInternalSupplySectorResults } from "@/lib/turn/corporation/internalSupplySectorPass";
import {
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { ObjectId } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CorporationLookups } from "@/lib/turn/corporation/types";
import { processSector, type SectorTurnEnv } from "@/lib/turn/corporation/sectorTurn";
import { runClearingPrePass } from "@/lib/turn/corporation/clearingPrePass";
import { buildMarketContext } from "@/lib/market/marketContext";
import type { InternalSupplyPolicy } from "@/lib/market/internalSupply/rules";
function emptyLookups(): CorporationLookups {
  return {
    corporations: [],
    primeRateSmoothedByCountry: new Map(),
    federalBudgets: [],
    domesticCorpTaxRateByCountry: new Map(),
    foreignCorpTaxRateByCountry: new Map(),
    domesticStateCorpTaxRateByState: new Map(),
    foreignStateCorpTaxRateByState: new Map(),
    stateCountryMap: new Map(),
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

export function runInternalSupplyWorld(
  policy: InternalSupplyPolicy,
  overrides: { mothballed?: boolean; group?: boolean; fx?: number } = {}
) {
  const parentId = new ObjectId("000000000000000000000001");
  const childId = new ObjectId("000000000000000000000002");
  const mineId = new ObjectId("000000000000000000000011");
  const factoryId = new ObjectId("000000000000000000000012");
  const corp = {
    _id: parentId,
    name: "Synthetic producer",
    countryId: "US",
    sectorType: "extraction",
    type: "extraction",
    secondaryType: null,
    headquartersState: "MN",
    dividendRate: 0,
    ceoSalary: 0,
    marketingBudget: 0,
    logisticsBudget: 0,
    marketingStrength: 0,
    logisticsStrength: 0,
    liquidCapital: 1000000,
    totalShares: 100,
    shareholders: [{ shares: 100 }],
    internalSupplyPolicy: policy,
  } as unknown as Corporation;
  const child = {
    ...corp,
    _id: childId,
    name: "Synthetic buyer",
    internalSupplyPolicy: undefined,
    shareholders: [{ corporationId: parentId, shares: 100 }],
  } as Corporation;
  const common = {
    stateId: "MN",
    countryId: "US",
    revenue: 240000,
    profitMargin: 20,
    effectiveProfitMargin: 20,
    currentGrowthRate: 0,
    targetGrowthRate: 0,
    currentGrowthCost: 0,
    productionPolicy: 0,
    productionPolicyLevel: 0,
    workers: 1000,
    capitalStock: 300,
    operatingCapacityUnits: 300,
    producedUnits: 200,
    throughputStartTurn: 0,
    plantsStartTurn: 0,
    clearingStartTurn: 0,
    otherOpexPerUnitAnchor: 0,
  };
  const mine = {
    ...common,
    _id: mineId,
    corporationId: parentId,
    sectorType: "extraction",
    strategyId: "iron_mining",
    mothballed: overrides.mothballed === true,
  } as unknown as CorporateSector;
  const factory = {
    ...common,
    _id: factoryId,
    corporationId: overrides.group ? childId : parentId,
    sectorType: "manufacturing",
    strategyId: "standard",
  } as unknown as CorporateSector;
  if (overrides.fx && overrides.group) {
    child.countryId = "JP";
    (factory as unknown as { countryId: string }).countryId = "JP";
    factory.stateId = "JP-TK";
    factory.revenue *= overrides.fx;
  }
  const lookups = emptyLookups();
  lookups.eraUnitScale = 1;
  lookups.preset = "2019-default";
  lookups.exchangeRatesByCurrency = new Map(overrides.fx ? [["JPY", overrides.fx]] : []);
  lookups.reachablePriceRatioByCountry = new Map();
  lookups.statePriceRatioByState = new Map();
  lookups.corpById = new Map([
    [parentId.toString(), corp],
    ...(overrides.group ? [[childId.toString(), child] as const] : []),
  ]);
  lookups.corporations = overrides.group ? [corp, child] : [corp];
  lookups.sectorsByCorp = overrides.group
    ? new Map([
        [parentId.toString(), [mine]],
        [childId.toString(), [factory]],
      ])
    : new Map([[parentId.toString(), [mine, factory]]]);
  lookups.globalCommodityBalances.set("iron", { supply: 500, demand: 1000 });
  const market = buildMarketContext("plants");
  market.explicitPlantCostsEnabled = true;
  runClearingPrePass({
    lookups,
    market,
    turn: 1000,
    currentYear: 2019,
    commandEconomyEnabled: false,
    freightSettlementActive: false,
    supplyAgreementsEnabled: false,
    settleableAgreements: undefined,
    contractedByCorpCommodity: undefined,
    contractSettlementByCorp: new Map(),
    producedByCorpCommodity: new Map(),
    achievableByCorpCommodity: new Map(),
    stateLocalClearingBlockedByLegacyAgreement: false,
    brandLoyaltyEnabled: false,
    brandLoyaltySliceEnabled: false,
    qualityPremiumPricingEnabled: false,
    treasuryCashLedgerEnabled: false,
  });
  const sectorOps: SectorTurnEnv["sectorOps"] = [];
  const env = {
    lookups,
    market,
    turn: 1000,
    currentTurn: 1000,
    now: new Date("2026-01-01T00:00:00Z"),
    techTreesEnabled: false,
    labour: { wagesEnabled: false },
    wageIndexByState: new Map(),
    automationIndexByState: new Map(),
    labourDemandByState: new Map(),
    pendingStrikeEvents: [],
    pendingCapacityBindingEvents: [],
    sectorOps,
  } as unknown as SectorTurnEnv;
  const prepared = prepareInternalSupplySectorResults(env);
  const seller =
    prepared?.get(mineId.toString()) ??
    processSector(
      env,
      corp,
      mine,
      lookups.sectorsByCorp.get(parentId.toString())!.length,
      resolveSectorHostCurrencyCode(mine, corp),
      fxRateForSectorHostFromMap(mine, corp, lookups.exchangeRatesByCurrency)
    );
  const buyer =
    prepared?.get(factoryId.toString()) ??
    processSector(
      env,
      overrides.group ? child : corp,
      factory,
      overrides.group ? 1 : 2,
      resolveSectorHostCurrencyCode(factory, overrides.group ? child : corp),
      fxRateForSectorHostFromMap(
        factory,
        overrides.group ? child : corp,
        lookups.exchangeRatesByCurrency
      )
    );
  const updates = sectorOps.map(
    (op) =>
      (op as { updateOne: { update: { $set: Partial<CorporateSector> } } }).updateOne.update.$set
  );
  return { seller, buyer, updates, market, lookups };
}
