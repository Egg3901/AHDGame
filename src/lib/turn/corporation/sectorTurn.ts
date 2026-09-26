/**
 * Sector operations turn owned capacity into sales, jobs and operating profit.
 * processSector prices production, upkeep and policy effects while preserving payroll.
 */
import {
  specializationMaintenance,
  specializationPayrollModifier,
} from "@/lib/corporations/specialization/rules";
import type { Corporation, CorporateSector } from "@/lib/db/types";
import type { CurrencyCode } from "@/lib/constants/currencies";
import type { CommodityType } from "@/lib/constants/commodities";
import { trendProductionPolicy, getRevenueMultiplier } from "@/lib/utils/productionPolicy";
import {
  calculateDailyGrowthCost,
  TURNS_PER_DAY,
  getDominanceGrowthCostMultiplier,
  getNationalDominanceGrowthCostMultiplier,
  softCapEffectiveMargin,
  nextNegativeProductionCounter,
} from "@/lib/constants/corporations";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { sociMultiplier } from "@/lib/nationalization/concentration";
import { nationalizationProductivityFactor } from "@/lib/nationalization/transitionShock";
import {
  getSectorTechEffects,
  getSectorTechEffectsForYear,
  NEUTRAL_TECH_EFFECTS,
} from "@/lib/constants/techTree";
import { getCountryConfig } from "@/lib/constants/countries";
import { NEUTRAL_STAT } from "@/lib/stats/statsConstants";
import {
  getEffectiveStrategyRates,
  STRATEGY_TRANSITION_TURNS,
} from "@/lib/constants/sectorStrategies";
import type { SectorUpdateOp } from "./types";
import { computeMarketTiers } from "./sectorTurn/marketTiers";
import { computePlantsCapacity } from "./sectorTurn/plantsCapacity";
import { accumulateMarginModifiers } from "./sectorTurn/marginStack";
import { resolvePlantsRevenue } from "./sectorTurn/plantsRevenue";
import { computeGrowthAndRegulatory, decomposePhysicalCosts } from "./sectorTurn/sectorCosts";
import { costReleasedThisTurn } from "@/lib/corporations/buildDelivery";
import { resolveBuildQueueTurn } from "./sectorBuildQueueTurn";
import { resolveSectorGrowthPolicy } from "./sectorGrowthPolicy";
import {
  resolveSectorHeadcount,
  resolveSectorLabourEconomics,
  resolveSectorLabourProductionEffects,
} from "./sectorLabour";
import { advanceSectorInventory } from "@/lib/corporations/sectorInventory";
import type { SectorTurnEnv, SectorTurnResult } from "./sectorTurnTypes";
import { legacyRevenueShadowTelemetry, marketTelemetry } from "./sectorTelemetry";
import { resolveSectorFreightBillingLegs } from "./freightBillingTurn";
import { resolveSectorCapacityHaircut } from "./sectorCapacityHaircut";

export { computeSectorOutputUnits } from "./sectorOutputUnits";
export type { SectorTurnEnv, SectorTurnResult } from "./sectorTurnTypes";

import { computeIdleUpkeep } from "./sectorTurn/idleUpkeep";
import {
  sectorNpvBoostMultiplier,
  sectorRevenueBoostMultiplier,
} from "@/lib/corporations/rules/marketBoost";

