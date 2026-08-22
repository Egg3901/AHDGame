/**
 * Payload-section builders for the sector detail query: apportioned taxes,
 * active-crisis margin penalty, attack/split info, for-sale info, tech
 * growth-cost reduction, and the strategy panel. Extracted verbatim from
 * sectorDetail.ts (pure code motion; no behavior change).
 */
import type { Db } from "mongodb";
import type {
  CommodityPrice,
  CorporateSector,
  Corporation,
  FederalBudget,
  GameState,
  State,
  StateBudget,
  StateMetrics,
  Subsidy,
  Tariff,
  UnownedSector,
} from "@/lib/db/types";
import type { Crisis } from "@/lib/db/types/crisis";
import {
  buildDisasterEffectsByState,
  computeDisasterMarginPenalty,
} from "@/lib/crises/disasterMarginPenalty";
import {
  getEffectiveTariffRate,
  getSplitCaptureMultiplier,
  getForeignTariffMarginModifier,
  getDomesticTariffMalus,
} from "@/lib/tariffs/tariffEffects";
import type { FtaCoverage } from "@/lib/tariffs/ftaOverrides";
import { sectorEconomicRevenue } from "@/lib/corporations/sectorRevenueBasis";
import { deliveredFraction } from "@/lib/corporations/buildDelivery";
import { readPlantsPnl, type PolicyStackRow } from "@/lib/corporations/plantsPnlBasis";
import {
  SPLIT_BASE_CAPTURE_FRACTION,
  UNOWNED_CAPTURE_BONUS_MULTIPLIER,
  MS_CAPTURE_DIVISOR,
  DOMINANCE_MARKET_SHARE_THRESHOLD,
  computeAllMarginModifiers,
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  softCapEffectiveMargin,
  TYPE_SWITCH_PENALTY_TURNS,
  TURNS_PER_DAY,
} from "@/lib/constants/corporations";
import type {
  CorporationType,
  StateMetricValues,
  MacroEconomicValues,
} from "@/lib/constants/corporations";
import type { CountryId } from "@/lib/constants/countries";
import { getSubsidyMarginModifier } from "@/lib/subsidies/subsidyEffects";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { computeStateMetricMarginModifier } from "@/lib/corporations/sectorMetricMarginProfiles";
import { computeRegionalConditionMargin } from "@/lib/states/conditions/marginEffects";
import { buildFlatMetrics } from "@/lib/utils/governmentApproval";
import { evaluateModifiers } from "@/lib/utils/approvalModifiers";
import { resolveGameYear } from "@/lib/era/era";
import { roundMarketingStrength } from "@/lib/utils/formatters";
import {
  calculateAttackCostFromLocalRevenue,
  calculateSplitCostAnchor,
  calculateSplitMsCostForStrength,
  SPLIT_STRENGTH_MULTIPLIERS,
  type SplitStrength,
} from "@/lib/corporations/marketActionCosts";
import {
  anchorToCorpLiquidCapital,
  corpLiquidCapitalToAnchor,
  loadFxRatesByCurrency,
  resolveCorpLiquidCurrencyCode,
  resolveSectorHostCurrencyCode,
  fxRateForSectorHostFromMap,
} from "@/lib/currency/corporationCapital";
import { readCorpEconomicAnchor } from "@/lib/currency/corpEconomyFields";
import { getLegalStructureForCorp } from "@/lib/corporations/legalStructure";
import {
  SECTOR_STRATEGIES,
  STRATEGY_TRANSITION_TURNS,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
  STRATEGY_RETOOL_COST_FRACTION,
  CANCEL_COST_FRACTION,
} from "@/lib/constants/sectorStrategies";
import type { EffectiveStrategyRates, SectorStrategy } from "@/lib/constants/sectorStrategies";
import { computePriceRealization } from "@/lib/market/priceRealization";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import {
  getStrategyAvailability,
  getSectorTechEffects,
  getSectorTechEffectsForYear,
  type TechCorpView,
} from "@/lib/constants/techTree";
import { COMMODITY_BASE_PRICES, computeBlendedMarginModifiers } from "@/lib/constants/commodities";
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import type { CurrencyCode } from "@/lib/constants/currencies";
import { projectStrategyRevenuePerTurn } from "@/lib/corporations/strategyRevenuePreview";
import type { SectorBuildOrder } from "@/lib/db/types";
import { STRIKE_REVENUE_THROTTLE } from "@/lib/labour/strikes";
import { CAPITAL_DEPRECIATION_PER_TURN } from "@/lib/market/capital";
import {
  CAPACITY_BUILD_TURNS,
  capacityRescaleRatio,
  IDLE_UPKEEP_FRACTION,
  MOTHBALL_UPKEEP_FRACTION,
  computeBuildCost,
  laborIntensity,
} from "@/lib/constants/capacityEconomy";

// Apportioned per-sector tax — matches the corp page formula exactly for THIS sector:
//   corpLevelCosts = marketing + logistics + CEO salary
//     (equivalent to corp.sectorOpTotal − operatingIncome used on the corp page)
//   revenueShare = sectorEconomicRevenue(sector) / corpRevenue
//   netIncome = profit − corpLevelCosts × revenueShare
//   tax = max(0, netIncome) × rate / 100
// Sibling sector margins never enter THIS sector's tax formula, so no approximation.
// Build domestic/foreign rate maps — per-sector selection based on
// corp.countryId === sector.countryId matches the simulation tax path.
export function computeSectorTaxSection(args: {
  allFederalBudgets: FederalBudget[];
  allSiblingStateBudgets: StateBudget[];
  corporation: Corporation;
  allCorpSectors: Pick<CorporateSector, "revenue" | "countryId" | "realizedRevenue">[];
  sector: CorporateSector;
  profit: number;
  sectorCountryId: string;
  fxByCurrency: ReadonlyMap<CurrencyCode, number>;
}) {
  const {
    allFederalBudgets,
    allSiblingStateBudgets,
    corporation,
    allCorpSectors,
    sector,
    profit,
    sectorCountryId,
    fxByCurrency,
  } = args;
  const domesticFederalRateByCountry = new Map<string, number>();
  const foreignFederalRateByCountry = new Map<string, number>();
  for (const fb of allFederalBudgets) {
    if (!fb.countryId) continue;
    const dom = fb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticFederalRateByCountry.set(fb.countryId, dom);
    const fgn = fb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignFederalRateByCountry.set(fb.countryId, fgn);
  }
  const domesticStateRateByStateId = new Map<string, number>();
  const foreignStateRateByStateId = new Map<string, number>();
  for (const sb of allSiblingStateBudgets) {
    const dom = sb.taxRates?.domesticCorporateTax;
    if (typeof dom === "number") domesticStateRateByStateId.set(sb._id, dom);
    const fgn = sb.taxRates?.foreignCorporateTax;
    if (typeof fgn === "number") foreignStateRateByStateId.set(sb._id, fgn);
  }
  const corpLevelCosts =
    (corporation.marketingBudget ?? 0) +
    (corporation.logisticsBudget ?? 0) +
    (corporation.ceoSalary ?? 0);
  // Revenue share apportions corp-level costs across sectors. Each sector's
  // revenue is stored in its HOST-state currency, so normalize every sector to ₳
  // before the ratio — a raw sum across a multinational's mixed-currency sectors
  // would distort the shares. Use the same realized-preferring basis
  // (sectorEconomicRevenue) the corp page weights its siblings by, not raw
  // nameplate — otherwise the two pages apportion the same sector's tax
  // differently whenever any sibling has a capacity/embargo/oversupply haircut.
  const revenueAnchorOf = (
    s: Pick<CorporateSector, "revenue" | "countryId" | "realizedRevenue">
  ): number =>
    readCorpEconomicAnchor(
      sectorEconomicRevenue(s),
      resolveSectorHostCurrencyCode(s, corporation),
      fxRateForSectorHostFromMap(s, corporation, fxByCurrency)
    );
  const corpRevenue = allCorpSectors.reduce((sum, s) => sum + revenueAnchorOf(s), 0);
  const thisRevenueShare = corpRevenue > 0 ? revenueAnchorOf(sector) / corpRevenue : 0;
  const thisSectorNetIncome = profit - corpLevelCosts * thisRevenueShare;
  const thisSectorTaxable = Math.max(0, thisSectorNetIncome);
  const isDomesticSector = corporation.countryId === sectorCountryId;
  const corpLegalStructure = getLegalStructureForCorp(corporation);
  const corpTaxMultiplier =
    corpLegalStructure.taxTreatment === "pass_through"
      ? 0
      : corpLegalStructure.taxTreatment === "preferential"
        ? (corpLegalStructure.taxMultiplier ?? 1)
        : 1;
  const sectorFederalRate =
    corpTaxMultiplier *
    (isDomesticSector
      ? (domesticFederalRateByCountry.get(sectorCountryId) ?? 0)
      : (foreignFederalRateByCountry.get(sectorCountryId) ?? 0));
  const sectorStateRate =
    corpTaxMultiplier *
    (isDomesticSector
      ? (domesticStateRateByStateId.get(sector.stateId) ?? 0)
      : (foreignStateRateByStateId.get(sector.stateId) ?? 0));
  const apportionedFederalTax = Math.round(thisSectorTaxable * (sectorFederalRate / 100));
  const apportionedStateTax = Math.round(thisSectorTaxable * (sectorStateRate / 100));
  return {
    corpLevelCosts,
    thisRevenueShare,
    thisSectorTaxable,
    sectorFederalRate,
    sectorStateRate,
    apportionedFederalTax,
    apportionedStateTax,
  };
}

