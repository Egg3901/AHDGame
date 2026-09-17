import type { Db } from "mongodb";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { TurnReferenceData } from "@/lib/corporations/turnReferenceData";
import type { FtaCoverage } from "@/lib/tariffs/ftaOverrides";
import type { StateViewContext } from "./stateViewContext";
import type { MarketViewContext } from "./marketViewContext";
import type { SectorCurrencyRestatement } from "./currencyRestatement";
import {
  CORPORATION_TYPE_LABELS,
  TURNS_PER_DAY,
  TYPE_SWITCH_PENALTY_TURNS,
  computeAllMarginModifiers,
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  calculateWorkers,
  getDominanceRegulatoryBurden,
  getExpropriationRiskMarginModifier,
  softCapEffectiveMargin,
} from "@/lib/constants/corporations";
import type { CorporationType, StateMetricValues } from "@/lib/constants/corporations";
import {
  getSectorTechEffectsForYear,
  getSectorTechEffects,
} from "@/lib/constants/techTree/selectors";
import { computeBlendedMarginModifiers } from "@/lib/constants/commodities";
import type { CommodityType } from "@/lib/constants/commodities";
import { computeSoeEfficiencyPenalty } from "@/lib/nationalization/soeEfficiency";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { sociMultiplier } from "@/lib/nationalization/concentration";
import { resolveSectorMandate } from "@/lib/nationalization/soeMandates";
import { getRevenueMultiplier, getInputMultiplier } from "@/lib/utils/productionPolicy";
import { priceRealizationFactor } from "@/lib/market/priceRealization";
import { isLabourWagesEnabled } from "@/lib/labour/featureFlag";
import { getMarketSystemModeForDb, marketAtLeast } from "@/lib/market/featureFlag";
import {
  CORP_GROWTH_TARGET_SPAN_TURNS,
  computeCorpRealizedGrowthRate,
} from "@/lib/corporations/realizedGrowth";
import { computeFillRate, fillRateBand } from "@/lib/corporations/financialFogOfWar";
import { summarizeBuildQueue } from "@/lib/corporations/sectorBuildQueue";
import { readPlantsPnl } from "@/lib/corporations/plantsPnlBasis";
import { seedPlantLedger } from "@/lib/corporations/plantLedger";
import {
  getForeignTariffMarginModifier,
  getDomesticTariffMalus,
  getTariffBlendWeights,
} from "@/lib/tariffs/tariffEffects";
import { getSubsidyMarginModifier } from "@/lib/subsidies/subsidyEffects";
import {
  marginEffectForModifier,
  computeRegionalConditionMargin,
} from "@/lib/states/conditions/marginEffects";
import { computeStateMetricMarginModifier } from "@/lib/corporations/sectorMetricMarginProfiles";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { resolveGameYear } from "@/lib/era/era";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import {
  getEffectiveStrategyRates,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
  STRATEGY_TRANSITION_TURNS,
} from "@/lib/constants/sectorStrategies";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";

export function getEmptyStateMetricValues(): StateMetricValues {
  return {
    fullMetrics: null,
    unemploymentRate: null,
    gridReliability: null,
    corruptionIndex: null,
    workforceSkill: null,
    crimeRate: null,
    broadbandAccess: null,
    roadCondition: null,
    carbonEmissions: null,
    costOfLiving: null,
  };
}

export interface SectorModeFlags {
  labourWagesEnabled: boolean;
  plantsMode: boolean;
  realizedGrowthRate: number | null;
}

/**
 * Labour/plants mode flags plus the trailing-window realized growth rate (#587).
 *
 * Plants tier: sectors are PLANTS, so the row's headline numbers become
 * physical (capacity, output, sales) rather than a growth rate. Below plants
 * every physical field is null and the legacy sector-average growth applies.
 */
