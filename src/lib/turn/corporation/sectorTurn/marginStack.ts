/**
 * Margin-modifier accumulation: tariffs, subsidies, supply scaling, and the
 * policy stack (#588).
 *
 * Pure computation split out of processSector. All modifiers are additive
 * percentage-point adjustments to sector.profitMargin; the total is soft-capped
 * by softCapEffectiveMargin (negative effective margins are intentional).
 * Includes the P3.5 disaster split partition: the physical leg gates tonnage
 * (returned as disasterOutputFactor) while the not-yet-ramped remainder stays
 * a margin hit (disasterPhysicalDeferred), so the two legs always sum to the
 * pre-P3.5 total. No reads or writes here, only the turn inputs.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import {
  getDominanceMarginPenalty,
  getNationalDominanceMarginPenalty,
  getSustainedNegativeProductionPenalty,
  getExpropriationRiskMarginModifier,
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  getSectorTypeMatchModifier,
  getSprawlModifier,
  softCapEffectiveMargin,
  TYPE_SWITCH_MARGIN_PENALTY,
  TYPE_SWITCH_PENALTY_TURNS,
} from "@/lib/constants/corporations";
import {
  STRATEGY_TRANSITION_TURNS,
  STRATEGY_TRANSITION_MARGIN_PENALTY,
} from "@/lib/constants/sectorStrategies";
import { computeBlendedMarginModifiers } from "@/lib/constants/commodities";
import {
  getForeignTariffMarginModifier,
  getDomesticTariffMalus,
  getTariffBlendWeights,
} from "@/lib/tariffs/tariffEffects";
import { getSubsidyMarginModifier } from "@/lib/subsidies/subsidyEffects";
import { politicalSoeInputs } from "@/lib/politicalLegislation/marginAdapter";
import { computeExportPremium } from "@/lib/trade/exportPremium";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import { computeStateMetricMarginModifier } from "@/lib/corporations/sectorMetricMarginProfiles";
import {
  computeDisasterPenaltySplit,
  disasterProductionFactor,
} from "@/lib/crises/disasterMarginPenalty";
import { computeSoeEfficiencyPenalty } from "@/lib/nationalization/soeEfficiency";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { resolveSectorMandate } from "@/lib/nationalization/soeMandates";
import { corpAlignmentModifier } from "@/lib/economicModels/effects";
import type { getSectorTechEffects } from "@/lib/constants/techTree";
import type { CountryId } from "@/lib/constants/countries";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";
import type { CorporationLookups } from "../types";
import type { CommodityType } from "@/lib/constants/commodities";

export interface MarginStackInput {
  corp: Pick<
    Corporation,
    | "_id"
    | "countryId"
    | "headquartersState"
    | "type"
    | "secondaryType"
    | "typeSwitchTurn"
    | "countryOwnerId"
    | "logisticsStrength"
    | "soeMandate"
  >;
  sector: Pick<
    CorporateSector,
    | "stateId"
    | "sectorType"
    | "strategyId"
    | "transitionFromStrategyId"
    | "transitionStartTurn"
    | "countryId"
    | "profitMargin"
    | "soeMandate"
  >;
  lookups: CorporationLookups;
  strategySupply: Partial<Record<CommodityType, number>> | undefined;
  strategyDemand: Partial<Record<CommodityType, number>> | undefined;
  strategyIsTransitioning: boolean;
  techEffects: ReturnType<typeof getSectorTechEffects>;
  sectorMarketSharePct: number;
  nationalDominanceSharePct: number;
  sectorCountryId: CountryId;
  corpCountry: CountryId;
  turn: number | undefined;
  currentTurn: number;
  plantsEnabled: boolean;
  plantsRampLambda: number;
  newNegativeProductionTurns: number;
  newPolicyLevel: number;
  embargoTradeExposureActive: boolean;
  soeConcentrationMultiplier: number;
  corpSectorCount: number;
  /** Production leg from the shared labour resolution, consumed as margin here. */
  strikeMarginModifier: number;
  wideCommodityBalances: CorporationLookups["globalCommodityBalances"];
  /** Raw political board for playable regions; also feeds labour headcount. */
  politicalBoard: Record<PoliticalMetricId, number> | undefined;
}

