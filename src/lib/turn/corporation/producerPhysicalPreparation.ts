/** Prepare work, recipes and plant constraints before any product money is moved. */
import type { Corporation, CorporateSector } from "@/lib/db/types";
import {
  COMMODITY_BASE_PRICES,
  COMMODITY_TYPES,
  eraScaledBasePrices,
  type CommodityType,
} from "@/lib/constants/commodities";
import {
  getEffectiveStrategyRatesForOperatingModel,
  getOperatingSectorType,
} from "@/lib/constants/sectorStrategies";
import { getSectorTechEffectsForYear, NEUTRAL_TECH_EFFECTS } from "@/lib/constants/techTree";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { activeCapacityConstraintFactor } from "@/lib/corporations/investment/rules";
import { standingProducerSiteBill } from "@/lib/corporations/plantCosts/rules";
import { retoolOperatingCapacityRatio } from "@/lib/corporations/retooling/rules";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import { commodityProductionCapacityScale } from "@/lib/banking/capacityAllocation";
import { nationalizationProductivityFactor } from "@/lib/nationalization/transitionShock";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { resolveSectorHostCurrencyCode } from "@/lib/currency/corporationCapital";
import {
  computeDisasterPenaltySplit,
  disasterProductionFactor,
} from "@/lib/crises/disasterMarginPenalty";
import {
  getInputMultiplier,
  getOutputMultiplier,
  trendProductionPolicy,
} from "@/lib/utils/productionPolicy";
import { energyProductivityMultiplier } from "@/lib/corporations/rules/energyProductivityRamp";
import { isStateScopedCommodity } from "@/lib/market/rules/commodityMarketScope";
import { producerRecipe } from "@/lib/market/producerMarket/recipeRules";
import { prepareProducerSector } from "./producerSectorPlan";
import { producerWalletId, type ProducerWalletScope } from "./producerMarketPhase";
import {
  resolveSectorHeadcount,
  resolveSectorLabourEconomics,
  resolveSectorLabourProductionEffects,
} from "./sectorLabour";
import type { SectorTurnEnv } from "./sectorTurnTypes";
import type { CorporationLookups } from "./types";

export type ProducerPhysicalEnv = Pick<
  SectorTurnEnv,
  | "currentTurn"
  | "currentYear"
  | "techTreesEnabled"
  | "labour"
  | "wageIndexByState"
  | "automationIndexByState"
  | "pendingStrikeEvents"
  | "labourDemandByState"
  | "labourDemandWageIndexByState"
  | "privateBankingEnabled"
> & {
  lookups: Pick<
    CorporationLookups,
    | "labourTightnessByState"
    | "labourDemandWageIndexByState"
    | "preset"
    | "hardwareInputReliefStartTurn"
    | "eraUnitScale"
    | "stateResourceCapacityByState"
    | "statePriceRatioByState"
    | "reachablePriceRatioByCountry"
    | "priceRatioByCommodity"
    | "activeDisasterEffectsByState"
    | "recessionCapacityFactorByCountry"
    | "rawWorkforceSkillByState"
    | "politicalBoardByState"
    | "stateMetricsByState"
    | "extractionCapacityUtilBySector"
    | "corporateEmbargoSuppression"
    | "embargoTradeExposureEnabled"
  >;
};

function scaledRates(
  rates: Partial<Record<CommodityType, number>>,
  factors: Record<string, number>,
  multiplier = 1
) {
  return Object.fromEntries(
    Object.entries(rates).map(([commodity, rate]) => [
      commodity,
      rate! * (factors[commodity] ?? 1) * multiplier,
    ])
  );
}

/**
 * Price choices and last turn's sell-through never determine physical capacity.
 * Demand and affordability constrain the prepared work inside funded settlement.
 */