export async function loadSectorModeFlags(
  db: Db,
  corporation: Corporation
): Promise<SectorModeFlags> {
  // Labour system (wages on): the persisted per-sector labour cost is carved
  // OUT of the gross maintenance recomputed below (profit-invariant).
  const labourWagesEnabled = await isLabourWagesEnabled();

  // Plants tier: sectors are PLANTS, so the row's headline numbers become
  // physical (capacity, output, sales) rather than a growth rate. Resolved
  // once here and published on the returned corporation so every client
  // surface reads one flag instead of each guessing from the presence of a
  // field. Below plants this is false and every field added below is null, so
  // a capital-tier world's payload is unchanged apart from the null keys.
  const plantsMode = marketAtLeast(await getMarketSystemModeForDb(db), "plants");

  // #922 — "Growth Rate always 0". Under plants, a sector's `currentGrowthRate`
  // no longer drives revenue (revenue comes from produced units against plant
  // capacity), so the field is vestigial and sits at 0 for most corporations.
  // Averaging it and printing it as the corp's growth rate reported 0.00% for
  // everyone. Measure the revenue the corp actually booked instead, over a
  // trailing window wide enough that annualizing does not amplify churn.
  const realizedGrowthRate = plantsMode
    ? computeCorpRealizedGrowthRate(
        (
          await db
            .collection<{ turn?: number; revenue?: number }>("corporationHistory")
            .find(
              { corporationId: corporation._id },
              {
                sort: { turn: -1 },
                limit: CORP_GROWTH_TARGET_SPAN_TURNS + 1,
                projection: { turn: 1, revenue: 1 },
              }
            )
            .toArray()
        ).flatMap((row) =>
          typeof row.turn === "number" && typeof row.revenue === "number"
            ? [{ turn: row.turn, revenue: row.revenue }]
            : []
        )
      )
    : null;

  return { labourWagesEnabled, plantsMode, realizedGrowthRate };
}

export interface SectorRowContext {
  corporation: Corporation;
  sectors: CorporateSector[];
  currentTurn: number;
  plantsMode: boolean;
  labourWagesEnabled: boolean;
  revenueRealizationRatio: number;
  restatement: SectorCurrencyRestatement;
  tariffs: Pick<TurnReferenceData, "allTariffs" | "activeFtaPairs" | "activeSubsidies">;
  tariffLookups: { blendPresenceKeys: Set<string>; ftaCoverage: FtaCoverage };
  stateCtx: StateViewContext;
  marketCtx: MarketViewContext;
}

export interface SectorFinancialTotals {
  totalRevenue: number;
  totalMaintenanceCosts: number;
  totalGrowthCosts: number;
  totalSubsidyBenefit: number;
  totalRegulatoryBurden: number;
  totalLaborCosts: number;
}

export interface PhysicalRollups {
  totalCapacityUnits: number;
  totalProducedUnits: number;
  totalSoldUnits: number;
  totalConstructionInProgressAnchor: number;
  mothballedSectorCount: number;
  buildingSectorCount: number;
  totalUnitsOnOrder: number;
}

export interface SectorDetailsResult {
  sectorDetails: SectorDetailRow[];
  totals: SectorFinancialTotals;
  wageBillAnchorPerTurnBySectorId: Map<string, number>;
  physicalRollups: PhysicalRollups;
}

/**
 * Per-sector detail rows plus corp-level financial totals (#587).
 *
 * The row's headline numbers are single-currency: every stored host-currency
 * sector field is restated into the corp's home currency before any math.
 * Totals and the wage-bill/pension map accumulate as a side effect of the
 * row build, exactly as the inline loop always did.
 */