// Active-crisis margin penalty for this sector — decaying disaster /
// infrastructure effects on sectors in this state. Mirrors the turn-engine
// blend (buildLookups -> computeDisasterMarginPenalty) so the detail page
// reflects the same hit, and links to the crises responsible.
export async function buildSectorCrisisSection(
  db: Db,
  sector: CorporateSector,
  sectorCountryId: string,
  currentTurn: number
) {
  const activeStateCrises = await db
    .collection<Crisis>("crises")
    .find({
      status: "active",
      $or: [
        { regionIds: sector.stateId },
        { scope: "global" },
        { scope: "country", countryIds: sectorCountryId },
      ],
    })
    .toArray();
  // Every fetched crisis already affects this state (by the $or above), so the
  // resolver collapses each to this one stateId; computeDisasterMarginPenalty
  // then applies sector/strategy filters and the linear decay.
  const disasterEntries =
    buildDisasterEffectsByState(activeStateCrises, () => [sector.stateId]).get(sector.stateId) ??
    [];
  const crisisMarginPenalty = computeDisasterMarginPenalty(
    disasterEntries,
    { sectorType: sector.sectorType, strategyId: sector.strategyId ?? null },
    currentTurn
  );
  const activeCrises = activeStateCrises
    .filter((c) =>
      c.effects.some(
        (e) =>
          e.effectType === "decay" &&
          e.targetType === "profitMargin" &&
          (!e.sectorType || e.sectorType === sector.sectorType) &&
          (!e.strategyId || e.strategyId === (sector.strategyId ?? null))
      )
    )
    .map((c) => ({ id: c._id.toString(), name: c.name }));
  return { crisisMarginPenalty, activeCrises };
}

/** Attack/split panel info for the viewer's corporation (non-null viewer). */
export function buildSectorAttackInfo(args: {
  viewerCorporation: Corporation;
  viewerCorpFxRate: number;
  sectorHostFxRate: number;
  sectorHostLiquidCode: CurrencyCode | undefined;
  sector: CorporateSector;
  sectorType: CorporationType;
  sectorCountryId: CountryId;
  allTariffs: Tariff[];
  activeFtaPairs: Set<string>;
  unownedRevenue: number;
  effectiveMarket: number;
  mods: { effective: number };
  siblingsSectors: CorporateSector[];
  siblingRevenueAnchorById: Map<string, number>;
  /**
   * Under plants, unowned splits are gone — only rival plant takeovers remain.
   * Split quote fields are forced to 0 so no client can render a Split CTA.
   */
  plantsMode?: boolean;
}) {
  const {
    viewerCorporation,
    viewerCorpFxRate,
    sectorHostFxRate,
    sectorHostLiquidCode,
    sector,
    sectorType,
    sectorCountryId,
    allTariffs,
    activeFtaPairs,
    unownedRevenue,
    effectiveMarket,
    mods,
    siblingsSectors,
    siblingRevenueAnchorById,
    plantsMode = false,
  } = args;
  const viewerCountryId = viewerCorporation.headquartersState
    ? viewerCorporation.countryId
    : sectorCountryId;
  const tariffEffectiveRate = getEffectiveTariffRate(
    allTariffs,
    sectorCountryId,
    sectorType,
    viewerCountryId,
    undefined,
    activeFtaPairs
  );
  const isDomesticSplitting = sectorCountryId === viewerCountryId;
  const tariffMultiplier = getSplitCaptureMultiplier(tariffEffectiveRate, isDomesticSplitting);
  const captureMultiplier =
    (1 + (viewerCorporation.marketingStrength ?? 0) / MS_CAPTURE_DIVISOR) * tariffMultiplier;
  // Raw capture for normal (1×) size — other sizes are scaled from this
  const rawCaptureNormal =
    unownedRevenue *
    SPLIT_BASE_CAPTURE_FRACTION *
    captureMultiplier *
    UNOWNED_CAPTURE_BONUS_MULTIPLIER;
  const baseSplitCost = calculateSplitCostAnchor(unownedRevenue);

  // Viewer's current revenue in this market (for projected share calc)
  const viewerSib = siblingsSectors.find(
    (s) => s.corporationId.toString() === viewerCorporation._id.toString()
  );
  const viewerCurrentRevAnchor = viewerSib
    ? (siblingRevenueAnchorById.get(viewerSib._id.toString()) ?? 0)
    : 0;

  const buildStrengthInfo = (strength: SplitStrength) => {
    const mult = SPLIT_STRENGTH_MULTIPLIERS[strength];
    const strengthSplitCost = Math.round(baseSplitCost * mult);
    const strengthMsCost = calculateSplitMsCostForStrength(
      viewerCorporation.splitEscalation,
      strength
    );
    const strengthCapture = Math.min(
      Math.round(rawCaptureNormal * mult),
      Math.round(unownedRevenue)
    );
    const projectedRevAnchor = viewerCurrentRevAnchor + strengthCapture;
    const projectedMarketShare =
      effectiveMarket > 0 ? Math.round((projectedRevAnchor / effectiveMarket) * 10000) / 100 : 0;
    const estimatedNetIncome = Math.round((strengthCapture * mods.effective) / 100);
    return {
      splitCost: strengthSplitCost,
      splitMsCost: strengthMsCost,
      splitEstimatedCapture: strengthCapture,
      splitEstimatedNetIncome: estimatedNetIncome,
      projectedMarketShare,
      exceedsDominanceThreshold: projectedMarketShare > DOMINANCE_MARKET_SHARE_THRESHOLD,
    };
  };

  const fullStrengthInfo = buildStrengthInfo("full");
  const zeroSplit = {
    splitCost: 0,
    splitMsCost: 0,
    splitEstimatedCapture: 0,
    splitEstimatedNetIncome: 0,
    projectedMarketShare: 0,
    exceedsDominanceThreshold: false,
  };

  return {
    attackCost: calculateAttackCostFromLocalRevenue(
      sector.revenue,
      sectorHostLiquidCode,
      sectorHostFxRate
    ),
    // Flat full-strength fields kept for backwards compat. Plants: always 0 —
    // unowned splits are retired; attackCost above is the only market action.
    splitCost: plantsMode ? 0 : fullStrengthInfo.splitCost,
    splitEstimatedCapture: plantsMode ? 0 : fullStrengthInfo.splitEstimatedCapture,
    splitMsCost: plantsMode ? 0 : fullStrengthInfo.splitMsCost,
    userMarketingStrength: roundMarketingStrength(viewerCorporation.marketingStrength ?? 0),
    userLiquidCapital: Math.round(
      corpLiquidCapitalToAnchor(
        viewerCorporation.liquidCapital ?? 0,
        viewerCorporation,
        viewerCorpFxRate
      )
    ),
    userLiquidCurrencyCode: resolveCorpLiquidCurrencyCode(viewerCorporation),
    stateId: sector.stateId,
    countryId: sectorCountryId,
    splitStrengths: plantsMode
      ? { full: zeroSplit, half: zeroSplit }
      : {
          full: fullStrengthInfo,
          half: buildStrengthInfo("half"),
        },
    sectorEffectiveMargin: mods.effective,
  };
}

/** For-sale listing info for a prospective buyer (null when not applicable). */
export async function buildSectorForSaleInfo(
  db: Db,
  args: {
    sector: CorporateSector;
    viewerCorporation: Corporation | null;
    isCeo: boolean;
    viewerCorpFxRate: number;
  }
) {
  const { sector, viewerCorporation, isCeo, viewerCorpFxRate } = args;
  const listing = sector.forSale;
  if (!listing || !viewerCorporation || isCeo) return null;
  // Detect buyers who already operate this sector type in this state; the
  // purchase is still allowed — it becomes a merge rather than a transfer.
  const conflict = await db.collection<CorporateSector>("corporateSectors").findOne(
    {
      corporationId: viewerCorporation._id,
      stateId: sector.stateId,
      sectorType: sector.sectorType,
    },
    { projection: { _id: 1 } }
  );
  const priceInViewerCapital = Math.round(
    anchorToCorpLiquidCapital(listing.priceAnchor, viewerCorporation, viewerCorpFxRate)
  );
  const viewerCapitalAnchor = Math.round(
    corpLiquidCapitalToAnchor(
      viewerCorporation.liquidCapital ?? 0,
      viewerCorporation,
      viewerCorpFxRate
    )
  );
  const hasFunds = viewerCapitalAnchor >= listing.priceAnchor;
  return {
    viewerCorporationId: viewerCorporation._id.toString(),
    viewerLiquidCurrencyCode: resolveCorpLiquidCurrencyCode(viewerCorporation),
    priceInViewerCapital,
    viewerCapitalAnchor,
    eligible: hasFunds,
    conflict: !!conflict,
    hasFunds,
  };
}