/** Process one sector and append its persisted update to the turn collectors. */
export function processSector(
  env: SectorTurnEnv,
  corp: Corporation,
  sector: CorporateSector,
  corpSectorCount: number,
  sectorCurrencyCode: CurrencyCode | undefined,
  sectorFxRate: number
): SectorTurnResult {
  const {
    lookups,
    turn,
    currentTurn,
    now,
    techTreesEnabled,
    currentYear,
    commandEconomyEnabled,
    labour,
    market,
    wageIndexByState,
    automationIndexByState,
    labourDemandByState,
    pendingStrikeEvents,
    pendingCapacityBindingEvents,
    sectorOps,
  } = env;

  // Per-sector tech effects: Corporate-lane bonuses apply to every sector at
  // reduced strength; Sector-lane bonuses apply only to the corp's primary
  // sector type, full strength. Neutral when the feature gate is off.
  const techEffects = techTreesEnabled
    ? currentYear != null
      ? getSectorTechEffectsForYear(corp, sector.sectorType, currentYear)
      : getSectorTechEffects(corp, sector.sectorType)
    : NEUTRAL_TECH_EFFECTS;
  // Normalize host-currency revenue to anchor currency. Recover corrupt values
  // here so NaN cannot spread through corporate totals and tax accruals.
  const rawSectorRevenue = Number.isFinite(sector.revenue) ? sector.revenue : 0;
  const sectorRevenueAnchor = readCorpEconomicAnchor(
    rawSectorRevenue,
    sectorCurrencyCode,
    sectorFxRate
  );

  const embargoSuppressed =
    lookups.corporateEmbargoSuppression?.has(
      `${sector.countryId ?? corp.countryId}|${corp.countryId}`
    ) ?? false;
  const useTradeExposureEmbargo = lookups.embargoTradeExposureEnabled === true;
  const plantsEnabled = market.plantsEnabled;
  const {
    brakedTargetRate,
    newCurrentGrowthRate,
    perTurnGrowthRate,
    embargoLegacyMothball,
    embargoTradeExposureActive,
    newRevenue,
    preFlipNameplateRevenue,
  } = resolveSectorGrowthPolicy({
    corp,
    sector,
    currentYear,
    commandEconomyEnabled,
    sectorRevenueAnchor,
    plantsEnabled,
    embargoSuppressed,
    useTradeExposureEmbargo,
  });

  // Recalculate daily growth cost; legacy sectors fall back to the HQ country.
  const sectorCountryId = sector.countryId ?? corp.countryId;
  // Partition worlds: the WIDE balance leg this sector reads (margin
  // modifiers, throughput coupling) is its country's REACHABLE book — the
  // same book clearing fills it from — so a sector behind an embargo wall is
  // margin-priced and input-throttled against the market it actually trades
  // in. Modern worlds build no books → the worldwide aggregate, unchanged.
  const wideCommodityBalances =
    lookups.countryClearingBooks?.get(sectorCountryId) ?? lookups.globalCommodityBalances;
  const primeRate =
    lookups.primeRateByCountry.get(sectorCountryId) ??
    getCountryConfig(sectorCountryId).centralBank.defaultPrimeRate;
  const sectorMarketSharePct = lookups.marketShareBySectorId.get(sector._id.toString()) ?? 0;
  // The owning corp's aggregate share of this (country, sectorType) across every
  // state. The per-cell share above is a LOCAL contest (50% threshold); a corp
  // can command a whole nation's sector while sitting under 50% in each state.
  // National share is a weighted average of the cell shares, so it is always
  // ≤ the largest cell — the national toll uses a LOWER threshold (30%) to bite
  // at all. Each toll is charged at the HARSHER of its local and national leg:
  // min() for the negative margin penalty, max() for the positive growth-cost
  // multiplier and regulatory burden. Absent lookup → national 0 → local-only.
  const nationalDominanceSharePct =
    lookups.nationalDominanceShareBySectorId?.get(sector._id.toString()) ?? 0;
  const dominanceGrowthMult = Math.max(
    getDominanceGrowthCostMultiplier(sectorMarketSharePct),
    getNationalDominanceGrowthCostMultiplier(nationalDominanceSharePct)
  );
  // Business Acumen: a player CEO's stat makes growth cheaper and dampens the
  // prime-rate penalty. Absent (NPP/imperial/vacant) → neutral.
  const ceoAcumen = lookups.ceoBusinessAcumenByCorpId.get(corp._id.toString()) ?? NEUTRAL_STAT;
  // A state monopoly is exempt from the private-firm dominance growth toll:
  // applying it alongside the command-economy soft budget creates an unchecked
  // growth-cost ratchet because a state firm cannot go bankrupt. We pass share 0
  // into calculateDailyGrowthCost (no internal dominance leg) and apply the
  // combined local+national growth multiplier here so both thresholds compose.
  // Use the pre-flip nameplate so enabling plants does not change growth cost.
  const newGrowthCost =
    calculateDailyGrowthCost(preFlipNameplateRevenue, perTurnGrowthRate, primeRate, 0, ceoAcumen) *
    techEffects.growthCostMultiplier *
    (isStateOwned(corp) ? 1 : dominanceGrowthMult);

  // Calculate per-turn financials from daily amounts and state conditions.
  // Trend production policy level toward CEO-set target by 1 pt/turn
  const newPolicyLevel = trendProductionPolicy(
    sector.productionPolicyLevel ?? 0,
    sector.productionPolicy ?? 0
  );
  // Sustained-negative-production tracker: increments while negative,
  // decrements (floored at 0) while non-negative — no free reset.
  const newNegativeProductionTurns = nextNegativeProductionCounter(
    sector.negativeProductionSustainedTurns,
    newPolicyLevel
  );
  const revenueMultiplier = getRevenueMultiplier(newPolicyLevel);
  // Nationalization transition shock: a freshly state-owned sector produces at
  // a discount that recovers over NATIONALIZATION_TRANSITION_TURNS. Hits output
  // here (not the stored `newRevenue` base), so it fades back to full as the
  // window elapses. Private sectors are unaffected.
  // Live SOCI escalation for the owning country — drives the steady-state
  // overreach penalty below.
  const soeConcentrationMultiplier = isStateOwned(corp)
    ? sociMultiplier(
        lookups.stateOwnershipConcentrationByCountry?.get(corp.countryOwnerId ?? "") ?? 0
      )
    : 1;
  // Transition uses the per-sector snapshot (the SOCI multiplier at taking
  // time), NOT live SOCI — so raising concentration later can't retroactively
  // deepen an already-settled sector's digestion. Absent ⇒ 1 (base shock).
  const nationalizationTransition = isStateOwned(corp)
    ? nationalizationProductivityFactor(
        sector.nationalizedAtTurn,
        turn,
        sector.nationalizationTransitionMultiplier ?? 1
      )
    : 1;
  // v3 Phase 6: a sector with an active strike (persisted from a prior
  // turn's trigger — see the labour.unionsEnabled block below for where
  // strikes are triggered/resolved) has revenue throttled, not zeroed.
  // Checked on `labour.unionsEnabled` directly (not `wagesEnabled`):
  // in practice unionsEnabled always implies wagesEnabled via
  // LABOUR_MODE_ORDER, but LabourContext doesn't enforce that, so this
  // reads `sector.strikeStartedAtTurn` regardless of wagesEnabled.
  const tightness = lookups.labourTightnessByState.get(sector.stateId);
  const stateDemandWageIndex = lookups.labourDemandWageIndexByState?.get(sector.stateId);
  const {
    outputFactor: labourOutputFactor,
    strikeMarginModifier,
    staffingFactor,
  } = resolveSectorLabourProductionEffects(labour, sector, tightness, stateDemandWageIndex);
  // Effective strategy rates, resolved once here and reused below by the
  // capacity haircut, price realization, and the blended commodity margin
  // modifiers (so non-standard strategies are priced against what the
  // sector actually produces/consumes).
  const strategyRates = getEffectiveStrategyRates(
    sector.sectorType,
    sector.strategyId ?? "standard",
    sector.transitionFromStrategyId,
    sector.transitionStartTurn,
    turn ?? 0
  );
  const { capacityUtil, capacityHaircutStartTurn, capacityHaircut } = resolveSectorCapacityHaircut(
    sector,
    lookups.extractionCapacityUtilBySector,
    currentTurn
  );
  // ─── Market-tier realization legs (clearing / throughput / capital) ──────
  // Pure computation in `sectorTurn/marketTiers.ts`; the orchestrator only
  // threads its inputs and consumes the legs. Names are unchanged, so every
  // reader below sees exactly what it saw before.
  const {
    clearing,
    clearingStartTurn,
    clearingFactor,
    priceRealization,
    throughputRaw,
    throughputStartTurn,
    throughputFactor,
    governorCap,
    nameplateUnits,
    newCapitalStock,
    capitalFactor,
  } = computeMarketTiers({
    sector,
    market,
    priceRatioByCommodity: lookups.priceRatioByCommodity,
    stateInputAvailabilityByState: lookups.stateInputAvailabilityByState,
    strategySupply: strategyRates.supply,
    strategyDemand: strategyRates.demand,
    wideCommodityBalances,
    stateId: sector.stateId,
    currentTurn,
    preFlipNameplateRevenue,
    perTurnGrowthRate,
    eraUnitScale: lookups.eraUnitScale,
  });
  // (moved to computeMarketTiers: throughput coupling + downside floor)
  // (moved to computeMarketTiers: capital tier + P1 nameplate units)
  // Plants tier: capacity is AUTHORITATIVE, not a haircut.
  //
  // Lazy per-sector flip migration — the first plants turn adopts
  //   capacity := max(existing capitalStock, impliedOutputUnits(nameplate))
  // so a sector arriving from capital mode keeps the capital it built, and one
  // that never ran under capital starts at exactly the units its revenue base
  // implied (which is what makes the derived-revenue identity below exact for
  // it). Capacity then only DEPRECIATES this phase — the growth slider no
  // longer builds it; build orders arrive in P3.
  // ─── P3a: build queue ─────────────────────────────────────────────────────
  // Extracted whole to `sectorBuildQueueTurn.ts`: it is a pure computation and
  // this file was over the 2000 LOC block threshold. The WRITES stay below,
  // because the queue update is a delta inside the same bulk op.
  const {
    isFlipTurn,
    existingQueue,
    landedBuildUnits,
    landedBuildCostAnchor,
    flipGrowthCreditOrder,
    constructionInProgressAnchor,
    capacityUnitPriceAnchor,
  } = resolveBuildQueueTurn({
    sector,
    currentTurn,
    plantsEnabled,
    currentYear,
    sectorCurrencyCode,
    sectorFxRate,
    eraUnitScale: lookups.eraUnitScale,
  });
  // ─── C4: the turn's queue write is a DELTA, never a whole-array $set ───────
  // `nextBuildQueue` is a snapshot; `$set`-ing it would erase any order a CEO
  // placed during this phase. Write only what the turn owns: `$pull` orders
  // that landed (`onlineTurn <= currentTurn`). A freshly placed order always
  // has `onlineTurn > currentTurn`, so it cannot match. CIP `$inc`s the same
  // delta so a concurrent order's contribution survives; rounded values keep
  // the stored integer exact, and the command restates CIP absolutely so drift
  // self-heals. Flip-turn credit is a `$push` in a second bulkWrite op - Mongo
  // rejects `$pull` and `$push` on the same path in one update. bulkWrite is
  // ordered, so the pull always precedes the push.
  const landedOrderCount = plantsEnabled
    ? existingQueue.reduce((n, o) => (o.onlineTurn <= currentTurn ? n + 1 : n), 0)
    : 0;
  // Cost leaving CIP this turn: the sum of what each order released (a landed
  // legacy order releases its whole cost; a smooth order releases this turn's
  // slice). `$inc`-ing CIP down by this delta — rather than restating it — is
  // what keeps a concurrently-placed order's contribution intact (C4).
  const cipAnchorDelta = Math.round(
    existingQueue.reduce((sum, o) => sum + costReleasedThisTurn(o, currentTurn), 0)
  );
  // ─── Plants capacity advance + P5 paid basis ──────────────────────────────
  // Pure computation in `sectorTurn/plantsCapacity.ts`; the orchestrator only
  // threads its inputs and consumes the legs. Names are unchanged, so every
  // reader below sees exactly what it saw before.
  const {
    mothballed,
    activeFraction,
    plantLedger,
    plantsOwnedCapacity,
    capacityBookAnchor,
    plantsMixPrice,
    storedOtherOpexAnchor,
    healedOpex,
    retoolCapacityRatio,
    priorProductionUnitRatio,
    plantsCapacity,
    plantsNameplateRevenue,
    plantsStartTurn,
    plantsRampLambda,
  } = computePlantsCapacity({
    sector,
    corp,
    plantsEnabled,
    isFlipTurn,
    preFlipNameplateRevenue,
    strategySupply: strategyRates.supply,
    eraUnitScale: lookups.eraUnitScale,
    landedBuildUnits,
    landedBuildCostAnchor,
    capacityUnitPriceAnchor,
    newRevenue,
    currentTurn,
    governorRampTurns: market.governorRampTurns,
    embargoLegacyMothball,
  });
  // (moved to computePlantsCapacity: plant ledger + owned-capacity advance)
  // (moved to computePlantsCapacity: P5 paid basis of capacity)
  // (moved to computePlantsCapacity: mix price, opex heal, retool ratios)
  // (moved to computePlantsCapacity: nameplate revenue, ramp anchor + λ)
  // ─── Margin stack (tariffs / subsidies / supply / policy) ────────────────
  // Pure computation in `sectorTurn/marginStack.ts`; the orchestrator only
  // threads its inputs and consumes the legs. Runs before the revenue
  // resolution because the P3.5 disaster split it owns feeds tonnage.
  const corpCountry = corp.countryId;
  const politicalBoard = lookups.politicalBoardByState?.get(sector.stateId);
  const {
    disasterOutputFactor,
    effectiveDemand,
    commodityMod,
    surplusMod,
    exportPremiumMod,
    sectorTypeMatchMod,
    inflationMod,
    debtToGdpMod,
    deficitMod,
    stateMetricMargin,
    totalMarginMod,
    disasterMarginMod,
    nationalizedMarginPenalty,
    effectiveMargin,
  } = accumulateMarginModifiers({
    corp,
    sector,
    lookups,
    strategySupply: strategyRates.supply,
    strategyDemand: strategyRates.demand,
    strategyIsTransitioning: strategyRates.isTransitioning,
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
  });
  // ─── P3b extraction capacity + realized revenue ───────────────────────────
  // Pure computation in `sectorTurn/plantsRevenue.ts`; the orchestrator only
  // threads its inputs and consumes the legs. Names are unchanged.
  const {
    plantsExtractionHardMin,
    producedUnits,
    soldUnits,
    contractAchievableUnits,
    demandThrottleFactor,
    embargoExportExposure,
    hourlyRevenue: realizedHourlyRevenue,
    capacityBindingEvent,
  } = resolvePlantsRevenue({
    sector,
    corp,
    strategySupply: strategyRates.supply,
    techEffects,
    plantsEnabled,
    mothballed,
    nameplateUnits,
    activeFraction,
    plantsRampLambda,
    capacityUtil,
    capacityHaircut,
    capitalFactor,
    clearing,
    clearingEnabled: market.clearingEnabled,
    clearingFactor,
    clearingStartTurn,
    currentTurn,
    priceRealization,
    priceRatioByCommodity: lookups.priceRatioByCommodity,
    embargoLegacyMothball,
    embargoTradeExposureActive,
    exportIntensityByCountry: lookups.exportIntensityByCountry,
    preFlipNameplateRevenue,
    plantsNameplateRevenue,
    revenueMultiplier,
    nationalizationTransition,
    throughputFactor,
    labourOutputFactor,
    strategyIsTransitioning: strategyRates.isTransitioning,
    retoolCapacityRatio,
    priorProductionUnitRatio,
    disasterOutputFactor,
    newPolicyLevel,
    plantsCapacity,
    plantsMixPrice,
    plantsStartTurn,
    governorCap,
    governorRampTurns: market.governorRampTurns,
    privateBankingEnabled: env.privateBankingEnabled,
    marketPlantsEnabled: market.plantsEnabled,
    contractProductionTargetBySectorId: market.contractProductionTargetBySectorId,
  });
  if (capacityBindingEvent) {
    pendingCapacityBindingEvents.push(capacityBindingEvent);
  }
  // Phased stock-market boost, phase A: lift realized operating revenue AFTER
  // every market-microstructure leg (governor, clearing, embargo) has run, so
  // those legs keep pricing what the market actually cleared. Nameplate
  // revenue above (the headcount basis) is deliberately unboosted: this is a
  // price/realization lift, not extra workers. Maintenance, growth realization
  // and regulatory legs below all scale with the boosted figure, so margins
  // are preserved and the lift lands in profit, then NPV, then share price.
  const hourlyRevenue =
    realizedHourlyRevenue * sectorRevenueBoostMultiplier(currentTurn, sector.sectorType);
  // (moved to resolvePlantsRevenue: trade-exposure embargo legs)
  // (moved to resolvePlantsRevenue: P3b extraction hard min)
  // (moved to resolvePlantsRevenue: pre-plants counterfactual baseline)
  // P1 units telemetry: the production-side legs of the chain above — the ones
  // that gate how much the sector can physically make. The remaining legs
  // (clearingRevenueLeg, embargoRevenueFactor) are sales-side and stay on the
  // dollar side of the identity documented on computeSectorOutputUnits.
  // (moved to resolvePlantsRevenue: tech output rate in capacity units)
  // (moved to accumulateMarginModifiers: P3.5 disaster split partition)
  // (moved to resolvePlantsRevenue: tonnage policy curve + production factor)
  // (moved to resolvePlantsRevenue: banking split + contract production)
  // (moved to resolvePlantsRevenue: derived revenue from produced output)
  // (moved to resolvePlantsRevenue: launch-safety governor + arsenal leg)
  // (moved to resolvePlantsRevenue: capacity-binding event, pushed above)
  // (moved to accumulateMarginModifiers: tariffs, subsidies, supply scaling)
  // (moved to accumulateMarginModifiers: export/macro/strategy/state metrics)
  // (moved to accumulateMarginModifiers: dominance + negative-production)
  // (moved to accumulateMarginModifiers: expropriation/alignment/disaster/total)
  // (moved to accumulateMarginModifiers: SOE efficiency + effective margin)
  // Labour telemetry below reads raw state metrics directly; the political
  // board it also needs was hoisted next to the margin call above.
  const sectorMetrics = lookups.stateMetricsByState?.get(sector.stateId) ?? null;
  // Ahead of the labor-cost split below, so labor is workers x wage-per-worker.
  const { desiredWorkers, workers: computedWorkers } = resolveSectorHeadcount({
    revenue: plantsEnabled ? plantsNameplateRevenue * activeFraction : newRevenue,
    stateId: sector.stateId,
    rawWorkforceSkillByState: lookups.rawWorkforceSkillByState,
    politicalBoard,
    staffingFactor,
    labourDemandByState,
    labourDemandWageIndexByState: env.labourDemandWageIndexByState,
    wageLevel: labour.wagesEnabled ? sector.wageLevel : 1,
  });

  const payrollSpecializationMod = isStateOwned(corp)
    ? 0
    : specializationPayrollModifier(sector.sectorType, corp.type, corp.secondaryType);
  const { payrollBasis, operatingSaving } = specializationMaintenance({
    revenue: hourlyRevenue,
    operatingMargin: effectiveMargin,
    payrollMargin: softCapEffectiveMargin(
      sector.profitMargin +
        totalMarginMod +
        nationalizedMarginPenalty -
        sectorTypeMatchMod +
        payrollSpecializationMod
    ),
  });
  const {
    maintenance: maintenanceBeforeSpecialization,
    sectorLaborCost,
    wagePerWorker,
    newUnionization,
    newWorkerExpectationIndex,
    newStrikeStartedAtTurn,
    newStrikeCooldownUntilTurn,
  } = resolveSectorLabourEconomics({
    labour,
    sector,
    sectorCountryId,
    currentTurn,
    currentYear,
    hourlyRevenue,
    grossMaintenance: payrollBasis,
    computedWorkers,
    techLaborCostMultiplier: techEffects.laborCostMultiplier,
    costOfLivingIndex: sectorMetrics?.economic?.costOfLiving?.value,
    unemploymentRate: sectorMetrics?.economic?.unemploymentRate?.value,
    wageIndexByState,
    automationIndexByState,
    pendingStrikeEvents,
  });
  // Apply operating savings after payroll has been priced at its existing basis.
  const maintenance = maintenanceBeforeSpecialization - operatingSaving;
  // ─── Growth cost (on realized revenue) + regulatory burden ────────────────
  // Pure computation in `sectorTurn/sectorCosts.ts`; names are unchanged.
  const { hourlyGrowthCost, regulatoryBurden } = computeGrowthAndRegulatory({
    corp,
    newGrowthCost,
    preFlipNameplateRevenue,
    hourlyRevenue,
    sectorMarketSharePct,
    nationalDominanceSharePct,
    dominanceShield: techEffects.dominanceShield,
    plantsEnabled,
    plantsRampLambda,
  });

  // ─── P3a: idle / mothball upkeep (plants only) ────────────────────────────
  //
  // Maintenance above is derived from REALIZED revenue, so it scales with
  // utilization: a sector running its plants at 40% pays 40% of the
  // maintenance and idle capacity is free to hold. Under plants that is no
  // longer honest — capacity is a thing you BOUGHT and must keep, and an
  // over-built sector should feel it.
  //
  // Cost basis becomes  utilization + IDLE_UPKEEP_FRACTION × (1 − utilization),
  // implemented as an ADDITIVE charge on the idle units rather than a
  // multiplier on `maintenance`, for two reasons: the multiplier form divides
  // by utilization (undefined at 0, which is exactly the mothballed case), and
  // the additive form prices idle units at nominal mix prices instead of
  // inheriting the sales legs — an idle plant's upkeep does not fall because
  // the market price of its output fell.
  //
  //   unitUpkeep = (mixPrice / TURNS_PER_DAY) × (1 − margin)   [per unit, hourly]
  //
  // FLIP IDENTITY: the flip turn seeds capacity at 1.1 × implied units, so
  // utilization is ≈0.909 and this charge would be ≈2.7% of maintenance on flip
  // day — a visible profit step on a tier whose promise is that the flip
  // changes nothing. It is therefore faded in over the SAME governor ramp every
  // other plants leg uses, anchored on `plantsStartTurn`: λ = 0 on the flip turn
  // (exact no-op, existing flip-identity tests stay green) rising to 1 over
  // `governorRampTurns`. DEVIATION from the plan's "fold it into the governor
  // baseline": folding a cost into a REVENUE governor would have made the
  // governor's revenue clamp mean two different things at once; ramping the
  // charge itself is the same guarantee with one meaning per mechanism.
  //
  // A MOTHBALLED sector is not ramped — mothballing is a deliberate, explicit
  // player action taken after the flip, so there is no continuity to protect.
  //
  // ─── TWO CORRECTIONS (measured on the live sandbox, turn 293) ─────────────
  //
  // 1. THE UNIT PRICE IS ANCHORED, not `(1 − margin_now)`. Pricing a FIXED
  //    site/skeleton-crew cost off the live margin made it GROW as the margin
  //    fell, so the world's most distressed sectors paid the most per idle
  //    unit. Stamped once from the live margin on the sector's first plants
  //    turn (`plantsUpkeepMarginBasisAnchor`) and then held, in exactly the
  //    discipline `otherOpexPerUnitAnchor` uses. The stamping turn is unchanged
  //    by construction — including for a mothballed sector, where the ramp is
  //    deliberately not applied and so would not have hidden a step.
  //
  // 2. THE BASE IS OWNER-IDLE CAPACITY, not `capacity − producedUnits`. All 675
  //    live sectors sat at `throughputFactor === 0.85` exactly, the launch
  //    governor's floor: every plant in the world was input-starved, none was
  //    over-built, and each was already losing that 15% off its top line
  //    (`throughputFactor` is a term in `baselineHourlyRevenue`) before being
  //    billed upkeep on the same 15% again.
  //
  // See `ownerIdleUnits` / `idleUpkeepUnitPrice` for the full rationale.
  const { plantsUpkeepCost, plantsUpkeepMarginBasisLive, plantsUpkeepMarginBasisAnchor } =
    computeIdleUpkeep({
      sector,
      plantsEnabled,
      mothballed,
      effectiveMargin,
      plantsMixPrice,
      plantsCapacity,
      producedUnits,
      plantsRampLambda,
      disasterOutputFactor,
      nationalizationTransition,
      plantsExtractionHardMin,
      throughputFactor,
      labourOutputFactor,
    });

  // ─── P3.5: physical cost decomposition (plants only) ──────────────────────
  // Pure computation in `sectorTurn/sectorCosts.ts`; names are unchanged.
  const {
    plantsPhysicalEnabled,
    plantsPolicyPp,
    plantsPolicyNeutralBasis,
    solvedOtherOpexPerUnit,
    physicalPnl,
    sectorNPV,
    capitalBookAnchor,
  } = decomposePhysicalCosts({
    plantsEnabled,
    embargoLegacyMothball,
    profitMargin: sector.profitMargin,
    totalMarginMod,
    commodityMod,
    surplusMod,
    disasterMarginMod,
    nationalizedMarginPenalty,
    hourlyRevenue,
    maintenance,
    sectorLaborCost,
    plantsUpkeepCost,
    regulatoryBurden,
    hourlyGrowthCost,
    plantsNameplateRevenue,
    effectiveDemand,
    sectorCountryId,
    priceRatioByCommodity: lookups.priceRatioByCommodity,
    reachableInputPriceRatiosByCountry: lookups.reachableInputPriceRatiosByCountry,
    plantsCapacity,
    producedUnits,
    retoolCapacityRatio,
    newPolicyLevel,
    mothballed,
    stateId: sector.stateId,
    landedPremiumByState: lookups.landedPremiumByState,
    storedOtherOpexAnchor,
    healedOtherOpexPerUnitAnchor: healedOpex?.otherOpexPerUnitAnchor,
    otherOpexAnchorMarginBasis: sector.otherOpexAnchorMarginBasis,
    capitalEnabled: market.capitalEnabled,
    prevCapitalBookAnchor: sector.capitalBookAnchor,
    npvBoostMultiplier: sectorNpvBoostMultiplier(currentTurn),
  });
  // (moved to decomposePhysicalCosts: inputs bill + financial legs)
  // (moved to decomposePhysicalCosts: calibration solve + residual)
  // (moved to decomposePhysicalCosts: P&L assembly, profit, NPV, book anchor)

  // Build sector update — include transition advancement if applicable.
  // ── Inventory of unsold storable output (design-realization-legs §6 v1) ────
  // Plants + clearing only: soldFraction is the accrual signal and mixPrice the
  // valuation basis, neither exists below those tiers. The drained revenue and
  // carrying cost ride the sector's normal rails below: revenue into
  // `realizedRevenue` and the result's `hourlyRevenue` (taxed and aggregated
  // like operating income), carry into the result's `costs`.
  const inventoryTurn =
    plantsEnabled && market.clearingEnabled && clearing && plantsMixPrice > 0
      ? advanceSectorInventory({
          inventory: (sector.inventoryUnits ?? {}) as Partial<Record<CommodityType, number>>,
          stockpileEnabled: sector.stockpileUnsold === true,
          producedUnits,
          soldUnits,
          soldFraction: clearing.soldFraction,
          soldByCommodity: clearing.soldByCommodity ?? {},
          supplyRates: (strategyRates.supply ?? {}) as Partial<Record<CommodityType, number>>,
          mixPriceAnchor: plantsMixPrice,
        })
      : null;
  const hourlyInventoryRevenue = inventoryTurn
    ? inventoryTurn.drainedRevenueAnchor / TURNS_PER_DAY
    : 0;
  const hourlyInventoryCarry = inventoryTurn ? inventoryTurn.carryCostAnchor / TURNS_PER_DAY : 0;

  // Canonical freight billing (issue #897, gameConfig gate, default off):
  // last turn's state-scoped shipping money as this sector's own named legs,
  // ₳/turn. Charge rides `costs` and credit rides the returned revenue below;
  // both legs and the flag-off stale-clear behavior live in
  // `resolveSectorFreightBillingLegs`. Off ⇒ both 0 and no fields written.
  const freightBilling = resolveSectorFreightBillingLegs({
    market,
    sector,
    embargoLegacyMothball,
    currentTurn,
    sectorCurrencyCode,
    sectorFxRate,
  });

  // Persist countryId so API endpoints don't need to re-derive it from the state.
  // newRevenue / newGrowthCost are ₳ (computed from anchor inputs); convert
  // back to the sector's HOST-state functional currency for storage (the market
  // it operates in, not the parent corp's home currency). Sectors with no
  // resolvable host currency passthrough in the helper, preserving ₳-on-disk.
  const sectorUpdate: Record<string, unknown> = {
    // Under plants the nameplate stops compounding and is restated from owned
    // capacity instead (see `plantsNameplateRevenue`); `newRevenue` outside it.
    // Realized earnings live in `realizedRevenue` below, in both modes.
    revenue: writeCorpEconomicLocal(plantsNameplateRevenue, sectorCurrencyCode, sectorFxRate),
    // Realized (post-realization-leg) revenue on the same DAILY basis + home
    // currency as `revenue` (#3001/#3002). `hourlyRevenue` is nameplate × every
    // realization leg (production policy, capacity haircut, clearing/soldFraction,
    // throughput, capital, strike, total-embargo); scale it back to daily to
    // match `revenue`. Persisting it exactly, per-sector, every turn lets the
    // corp Financials query drop the blended-ratio approximation that smeared one
    // corp-wide ratio across heterogeneous sectors (a $0 embargoed sector now
    // reads $0, not corp-average). Never read back into the economy.
    realizedRevenue: writeCorpEconomicLocal(
      (hourlyRevenue + hourlyInventoryRevenue) * TURNS_PER_DAY,
      sectorCurrencyCode,
      sectorFxRate
    ),
    // P1 units telemetry (buildable sectors): the units-denominated twin of
    // `realizedRevenue`, on the same DAILY basis but currency-free. Produced =
    // nameplate output units × the production-side legs; sold = produced ×
    // soldFraction when the clearing pre-pass ran. See computeSectorOutputUnits
    // for the exact identity. Display/analytics only — never read back into the
    // economy.
    producedUnits: Math.round(producedUnits * 100) / 100,
    soldUnits: Math.round(soldUnits * 100) / 100,
    // Ceiling the supply-agreement damages leg clamps a contracted volume to,
    // so a supplier is never billed for output it could not physically have
    // made. See the derivation beside `contractAchievableUnits` above.
    contractAchievableUnits: Math.round(contractAchievableUnits * 100) / 100,
    // Demand-aware production telemetry. This is display-only: it records the
    // deliberate run-rate cap so the sector page can distinguish market demand
    // from physical input shortages and the residual "other" bucket.
    demandThrottleFactor: plantsEnabled ? Math.round(demandThrottleFactor * 1000) / 1000 : null,
    currentGrowthRate: newCurrentGrowthRate,
    // Persisted so the brake is durable: without this the next turn's trend
    // simply pulls the rate straight back toward the old, unaffordable target.
    targetGrowthRate: brakedTargetRate,
    currentGrowthCost: writeCorpEconomicLocal(newGrowthCost, sectorCurrencyCode, sectorFxRate),
    workers: computedWorkers,
    workersDesired: desiredWorkers,
    labourStaffingFactor: staffingFactor,
    productionPolicyLevel: newPolicyLevel,
    negativeProductionSustainedTurns: newNegativeProductionTurns,
    countryId: sectorCountryId,
    // Surfaced to the corporation UI/API so a $0 sector reads as "suspended
    // by embargo" rather than looking like a bug.
    embargoSuspended: embargoSuppressed,
    // Under the trade-exposure model, the export-exposed revenue share the
    // embargo stripped this turn (0 under legacy mothball / when unembargoed).
    // Lets the UI show "trade-restricted — N% of output was exported".
    embargoExportExposure: embargoTradeExposureActive ? embargoExportExposure : 0,
    updatedAt: now,
  };
  // Persist extraction capacity utilization + binding resource for display and
  // for next turn's ramp anchor / notification edge detection. Only written for
  // extraction sectors.
  if (sector.sectorType === "extraction") {
    sectorUpdate.capacityUtilization = Math.round(capacityUtil.utilization * 1000) / 1000;
    sectorUpdate.capacityBindingResource = capacityUtil.bindingResource ?? null;
    sectorUpdate.capacityHaircutStartTurn = capacityHaircutStartTurn ?? null;
  }
  // Price-realization telemetry: persisted for sector-detail display only,
  // never read back into the economy. Only written when the mode is on.
  if (market.realizationEnabled && !market.clearingEnabled) {
    // Under clearing the realization term lives inside clearingFactor —
    // writing both would double-report the price leg.
    sectorUpdate.priceRealization = Math.round(priceRealization * 1000) / 1000;
  }
  // Capital state + telemetry: stock persists (it IS the state), the
  // gating factor is display-only.
  if (market.capitalEnabled) {
    // Under plants, `capitalStock` holds the authoritative plant capacity and
    // `capitalUtilization` reports how hard those plants ran (produced ÷
    // capacity, i.e. the production legs) rather than a capacity haircut.
    // Plants capacity is persisted RAW — it is authoritative state, and rounding
    // it breaks the invertibility of the retool unit conversion. Capital mode's
    // derived stock keeps its 2dp rounding exactly as before.
    sectorUpdate.capitalStock = plantsEnabled
      ? plantsOwnedCapacity
      : Math.round(newCapitalStock * 100) / 100;
    sectorUpdate.capitalUtilization =
      Math.round(
        (plantsEnabled
          ? plantsCapacity > 0
            ? producedUnits / plantsCapacity
            : 0
          : capitalFactor) * 1000
      ) / 1000;
    sectorUpdate.capitalBookAnchor = Math.round(capitalBookAnchor);
    // P5 paid basis. Plants only: below plants there is no build path, so there
    // is no discount wedge between what capacity costs and what it books at,
    // and stamping the field would only give the exit paths a number to drift
    // from. Written RAW for the same reason `capitalStock` is — the two are a
    // ratio (per-unit basis) that has to survive round-tripping.
    if (plantsEnabled) {
      sectorUpdate.operatingCapacityUnits = plantsCapacity;
      sectorUpdate.operatingCapacityTurn = currentTurn;
      sectorUpdate.capacityBookAnchor = capacityBookAnchor;
      sectorUpdate.plantCount = plantLedger?.plantCount ?? 0;
      sectorUpdate.plantUnitRemainder = plantLedger?.plantUnitRemainder ?? 0;
    }
  }
  // Plants ramp anchor (stamped once, on the flip turn).
  if (plantsEnabled) {
    sectorUpdate.plantsStartTurn = plantsStartTurn ?? null;
    // Stamp the idle-upkeep margin basis ONCE, from the live margin, and then
    // hold it — the anti-spiral half of the upkeep fix above. Written on the
    // first plants turn the sector runs, so the value stamped IS the value the
    // old `(1 − margin_now)` expression would have used that turn: the stamping
    // turn is unchanged, and only later turns stop tracking a falling margin.
    if (plantsUpkeepMarginBasisAnchor == null) {
      sectorUpdate.plantsUpkeepMarginBasisAnchor = plantsUpkeepMarginBasisLive;
    }
    // P3a/C4: `buildQueue` and `constructionInProgressAnchor` are deliberately
    // NOT in this `$set`. They are written as a `$pull`/`$inc` delta on the
    // bulkWrite op below — see the C4 note at `cipAnchorDelta`.
    // Keep an independent capital-mode counterfactual so a plants rollback
    // restores the old compounding series instead of a plants-derived value.
    Object.assign(
      sectorUpdate,
      legacyRevenueShadowTelemetry({
        sector,
        isFlipTurn,
        preFlipNameplateRevenue,
        brakedTargetRate,
        newCurrentGrowthRate,
        embargoLegacyMothball,
        sectorCurrencyCode,
        sectorFxRate,
      })
    );
    // Legacy growth fields are vestigial under plants: capacity is the only
    // thing that moves output, and the flip credit above compensates any
    // in-flight paid ramp. Zeroing the target lets `currentGrowthRate` trend to
    // 0 over the following turns (no cliff — this turn's growth cost is still
    // charged in full, so the flip turn itself is unchanged).
    // The policy computation above is NOT dead, only its revenue leg: the
    // trended rate still bills the decaying `hourlyGrowthCost` through the
    // physical PnL, seeds next turn's trend, and seeds `legacyRevenueShadow`
    // on the flip turn. Do not "clean up" the compute-then-zero into a skip
    // without rehoming all three.
    sectorUpdate.targetGrowthRate = 0;
    sectorUpdate.currentGrowthCost = 0;
    // NOT written back: `mothballed` is derived here purely from the stored
    // field, so echoing it is a no-op that can only do harm — the turn
    // processor's snapshot is taken at turn start, so a player who mothballs
    // while the turn is running would have the toggle silently reverted. The
    // flag is owned by the build command alone.
  }
  Object.assign(
    sectorUpdate,
    marketTelemetry({
      clearingEnabled: market.clearingEnabled,
      clearing,
      clearingFactor,
      clearingStartTurn,
      mothballed,
      sector,
      inventoryTurn: inventoryTurn ?? undefined,
    })
  );
  // Throughput telemetry + ramp anchor (display + next turn's fade-in).
  if (market.throughputEnabled) {
    sectorUpdate.throughputFactor = Math.round(throughputFactor * 1000) / 1000;
    sectorUpdate.throughputBindingInput = throughputRaw.bindingInput ?? null;
    sectorUpdate.throughputStartTurn = throughputStartTurn ?? null;
  }
  // Freight seam telemetry (t225): the share of output that was wanted and
  // still could not be delivered, sat next to `soldFraction` above, which
  // measures the opposite thing. A glut is NOT in this number: it is attributed
  // in the sourcing pass against residual unmet demand, because the sector
  // surface reads it as "buyers still wanted it" and tells the player to fix
  // freight rather than cut output.
  // Only settlement worlds populate the map, so a world with settlement off
  // writes nothing new, except to clear a value it wrote while settlement was
  // on, which would otherwise sit stale on the sector forever.
  const deliveryLimited = market.deliveryLimitedBySectorId?.get(sector._id.toString());
  if (deliveryLimited != null || typeof sector.deliveryLimitedFraction === "number") {
    sectorUpdate.deliveryLimitedFraction = Math.round((deliveryLimited ?? 0) * 1000) / 1000;
    sectorUpdate.deliveryLimitedFreightClass =
      deliveryLimited != null && deliveryLimited > 0
        ? (market.deliveryLimitedClassBySectorId?.get(sector._id.toString()) ?? null)
        : null;
  }
  // Canonical freight billing: persist both legs as named daily lines (or
  // clear stale ones); see `resolveSectorFreightBillingLegs`.
  Object.assign(sectorUpdate, freightBilling.sectorUpdate);
  // Labour telemetry: persist the per-turn labor cost on a daily basis (like
  // `revenue`), in the sector's host-state currency. Display/analytics only;
  // never read back into the economy. Only written when the labour system is on.
  if (labour.wagesEnabled) {
    // Per-turn labor cost (daily basis, host currency) — display/analytics
    // only, never read back into the economy.
    sectorUpdate.laborCost = writeCorpEconomicLocal(
      sectorLaborCost * TURNS_PER_DAY,
      sectorCurrencyCode,
      sectorFxRate
    );
  }
  // Persist the physical P&L the turn actually booked (ticket 1122). Display
  // and decision telemetry, on the same daily basis and in the same currency as
  // `revenue` / `laborCost`. NPP behavior reads it on the following turn, but
  // it never feeds physical settlement back into itself.
  //
  // Read surfaces used to rebuild these numbers by inverting
  // `effectiveProfitMargin`, which is this P&L's OUTPUT and is capped at 100.
  // At the cap the inversion recovers a zero operating cost from a genuinely
  // NEGATIVE one and reports profit == revenue, and it drops upkeep and
  // compliance in every case because they sit outside the margin's scope.
  // Writing the lines is the only way a reader can have the real ones.
  if (physicalPnl) {
    const daily = (anchorPerTurn: number) =>
      writeCorpEconomicLocal(anchorPerTurn * TURNS_PER_DAY, sectorCurrencyCode, sectorFxRate);
    sectorUpdate.plantsPnl = {
      // Inventory sell-down earns beside operating revenue and its carry lands
      // in costs (see the `costs` leg of this function's return), so both are
      // in the revenue and profit reported here. That makes `revenue` equal
      // `realizedRevenue` exactly and `profit` the figure the corp booked.
      revenue: daily(hourlyRevenue + hourlyInventoryRevenue),
      inventoryRevenue: daily(hourlyInventoryRevenue),
      inventoryCarry: daily(hourlyInventoryCarry),
      inputs: daily(physicalPnl.inputsCost),
      labour: daily(physicalPnl.laborCost),
      upkeep: daily(physicalPnl.upkeep),
      compliance: daily(physicalPnl.complianceCost),
      otherOpex: daily(physicalPnl.otherOpex),
      otherOpexCreditCapped: physicalPnl.otherOpexCreditCapped,
      otherOpexUncapped: daily(physicalPnl.otherOpexUncapped),
      financialLegs: daily(physicalPnl.financialLegs),
      policyCredit: daily(physicalPnl.policyCredit),
      policyPp: Math.round(plantsPolicyPp * 100) / 100,
      operatingCost: daily(physicalPnl.operatingCost),
      totalCost: daily(physicalPnl.totalCost + hourlyInventoryCarry),
      profit: daily(physicalPnl.profit + hourlyInventoryRevenue - hourlyInventoryCarry),
      turn: currentTurn,
    };
  }
  // Persist effective margin for display and NPP profitability decisions.
  // Below plants it is the modifier stack; under plants it is derived from the
  // physical P&L. Public-enterprise remittance recomputes its own value.
  // A sector with NO revenue this turn (mothballed, fully embargoed) has no
  // ratio to derive from — profit ÷ 0 is not "0% margin", it is undefined. Such
  // a sector keeps reporting the modifier stack, which is what its margin WOULD
  // be if it ran, and is what the P3a mothball-upkeep pricing already reads.
  const reportedEffectiveMargin =
    physicalPnl && hourlyRevenue > 0 ? physicalPnl.derivedMarginPct : effectiveMargin;
  sectorUpdate.effectiveProfitMargin = Math.round(reportedEffectiveMargin * 100) / 100;
  // P3.5: stamp the solved calibration residual and the margin basis it was
  // solved at. Written once, on the sector's first producing physical-P&L turn,
  // and never rewritten — the anchor is the thing that is HELD while the
  // physical lines move. (Era-indexing it is a later wave; the field is the
  // hook.)
  if (solvedOtherOpexPerUnit != null) {
    sectorUpdate.otherOpexPerUnitAnchor = solvedOtherOpexPerUnit;
    sectorUpdate.otherOpexAnchorMarginBasis = plantsPolicyNeutralBasis;
  } else if (healedOpex?.otherOpexPerUnitAnchor != null) {
    // Persist the rebasing this turn's P&L already used. Skip when this is
    // also the first calibration (branch above): that sector had no leftover
    // residual to rebase.
    sectorUpdate.otherOpexPerUnitAnchor = healedOpex.otherOpexPerUnitAnchor;
  }
  if (healedOpex) {
    sectorUpdate.retoolRescaleApplied = true;
  }

  // v3 Phase 5: persist the trended unionization level. Only written when
  // unions are enabled, so it's inert (and absent → 0 fallback elsewhere) otherwise.
  if (newUnionization !== undefined) {
    sectorUpdate.unionization = newUnionization;
  }
  // Per-worker daily pay: union dues and services are priced as a share of it,
  // and nothing wrote it before, so every union's average annual wage was 0
  // (dues ceiling 0, no dues approval penalty, free services). Written whenever
  // the wage leg ran and the sector has a headcount.
  if (wagePerWorker !== undefined) {
    sectorUpdate.wagePerWorker = wagePerWorker;
  }
  // v3 Phase 6: persist the worker-expectation trend + strike state. Only
  // written when the strike computation actually ran above (requires both
  // wagesEnabled and unionsEnabled - see the labour output factor near
  // hourlyRevenue for why unionsEnabled alone does not imply that).
  // Explicit `null` clears strikeStartedAtTurn/strikeCooldownUntilTurn on
  // resolution — matches the transitionFromStrategyId = null precedent
  // below (Mongo $set with a literal null sets BSON null, not unset).
  if (newWorkerExpectationIndex !== undefined) {
    sectorUpdate.workerExpectationIndex = newWorkerExpectationIndex;
    sectorUpdate.strikeStartedAtTurn = newStrikeStartedAtTurn ?? null;
    sectorUpdate.strikeCooldownUntilTurn = newStrikeCooldownUntilTurn ?? null;
  }
  // Advance strategy transition: if transition complete, finalize it
  // Clear both transition fields AND the cooldown timer.
  // Also clear isReversing if a reversal just finished.
  if (sector.transitionFromStrategyId && sector.transitionStartTurn != null && turn != null) {
    const elapsed = turn - sector.transitionStartTurn;
    if (elapsed >= STRATEGY_TRANSITION_TURNS) {
      sectorUpdate.transitionFromStrategyId = null;
      sectorUpdate.transitionStartTurn = null;
      sectorUpdate.transitionCooldownUntilTurn = null;
      if (sector.isReversing) {
        sectorUpdate.isReversing = false;
      }
    }
  }

  // C4: the queue delta rides along with the `$set` — a `$pull` of the orders
  // that landed and an `$inc` of the CIP they were holding. Paths are disjoint
  // from `sectorUpdate` (which no longer carries `buildQueue` /
  // `constructionInProgressAnchor`), so Mongo accepts the combined update.
  const sectorUpdateDoc: SectorUpdateOp["updateOne"]["update"] = { $set: sectorUpdate };
  if (plantsEnabled) {
    // A smooth order releases CIP every turn it delivers, not only on the turn
    // it fully lands, so the `$inc` is gated on the delta, not on a full
    // landing. The `$pull` still only fires when an order actually came due.
    if (landedOrderCount > 0) {
      sectorUpdateDoc.$pull = { buildQueue: { onlineTurn: { $lte: currentTurn } } };
    }
    if (cipAnchorDelta !== 0) {
      sectorUpdateDoc.$inc = { constructionInProgressAnchor: -cipAnchorDelta };
    }
  }
  sectorOps.push({
    updateOne: {
      filter: { _id: sector._id },
      update: sectorUpdateDoc,
    },
  });
  // Flip-turn growth credit: a separate op, because `$push` cannot share the
  // `buildQueue` path with the `$pull` above. bulkWrite is ordered by default,
  // so this always lands after the pull. `$push` is additive, so it cannot
  // clobber a concurrently placed order either.
  if (plantsEnabled && flipGrowthCreditOrder) {
    sectorOps.push({
      updateOne: {
        filter: { _id: sector._id },
        update: {
          $push: { buildQueue: flipGrowthCreditOrder },
          // The credit order is free (costPaidAnchor 0), so CIP is unchanged.
          $set: { updatedAt: now },
        },
      },
    });
  }

  return {
    // Inventory sell-down earns beside operating revenue and rides the same
    // aggregation/tax rails; carry cost lands in `costs` below. The freight
    // billing credit (canonical freight billing, flag-gated, 0 otherwise) is
    // haulage income and rides the same rails.
    hourlyRevenue: hourlyRevenue + hourlyInventoryRevenue + freightBilling.credit,
    newCurrentGrowthRate,
    // P3.5: under plants this is the DERIVED margin (profit ÷ revenue), not the
    // modifier stack — see `reportedEffectiveMargin`.
    effectiveMargin: reportedEffectiveMargin,
    // Include regulatoryBurden so it flows to corpLevelCosts (apportioned by
    // revenue share for tax) AND to incomePreDividends → earningsHistory →
    // the share-price formula's earningsPower component. Without this, the
    // burden would only hit sectorNPV and would be silently absorbed by
    // corp-level income.
    // Legacy-mothballed (embargoed foreign) sectors carry no operating cost —
    // the corp neither earns nor bleeds while dormant. Under the trade-exposure
    // model the sector still operates, so maintenance (which already scaled down
    // with the reduced hourlyRevenue) and growth/regulatory costs still apply.
    costs: embargoLegacyMothball
      ? 0
      : (physicalPnl?.totalCost ??
          maintenance + plantsUpkeepCost + hourlyGrowthCost + regulatoryBurden) +
        hourlyInventoryCarry +
        // Canonical freight billing: the shipping bill is a real cost leg
        // (flag-gated, 0 otherwise), the buyer half of the haul transfer.
        freightBilling.charge,
    /** P3a: idle-capacity (or mothball) upkeep charged this turn, ₳/turn. */
    plantsUpkeepCost,
    /** P3a: ₳ of paid-but-not-yet-delivered build orders after this turn. */
    constructionInProgressAnchor,
    npvContribution: market.capitalEnabled ? Math.round(capitalBookAnchor) : sectorNPV,
    // P3.5: under plants these two modifiers no longer drive cost (input costs
    // are billed physically, surplus is priced on the revenue side). Reporting
    // them as 0 keeps the corp margin diagnostic honest about what actually
    // moved the sector — a non-zero readout for a dead channel is worse than
    // no readout.
    commodityMod: plantsPhysicalEnabled ? 0 : commodityMod,
    surplusMod: plantsPhysicalEnabled ? 0 : surplusMod,
    exportPremiumMod,
    macroMod: inflationMod + debtToGdpMod + deficitMod,
    stateMetricsCappedTotal: stateMetricMargin.cappedTotal,
    stateMetricsLegacyTotal: stateMetricMargin.legacyTotal,
    hourlyGrowthCost,
    // O1c: paid growth cost this turn (0 only under legacy mothball — froze, paid
    // nothing; the trade-exposure model keeps investing on the domestic remainder).
    growthInvestmentAnchor: embargoLegacyMothball ? 0 : hourlyGrowthCost,
    stateId: sector.stateId,
    countryId: sectorCountryId,
  };
}