export function prepareProducerPhysicalSector(input: {
  worldEpoch: string;
  env: ProducerPhysicalEnv;
  corporation: Corporation;
  sector: CorporateSector;
  /** One buyer policy, shared across sectors; supplied by the world host. */
  inputPriceHeadroom: number;
}) {
  const { env, corporation: corp, sector } = input;
  const { lookups, currentTurn, currentYear } = env;
  const countryId = sector.countryId ?? corp.countryId;
  const currency = resolveSectorHostCurrencyCode(sector, corp);
  if (!countryId || !currency) throw new Error("Producer location requires a reconciled currency");
  if (!Number.isFinite(input.inputPriceHeadroom) || input.inputPriceHeadroom <= 0)
    throw new Error("Invalid producer input price headroom");
  const scopes: ProducerWalletScope[] = [
    { kind: "households", countryId, stateId: sector.stateId, currency },
    { kind: "operatingPayee", countryId, stateId: sector.stateId, currency },
  ];
  const labour = resolveSectorLabourProductionEffects(
    env.labour,
    sector,
    lookups.labourTightnessByState.get(sector.stateId),
    lookups.labourDemandWageIndexByState?.get(sector.stateId),
    countryId
  );
  const tech =
    env.techTreesEnabled && currentYear != null
      ? getSectorTechEffectsForYear(
          corp,
          sector.sectorType,
          currentYear,
          sector.industryModel,
          sector.mediaDiscriminator
        )
      : NEUTRAL_TECH_EFFECTS;
  const recipe = getEffectiveStrategyRatesForOperatingModel(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    currentTurn,
    sector.industryModel,
    sector.mediaDiscriminator,
    lookups.preset,
    lookups.hardwareInputReliefStartTurn
  );
  const operatingType = getOperatingSectorType(
    sector.sectorType,
    sector.industryModel,
    sector.mediaDiscriminator
  );
  const outputRateValueBasis = Object.values(recipe.supply).reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0
  );
  const baseRecipe = producerRecipe({ ...recipe, eraUnitScale: lookups.eraUnitScale });
  if (sector.transitionFromStrategyId && sector.retoolRescaleApplied !== true)
    throw new Error("Retooling requires a reconciled owned-unit basis");
  if (operatingType === "extraction" && !lookups.stateResourceCapacityByState.has(sector.stateId))
    throw new Error("Extraction requires a reconciled resource opening");
  const resourceSupply = applyExtractionResourceCapacityToSupply(
    operatingType,
    recipe.supply,
    lookups.stateResourceCapacityByState.get(sector.stateId)
  );
  const supply = scaledRates(resourceSupply, tech.outputRateMult);
  const outputYield =
    (Object.entries(supply).reduce(
      (sum, [commodity, rate]) => sum + rate / COMMODITY_BASE_PRICES[commodity as CommodityType],
      0
    ) *
      lookups.eraUnitScale) /
    outputRateValueBasis;
  const policyLevel = trendProductionPolicy(
    sector.productionPolicyLevel ?? 0,
    sector.productionPolicy ?? 0
  );
  const policyOutput = getOutputMultiplier(policyLevel);
  const demand = scaledRates(
    recipe.demand,
    tech.inputRateMult,
    getInputMultiplier(policyLevel) / policyOutput
  );
  const prices = eraScaledBasePrices(lookups.eraUnitScale);
  const commodities = new Set(Object.keys({ ...recipe.supply, ...recipe.demand }));
  for (const stock of sector.producerInventory?.outputStock ?? []) {
    if (stock.units > 0) commodities.add(stock.commodity);
  }
  const markets = new Map(
    [...commodities].map((key) => {
      const commodity = COMMODITY_TYPES.find((item) => item === key);
      if (!commodity) throw new Error("Unrecognized producer commodity");
      const ratio = isStateScopedCommodity(commodity)
        ? lookups.statePriceRatioByState?.get(sector.stateId)?.get(commodity)
        : lookups.reachablePriceRatioByCountry?.get(countryId)?.get(commodity);
      const reference =
        prices[commodity] * (ratio ?? lookups.priceRatioByCommodity.get(commodity) ?? 1);
      return [
        commodity,
        {
          book: isStateScopedCommodity(commodity) ? `state:${sector.stateId}` : "world",
          referenceUnitPrice: reference,
          maximumInputUnitPrice: reference * input.inputPriceHeadroom,
        },
      ] as const;
    })
  );
  const disaster = computeDisasterPenaltySplit(
    lookups.activeDisasterEffectsByState.get(sector.stateId) ?? [],
    { sectorType: sector.sectorType, strategyId: sector.strategyId ?? null },
    currentTurn,
    true
  );
  const prepared = prepareProducerSector({
    worldEpoch: input.worldEpoch,
    turn: currentTurn,
    sector,
    // A site with no accessible resource still retains its recipe for selling
    // old goods. Its current physical output is zero, never a fallback yield.
    recipe: {
      supply: outputYield > 0 ? supply : recipe.supply,
      demand,
      eraUnitScale: lookups.eraUnitScale,
      outputRateValueBasis,
    },
    markets,
    outputMultiplier: 0,
    operatingRecipeRatio: retoolOperatingCapacityRatio({ ...sector, currentTurn }),
    recessionCapacityFactor: lookups.recessionCapacityFactorByCountry?.get(countryId) ?? 1,
    labourCost: 0,
    otherOperatingCost: 0,
    labourRecipientAccountId: producerWalletId(input.worldEpoch, scopes[0]),
    operatingRecipientAccountId: producerWalletId(input.worldEpoch, scopes[1]),
  });
  const { plan } = prepared;
  const suspended =
    lookups.corporateEmbargoSuppression?.has(`${countryId}|${corp.countryId}`) === true &&
    lookups.embargoTradeExposureEnabled !== true;
  if (suspended) plan.activeFraction = 0;
  const nominalDaily = plan.capacityUnits * TURNS_PER_DAY * baseRecipe.nominalAnchorPerCapacityUnit;
  const headcount = resolveSectorHeadcount({
    revenue: nominalDaily * plan.activeFraction,
    stateId: sector.stateId,
    rawWorkforceSkillByState: lookups.rawWorkforceSkillByState,
    politicalBoard: lookups.politicalBoardByState?.get(sector.stateId),
    staffingFactor: labour.staffingFactor,
    labourDemandByState: env.labourDemandByState,
    labourDemandWageIndexByState: env.labourDemandWageIndexByState,
    wageLevel: sector.wageLevel,
  });
  const metrics = lookups.stateMetricsByState?.get(sector.stateId);
  const staffedShare =
    headcount.desiredWorkers > 0 ? headcount.workers / headcount.desiredWorkers : 0;
  const payroll = resolveSectorLabourEconomics({
    labour: { ...env.labour, wagesEnabled: true },
    sector,
    sectorCountryId: countryId,
    currentTurn,
    currentYear,
    explicitPlantCostsEnabled: true,
    hourlyRevenue: (nominalDaily * plan.activeFraction * staffedShare) / TURNS_PER_DAY,
    grossMaintenance: (nominalDaily * plan.activeFraction * staffedShare) / TURNS_PER_DAY,
    computedWorkers: headcount.workers,
    techLaborCostMultiplier: tech.laborCostMultiplier,
    costOfLivingIndex: metrics?.economic?.costOfLiving?.value,
    unemploymentRate: metrics?.economic?.unemploymentRate?.value,
    wageIndexByState: env.wageIndexByState,
    automationIndexByState: env.automationIndexByState,
    pendingStrikeEvents: env.pendingStrikeEvents,
  });
  const extraction =
    operatingType === "extraction"
      ? activeCapacityConstraintFactor(
          lookups.extractionCapacityUtilBySector.get(sector._id.toHexString())?.utilization ?? 0,
          plan.activeFraction
        )
      : 1;
  plan.outputMultiplier =
    labour.outputFactor *
    disasterProductionFactor(disaster.productionPenalty) *
    policyOutput *
    (outputYield / baseRecipe.unitsPerNominalAnchor) *
    extraction *
    energyProductivityMultiplier(sector.sectorType, currentTurn, lookups.preset) *
    (sector.sectorType === "financial"
      ? commodityProductionCapacityScale(corp.bankCharter, env.privateBankingEnabled === true)
      : 1) *
    (isStateOwned(corp)
      ? nationalizationProductivityFactor(
          sector.nationalizedAtTurn,
          currentTurn,
          sector.nationalizationTransitionMultiplier ?? 1
        )
      : 1);
  plan.labourCost = payroll.sectorLaborCost;
  plan.otherOperatingCost = standingProducerSiteBill({
    nominalHourlyCapacityValue: nominalDaily / TURNS_PER_DAY,
    activeFraction: plan.activeFraction,
    financialPenaltyPercent: Math.max(0, -disaster.marginPenalty),
  });
  return {
    prepared,
    walletScopes: scopes,
    headcount,
    payroll,
    policyLevel,
    staffingFactor: labour.staffingFactor,
    suspended,
  };
}