export interface MarginStackResult {
  disasterPenalty: ReturnType<typeof computeDisasterPenaltySplit>;
  disasterPhysicalRamped: number;
  disasterPhysicalDeferred: number;
  disasterOutputFactor: number;
  foreignTariffMod: number;
  domesticTariffMod: number;
  subsidyMod: number;
  effectiveSupply: Partial<Record<CommodityType, number>> | undefined;
  effectiveDemand: Partial<Record<CommodityType, number>> | undefined;
  commodityMod: number;
  surplusMod: number;
  exportPremiumMod: number;
  homeLocationMod: number;
  stateSectorSpecializationMod: number;
  sectorTypeMatchMod: number;
  sprawlMod: number;
  inflationMod: number;
  debtToGdpMod: number;
  deficitMod: number;
  sovereignDefaultMod: number;
  transitionProgress: number;
  strategyMarginMod: number;
  stateMetricMargin: ReturnType<typeof computeStateMetricMarginModifier>;
  typeSwitchMod: number;
  dominanceMarginPenalty: number;
  negativeProductionMarginPenalty: number;
  expropriationRiskMod: number;
  economicModelAlignmentMod: number;
  disasterMarginMod: number;
  regionalConditionMarginMod: number;
  strikeMarginMod: number;
  totalMarginMod: number;
  nationalizedMarginPenalty: number;
  effectiveMargin: number;
}

/** Multiply selected commodity rates by per-commodity multipliers (new map). */
function scaleCommodityRates<T extends Partial<Record<string, number>>>(
  rates: T,
  mult: Record<string, number>
): T {
  if (!mult || Object.keys(mult).length === 0) return rates;
  const out: Record<string, number | undefined> = { ...rates };
  for (const [commodity, m] of Object.entries(mult)) {
    if (out[commodity] != null) out[commodity] = (out[commodity] as number) * m;
  }
  return out as T;
}

const EMPTY_EXPORT_INTENSITY: ReadonlyMap<CommodityType, number> = new Map();