export function buildSectorDetails(ctx: SectorRowContext): SectorDetailsResult {
  const {
    corporation,
    sectors,
    currentTurn,
    plantsMode,
    labourWagesEnabled,
    revenueRealizationRatio,
    restatement,
    tariffs,
    tariffLookups,
    stateCtx,
    marketCtx,
  } = ctx;
  const { allTariffs, activeFtaPairs, activeSubsidies } = tariffs;
  const { blendPresenceKeys, ftaCoverage } = tariffLookups;
  const {
    states,
    stateMetricsMap,
    stateCountryMap,
    stateNameMap,
    stateResourceCapacityByState,
    politicalBaseModifiersByState,
    macroByCountry,
    sociByCountry,
    investorConfidenceByCountry,
    gameState,
  } = stateCtx;
  const {
    marketShareBySectorId,
    globalBalances,
    nationalBalancesByCountry,
    rawStateBalances,
    globalPriceRatioByCommodity,
  } = marketCtx;
  const sectorFieldToCorpCcy = restatement.toCorpCurrency;
  const sectorFieldToAnchor = restatement.toAnchor;

  const techCorpView = {
    type: corporation.type,
    unlockedTechNodeIds: corporation.unlockedTechNodeIds,
    techDecadeLane: corporation.techDecadeLane,
  };
  const currentYear = gameState?.currentYear;

  let totalRevenue = 0;
  let totalMaintenanceCosts = 0;
  let totalGrowthCosts = 0;
  let totalSubsidyBenefit = 0;
  let totalRegulatoryBurden = 0;
  let totalLaborCosts = 0;
  const wageBillAnchorPerTurnBySectorId = new Map<string, number>();

  // Corp-level physical rollups (plants only). These are the physical P&L's
  // top line: what the corporation can make, what it did make, what it sold,
  // and what it has paid for but cannot use yet.
  let totalCapacityUnits = 0;
  let totalProducedUnits = 0;
  let totalSoldUnits = 0;
  let totalConstructionInProgressAnchor = 0;
  let mothballedSectorCount = 0;
  let buildingSectorCount = 0;
  let totalUnitsOnOrder = 0;

  const sectorDetails = sectors.map((sector) => {
    const st = sector.sectorType as CorporationType;
    const metrics = stateMetricsMap.get(sector.stateId) ?? getEmptyStateMetricValues();

    const stateBalances = rawStateBalances.get(sector.stateId) ?? new Map();
    const sectorCountryId =
      sector.countryId ?? stateCountryMap.get(sector.stateId) ?? corporation.countryId;
    const nationalBalances = nationalBalancesByCountry.get(sectorCountryId) ?? new Map();
    const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
      allTariffs,
      sectorCountryId,
      st,
      blendPresenceKeys,
      ftaCoverage
    );
    const commoditySupplyDemandBlendPct = {
      global: Math.round(globalWeight * 10000) / 100,
      national: Math.round(nationalWeight * 10000) / 100,
      local: Math.round(localWeight * 10000) / 100,
    };
    const sectorEffectiveRates = getEffectiveStrategyRates(
      st,
      sector.strategyId ?? "standard",
      sector.transitionFromStrategyId,
      sector.transitionStartTurn,
      currentTurn
    );
    const effectiveSupply = applyExtractionResourceCapacityToSupply(
      st,
      sectorEffectiveRates.supply,
      stateResourceCapacityByState.get(sector.stateId)
    );
    const { inputMod, surplusMod } = computeBlendedMarginModifiers(
      st,
      globalBalances,
      nationalBalances,
      stateBalances,
      globalWeight,
      nationalWeight,
      localWeight,
      effectiveSupply,
      sectorEffectiveRates.demand
    );
    const commodityMod = inputMod + surplusMod;

    const corpCountryId = corporation.countryId;
    const homeLocationBonus = getHomeLocationMarginBonus(
      sector.stateId,
      corporation.headquartersState,
      sectorCountryId,
      corpCountryId
    );
    const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
      states.find((s) => s._id === sector.stateId)?.sectorSpecializations,
      st
    );
    const macroEcon = macroByCountry.get(sectorCountryId);
    const typeSwitchPenaltyActive =
      corporation.typeSwitchTurn != null &&
      currentTurn - corporation.typeSwitchTurn < TYPE_SWITCH_PENALTY_TURNS;
    const foreignTariffMod = getForeignTariffMarginModifier(
      allTariffs,
      sectorCountryId,
      st,
      corpCountryId,
      corporation._id,
      activeFtaPairs
    );
    const domesticTariffMod = getDomesticTariffMalus(
      allTariffs,
      sectorCountryId,
      st,
      corpCountryId,
      ftaCoverage
    );
    const subsidyMod = getSubsidyMarginModifier(
      activeSubsidies,
      corporation.headquartersState,
      st,
      sector.stateId,
      sector.strategyId,
      sectorCountryId,
      corpCountryId
    );
    const transitionProgress =
      sectorEffectiveRates.isTransitioning && sector.transitionStartTurn != null
        ? Math.min(
            1,
            Math.max(0, (currentTurn - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
          )
        : 0;
    const strategyTransitionMod = sectorEffectiveRates.isTransitioning
      ? sector.transitionStartTurn != null
        ? transitionProgress * STRATEGY_TRANSITION_MARGIN_PENALTY
        : STRATEGY_TRANSITION_MARGIN_PENALTY
      : 0;
    const sectorMarketSharePct = marketShareBySectorId.get(sector._id.toString()) ?? 0;
    const stateMetricMargin = computeStateMetricMarginModifier({
      sectorType: st,
      strategyId: sector.strategyId ?? "standard",
      transitionFromStrategyId: sector.transitionFromStrategyId,
      transitionProgress,
      stateMetrics: metrics.fullMetrics ?? null,
      // SP4 §4a: political margin overlay for playable regions.
      politicalBaseModifiers: politicalBaseModifiersByState.get(sector.stateId) ?? null,
      countryId: sectorCountryId,
      // Live year for the era existence gate; null while the flag is off.
      year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
    });
    const regionalConditionsModifiers = metrics.fullMetrics
      ? evaluateModifiers(buildFlatMetrics(metrics.fullMetrics), {
          preset: gameState?.preset,
          countryId: metrics.fullMetrics?.countryId ?? sectorCountryId,
          // Live year for era-aware margins; null while the flag is off.
          year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
        }).map((m) => ({
          id: m.id,
          label: m.label,
          effect: m.effect,
          marginEffect:
            m.marginEffect ??
            (m.source === "address" ? 0 : marginEffectForModifier(m.effect, m.id)),
          source: m.source,
        }))
      : [];
    const regionalConditionsModifier = computeRegionalConditionMargin(regionalConditionsModifiers);
    const mods = computeAllMarginModifiers(
      st,
      sector.profitMargin,
      metrics,
      commodityMod,
      homeLocationBonus,
      corporation.type,
      sectors.length,
      macroEcon,
      corporation.logisticsStrength ?? 0,
      corporation.secondaryType,
      typeSwitchPenaltyActive,
      foreignTariffMod,
      domesticTariffMod,
      subsidyMod,
      strategyTransitionMod,
      stateSectorSpecializationMod,
      sectorMarketSharePct,
      sector.negativeProductionSustainedTurns ?? 0,
      sector.productionPolicyLevel ?? 0,
      {
        total: stateMetricMargin.cappedTotal,
        legacyTotal: stateMetricMargin.legacyTotal,
        contributions: stateMetricMargin.contributions,
        headlineModifiers: stateMetricMargin.headlineModifiers,
      },
      isStateOwned(corporation),
      regionalConditionsModifier,
      regionalConditionsModifiers.map((m) => ({
        label: m.label,
        marginEffect: m.marginEffect ?? 0,
      }))
    );

    const revenueMultiplier = getRevenueMultiplier(sector.productionPolicyLevel ?? 0);
    // Realized revenue for this sector (#3001/#3002). Prefer the exact,
    // per-sector `realizedRevenue` the turn processor now persists (nameplate ×
    // every realization leg, same daily basis + currency as `revenue`). This
    // replaces the legacy uniform per-corp `revenueRealizationRatio` (#2958),
    // which smeared one corp-wide ratio across sectors with heterogeneous
    // haircuts and lagged a turn behind CorporationHistory. The blended ratio
    // survives only as a fallback for sectors not yet reprocessed since the
    // field shipped — a single turn of processing backfills every active sector.
    // Restate this sector's stored (host-currency) fields into the corp's
    // currency so all the per-sector math below is single-currency.
    const sectorRevenueLocal = sectorFieldToCorpCcy(sector.revenue, sector);
    const sectorGrowthCostLocal = sectorFieldToCorpCcy(sector.currentGrowthCost, sector);
    const sectorRealizedRevenueLocal =
      typeof sector.realizedRevenue === "number"
        ? sectorFieldToCorpCcy(sector.realizedRevenue, sector)
        : null;
    const sectorLaborCostLocal =
      typeof sector.laborCost === "number" ? sectorFieldToCorpCcy(sector.laborCost, sector) : null;
    const financialRevenue =
      sectorRealizedRevenueLocal ??
      sectorRevenueLocal * revenueMultiplier * revenueRealizationRatio;
    // Dynamic SOE efficiency (spec §11.3) — same shared function as the turn math
    // and the budget estimate, so display stays aligned. Private corps get 0.
    const soeMandate = resolveSectorMandate(corporation, sector);
    const soeEfficiency = isStateOwned(corporation)
      ? computeSoeEfficiencyPenalty({
          corruptionIndex: metrics.fullMetrics?.governance?.corruptionIndex?.value ?? null,
          governmentTransparency:
            metrics.fullMetrics?.governance?.governmentTransparency?.value ?? null,
          priceControlled: soeMandate.priceControlled === true,
          employmentGuaranteed: soeMandate.employmentGuaranteed === true,
          concentrationMultiplier: sociMultiplier(
            sociByCountry.get(corporation.countryOwnerId ?? "") ?? 0
          ),
        })
      : 0;
    // Expropriation-risk drag (spec §12.4 feed 1) — private corps only, same fn
    // and per-country confidence the turn uses.
    const expropriationRisk = isStateOwned(corporation)
      ? 0
      : getExpropriationRiskMarginModifier(
          investorConfidenceByCountry.get(sectorCountryId) ?? null
        );
    const techEffects =
      currentYear != null
        ? getSectorTechEffectsForYear(techCorpView, st, currentYear)
        : getSectorTechEffects(techCorpView, st);
    const techMarginBonus = techEffects.marginBonusPp;
    const stackMargin = softCapEffectiveMargin(
      mods.effective + soeEfficiency + expropriationRisk + techMarginBonus
    );
    // The margin the engine ACTUALLY applied last turn. Under plants the stored
    // field is an OUTPUT of the physical P&L (sectorTurn.ts P3.5:
    // derivedMarginPct = 100 × (1 − operatingCost/revenue), with labor, upkeep
    // and inputs all inside operatingCost), and this query is its documented
    // reader. The stack recomputed above knows nothing about physical costs —
    // on prod it overstated every corp-484 sector by 20-55pts, inflating the
    // projected income ~2.6x over realized and the balance-sheet sector NPV
    // 2.2x over the capital book the share price uses (ops-knowledge:
    // ahd-corp-sector-npv-divergence). Money uses the engine figure; the stack
    // survives only as the advisory modifier breakdown and as the fallback for
    // legacy sectors that predate the stored field. Below plants the stored
    // value IS last turn's stack, so this is a no-op there.
    const engineMargin =
      typeof sector.effectiveProfitMargin === "number" ? sector.effectiveProfitMargin : null;
    const effectiveProfitMargin = engineMargin ?? stackMargin;
    // Ticket 1122: the turn's own lines when the sector has them, restated into
    // the corp's currency. Inverting `effectiveProfitMargin` cannot be right:
    // it is this P&L's capped OUTPUT, so at the cap it recovers a zero
    // operating cost from a negative one (profit == revenue), and in every case
    // it drops upkeep and compliance, which the margin's scope excludes and the
    // profit includes. The inversion stays as the fallback for rows that
    // predate the field. See `plantsPnlBasis.ts`.
    const enginePnl = readPlantsPnl(sector);
    const maintenance = enginePnl
      ? sectorFieldToCorpCcy(enginePnl.operatingCost, sector)
      : financialRevenue * (1 - effectiveProfitMargin / 100);
    const profit = enginePnl
      ? sectorFieldToCorpCcy(enginePnl.profit, sector)
      : financialRevenue - maintenance - sectorGrowthCostLocal;
    // Physical cost decomposition for the margin drilldown (ticket 1072: the
    // additive modifier list could not explain a physically-derived margin —
    // base + modifiers summed 40pts above the engine figure with no line
    // saying why). Percentage points of REALIZED revenue, mirroring the
    // engine's own cost legs:
    //  - inputs: recipe rates x realized unit prices (priceRealizationFactor,
    //    the same damped/clamped function computeInputsCost bills through),
    //    on the nameplate basis the recipe is expressed against.
    //  - wages: the persisted labor bill.
    //  - other: everything else the engine charged (upkeep, other opex,
    //    financial legs, calibration residual) = the exact remainder, so the
    //    three lines always reconcile to the engine margin.
    // null below plants or when the engine margin / realized revenue are
    // absent — the drilldown falls back to the additive view there.
    const physicalCosts = (() => {
      if (!plantsMode || engineMargin == null) return null;
      const realized = sectorRealizedRevenueLocal;
      if (realized == null || !(realized > 0)) return null;
      // Exact when the turn's lines are on the row: no re-derivation of the
      // input bill, and the policy stack gets its own line instead of hiding
      // inside "other". This is the same decomposition the sector page's money
      // chain now shows, so the two surfaces agree line for line (ticket 1122).
      if (enginePnl && enginePnl.revenue > 0) {
        const pp = (v: number) => Math.round((v / enginePnl.revenue) * 1000) / 10;
        return {
          inputsPp: pp(enginePnl.inputs),
          laborPp: enginePnl.labour > 0 ? pp(enginePnl.labour) : null,
          // Everything else the margin's scope charges, policy credit excluded
          // so it can be named. Upkeep and compliance are deliberately absent:
          // they are outside the margin, and folding them in here would make
          // the lines stop summing to it.
          otherPp: pp(enginePnl.otherOpex + enginePnl.financialLegs),
          // Signed, positive = credit.
          policyPp: pp(enginePnl.policyCredit),
        };
      }
      const measuredCapacity = sector.operatingCapacityUnits ?? sector.capitalStock;
      const util =
        Number.isFinite(measuredCapacity) &&
        (measuredCapacity as number) > 0 &&
        Number.isFinite(sector.producedUnits)
          ? Math.max(
              0,
              Math.min(1, (sector.producedUnits as number) / (measuredCapacity as number))
            )
          : 1;
      const inputMult = getInputMultiplier(sector.productionPolicyLevel ?? 0);
      let inputsBill = 0;
      for (const [commodity, rate] of Object.entries(sectorEffectiveRates.demand) as [
        CommodityType,
        number,
      ][]) {
        if (!(rate > 0)) continue;
        inputsBill +=
          sectorRevenueLocal *
          rate *
          priceRealizationFactor(globalPriceRatioByCommodity.get(commodity)) *
          util *
          inputMult;
      }
      const inputsPp = Math.round((inputsBill / realized) * 1000) / 10;
      const laborPp =
        sectorLaborCostLocal != null && sectorLaborCostLocal > 0
          ? Math.round((sectorLaborCostLocal / realized) * 1000) / 10
          : null;
      const otherPp =
        Math.round((100 - effectiveProfitMargin - inputsPp - (laborPp ?? 0)) * 10) / 10;
      return { inputsPp, laborPp, otherPp, policyPp: 0 };
    })();
    // Local-cell share only: this query scopes to the corp's own buckets, so a
    // correct NATIONAL share (which the turn charges the burden on — see
    // buildNationalDominanceShareBySectorId) isn't available here without a
    // country-wide query. Displayed burden is a lower bound for a spread champion.
    const regulatoryBurdenRate = getDominanceRegulatoryBurden(sectorMarketSharePct);
    const sectorRegulatoryBurden = financialRevenue * regulatoryBurdenRate;
    totalRevenue += financialRevenue;
    totalMaintenanceCosts += maintenance;
    if (labourWagesEnabled && sectorLaborCostLocal != null && sectorLaborCostLocal > 0) {
      totalLaborCosts += sectorLaborCostLocal;
      // Same wage bill in ₳ on the per-turn clock the pension pass charges on,
      // keyed by sector so a collective agreement can pick out just the sectors
      // it covers.
      wageBillAnchorPerTurnBySectorId.set(
        sector._id.toString(),
        sectorFieldToAnchor(sector.laborCost as number, sector) / TURNS_PER_DAY
      );
    }
    totalGrowthCosts += sectorGrowthCostLocal;
    totalRegulatoryBurden += sectorRegulatoryBurden;
    totalSubsidyBenefit += financialRevenue * (subsidyMod / 100);

    // ── Plants-tier physicals ────────────────────────────────────────────
    // `capitalStock`, `producedUnits` and `soldUnits` share one basis: output
    // units on the same DAILY clock as `revenue` (under plants the stored
    // nameplate revenue IS `capitalStock × mixPrice`). So no rescaling here —
    // rescaling is exactly how the two clocks got mixed up before.
    const capacityUnits =
      plantsMode && Number.isFinite(sector.operatingCapacityUnits ?? sector.capitalStock)
        ? (sector.operatingCapacityUnits ?? sector.capitalStock ?? null)
        : null;
    const plantCount =
      plantsMode && Number.isInteger(sector.plantCount) && (sector.plantCount ?? 0) >= 0
        ? (sector.plantCount as number)
        : plantsMode
          ? seedPlantLedger(sector.sectorType, sector.capitalStock).plantCount
          : null;
    const producedUnits =
      plantsMode && Number.isFinite(sector.producedUnits) ? (sector.producedUnits as number) : null;
    const soldUnits =
      plantsMode && Number.isFinite(sector.soldUnits) ? (sector.soldUnits as number) : null;
    const constructionInProgressAnchor =
      plantsMode && Number.isFinite(sector.constructionInProgressAnchor)
        ? (sector.constructionInProgressAnchor as number)
        : null;
    const buildQueueSummary = plantsMode
      ? summarizeBuildQueue(sector.buildQueue, currentTurn)
      : null;
    const sectorFillRate = computeFillRate(producedUnits, soldUnits);
    // Share of the fill shortfall that is a DELIVERY failure, not a demand
    // failure. The row shows one fill number and a player reads every point of
    // missing fill as "nobody wanted it", which is the opposite instruction
    // from what a freight-limited sector needs. Null outside plants and when
    // the freight pass has written nothing.
    const deliveryLimitedFraction =
      plantsMode && Number.isFinite(sector.deliveryLimitedFraction)
        ? Math.max(0, Math.min(1, sector.deliveryLimitedFraction as number))
        : null;
    const deliveryLimitedFreightClass =
      plantsMode &&
      (sector.deliveryLimitedFreightClass === "bulk" ||
        sector.deliveryLimitedFreightClass === "special" ||
        sector.deliveryLimitedFreightClass === "grid")
        ? sector.deliveryLimitedFreightClass
        : null;
    const mothballed = plantsMode ? sector.mothballed === true : false;
    // Fill-adjusted margin (ticket #1027 family): realized profit over the full
    // cost bill, not over sold revenue. `effectiveProfitMargin` divides by the
    // revenue the SOLD units earned, so a plants sector selling 15% of its
    // output displays a fat positive margin while it loses money. Profit here
    // already nets the whole bill, so profit / cost is the honest ratio and it
    // reconciles with the profit figure shown on the same row. Plants only:
    // below plants there is no produced-vs-sold split for the margin to lie
    // about. Presentation only, never read back into the economy.
    const sectorTotalCost = maintenance + sectorGrowthCostLocal;
    const fillAdjustedMarginPct =
      plantsMode && sectorTotalCost > 0 ? Math.round((profit / sectorTotalCost) * 1000) / 10 : null;

    if (plantsMode) {
      totalCapacityUnits += capacityUnits ?? 0;
      totalProducedUnits += producedUnits ?? 0;
      totalSoldUnits += soldUnits ?? 0;
      totalConstructionInProgressAnchor += constructionInProgressAnchor ?? 0;
      if (mothballed) mothballedSectorCount += 1;
      if (buildQueueSummary) {
        buildingSectorCount += 1;
        totalUnitsOnOrder += buildQueueSummary.unitsOrdered;
      }
    }

    return {
      _id: sector._id,
      stateId: sector.stateId,
      countryId: sector.countryId,
      stateName: stateNameMap.get(sector.stateId) ?? sector.stateId,
      sectorType: sector.sectorType,
      sectorLabel: CORPORATION_TYPE_LABELS[sector.sectorType as CorporationType],
      displayName: sector.displayName ?? null,
      targetGrowthRate:
        sector.targetGrowthRate ?? sector.currentGrowthRate ?? sector.growthRate ?? 0,
      currentGrowthRate: sector.currentGrowthRate ?? sector.growthRate ?? 0,
      currentGrowthCost: Math.round(sectorGrowthCostLocal),
      revenue: Math.round(sectorRevenueLocal),
      // Suspended by a total embargo the operating country has against this
      // corp's nation — surfaced so the $0 reads as a suspension, not a bug.
      embargoSuspended: sector.embargoSuspended ?? false,
      financialRevenue: Math.round(financialRevenue),
      // Exact realized revenue when persisted (null on not-yet-reprocessed
      // sectors, where financialRevenue used the blended-ratio fallback).
      realizedRevenue:
        sectorRealizedRevenueLocal != null ? Math.round(sectorRealizedRevenueLocal) : null,
      profitMargin: sector.profitMargin,
      effectiveProfitMargin,
      // "physical": effectiveProfitMargin is the engine's derived margin and
      // `physicalCosts` explains it; "additive": legacy stack recompute.
      marginBasis: physicalCosts != null ? ("physical" as const) : ("additive" as const),
      physicalCosts,
      fillAdjustedMarginPct,
      techMarginBonus: techMarginBonus !== 0 ? techMarginBonus : null,
      marketSharePercent: sectorMarketSharePct,
      ...mods,
      commoditySupplyDemandBlendPct,
      profit: Math.round(profit),
      workers:
        sector.workers ??
        calculateWorkers(sectorFieldToAnchor(sector.revenue, sector), metrics.workforceSkill),
      workersDesired:
        sector.workersDesired ??
        calculateWorkers(sectorFieldToAnchor(sector.revenue, sector), metrics.workforceSkill),
      labourStaffingFactor: sector.labourStaffingFactor ?? 1,
      strategyId: sector.strategyId ?? "standard",
      stateResources: stateResourceCapacityByState.has(sector.stateId)
        ? (stateResourceCapacityByState.get(sector.stateId) ?? null)
        : undefined,
      transitionFromStrategyId: sector.transitionFromStrategyId ?? null,
      transitionStartTurn: sector.transitionStartTurn ?? null,
      transitionCooldownUntilTurn: sector.transitionCooldownUntilTurn ?? null,
      isReversing: sector.isReversing ?? false,
      productionPolicy: sector.productionPolicy ?? 0,
      productionPolicyLevel: sector.productionPolicyLevel ?? 0,
      forSale: sector.forSale
        ? {
            listedAt: sector.forSale.listedAt,
            priceAnchor: sector.forSale.priceAnchor,
            npvAnchor: sector.forSale.npvAnchor,
          }
        : null,
      // Plants-tier physicals. Null outside plants — never removed, so a
      // capital-tier client keeps reading exactly the fields it always did.
      capacityUnits,
      plantCount,
      producedUnits,
      soldUnits,
      // Exact ratio. The API layer replaces this with null (and keeps only the
      // band) for a viewer without insider access — see financialFogOfWar.
      fillRate: sectorFillRate,
      fillRateBand: fillRateBand(sectorFillRate),
      deliveryLimitedFraction,
      deliveryLimitedFreightClass,
      mothballed,
      buildQueueSummary,
      constructionInProgressAnchor,
    };
  });

  return {
    sectorDetails,
    totals: {
      totalRevenue,
      totalMaintenanceCosts,
      totalGrowthCosts,
      totalSubsidyBenefit,
      totalRegulatoryBurden,
      totalLaborCosts,
    },
    wageBillAnchorPerTurnBySectorId,
    physicalRollups: {
      totalCapacityUnits,
      totalProducedUnits,
      totalSoldUnits,
      totalConstructionInProgressAnchor,
      mothballedSectorCount,
      buildingSectorCount,
      totalUnitsOnOrder,
    },
  };
}

export type SectorDetailRow = SectorDetailsResult["sectorDetails"][number];