/** Tech-tree growth-cost reduction (%) shown on the financials panel. */
export function computeTechGrowthCostReductionPct(args: {
  techTreesEnabled: boolean;
  techCurrentYear: number;
  techCorpView: TechCorpView;
  sectorType: CorporationType;
}): number {
  const { techTreesEnabled, techCurrentYear, techCorpView, sectorType } = args;
  if (!techTreesEnabled) return 0;
  const effects = techCurrentYear
    ? getSectorTechEffectsForYear(techCorpView, sectorType, techCurrentYear)
    : getSectorTechEffects(techCorpView, sectorType);
  return Math.round((1 - effects.growthCostMultiplier) * 100 * 10) / 10;
}

/** Strategy panel: current/available strategies, transition and cost fields. */
export function buildSectorStrategySection(args: {
  sector: CorporateSector;
  sectorType: CorporationType;
  effectiveRates: { isTransitioning: boolean };
  transitionProgress: number;
  strategyTransitionMod: number;
  currentTurn: number;
  sectorHostLiquidCode: CurrencyCode | undefined;
  sectorHostFxRate: number;
  commodityPrices: CommodityPrice[];
  techCorpView: TechCorpView;
  techCurrentYear: number;
  techTreesEnabled: boolean;
  shouldRedact: boolean;
  stateResources: Partial<Record<ExtractableResource, number>> | null | undefined;
  strategyCapacityMultipliers: Map<string, Partial<Record<ExtractableResource, number>>> | null;
  /**
   * Commodity-market state for the per-strategy margin projection. Same inputs
   * `computeBlendedMarginModifiers` gets for the live sector, so a projection
   * and the real thing can never disagree.
   */
  marginProjection: {
    globalBalances: Map<CommodityType, { supply: number; demand: number }>;
    nationalBalances: Map<CommodityType, { supply: number; demand: number }>;
    stateBalances: Map<CommodityType, { supply: number; demand: number }>;
    globalWeight: number;
    nationalWeight: number;
    localWeight: number;
    /** The live sector's own commodity modifier — the baseline to diff against. */
    currentCommodityModifier: number;
    /**
     * The live sector's realization multiplier, to diff the revenue leg against.
     * null when the price-realization market mode is OFF — projecting a revenue
     * change the engine would not apply is worse than showing nothing.
     */
    currentRealization: number | null;
  } | null;
}) {
  const {
    sector,
    sectorType,
    effectiveRates,
    transitionProgress,
    strategyTransitionMod,
    currentTurn,
    sectorHostLiquidCode,
    sectorHostFxRate,
    commodityPrices,
    techCorpView,
    techCurrentYear,
    techTreesEnabled,
    shouldRedact,
    stateResources,
    strategyCapacityMultipliers,
    marginProjection,
  } = args;
  return {
    currentStrategyId: sector.strategyId ?? "standard",
    currentStrategyName:
      SECTOR_STRATEGIES[sectorType]?.find((s) => s.id === (sector.strategyId ?? "standard"))
        ?.name ?? "Standard",
    isTransitioning: effectiveRates.isTransitioning,
    isReversing: sector.isReversing ?? false,
    transitionFromStrategyId: sector.transitionFromStrategyId ?? null,
    transitionStartTurn: sector.transitionStartTurn ?? null,
    transitionProgress: transitionProgress > 0 ? transitionProgress : null,
    transitionMarginPenalty: Math.round(Math.abs(strategyTransitionMod) * 10) / 10,
    cancelCost:
      effectiveRates.isTransitioning && !sector.isReversing
        ? Math.round(
            transitionProgress *
              CANCEL_COST_FRACTION *
              readCorpEconomicAnchor(sector.revenue, sectorHostLiquidCode, sectorHostFxRate)
          )
        : 0,
    reversalTurns:
      effectiveRates.isTransitioning && !sector.isReversing
        ? Math.max(1, Math.round(transitionProgress * STRATEGY_TRANSITION_TURNS))
        : 0,
    cooldownUntilTurn: sector.transitionCooldownUntilTurn ?? null,
    cooldownRemaining:
      sector.transitionCooldownUntilTurn != null
        ? Math.max(0, sector.transitionCooldownUntilTurn - currentTurn)
        : 0,
    retoolCost: Math.round(
      readCorpEconomicAnchor(sector.revenue, sectorHostLiquidCode, sectorHostFxRate) *
        STRATEGY_RETOOL_COST_FRACTION
    ),
    availableStrategies: (() => {
      // Strategy-picker revenue preview (extraction only): projected ₳/turn
      // at current lagged prices, capacity-clamped per resource — the number
      // that makes "big rate, no deposit" visible before retooling. Uses the
      // same globalPrice/base positive-price guard as the realization map.
      const previewPriceRatioByCommodity = new Map(
        commodityPrices
          .filter(
            (p) =>
              typeof p.globalPrice === "number" &&
              COMMODITY_BASE_PRICES[p.commodity] > 0 &&
              p.globalPrice > 0
          )
          .map((p) => [p.commodity as string, p.globalPrice / COMMODITY_BASE_PRICES[p.commodity]])
      );
      const sectorRevenueForPreview = readCorpEconomicAnchor(
        sector.revenue,
        sectorHostLiquidCode,
        sectorHostFxRate
      );

      // Per-strategy margin + realization projection, for EVERY sector type.
      //
      // Strategies carry no direct margin modifier — their whole effect is the
      // commodity supply/demand mix they impose (see sectorStrategies.ts header).
      // So the honest projection is to run the engine's own
      // `computeBlendedMarginModifiers` over each candidate strategy's rates
      // against today's market, and diff it against the live sector's modifier.
      //
      // Before this, the picker showed a name, a description, and (extraction
      // only) a projected ₳/turn. A player could not weigh "more revenue vs the
      // loss in profit margin" — the exact complaint in #gameplay-advisors on
      // 2026-07-29 — because the margin half of the trade was never quantified.
      const priceRatioMapTyped = new Map<CommodityType, number>(
        commodityPrices
          .filter(
            (p) =>
              typeof p.globalPrice === "number" &&
              COMMODITY_BASE_PRICES[p.commodity] > 0 &&
              p.globalPrice > 0
          )
          .map((p) => [
            p.commodity as CommodityType,
            p.globalPrice / COMMODITY_BASE_PRICES[p.commodity],
          ])
      );

      const projectStrategy = (s: SectorStrategy) => {
        if (!marginProjection || shouldRedact) return { marginDelta: null, realizationDelta: null };
        // Capacity-clamp the supply exactly as the live sector's is clamped, so
        // an extraction strategy targeting deposits the state does not have
        // projects its real (zero) yield rather than its nameplate rate.
        const cappedSupply = applyExtractionResourceCapacityToSupply(
          sectorType,
          s.supply,
          stateResources === undefined ? undefined : (stateResources ?? {})
        );
        const { inputMod, surplusMod } = computeBlendedMarginModifiers(
          sectorType,
          marginProjection.globalBalances,
          marginProjection.nationalBalances,
          marginProjection.stateBalances,
          marginProjection.globalWeight,
          marginProjection.nationalWeight,
          marginProjection.localWeight,
          cappedSupply,
          s.demand
        );
        const projectedCommodityMod = inputMod + surplusMod;
        const projectedRealization = computePriceRealization(cappedSupply, priceRatioMapTyped);
        return {
          // Percentage points the effective margin would move by.
          marginDelta:
            Math.round((projectedCommodityMod - marginProjection.currentCommodityModifier) * 10) /
            10,
          // Fractional change in realized revenue (0.08 = +8%).
          realizationDelta:
            marginProjection.currentRealization != null && marginProjection.currentRealization > 0
              ? Math.round(
                  (projectedRealization / marginProjection.currentRealization - 1) * 1000
                ) / 1000
              : null,
        };
      };

      return (
        SECTOR_STRATEGIES[sectorType]?.map((s) => {
          const availability = getStrategyAvailability(
            techCorpView,
            s,
            techCurrentYear,
            techTreesEnabled
          );
          const projection = projectStrategy(s);
          return {
            id: s.id,
            name: s.name,
            description: s.description,
            locked: availability.locked,
            lockReason: availability.reason ?? null,
            minDecade: s.minDecade ?? null,
            // Percentage points this strategy would move the effective margin
            // by, at today's commodity prices. null when redacted.
            projectedMarginDelta: projection.marginDelta,
            // Fractional change to realized revenue via price realization.
            projectedRealizationDelta: projection.realizationDelta,
            // D9 capacity rescale preview (plants tier): retooling re-denominates
            // capacity into the new output mix at equal value, so the unit count
            // moves even though nothing was built or scrapped. Shipped for every
            // mode (harmless below plants, where the page does not read it) using
            // the SAME `capacityRescaleRatio` the retool command applies.
            capacityRescaleRatio: capacityRescaleRatio(sectorType, sector.strategyId, s.id),
            capacityAfterRetool:
              typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
                ? sector.capitalStock * capacityRescaleRatio(sectorType, sector.strategyId, s.id)
                : null,
            // ₳/turn preview; null when redacted or not an extraction sector.
            projectedRevenuePerTurn:
              sectorType === "extraction" && !shouldRedact
                ? Math.round(
                    projectStrategyRevenuePerTurn({
                      revenueAnchor: sectorRevenueForPreview,
                      supply: s.supply,
                      priceRatioByCommodity: previewPriceRatioByCommodity,
                      capacityMultipliers:
                        stateResources === undefined
                          ? undefined // no cap doc — uncapped legacy state
                          : stateResources === null
                            ? null // cap doc with no resources — zero capacity
                            : (strategyCapacityMultipliers?.get(s.id) ?? {}),
                    })
                  )
                : null,
          };
        }) ?? []
      );
    })(),
    currentTurn,
  };
}