export function accumulateMarginModifiers(input: MarginStackInput): MarginStackResult {
  const {
    corp,
    sector,
    lookups,
    strategySupply,
    strategyDemand,
    strategyIsTransitioning,
    techEffects,
    sectorMarketSharePct,
    nationalDominanceSharePct,
    sectorCountryId,
    corpCountry,
    turn,
    currentTurn,
    plantsEnabled,
    plantsRampLambda,
    newNegativeProductionTurns,
    newPolicyLevel,
    embargoTradeExposureActive,
    soeConcentrationMultiplier,
    corpSectorCount,
    strikeMarginModifier,
    wideCommodityBalances,
    politicalBoard,
  } = input;

  // P3.5 SEAM — active-disaster penalties are split at their source
  // (disasterMarginPenalty.ts) into a financial leg and a physical leg.
  // The physical leg gates TONNAGE: pre-P3.5 a blackout shipped a full load
  // at a thinner margin. The financial leg is consumed unchanged below in
  // `totalMarginMod`.
  // FLIP IDENTITY: below plants, and for any crisis effect with no
  // `physicality` (i.e. every crisis spawned before P3.5), the split puts the
  // whole penalty in `marginPenalty` and `disasterProductionFactor` returns
  // exactly 1.
  const disasterPenalty = computeDisasterPenaltySplit(
    lookups.activeDisasterEffectsByState.get(sector.stateId) ?? [],
    { sectorType: sector.sectorType, strategyId: sector.strategyId ?? null },
    currentTurn,
    plantsEnabled
  );
  // FLIP-DAY HANDOVER. Fade the physical leg in on `plantsRampLambda`, same
  // rule as every other plants leg. A partition, not a duplication: λ of the
  // penalty drives tonnage, (1 - λ) stays in the margin stack, and the two
  // always sum to the pre-P3.5 total. At λ = 0 that is `productionPenalty x 0
  // === 0` and `marginPenalty + productionPenalty` - the old number, exactly.
  // At λ = 1 the whole physical penalty is tonnage, which is the wave's intent.
  const disasterPhysicalRamped = disasterPenalty.productionPenalty * plantsRampLambda;
  const disasterPhysicalDeferred = disasterPenalty.productionPenalty - disasterPhysicalRamped;
  const disasterOutputFactor = disasterProductionFactor(disasterPhysicalRamped);

  // Tariff modifiers: foreign corps pay a rate-proportional margin penalty;
  // domestic corps absorb a smaller supply-chain friction malus from broad tariffs.
  // Blend weights shift toward local commodity data when tariffs are in effect,
  // reflecting that import costs push buyers toward domestic alternatives.
  const foreignTariffMod =
    getForeignTariffMarginModifier(
      lookups.allTariffs,
      sectorCountryId,
      sector.sectorType,
      corpCountry,
      corp._id,
      lookups.activeFtaPairs
    ) *
    (1 - techEffects.tariffShield);
  const domesticTariffMod = getDomesticTariffMalus(
    lookups.allTariffs,
    sectorCountryId,
    sector.sectorType,
    corpCountry,
    lookups.ftaCoverage
  );
  // Subsidy bonus: +7.5pp of margin per qualifying active subsidy (federal and state stack freely)
  const subsidyMod = getSubsidyMarginModifier(
    lookups.activeSubsidies,
    corp.headquartersState,
    sector.sectorType,
    sector.stateId,
    sector.strategyId,
    sectorCountryId,
    corpCountry
  );
  const { globalWeight, nationalWeight, localWeight } = getTariffBlendWeights(
    lookups.allTariffs,
    sectorCountryId,
    sector.sectorType,
    lookups.sectorPresenceKeys,
    lookups.ftaCoverage
  );
  const nationalBalances =
    lookups.nationalCommodityBalancesByCountry.get(sectorCountryId) ?? new Map();
  // Commodity shortage modifier: logarithmic penalty for input shortages.
  // The blended modifier uses `strategyRates` so it reflects what the sector
  // actually produces/consumes on its current strategy — without that
  // override, sectors on non-standard strategies would be priced against
  // SECTOR_DEMAND/SECTOR_SUPPLY (the "standard" recipe).
  const stateBalances = lookups.rawStateBalances.get(sector.stateId) ?? new Map();
  const baseSupply = applyExtractionResourceCapacityToSupply(
    sector.sectorType,
    strategySupply ?? {},
    lookups.stateResourceCapacityByState.get(sector.stateId)
  );
  // Tech production-method effects: scale specific commodity output up and
  // input (demand) down. No-op for commodities a node doesn't target.
  const effectiveSupply = scaleCommodityRates(baseSupply, techEffects.outputRateMult);
  const effectiveDemand = scaleCommodityRates(strategyDemand ?? {}, techEffects.inputRateMult);
  const { inputMod: commodityMod, surplusMod } = computeBlendedMarginModifiers(
    sector.sectorType,
    wideCommodityBalances,
    nationalBalances,
    stateBalances,
    globalWeight,
    nationalWeight,
    localWeight,
    effectiveSupply,
    effectiveDemand
  );
  // Export reward: a margin premium for producing a commodity this country
  // actually exports into foreign deficits (export intensity from the prior
  // turn's trade snapshot, one-turn lag like the commodity balances above).
  // Empty map before the first trade turn → 0.
  // Under the trade-exposure embargo the sector's remaining sales are domestic,
  // so it no longer earns the export-reward margin premium.
  const exportPremiumMod = embargoTradeExposureActive
    ? 0
    : computeExportPremium(
        effectiveSupply,
        lookups.exportIntensityByCountry.get(sectorCountryId) ?? EMPTY_EXPORT_INTENSITY
      );
  // Home state +10%, home nation +5%, international 0%
  const homeLocationMod = getHomeLocationMarginBonus(
    sector.stateId,
    corp.headquartersState,
    sector.countryId,
    corp.countryId
  );
  const stateSectorSpecializationMod = getStateSectorSpecializationMarginBonus(
    lookups.stateSectorSpecializationByState.get(sector.stateId),
    sector.sectorType as CorporationType
  );
  // Sector type match: +10pp primary, +5pp secondary, -15pp mismatch. SOEs are
  // exempt - a NatCorp is a diversified state holding company, not a
  // specialized private firm (Bug #0775).
  const sectorTypeMatchMod = isStateOwned(corp)
    ? 0
    : getSectorTypeMatchModifier(
        sector.sectorType as CorporationType,
        corp.type,
        corp.secondaryType
      );
  // Logistical sprawl: -0.5% per 2 sectors over 15 for a single-type corp
  // (-1.0% per pair if dual-type). Logistics spending raises the threshold
  // (15 at LS 0, 30 at LS 200) and halves the rate at LS 200. SOEs are exempt
  // - they accumulate sectors by nationalization.
  const sprawlMod = isStateOwned(corp)
    ? 0
    : getSprawlModifier(corpSectorCount, corp.logisticsStrength ?? 0, !!corp.secondaryType);
  // National-level macroeconomic modifiers (inflation, debt-to-GDP, deficit)
  const inflationMod = lookups.macroInflationByCountry.get(sectorCountryId) ?? 0;
  const debtToGdpMod = lookups.macroDebtToGdpByCountry.get(sectorCountryId) ?? 0;
  const deficitMod = lookups.macroDeficitByCountry.get(sectorCountryId) ?? 0;
  // Sovereign-default sector margin penalty (Phase 7) — local + global contagion
  // already aggregated per-corp in buildLookups. Defaults to 0 outside a crisis.
  const sovereignDefaultMod = lookups.sovereignDefaultMarginByCorpId.get(corp._id.toString()) ?? 0;
  // Operating strategy: −5% margin penalty while transitioning between strategies.
  // Penalty scales with progress: no disruption at turn 0, full −5% at turn 12.
  // Falls back to full penalty if transitionStartTurn is missing (legacy safety).
  const transitionProgress =
    strategyIsTransitioning && sector.transitionStartTurn != null
      ? Math.min(
          1,
          Math.max(0, ((turn ?? 0) - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
        )
      : 0;
  const strategyMarginMod = strategyIsTransitioning
    ? sector.transitionStartTurn != null
      ? transitionProgress * STRATEGY_TRANSITION_MARGIN_PENALTY
      : STRATEGY_TRANSITION_MARGIN_PENALTY
    : 0;
  const stateMetricMargin = computeStateMetricMarginModifier({
    sectorType: sector.sectorType as CorporationType,
    strategyId: sector.strategyId ?? "standard",
    transitionFromStrategyId: sector.transitionFromStrategyId,
    transitionProgress,
    stateMetrics: lookups.stateMetricsByState?.get(sector.stateId) ?? null,
    countryId: sectorCountryId,
    // Live year for the era existence gate; null while the flag is off.
    year: lookups.eraYear ?? null,
    // SP4 §4a: political margin overlay for playable regions.
    politicalBaseModifiers: lookups.politicalBaseModifiersByState?.get(sector.stateId) ?? null,
  });
  // Type switch penalty: -10% for 24 turns after switching primary/secondary type
  const typeSwitchPenaltyActive =
    corp.typeSwitchTurn != null &&
    turn != null &&
    turn - corp.typeSwitchTurn < TYPE_SWITCH_PENALTY_TURNS;
  const typeSwitchMod = typeSwitchPenaltyActive ? TYPE_SWITCH_MARGIN_PENALTY : 0;
  // Dominance margin penalty: 0 at ≤50% share, scales to -15pp at 100%.
  // Models regulatory pressure, customer backlash, and political risk that
  // accumulate as a sector tightens its grip on its (state, sectorType).
  // SOEs are exempt — a nationalized industry is a state monopoly by design,
  // so anti-trust/political-risk dominance pressure doesn't fit (Bug #0775).
  // P3a scoped touch #2a — DOMINANCE TOLL CONSOLIDATION (plants only).
  // Under plants, dominance is charged ONCE, at build time, as a multiplier on
  // the capacity price (`computeBuildCost`, which documents the design in full).
  // Keeping this permanent margin penalty as well would triple-charge the same
  // condition alongside the revenue tax below, on a tier where capacity is
  // bought outright rather than accrued off a cheap slider. Dominance under
  // plants is a barrier to EXPANSION, not a tax on operating.
  // SOEs remain exempt in every mode (a nationalized industry is a state
  // monopoly by design, Bug #0775). Non-plants worlds are unchanged.
  // Under plants the toll is FADED OUT over `plantsRampLambda` rather than
  // switched off: λ = 0 on the flip turn keeps flip-day numbers byte-identical
  // for a dominant sector, rising to a full consolidation over the same ramp
  // every other plants leg uses.
  const dominanceMarginPenalty = isStateOwned(corp)
    ? 0
    : Math.min(
        getDominanceMarginPenalty(sectorMarketSharePct),
        getNationalDominanceMarginPenalty(nationalDominanceSharePct)
      ) *
      (1 - techEffects.dominanceShield) *
      (plantsEnabled ? 1 - plantsRampLambda : 1);
  // Sustained-negative-production margin penalty: counter-driven, see
  // `getSustainedNegativeProductionPenalty`. Punishes long-term parking at
  // negative production levels without preventing tactical short-term use.
  const negativeProductionMarginPenalty = getSustainedNegativeProductionPenalty(
    newNegativeProductionTurns,
    newPolicyLevel
  );
  // ── Margin modifier accumulation ──────────────────────────────────────────────
  // All modifiers are additive percentage-point adjustments to sector.profitMargin.
  // Positive = boost to profitability; negative = drag.
  // The total is uncapped here; effectiveMargin below clamps the result to ≤100,
  // but negative effective margins are intentional — loss-making sectors drain cash.
  // See docs/design/corporations.md for modifier magnitudes and balance rationale.
  // Expropriation-risk drag (spec §12.4 feed 1): low investor confidence drags
  // PRIVATE corp margins; SOEs are exempt (the state cannot expropriate itself).
  const expropriationRiskMod = isStateOwned(corp)
    ? 0
    : getExpropriationRiskMarginModifier(
        lookups.investorConfidenceByCountry?.get(sectorCountryId) ?? null
      );
  // §6.2 (P7b): corp alignment to the country's (lagged) economic model —
  // favored sectors earn higher margins, off-model a mild penalty. 0 when no
  // named model / mixed (parity). Applies to SOEs too: the state's identity favors its
  // own strategic sectors.
  const economicModelAlignmentMod = corpAlignmentModifier(
    lookups.economicModelByCountry?.get(sectorCountryId),
    sector.sectorType as string
  );
  // P3.5: financial leg only. The physical leg was consumed above as a
  // production haircut (`disasterOutputFactor`); adding it here too would
  // charge the same disaster twice. `disasterPhysicalDeferred` is the part of
  // the physical leg the plants ramp has not taken over yet (all of it on the
  // flip turn, none of it once λ reaches 1) — it stays a margin hit so the two
  // legs partition the penalty instead of dropping a slice of it.
  const disasterMarginMod = disasterPenalty.marginPenalty + disasterPhysicalDeferred;
  const regionalConditionMarginMod =
    lookups.regionalConditionMarginByState?.get(sector.stateId) ?? 0;
  // v3 Phase 6: margin hit while a strike is active. The production leg was
  // already consumed through the shared labour output factor above.
  const strikeMarginMod = strikeMarginModifier;
  const totalMarginMod =
    stateMetricMargin.cappedTotal +
    commodityMod +
    surplusMod +
    exportPremiumMod +
    homeLocationMod +
    stateSectorSpecializationMod +
    sectorTypeMatchMod +
    sprawlMod +
    inflationMod +
    debtToGdpMod +
    deficitMod +
    strategyMarginMod +
    typeSwitchMod +
    foreignTariffMod +
    domesticTariffMod +
    subsidyMod +
    sovereignDefaultMod +
    dominanceMarginPenalty +
    expropriationRiskMod +
    economicModelAlignmentMod +
    negativeProductionMarginPenalty +
    disasterMarginMod +
    regionalConditionMarginMod +
    techEffects.marginBonusPp +
    strikeMarginMod;
  // Dynamic SOE efficiency (spec §11.3) replaces the old flat −15%. Driven
  // by state governance quality + the sector's price-control posture; private
  // corps get 0. Same shared function feeds the budget estimate + display.
  const sectorMetrics = lookups.stateMetricsByState?.get(sector.stateId) ?? null;
  // SP4: playable regions' governance reads come from the political board
  // (their political stateMetrics are demolished) — legacy scales preserved,
  // including the corruption inversion (politicalSoeInputs).
  const politicalSoe = politicalBoard ? politicalSoeInputs(politicalBoard) : null;
  const soeMandate = resolveSectorMandate(corp, sector);
  const nationalizedMarginPenalty = isStateOwned(corp)
    ? computeSoeEfficiencyPenalty({
        corruptionIndex:
          sectorMetrics?.governance?.corruptionIndex?.value ??
          politicalSoe?.corruptionIndex ??
          null,
        governmentTransparency:
          sectorMetrics?.governance?.governmentTransparency?.value ??
          politicalSoe?.governmentTransparency ??
          null,
        priceControlled: soeMandate.priceControlled === true,
        employmentGuaranteed: soeMandate.employmentGuaranteed === true,
        concentrationMultiplier: soeConcentrationMultiplier,
      })
    : 0;
  // Margin can go negative — sectors in terrible commodity markets drain cash.
  // The high side is soft-capped (not a hard min(100)) so a stacked modifier
  // pile asymptotes toward the ceiling instead of pinning it as free profit.
  const effectiveMargin = softCapEffectiveMargin(
    sector.profitMargin + totalMarginMod + nationalizedMarginPenalty
  );

  return {
    disasterPenalty,
    disasterPhysicalRamped,
    disasterPhysicalDeferred,
    disasterOutputFactor,
    foreignTariffMod,
    domesticTariffMod,
    subsidyMod,
    effectiveSupply,
    effectiveDemand,
    commodityMod,
    surplusMod,
    exportPremiumMod,
    homeLocationMod,
    stateSectorSpecializationMod,
    sectorTypeMatchMod,
    sprawlMod,
    inflationMod,
    debtToGdpMod,
    deficitMod,
    sovereignDefaultMod,
    transitionProgress,
    strategyMarginMod,
    stateMetricMargin,
    typeSwitchMod,
    dominanceMarginPenalty,
    negativeProductionMarginPenalty,
    expropriationRiskMod,
    economicModelAlignmentMod,
    disasterMarginMod,
    regionalConditionMarginMod,
    strikeMarginMod,
    totalMarginMod,
    nationalizedMarginPenalty,
    effectiveMargin,
  };
}