/**
 * Market position for the sector's (state, sectorType) bucket: effective
 * market size, market share, competitor rows, and the unowned pool.
 */
export function computeSectorMarketPosition(args: {
  state: State | null;
  sector: CorporateSector;
  sectorCountryId: string;
  corporation: Corporation;
  siblingCorps: Pick<
    Corporation,
    "_id" | "name" | "sequentialId" | "brandColor" | "countryId" | "liquidCurrencyCode"
  >[];
  siblingsSectors: CorporateSector[];
  siblingFxByCurrency: Awaited<ReturnType<typeof loadFxRatesByCurrency>>;
  unownedDoc: UnownedSector | null;
  /**
   * Active world preset, for the era-correct GDP→₳ normalization of the
   * GDP-derived market size (refs #3778). Omitted = modern base config.
   */
  preset?: string;
}) {
  const {
    sector,
    sectorCountryId,
    corporation,
    siblingCorps,
    siblingsSectors,
    siblingFxByCurrency,
  } = args;
  const siblingCorpMap = new Map(siblingCorps.map((c) => [c._id.toString(), c]));

  // Each sibling sector's `revenue` is denominated in its HOST-state currency
  // (the market it operates in), not its owner's. Every sibling here is in the
  // same state as `sector` (same host country), so they share one host currency
  // — normalize each to ₳ at the host rate. Summing LOCAL values across mixed
  // currencies would produce wildly wrong market totals (e.g. a JPY-host sector's
  // ¥246M next to a USD-host sector's $204K). `unownedSectors.revenue` is already
  // ₳-native, so it sums directly below.
  const hostCode = resolveSectorHostCurrencyCode({ countryId: sectorCountryId }, corporation);
  const hostRate = fxRateForSectorHostFromMap(
    { countryId: sectorCountryId },
    corporation,
    siblingFxByCurrency
  );
  const siblingRevenueAnchorById = new Map<string, number>();
  for (const s of siblingsSectors) {
    siblingRevenueAnchorById.set(
      s._id.toString(),
      readCorpEconomicAnchor(s.revenue, hostCode, hostRate)
    );
  }
  const totalOwnedRevenue = siblingsSectors.reduce(
    (sum, s) => sum + (siblingRevenueAnchorById.get(s._id.toString()) ?? 0),
    0
  );

  // Market = the TOTAL real revenue produced in this (state, sectorType) cell
  // (ticket #1145). No unowned pool, no GDP floor: a sector's share is its
  // revenue over what every producer actually earns, and the shares add to 100%.
  const effectiveMarket = Math.max(0, Math.round(totalOwnedRevenue));
  // Focal sector's own revenue in ₳ for market-share + competitor ratios.
  const sectorRevenueAnchor = siblingRevenueAnchorById.get(sector._id.toString()) ?? 0;
  const marketShare =
    effectiveMarket > 0 ? Math.round((sectorRevenueAnchor / effectiveMarket) * 10000) / 100 : 0;

  const competitors = siblingsSectors
    .filter((s) => s.corporationId.toString() !== corporation._id.toString())
    .map((s) => {
      const comp = siblingCorpMap.get(s.corporationId.toString());
      const revAnchor = siblingRevenueAnchorById.get(s._id.toString()) ?? 0;
      return {
        corporationName: comp?.name ?? "Unknown",
        corporationId: comp?._id.toString(),
        corporationSequentialId: comp?.sequentialId,
        brandColor: comp?.brandColor,
        // Return revenue in ₳ so the UI's `formatAmountIn(value, sectorCurrency)`
        // formats to the sector's country-home currency consistently across
        // cross-currency competitors. Pre-fix this was LOCAL (each competitor's
        // own corp currency), which compared incoherently against the anchor-
        // denominated `totalMarket` / `unownedRevenue`.
        revenue: Math.round(revAnchor),
        marketShare:
          effectiveMarket > 0 ? Math.round((revAnchor / effectiveMarket) * 10000) / 100 : 0,
      };
    });

  // No unclaimed market any more: every bit of the cell's revenue belongs to a
  // real producer, so the "unowned" slice is gone (ticket #1145).
  const unownedRevenue = 0;
  const unownedPercent = 0;

  return {
    effectiveMarket,
    marketShare,
    competitors,
    unownedRevenue,
    unownedPercent,
    siblingRevenueAnchorById,
  };
}

/**
 * Margin modifier stack for the sector: commodity blend, tariffs, subsidies,
 * strategy transition, state metrics, regional conditions — combined via the
 * shared computeAllMarginModifiers single source of truth.
 */
export function computeSectorMarginSection(args: {
  sector: CorporateSector;
  sectorType: CorporationType;
  sectorCountryId: CountryId;
  corporation: Corporation;
  state: State | null;
  stateMetrics: StateMetrics | null;
  /** SP4 §4a: political margin overlay for playable regions (null elsewhere). */
  politicalBaseModifiers?: ReadonlyMap<string, { modifier: number; rawValue: number }> | null;
  gameState: GameState | null;
  metrics: StateMetricValues;
  macroEcon: MacroEconomicValues;
  currentTurn: number;
  totalCorpSectors: number;
  marketShare: number;
  allTariffs: Tariff[];
  activeFtaPairs: Set<string>;
  ftaCoverage: FtaCoverage;
  activeSubsidies: Subsidy[];
  tariffBlend: { globalWeight: number; nationalWeight: number; localWeight: number };
  effectiveSupply: Partial<Record<CommodityType, number>>;
  effectiveRates: EffectiveStrategyRates;
  globalBalances: Map<CommodityType, { supply: number; demand: number }>;
  nationalBalancesByCountry: Map<string, Map<CommodityType, { supply: number; demand: number }>>;
  stateBalances: Map<CommodityType, { supply: number; demand: number }>;
  /** Dynamic modifiers computed outside the shared static stack (tech, risk, crises). */
  additionalMarginModifier?: number;
}) {
  const {
    sector,
    sectorType,
    sectorCountryId,
    corporation,
    state,
    stateMetrics,
    gameState,
    metrics,
    macroEcon,
    currentTurn,
    totalCorpSectors,
    marketShare,
    allTariffs,
    activeFtaPairs,
    ftaCoverage,
    activeSubsidies,
    tariffBlend,
    effectiveSupply,
    effectiveRates,
    globalBalances,
    nationalBalancesByCountry,
    stateBalances,
    additionalMarginModifier = 0,
  } = args;
  // Commodity shortage margin modifier (authoritative total). Pass the
  // sector's effective strategy rates so the blended net matches the per-row
  // `priceImpact` sum for non-standard strategies (e.g. telecom on "cloud"
  // only consumes energy/electronics/real_estate — the default
  // SECTOR_DEMAND table would penalize it for copper and building_materials
  // it never actually buys).
  const { inputMod, surplusMod } = computeBlendedMarginModifiers(
    sectorType,
    globalBalances,
    nationalBalancesByCountry.get(sectorCountryId) ?? new Map(),
    stateBalances,
    tariffBlend.globalWeight,
    tariffBlend.nationalWeight,
    tariffBlend.localWeight,
    effectiveSupply,
    effectiveRates.demand
  );
  const commodityMarginMod = inputMod + surplusMod;

  const homeLocationBonus = getHomeLocationMarginBonus(
    sector.stateId,
    corporation.headquartersState,
    sectorCountryId,
    corporation.countryId
  );
  const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
    state?.sectorSpecializations,
    sectorType
  );

  // Use shared single-source-of-truth modifier computation
  const typeSwitchPenaltyActive =
    corporation.typeSwitchTurn != null &&
    currentTurn - corporation.typeSwitchTurn < TYPE_SWITCH_PENALTY_TURNS;

  const corpCountryId = corporation.countryId;
  const foreignTariffMod = getForeignTariffMarginModifier(
    allTariffs,
    sectorCountryId,
    sectorType,
    corpCountryId,
    corporation._id,
    activeFtaPairs
  );
  const domesticTariffMod = getDomesticTariffMalus(
    allTariffs,
    sectorCountryId,
    sectorType,
    corpCountryId,
    ftaCoverage
  );

  const subsidyMod = getSubsidyMarginModifier(
    activeSubsidies,
    corporation.headquartersState,
    sectorType,
    sector.stateId,
    sector.strategyId,
    sectorCountryId,
    corpCountryId
  );

  const transitionProgress =
    effectiveRates.isTransitioning && sector.transitionStartTurn != null
      ? Math.min(
          1,
          Math.max(0, (currentTurn - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
        )
      : 0;
  // Penalty scales with progress: no disruption at turn 0, full −5% at turn 12
  const strategyTransitionMod = effectiveRates.isTransitioning
    ? sector.transitionStartTurn != null
      ? transitionProgress * STRATEGY_TRANSITION_MARGIN_PENALTY
      : STRATEGY_TRANSITION_MARGIN_PENALTY
    : 0;
  const stateMetricMargin = computeStateMetricMarginModifier({
    sectorType,
    strategyId: sector.strategyId ?? "standard",
    transitionFromStrategyId: sector.transitionFromStrategyId,
    transitionProgress,
    stateMetrics,
    countryId: sectorCountryId,
    // Live year for the era existence gate; null while the flag is off.
    year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
    // SP4 §4a: political margin overlay for playable regions.
    politicalBaseModifiers: args.politicalBaseModifiers ?? null,
  });
  const regionalConditionsModifiers = stateMetrics
    ? evaluateModifiers(buildFlatMetrics(stateMetrics), {
        preset: gameState?.preset,
        countryId: stateMetrics.countryId,
        // Live year for era-aware margins; null while the flag is off.
        year: gameState?.eraSystemEnabled ? resolveGameYear(gameState) : null,
      })
        .filter((m) => m.marginEffect !== 0 && m.marginEffect !== undefined)
        .map((m) => ({
          id: m.id,
          label: m.label,
          effect: m.effect,
          marginEffect: m.marginEffect!,
          source: m.source,
        }))
    : [];
  const regionalConditionsModifier = computeRegionalConditionMargin(regionalConditionsModifiers);
  const mods = computeAllMarginModifiers(
    sectorType,
    sector.profitMargin,
    metrics,
    commodityMarginMod,
    homeLocationBonus,
    corporation.type,
    totalCorpSectors,
    macroEcon,
    corporation.logisticsStrength ?? 0,
    corporation.secondaryType,
    typeSwitchPenaltyActive,
    foreignTariffMod,
    domesticTariffMod,
    subsidyMod,
    strategyTransitionMod,
    stateSectorSpecializationMod,
    marketShare,
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
    regionalConditionsModifiers
  );
  // Compute profit off the REALIZED (embargo/haircut-adjusted) revenue basis —
  // the same `sectorEconomicRevenue` the corp list and Financials page already
  // use — instead of raw nameplate `sector.revenue`. Previously this path used
  // nameplate, so an embargoed/suppressed sector showed a healthy positive net
  // here while the sector list (realized basis) showed a loss: the exact
  // list-vs-detail divergence in ticket 984. Both paths now agree.
  const economicRevenue = sectorEconomicRevenue(sector);
  const stackMargin = softCapEffectiveMargin(mods.effective + additionalMarginModifier);
  // Money uses the margin the engine ACTUALLY applied last turn, exactly as the
  // corp page does post-#262 (see corporationDetail.ts). Under plants the
  // stored field is derived from the physical P&L — inputs at live commodity
  // prices, labor, upkeep — which the stack recomputed above knows nothing
  // about. Observed on prod: a farm the engine paid −6.19% (input shortage x
  // output glut) rendered here at +48%, so this page showed +238K/day profit
  // on a sector losing money, directly contradicting the corp page one tap
  // away. The stack remains the advisory modifier breakdown and the fallback
  // for never-processed sectors; below plants stored == last turn's stack.
  const engineMargin =
    typeof sector.effectiveProfitMargin === "number" ? sector.effectiveProfitMargin : null;
  const effectiveMargin = engineMargin ?? stackMargin;
  const effectiveMods = { ...mods, effective: effectiveMargin };
  // Ticket 1122: prefer the P&L the turn actually booked over inverting the
  // margin. `effectiveProfitMargin` is that P&L's OUTPUT, capped at 100, so
  // inverting it recovers a zero operating cost from a genuinely negative one
  // (profit == revenue, the reported defect) and drops upkeep + compliance on
  // every plants sector because they sit outside the margin's scope. See
  // `plantsPnlBasis.ts`. The inversion below stays as the fallback for sectors
  // with no persisted P&L yet, where it is the pre-existing behaviour exactly.
  const enginePnl = readPlantsPnl(sector);
  const maintenance = enginePnl
    ? enginePnl.operatingCost
    : economicRevenue * (1 - effectiveMargin / 100);
  const profit = enginePnl
    ? enginePnl.profit
    : economicRevenue - maintenance - sector.currentGrowthCost;

  return {
    mods: effectiveMods,
    maintenance,
    profit,
    enginePnl,
    transitionProgress,
    strategyTransitionMod,
  };
}

// ─── Plants tier (marketSystemMode >= "plants") ──────────────────────────────

/**
 * One named reason capacity did not run this turn. Shares sum, with
 * `other`, to exactly the idle share of capacity — the run meter on the sector
 * page draws straight from these and must reconcile on screen.
 */
export interface PlantIdleCause {
  /** Stable key the UI maps to a label, colour and tooltip. */
  cause: "inputs" | "strike" | "disaster" | "policy" | "deposits" | "mothballed" | "other";
  /** Capacity units that did not run for this reason, units/day. */
  units: number;
}

/** One outstanding capacity build order, already turned into countdown form. */
export interface PlantBuildOrderView {
  /** Index into the persisted `buildQueue` — the cancel command's `orderIndex`. */
  orderIndex: number;
  unitsOrdered: number;
  /** Units delivered into capacity so far (ramps up for a smooth order). */
  unitsDelivered: number;
  /** True when this order ramps in per turn rather than landing all at once. */
  smooth: boolean;
  costPaidAnchor: number;
  startTurn: number;
  onlineTurn: number;
  /** Turns still to run before the capacity fully lands. 0 = lands next turn. */
  turnsRemaining: number;
  /** Fraction of capacity DELIVERED so far, 0–1. */
  progress: number;
}

/**
 * Everything the plants-mode sector page needs that the pre-plants payload had
 * no home for. Present only under `marketSystemMode >= "plants"`; `null`
 * otherwise, which is what keeps every non-plants world rendering the old page
 * byte-for-byte.
 *
 * MONEY UNITS: every `*Anchor` field is ₳ (economic anchor) on the DAILY basis
 * `sector.revenue` uses — NOT the corp-currency basis the `financials` block
 * ships in. The two are deliberately different: the plants block is a physical
 * statement about one plant in one host economy, so it stays in the currency
 * the commodity ledger prices in.
 *
 * UNIT UNITS: every `*Units` field is output units per financial day, the same
 * basis as `capitalStock` / `producedUnits`.
 */
export interface SectorPlantsSection {
  /** Installed capacity, units/day. Null before the sector's first plants turn. */
  capacityUnits: number | null;
  /** Units the plants actually made this turn. Null until a plants turn has run. */
  producedUnits: number | null;
  /** Units that found a buyer. Null until a plants turn has run. */
  soldUnits: number | null;
  /** producedUnits − soldUnits, floored at 0. */
  unsoldUnits: number | null;
  /** capacityUnits − producedUnits, floored at 0. */
  idleUnits: number | null;
  /** soldUnits / producedUnits, 0–1. Null when nothing was produced. */
  fillRate: number | null;
  /** Named reasons behind `idleUnits`. Sums to `idleUnits`. */
  idleCauses: PlantIdleCause[];
  mothballed: boolean;
  /** Outstanding build orders, oldest first. */
  buildQueue: PlantBuildOrderView[];
  /** ₳ paid for capacity that is not productive yet. */
  constructionInProgressAnchor: number;
  /** Capacity lost per turn with no investment, as a fraction (0.001 = 0.1%/turn). */
  depreciationPerTurn: number;
  /** Turns a new build in this sector takes to come online. */
  buildTurns: number;
  workers: number;
  /** NPC unionization pressure, 0–100. */
  unionizationPct: number;
  /** Workers needed per unit/day of capacity at this era. */
  laborIntensity: number;
  /** Launch-safety governor state — the "market support" pill. */
  governor: {
    /** True while the ramp is still running (the governor is still holding). */
    active: boolean;
    startTurn: number | null;
    rampTurns: number;
    /** Turns until the governor is fully faded out. 0 when done. */
    turnsRemaining: number;
    /** Max fractional deviation the governor still allows. */
    cap: number;
  };
  /** Untapped demand in this (state, sectorType) market, units/day. */
  headroomUnits: number;
  /**
   * True buyers' room in sector output units: unmet world demand across this
   * sector's output mix (min over legs — the market stops absorbing when the
   * first leg saturates). 0 in a glut. `headroomUnits` above is the unowned
   * pool = claimable market SHARE, a different thing; the UI must not present
   * it as demand (ticket #1027 follow-up).
   */
  demandGapUnits: number;
  currentTurn: number;
  /**
   * Everything the build dialog needs to price an order CLIENT-SIDE. Build cost
   * is exactly linear in units, so shipping the per-unit breakdown once lets the
   * stepper update instantly instead of round-tripping the preview endpoint on
   * every keystroke — and it is the same `computeBuildCost` the command charges.
   */
  buildQuote: {
    /** Base ₳ per unit at this era, before the multipliers below. */
    unitPriceAnchor: number;
    dominanceMultiplier: number;
    rateMultiplier: number;
    acumenMultiplier: number;
    techMultiplier: number;
    hostPriceMultiplier: number;
    /** unitPriceAnchor × every multiplier — the ₳ of CONSTRUCTION per unit. */
    perUnitAnchor: number;
    /**
     * C9: cross-currency transaction fee rate the server also charges on top of
     * the construction cost (`corpToSectorCountrySpread`, SECTOR_FX_SPREAD),
     * 0 when the corp and the host country share a currency.
     *
     * It is strictly proportional to the construction cost, so the client can
     * quote it exactly rather than guessing — which is the point. Quoting
     * `perUnitAnchor × units` alone under-quoted every foreign build and let the
     * dialog offer an order the server then refused for insufficient capital.
     */
    fxSpreadRate: number;
    /** perUnitAnchor × (1 + fxSpreadRate) — the ₳ per unit actually charged. */
    perUnitChargedAnchor: number;
    /** Corp's spendable capital, normalized to ₳ so the dialog can gate on it. */
    corpCapitalAnchor: number;
    /** Largest whole order the corp can afford, fee included. */
    maxAffordableUnits: number;
  };
  /**
   * The modifiers behind `pnl.policyAnchor`, already in money and summing to it
   * exactly. Empty when there is no stack to explain, or on the fallback path
   * where the credit cannot be separated from the residual.
   */
  policyStack: PolicyStackRow[];
  /**
   * The physical profit and loss, ₳/day. Reconciles by construction:
   * `profit = revenue − inputs − labour − upkeep − compliance + policy
   * − otherOperating − growthAndBuild`, and that identity IS the engine's own
   * profit whenever `plantsPnl` is on the row, because every line is read
   * straight off it (ticket 1122). Absent that row it falls back to inverting
   * the margin, where `otherOperating` is the solved residual that makes the
   * same identity hold.
   */
  pnl: {
    revenueAnchor: number;
    inputsAnchor: number;
    labourAnchor: number;
    upkeepAnchor: number;
    complianceAnchor: number;
    /**
     * The policy/tech modifier stack as money: tariffs, subsidies, state
     * metrics, regional conditions, tech bonuses, strategy transition, the SOE
     * and nationalization terms. POSITIVE is a credit that lowers cost.
     *
     * Under plants this is the ONLY channel by which any of those modifiers
     * reaches profit, so showing it is the difference between a player seeing
     * their subsidy and a player seeing an unexplained residual. 0 on the
     * fallback path, where the credit is still buried in `otherOperatingAnchor`
     * and cannot be separated.
     */
    policyAnchor: number;
    /** The same stack in percentage points of revenue, after the soft cap. */
    policyPp: number;
    otherOperatingAnchor: number;
    growthAndBuildAnchor: number;
    profitAnchor: number;
    /** Part of `otherOperatingAnchor` attributable to active crises. */
    financialEventsAnchor: number;
    /** revenue / soldUnits — what a unit actually fetched. */
    avgSalePriceAnchor: number | null;
    /** profit / producedUnits — the per-unit margin the dialog pays back on. */
    profitPerUnitAnchor: number | null;
  };
  /**
   * The three-number headline (ticket #1027 family): what the sector page leads
   * with so a player never again reads "43% margin" and "no money coming in" on
   * the same screen. Everything here is computed from the same telemetry the
   * pnl block reads, so the headline can never disagree with the money chain
   * below it.
   */
  truth: {
    /**
     * Share of output that found a buyer, 0-1. The engine's weighted
     * `soldFraction` when clearing wrote one, else the same soldUnits /
     * producedUnits ratio as `fillRate`. Null before the first plants turn.
     */
    soldFraction: number | null;
    /**
     * Per-output breakdown behind the blended headline. A multi-output sector
     * can clear one commodity fully and another barely; the blend alone reads
     * as though the short commodity is the one not selling. Empty when
     * clearing has not written the per-commodity split.
     */
    soldByCommodity: { commodity: string; fraction: number }[];
    /**
     * Share of offered output (0..1) that no freight network could place last
     * turn. The other half of the shortfall `soldFraction` reports: on screen
     * the two look identical and they mean opposite things, because a demand
     * shortfall says cut output while a delivery shortfall says buy freight or
     * build somewhere else. 0 when the engine wrote nothing.
     */
    deliveryLimitedFraction: number;
    deliveryLimitedFreightClass: "bulk" | "special" | "grid" | null;
    /**
     * Consecutive turns the sector cleared under half its output (see
     * strandedPlant.ts). Drives the stranded-plant warning on the sector page
     * once it reaches STRANDED_WARN_TURNS.
     */
    lowFillTurns: number;
    /**
     * Inventory of unsold storable output (design-realization-legs §6): the
     * toggle state plus the pile. Null-ish zeros before the first inventory
     * turn.
     */
    inventory: {
      stockpileUnsold: boolean;
      heldUnits: number;
      heldValueAnchor: number;
      byCommodity: { commodity: string; units: number }[];
      drainedUnits: number;
      spoiledUnits: number;
    };
    /**
     * Realized revenue per unit PRODUCED (not per unit sold): what a unit
     * coming off the line actually brought in, unsold units included at zero.
     * Null when nothing was produced.
     */
    receivedPerUnitAnchor: number | null;
    /**
     * Operating cost per unit produced: inputs, wages, upkeep on idle
     * capacity, compliance and other opex (the full `maintenanceNet + labour`
     * bill), spread over every unit made. Null when nothing was produced.
     */
    costPerUnitAnchor: number | null;
    /**
     * The margin after unsold output: realized profit over the full cost of
     * everything produced, in percent. This is the honest counterpart to the
     * stored `effectiveProfitMargin`, which divides by SOLD revenue only and
     * shows a 15%-fill sector a 45% margin while it bleeds money. Null when
     * there were no costs to measure against.
     */
    fillAdjustedMarginPct: number | null;
    /**
     * Break-even against construction in progress: how the money already sunk
     * into unbuilt capacity relates to what the sector clears per turn.
     * `turns` is set only for status "turns".
     */
    breakEven: {
      status: "profitable_now" | "turns" | "not_at_current_fills";
      turns: number | null;
    };
  };
}

/**
 * Build the plants-tier section. Pure: every DB-derived input is passed in, so
 * this is directly testable and adds no read to the sector-detail query beyond
 * the prime rate the caller already has to resolve.
 */
export function buildSectorPlantsSection(args: {
  sector: CorporateSector;
  sectorType: CorporationType;
  currentTurn: number;
  currentYear: number;
  governorCap: number;
  governorRampTurns: number;
  marketSharePercent: number;
  /**
   * Rival corps in this (state, type) cell — scales the dominance build toll.
   * Null when the caller could not resolve it, which prices at the full toll.
   */
  competitorCount: number | null;
  primeRate: number;
  ceoAcumen: number;
  hostCostOfLivingIndex: number | null;
  techGrowthCostMultiplier: number;
  /** The world's era unit-basis scale (`getEraUnitScale(preset)`). */
  eraUnitScale: number;
  corpCapitalAnchor: number;
  /** Untapped units in this market — see `unownedHeadroomUnitsOf`. */
  headroomUnits: number;
  /** True buyers' room (see SectorPlantsSection.demandGapUnits). Optional so
   *  test fixtures predating the field keep compiling; defaults to 0. */
  demandGapUnits?: number;
  workers: number;
  /** ₳/day, all on the same basis as `sector.revenue` normalized to ₳. */
  money: {
    realizedRevenueAnchor: number;
    /** Operating cost NET of labour, as the engine bills it. */
    maintenanceNetAnchor: number;
    labourAnchor: number;
    growthCostAnchor: number;
    profitAnchor: number;
    /** Physical input bill computed from the demand rows at market prices. */
    inputsAnchor: number;
    /**
     * Ticket 1122: the lines the turn ACTUALLY booked, in ₳. When present every
     * money figure below is read straight off them and nothing is
     * reconstructed. Absent on a sector that has not run a plants turn since
     * the field shipped, which falls back to the margin inversion exactly as
     * before. See `plantsPnlBasis.ts` for why the inversion is not enough.
     */
    enginePnl?: {
      revenue: number;
      inputs: number;
      labour: number;
      upkeep: number;
      compliance: number;
      otherOpex: number;
      financialLegs: number;
      inventoryCarry: number;
      policyCredit: number;
      policyPp: number;
      operatingCost: number;
      totalCost: number;
      profit: number;
    } | null;
  };
  /**
   * The modifier stack behind `pnl.policyAnchor`, already in money. Empty when
   * there is no stack to explain. Built by `buildPolicyStackRows` from the same
   * rows the corporation page's margin drilldown shows, so the two agree.
   */
  policyStack?: PolicyStackRow[];
  /** Regulatory burden in margin-pp equivalent (dominance). */
  regulatoryBurdenPp: number;
  /** Active-crisis margin penalty in pp (negative). */
  crisisMarginPenaltyPp: number;
  /** True when this extraction sector is clamped by its state's deposits. */
  depositBound: boolean;
  /**
   * C9: `SECTOR_FX_SPREAD` when the corp's currency differs from the host
   * country's, else 0. Resolved by the caller (which knows both currencies) and
   * passed in so this builder stays pure.
   */
  fxSpreadRate: number;
}): SectorPlantsSection {
  const {
    sector,
    sectorType,
    currentTurn,
    currentYear,
    governorCap,
    governorRampTurns,
    marketSharePercent,
    competitorCount,
    primeRate,
    ceoAcumen,
    hostCostOfLivingIndex,
    techGrowthCostMultiplier,
    eraUnitScale,
    corpCapitalAnchor,
    headroomUnits,
    demandGapUnits = 0,
    workers,
    money,
    regulatoryBurdenPp,
    crisisMarginPenaltyPp,
    depositBound,
  } = args;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const nonNeg = (v: number) => (v > 0 ? v : 0);

  const capacityUnits = num(sector.capitalStock);
  const producedUnits = num(sector.producedUnits);
  const soldUnits = num(sector.soldUnits);
  const mothballed = sector.mothballed === true;

  const unsoldUnits =
    producedUnits != null && soldUnits != null ? nonNeg(producedUnits - soldUnits) : null;
  const idleUnits =
    capacityUnits != null && producedUnits != null ? nonNeg(capacityUnits - producedUnits) : null;
  const fillRate =
    producedUnits != null && producedUnits > 0 && soldUnits != null
      ? Math.min(1, nonNeg(soldUnits) / producedUnits)
      : null;

  // ─── Idle attribution ──────────────────────────────────────────────────────
  // Every leg the engine applied is a factor in (0, 1]; its loss weight is
  // 1 − factor. The named weights are scaled to fit inside the ACTUAL idle
  // share and any remainder becomes "other", so the meter reconciles exactly
  // rather than asserting a decomposition the engine did not produce.
  const idleCauses: PlantIdleCause[] = [];
  if (mothballed && capacityUnits != null && capacityUnits > 0) {
    idleCauses.push({ cause: "mothballed", units: capacityUnits });
  } else if (idleUnits != null && idleUnits > 0 && capacityUnits && capacityUnits > 0) {
    const idleShare = idleUnits / capacityUnits;
    const weights: { cause: PlantIdleCause["cause"]; w: number }[] = [];
    const throughput = num(sector.throughputFactor);
    if (throughput != null && throughput < 1) {
      weights.push({ cause: "inputs", w: 1 - Math.max(0, throughput) });
    }
    if (sector.strikeStartedAtTurn != null) {
      weights.push({ cause: "strike", w: 1 - STRIKE_REVENUE_THROTTLE });
    }
    if (crisisMarginPenaltyPp < 0) {
      // No persisted physical-crisis factor exists; the margin penalty's
      // magnitude is the only honest proxy for how hard the disaster bit.
      weights.push({ cause: "disaster", w: Math.min(1, Math.abs(crisisMarginPenaltyPp) / 100) });
    }
    if ((sector.productionPolicyLevel ?? 0) < 0) {
      weights.push({
        cause: "policy",
        w: Math.min(1, Math.abs(sector.productionPolicyLevel ?? 0) / 10),
      });
    }
    if (depositBound) {
      weights.push({ cause: "deposits", w: idleShare });
    }
    const sumW = weights.reduce((s, x) => s + x.w, 0);
    const scale = sumW > 0 ? Math.min(1, idleShare / sumW) : 0;
    let attributed = 0;
    for (const { cause, w } of weights) {
      const units = w * scale * capacityUnits;
      if (units <= 0) continue;
      attributed += units;
      idleCauses.push({ cause, units });
    }
    const leftover = nonNeg(idleUnits - attributed);
    if (leftover > 0.0001) idleCauses.push({ cause: "other", units: leftover });
  }

  // ─── Build queue ──────────────────────────────────────────────────────────
  const rawQueue: SectorBuildOrder[] = Array.isArray(sector.buildQueue) ? sector.buildQueue : [];
  const buildQueue: PlantBuildOrderView[] = rawQueue.map((o, orderIndex) => {
    // `progress` is the share of capacity actually DELIVERED so far: a linear
    // ramp for a smooth order, a step (0 then 1) for a legacy all-at-once order.
    const delivered = deliveredFraction(o, currentTurn);
    return {
      orderIndex,
      unitsOrdered: o.unitsOrdered,
      unitsDelivered: o.unitsOrdered * delivered,
      smooth: o.smooth === true,
      costPaidAnchor: o.costPaidAnchor,
      startTurn: o.startTurn,
      onlineTurn: o.onlineTurn,
      turnsRemaining: nonNeg(o.onlineTurn - currentTurn),
      progress: delivered,
    };
  });

  // ─── Governor ("market support") ──────────────────────────────────────────
  const plantsStartTurn = num(sector.plantsStartTurn);
  const governorTurnsRemaining =
    plantsStartTurn != null
      ? nonNeg(plantsStartTurn + governorRampTurns - currentTurn)
      : governorRampTurns;

  // ─── Build quote ──────────────────────────────────────────────────────────
  const oneUnit = computeBuildCost({
    sectorType,
    units: 1,
    year: currentYear,
    eraUnitScale,
    marketSharePercent,
    competitorCount: competitorCount ?? undefined,
    primeRate,
    acumen: ceoAcumen,
    hostCostOfLivingIndex,
    techGrowthCostMultiplier,
  });
  const perUnitAnchor = oneUnit.totalAnchor;
  // C9: the server charges construction cost PLUS the cross-currency spread
  // (buildCapacity.ts). Both the quote and the affordability gate have to price
  // the same thing the server bills, or a foreign build is quoted low and then
  // rejected.
  const safeFxSpreadRate =
    Number.isFinite(args.fxSpreadRate) && args.fxSpreadRate > 0 ? args.fxSpreadRate : 0;
  const perUnitChargedAnchor = perUnitAnchor * (1 + safeFxSpreadRate);

  // ─── Physical P&L ─────────────────────────────────────────────────────────
  // The engine bills ONE operating number (`maintenanceNet` + labour). These
  // lines split that same number, so the panel can never disagree with the
  // profit the turn actually booked: `otherOperating` is whatever the named
  // physical lines do not explain, which is exactly the residual
  // `physicalPnl.ts` solves for. It is SIGNED, because that residual is signed.
  //
  // The identity every caller may rely on, exactly:
  //   revenue - (inputs + labour + upkeep + compliance + otherOperating
  //              + growthAndBuild) === profit
  const utilization =
    capacityUnits != null && capacityUnits > 0 && producedUnits != null
      ? Math.max(0, Math.min(1, producedUnits / capacityUnits))
      : 1;
  // OWNER-idle share only — the turn charges upkeep on the capacity the owner
  // chose to leave idle, not on capacity the world's input shortage idled (see
  // `ownerIdleUnits`). Reading total idleness here would show players an upkeep
  // line the engine never billed them, and would steal that ₳ from the inputs
  // line it actually belongs to. `throughputFactor` is the involuntary leg this
  // panel can see; disaster/strike/hard-min legs are not persisted per sector,
  // so the split can still over-attribute slightly in those rarer states.
  const involuntaryThrottle = (() => {
    const t = num(sector.throughputFactor);
    return t != null && t > 0 && t <= 1 ? t : 1;
  })();
  const idleShareForBill = Math.max(0, 1 - Math.min(1, utilization / involuntaryThrottle));
  // Invert the plants cost basis (utilization + IDLE × (1 − utilization)) to
  // recover the full-capacity bill, then read the idle slice off it.
  const costBasis = mothballed
    ? MOTHBALL_UPKEEP_FRACTION
    : utilization + IDLE_UPKEEP_FRACTION * idleShareForBill;
  const fullMaintenance = costBasis > 0 ? money.maintenanceNetAnchor / costBasis : 0;
  const upkeepAnchor = money.enginePnl
    ? nonNeg(money.enginePnl.upkeep)
    : nonNeg(
        mothballed
          ? money.maintenanceNetAnchor
          : fullMaintenance * IDLE_UPKEEP_FRACTION * idleShareForBill
      );
  const complianceAnchor = money.enginePnl
    ? nonNeg(money.enginePnl.compliance)
    : nonNeg((money.realizedRevenueAnchor * Math.max(0, regulatoryBurdenPp)) / 100);
  // The input bill renders at its real size, and `otherOperating` is the SIGNED
  // remainder that makes the named lines sum back to `maintenanceNet` exactly.
  //
  // Under plants the engine's derived operating cost can land BELOW the named
  // physical lines. `solveOtherOpexPerUnit` deliberately keeps a NEGATIVE
  // residual (a sector whose policy credit and calibration anchor outweigh its
  // physical costs), and `derivedMarginPct` is additionally capped at 100. Both
  // reconstruct here as a maintenance bill smaller than the wage bill, so
  // `maintenanceNet` goes negative once wages are carved out. That is a credit,
  // not an absence of costs.
  //
  // Clamping it at zero, and clamping the inputs line to fit inside a negative
  // budget, is what broke prod sector 6a83e59f97baa9dbe6bb7980 (a California
  // newsroom, other-opex anchor -0.0754/unit): realized revenue 321,760.57 at
  // an 88.63% engine margin is a 36,584.10 operating bill against a 70,561.75
  // wage bill, so the panel printed $322K of revenue, $70.6K of wages, $0 on
  // every other line and $285K of profit. 322 - 70.6 is 251.4, not 285
  // (ticket 1122).
  //
  // This mirrors the corporation page's `otherPp` residual (corporationDetail.ts,
  // ticket 1072), which was already signed and unclamped for the same reason.
  //
  // Ticket 1122 follow-up: all of the above is the FALLBACK. When the turn's own
  // lines are on the row (`money.enginePnl`) they are used verbatim and nothing
  // is inverted, because the inversion cannot be right at the margin cap: a
  // sector whose policy credit outruns its operating bill has a NEGATIVE
  // operating cost and a profit above its revenue, and `min(100, ...)` erases
  // exactly that. The engine path also carries upkeep and compliance, which the
  // margin's scope excludes and the profit includes.
  const engine = money.enginePnl ?? null;
  const inputsAnchor = engine ? engine.inputs : nonNeg(money.inputsAnchor);
  const otherOperatingAnchor = engine
    ? // Financial legs (disaster losses) and inventory carry have no line of
      // their own in the cost chain, so they sit here, exactly as the residual
      // used to carry them.
      engine.otherOpex + engine.financialLegs + engine.inventoryCarry
    : money.maintenanceNetAnchor - upkeepAnchor - complianceAnchor - inputsAnchor;
  // The whole modifier stack as one signed line: positive is a credit that
  // lowers cost. Rendered as its own row with a drilldown, so a player can see
  // their subsidy or a live crisis as a number in the same units as the wage
  // bill instead of it vanishing inside "other running costs".
  const policyAnchor = engine ? engine.policyCredit : 0;
  const policyPp = engine ? engine.policyPp : 0;
  const financialEventsAnchor = engine
    ? nonNeg(engine.financialLegs)
    : nonNeg((money.realizedRevenueAnchor * Math.abs(Math.min(0, crisisMarginPenaltyPp))) / 100);

  // ─── Truth headline ───────────────────────────────────────────────────────
  // Everything below is per-PRODUCED-unit on purpose. The stored margin divides
  // by sold revenue, so a sector selling 15% of its output can display a fat
  // positive margin while the whole operation loses money (77% of live sectors
  // sell under half their output). The headline instead spreads cost and
  // revenue over every unit made, which is the basis the player's bank balance
  // actually moves on.
  const soldFraction = num(sector.soldFraction) ?? fillRate;
  const soldByCommodity = Object.entries(sector.soldByCommodity ?? {})
    .filter((e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]))
    .map(([commodity, fraction]) => ({
      commodity,
      fraction: Math.max(0, Math.min(1, fraction)),
    }));
  // Share of the shortfall that is a DELIVERY failure, not a demand failure.
  // Absent on every sector until the freight pass writes it, so it reads as 0
  // and the surfaces render nothing extra.
  const deliveryLimitedFraction = Math.max(
    0,
    Math.min(1, num(sector.deliveryLimitedFraction) ?? 0)
  );
  const deliveryLimitedFreightClass =
    sector.deliveryLimitedFreightClass === "bulk" ||
    sector.deliveryLimitedFreightClass === "special" ||
    sector.deliveryLimitedFreightClass === "grid"
      ? sector.deliveryLimitedFreightClass
      : null;
  // Full operating bill: maintenanceNet already carries inputs, upkeep on idle
  // capacity, compliance and other opex; labour is billed beside it.
  // Floor the SUM, not each leg: `maintenanceNet` is routinely negative (a
  // credit) under plants, and flooring it on its own double-counted wages that
  // the credit had already offset, inflating cost-per-unit.
  //
  // Ticket 1122: with the engine's own lines the bill needs no flooring at all.
  // A negative total would be a sector paid more to run than it spends, and the
  // engine can say so; the fallback keeps the floor because an INVERTED total
  // can go negative for reasons that are artefacts of the inversion.
  const engineGrowthAnchor = engine
    ? engine.totalCost -
      engine.operatingCost -
      engine.upkeep -
      engine.compliance -
      engine.inventoryCarry
    : 0;
  const operatingCostAnchor = engine
    ? engine.totalCost - engineGrowthAnchor
    : nonNeg(money.maintenanceNetAnchor + money.labourAnchor);
  const totalCostAnchor = engine
    ? engine.totalCost
    : operatingCostAnchor + nonNeg(money.growthCostAnchor);
  const revenueAnchor = engine ? engine.revenue : money.realizedRevenueAnchor;
  const receivedPerUnitAnchor =
    producedUnits != null && producedUnits > 0 ? revenueAnchor / producedUnits : null;
  const costPerUnitAnchor =
    producedUnits != null && producedUnits > 0 ? operatingCostAnchor / producedUnits : null;
  const fillAdjustedMarginPct =
    totalCostAnchor > 0 ? (money.profitAnchor / totalCostAnchor) * 100 : null;
  // Break-even: profit is stored per financial day (TURNS_PER_DAY turns), CIP
  // is a stock. Positive profit pays CIP down in cip / profitPerTurn turns; at
  // zero CIP the sector's own profit sign is the whole story.
  const cipAnchor = nonNeg(num(sector.constructionInProgressAnchor) ?? 0);
  const profitPerTurnAnchor = money.profitAnchor / TURNS_PER_DAY;
  const breakEven: SectorPlantsSection["truth"]["breakEven"] =
    profitPerTurnAnchor > 0
      ? cipAnchor > 0
        ? { status: "turns", turns: Math.ceil(cipAnchor / profitPerTurnAnchor) }
        : { status: "profitable_now", turns: null }
      : profitPerTurnAnchor === 0 && cipAnchor === 0
        ? { status: "profitable_now", turns: null }
        : { status: "not_at_current_fills", turns: null };

  return {
    capacityUnits,
    producedUnits,
    soldUnits,
    unsoldUnits,
    idleUnits,
    fillRate,
    idleCauses,
    mothballed,
    buildQueue,
    constructionInProgressAnchor: num(sector.constructionInProgressAnchor) ?? 0,
    depreciationPerTurn: CAPITAL_DEPRECIATION_PER_TURN,
    buildTurns: CAPACITY_BUILD_TURNS(sectorType),
    workers,
    unionizationPct: num(sector.unionization) ?? 0,
    laborIntensity: laborIntensity(sectorType, currentYear, eraUnitScale),
    governor: {
      active: governorTurnsRemaining > 0,
      startTurn: plantsStartTurn,
      rampTurns: governorRampTurns,
      turnsRemaining: governorTurnsRemaining,
      cap: governorCap,
    },
    headroomUnits: nonNeg(headroomUnits),
    demandGapUnits: nonNeg(demandGapUnits),
    currentTurn,
    buildQuote: {
      unitPriceAnchor: oneUnit.unitPriceAnchor,
      dominanceMultiplier: oneUnit.dominanceMultiplier,
      rateMultiplier: oneUnit.rateMultiplier,
      acumenMultiplier: oneUnit.acumenMultiplier,
      techMultiplier: oneUnit.techMultiplier,
      hostPriceMultiplier: oneUnit.hostPriceMultiplier,
      perUnitAnchor,
      fxSpreadRate: safeFxSpreadRate,
      perUnitChargedAnchor,
      corpCapitalAnchor,
      maxAffordableUnits:
        perUnitChargedAnchor > 0
          ? Math.max(0, Math.floor(corpCapitalAnchor / perUnitChargedAnchor))
          : 0,
    },
    policyStack: args.policyStack ?? [],
    pnl: {
      revenueAnchor,
      inputsAnchor,
      labourAnchor: engine ? engine.labour : nonNeg(money.labourAnchor),
      upkeepAnchor,
      complianceAnchor,
      policyAnchor,
      policyPp,
      otherOperatingAnchor,
      growthAndBuildAnchor: engine ? nonNeg(engineGrowthAnchor) : nonNeg(money.growthCostAnchor),
      profitAnchor: money.profitAnchor,
      financialEventsAnchor,
      avgSalePriceAnchor: soldUnits != null && soldUnits > 0 ? revenueAnchor / soldUnits : null,
      profitPerUnitAnchor:
        producedUnits != null && producedUnits > 0 ? money.profitAnchor / producedUnits : null,
    },
    truth: {
      soldFraction,
      soldByCommodity,
      deliveryLimitedFraction,
      deliveryLimitedFreightClass,
      lowFillTurns: num(sector.lowFillTurns) ?? 0,
      inventory: {
        stockpileUnsold: sector.stockpileUnsold === true,
        heldUnits: Object.values(sector.inventoryUnits ?? {}).reduce<number>(
          (s, u) => s + (typeof u === "number" && Number.isFinite(u) ? u : 0),
          0
        ),
        heldValueAnchor: num(sector.inventoryValueAnchor) ?? 0,
        byCommodity: Object.entries(sector.inventoryUnits ?? {})
          .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
          .map(([commodity, units]) => ({ commodity, units })),
        drainedUnits: num(sector.inventoryDrainedUnits) ?? 0,
        spoiledUnits: num(sector.inventorySpoiledUnits) ?? 0,
      },
      receivedPerUnitAnchor,
      costPerUnitAnchor,
      fillAdjustedMarginPct,
      breakEven,
    },
  };
}
