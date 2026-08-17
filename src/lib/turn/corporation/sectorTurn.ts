import type { Corporation, CorporateSector, SectorBuildOrder } from "@/lib/db/types";
import { freshMilitaryDiversion } from "@/lib/military/arsenal";
import {
  CAPACITY_ANCHOR_YEAR,
  CAPACITY_BUILD_TURNS,
  IDLE_UPKEEP_FRACTION,
  MOTHBALL_UPKEEP_FRACTION,
  capacityPricePerUnit,
  techOutputUnitsMultiplier,
  unitYieldForSupply,
} from "@/lib/constants/capacityEconomy";
import type { CurrencyCode } from "@/lib/constants/currencies";
import {
  getForeignTariffMarginModifier,
  getDomesticTariffMalus,
  getTariffBlendWeights,
} from "@/lib/tariffs/tariffEffects";
import { getSubsidyMarginModifier } from "@/lib/subsidies/subsidyEffects";
import { politicalSoeInputs } from "@/lib/politicalLegislation/marginAdapter";
import { computeExportPremium, computeExportExposure } from "@/lib/trade/exportPremium";
import { TRADE_EMBARGO_EXPORT_LOSS_SHARE } from "@/lib/trade/constants";
import type { CommodityType, ExtractableResource } from "@/lib/constants/commodities";
import {
  capacityHaircutFactor,
  CAPACITY_BINDING_THRESHOLD,
  EXTRACTION_CAPACITY_HAIRCUT_FLOOR,
} from "@/lib/extraction/capacityHaircut";
import { computePriceRealization } from "@/lib/market/priceRealization";
import { computeThroughput } from "@/lib/market/throughput";
import {
  MARKET_REALIZATION_DEVIATION_CAP,
  advanceCapitalBookAnchor,
  advanceCapitalStock,
  capitalUtilizationFactor,
  impliedOutputUnits,
  seedCapitalStock,
  softenedMarketRealization,
  softenedMarketRealizationAmount,
} from "@/lib/market/capital";
import { COMMODITY_BASE_PRICES } from "@/lib/constants/commodities";
import {
  trendProductionPolicy,
  getRevenueMultiplier,
  getOutputMultiplier,
  getInputMultiplier,
} from "@/lib/utils/productionPolicy";
import {
  assemblePhysicalPnl,
  computeFinancialLegs,
  computeInputsCost,
  idleUpkeepUnitPrice,
  otherOpexDriftFactor,
  ownerIdleUnits,
  solveOtherOpexPerUnit,
} from "@/lib/corporations/physicalPnl";
import { healAutoRetoolOpexAnchor } from "@/lib/corporations/retoolRescale";
import { trendGrowthRate } from "@/lib/utils/sectorGrowth";
import {
  calculateDailyGrowthCost,
  GROWTH_RATE_TURNS_PER_YEAR,
  TURNS_PER_DAY,
  NPV_ANNUAL_DISCOUNT_RATE,
  getHomeLocationMarginBonus,
  getStateSectorSpecializationMarginBonus,
  getSectorTypeMatchModifier,
  getSprawlModifier,
  getDominanceMarginPenalty,
  getDominanceRegulatoryBurden,
  getDominanceGrowthCostMultiplier,
  getNationalDominanceMarginPenalty,
  getNationalDominanceRegulatoryBurden,
  getNationalDominanceGrowthCostMultiplier,
  softCapEffectiveMargin,
  getSustainedNegativeProductionPenalty,
  nextNegativeProductionCounter,
  calculateWorkers,
  TYPE_SWITCH_MARGIN_PENALTY,
  TYPE_SWITCH_PENALTY_TURNS,
} from "@/lib/constants/corporations";
import type { CorporationType } from "@/lib/constants/corporations";
import { TURNS_PER_YEAR } from "@/lib/constants/turnTime";
import { computeBlendedMarginModifiers } from "@/lib/constants/commodities";
import { readCorpEconomicAnchor, writeCorpEconomicLocal } from "@/lib/currency/corpEconomyFields";
import { computeSoeEfficiencyPenalty } from "@/lib/nationalization/soeEfficiency";
import { isStateOwned } from "@/lib/nationalization/nationalCorporation";
import { sociMultiplier } from "@/lib/nationalization/concentration";
import { resolveSectorMandate } from "@/lib/nationalization/soeMandates";
import { nationalizationProductivityFactor } from "@/lib/nationalization/transitionShock";
import { corpAlignmentModifier } from "@/lib/economicModels/effects";
import { getExpropriationRiskMarginModifier } from "@/lib/constants/corporations";
import { commodityProductionCapacityScale } from "@/lib/banking/capacityAllocation";
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
  STRATEGY_TRANSITION_MARGIN_PENALTY,
} from "@/lib/constants/sectorStrategies";
import type { SectorUpdateOp } from "./types";
import { applyExtractionResourceCapacityToSupply } from "@/lib/corporations/extractionResourceSupply";
import { computeStateMetricMarginModifier } from "@/lib/corporations/sectorMetricMarginProfiles";
import {
  costReleasedThisTurn,
  queueUndeliveredCost,
  unitsDeliveredThisTurn,
} from "@/lib/corporations/buildDelivery";
import {
  computeDisasterPenaltySplit,
  disasterProductionFactor,
} from "@/lib/crises/disasterMarginPenalty";
import { resolveSectorGrowthPolicy } from "./sectorGrowthPolicy";
import { resolveSectorLabourEconomics, resolveSectorLabourProductionEffects } from "./sectorLabour";
import { computeSectorOutputUnits } from "./sectorOutputUnits";
import type { SectorTurnEnv, SectorTurnResult } from "./sectorTurnTypes";

export { computeSectorOutputUnits } from "./sectorOutputUnits";
export type { SectorTurnEnv, SectorTurnResult } from "./sectorTurnTypes";

/** Shared empty export-intensity map for countries with no exports this turn. */
const EMPTY_EXPORT_INTENSITY: ReadonlyMap<CommodityType, number> = new Map();

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
  const { outputFactor: labourOutputFactor, strikeMarginModifier } =
    resolveSectorLabourProductionEffects(labour, sector);
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
  // Extraction capacity haircut: a sector that can only extract a fraction of
  // its revenue-based output realizes only that fraction of resource revenue.
  // Ramped in over EXTRACTION_CAPACITY_HAIRCUT_TURNS from the sector's first
  // exposure so it doesn't insta-bankrupt miners (audit t786). Applied to
  // realized output (hourlyRevenue), NOT the stored revenue base — mirrors the
  // nationalization transition so the growth trajectory stays clean.
  const capacityUtil =
    sector.sectorType === "extraction"
      ? (lookups.extractionCapacityUtilBySector.get(sector._id.toString()) ?? {
          utilization: 1,
          bindingResource: null,
        })
      : { utilization: 1, bindingResource: null as ExtractableResource | null };
  // Stamp the ramp start the first time an extraction sector is under-utilized.
  const capacityHaircutStartTurn =
    sector.sectorType === "extraction" && capacityUtil.utilization < 1
      ? (sector.capacityHaircutStartTurn ?? currentTurn)
      : sector.capacityHaircutStartTurn;
  const capacityHaircut = capacityHaircutFactor(
    capacityUtil.utilization,
    capacityHaircutStartTurn,
    currentTurn,
    EXTRACTION_CAPACITY_HAIRCUT_FLOOR
  );
  // Business Acumen no longer scales revenue — it now lowers growth cost and
  // softens high interest rates (see calculateDailyGrowthCost above).
  // Price realization (marketSystemMode >= "realization", audit t806 Fix 1):
  // realized revenue is scaled by the lagged market price of the sector's
  // output mix, so shortages finally reward producers and gluts bleed them.
  // Weighted by pre-clamp strategy supply rates (the mix the sector sells),
  // lagged one turn via lookups.priceRatioByCommodity, damped + clamped in
  // computePriceRealization. Exactly 1 when the mode is off.
  // Clearing (marketSystemMode >= "clearing", Fix 2): the pre-pass factor
  // (soldFraction × (1+posture) × price leg) SUBSUMES plain realization —
  // when clearing is on it replaces the Tier-1 multiplier, ramped in per
  // sector so posture/volume shocks fade in like every other constraint.
  const clearing = market.clearingEnabled
    ? market.clearingBySectorId?.get(sector._id.toString())
    : undefined;
  const clearingStartTurn =
    market.clearingEnabled && clearing && clearing.factor < 1
      ? (sector.clearingStartTurn ?? currentTurn)
      : sector.clearingStartTurn;
  // Ramp only softens sub-1 factors (capacityHaircutFactor returns 1 for
  // factor >= 1); premium upside applies immediately — upside needs no
  // bankruptcy protection.
  const clearingFactor = clearing
    ? clearing.factor >= 1
      ? clearing.factor
      : capacityHaircutFactor(clearing.factor, clearingStartTurn, currentTurn)
    : 1;
  const priceRealization =
    market.realizationEnabled && !market.clearingEnabled
      ? computePriceRealization(strategyRates.supply, lookups.priceRatioByCommodity)
      : 1;
  // Throughput coupling (marketSystemMode >= "clearing", audit t806 D1):
  // realized output is throttled by the scarcest available input (Leontief),
  // using lagged local delivery availability when freight settlement is active
  // and lagged global balances otherwise. A throttled sector therefore cannot
  // deepen the shortage that throttled it within the same turn. Ramped in per
  // sector over the same 240-turn window as the capacity haircut.
  const throughputRaw = market.throughputEnabled
    ? computeThroughput(
        strategyRates.demand,
        wideCommodityBalances,
        lookups.stateInputAvailabilityByState.get(sector.stateId)
      )
    : { throughput: 1, bindingInput: null };
  const throughputStartTurn =
    market.throughputEnabled && throughputRaw.throughput < 1
      ? (sector.throughputStartTurn ?? currentTurn)
      : sector.throughputStartTurn;
  // capacityHaircutFactor already ramps throughput in from 1 (flip = no-op).
  // The launch-safety governor adds only the downside floor: an input-starved
  // sector's revenue can't be cut more than `cap` below the ledger baseline
  // (throughput's baseline is 1 — ledger has no input gate). No second ramp.
  const throughputRamped = capacityHaircutFactor(
    throughputRaw.throughput,
    throughputStartTurn,
    currentTurn
  );
  const governorCap = market.governorCap ?? MARKET_REALIZATION_DEVIATION_CAP;
  const throughputFactor = market.throughputEnabled
    ? Math.max(throughputRamped, 1 - governorCap)
    : throughputRamped;
  // Capital tier (marketSystemMode >= "capital", Fix 4 v1): capacity is
  // seeded with headroom at first exposure (mode flip = no-op), advances
  // with the growth slider minus depreciation, and gates realized output
  // like geological capacity gates extraction. No ramp needed — the seed
  // headroom IS the grace period; only sustained non-investment bites.
  // Nameplate output units of the sector's (pre-realization) revenue base, on
  // the same DAILY basis as `newRevenue`. Computed unconditionally because the
  // P1 units telemetry below reports it in every mode; the capital tier still
  // only gates on it when capital mode is on (0 otherwise, as before).
  // `preFlipNameplateRevenue === newRevenue` in every mode below "plants", so
  // this whole block is byte-identical outside plants; under plants it computes
  // the pre-flip baseline the governor anchors on, and the authoritative plants
  // capacity is derived from it just below.
  const nameplateUnits = impliedOutputUnits(
    preFlipNameplateRevenue,
    strategyRates.supply ?? {},
    COMMODITY_BASE_PRICES,
    lookups.eraUnitScale
  );
  const impliedUnits = market.capitalEnabled ? nameplateUnits : 0;
  const newCapitalStock = market.capitalEnabled
    ? advanceCapitalStock({
        prevStock:
          typeof sector.capitalStock === "number"
            ? sector.capitalStock
            : seedCapitalStock(
                preFlipNameplateRevenue,
                strategyRates.supply ?? {},
                COMMODITY_BASE_PRICES,
                lookups.eraUnitScale
              ),
        currentGrowthRate: perTurnGrowthRate,
      })
    : 0;
  const capitalFactor = market.capitalEnabled
    ? capitalUtilizationFactor(newCapitalStock, impliedUnits)
    : 1;
  // Plants tier: capacity is AUTHORITATIVE, not a haircut.
  //
  // Lazy per-sector flip migration — the first plants turn adopts
  //   capacity := max(existing capitalStock, impliedOutputUnits(nameplate))
  // so a sector arriving from capital mode keeps the capital it built, and one
  // that never ran under capital starts at exactly the units its revenue base
  // implied (which is what makes the derived-revenue identity below exact for
  // it). Capacity then only DEPRECIATES this phase — the growth slider no
  // longer builds it; build orders arrive in P3.
  const storedCapacity =
    typeof sector.capitalStock === "number" && sector.capitalStock > 0 ? sector.capitalStock : 0;
  // ─── P3a: build queue ─────────────────────────────────────────────────────
  // Orders whose `onlineTurn` has arrived convert into capacity and leave the
  // queue; the rest stay outstanding and keep their paid cost in CIP (D10).
  const isFlipTurn = plantsEnabled && sector.plantsStartTurn == null;
  const existingQueue: SectorBuildOrder[] = Array.isArray(sector.buildQueue)
    ? sector.buildQueue.filter(
        (o) =>
          o != null && Number.isFinite(o.unitsOrdered) && o.unitsOrdered > 0 && o.onlineTurn != null
      )
    : [];
  // Capacity converting into `capitalStock` THIS turn. A legacy order delivers
  // its whole `unitsOrdered` the turn it comes due; a `smooth` order delivers
  // only this turn's slice, so a large build ramps in instead of landing as one
  // lump (see buildDelivery.ts). Both are summed here identically.
  const landedBuildUnits = plantsEnabled
    ? existingQueue.reduce((sum, o) => sum + unitsDeliveredThisTurn(o, currentTurn), 0)
    : 0;
  // P5: the CASH those landing orders consumed. It leaves CIP this turn (the
  // orders leave the queue), so it has to arrive somewhere or the sector's paid
  // basis silently drops to zero the moment its plant comes online. It arrives
  // in `capacityBookAnchor` — see the book-basis block below.
  const landedBuildCostAnchor = plantsEnabled
    ? existingQueue.reduce((sum, o) => sum + costReleasedThisTurn(o, currentTurn), 0)
    : 0;
  const outstandingOrders = plantsEnabled
    ? existingQueue.filter((o) => o.onlineTurn > currentTurn)
    : existingQueue;
  // Growth-ramp flip conversion: a sector that was mid-ramp when plants landed
  // had been PAYING for capacity the legacy growth path would have delivered
  // continuously. Plants stops delivering it (capacity no longer grows off the
  // slider), so without compensation that spend is simply confiscated. Convert
  // the accrued daily growth spend into capacity at the standing build price
  // and deliver it as a FREE queue order (costPaidAnchor 0 — the corp already
  // paid, and it must not be refundable via cancel), at half the normal build
  // time since the legacy build was already partly under way.
  const growthCostAnchorForFlip = readCorpEconomicAnchor(
    Number.isFinite(sector.currentGrowthCost) ? (sector.currentGrowthCost ?? 0) : 0,
    sectorCurrencyCode,
    sectorFxRate
  );
  // `currentYear` is always supplied by the live turn; fall back to the
  // calibration anchor year (era index 1.0) rather than to the modern row, so a
  // year-less test/simulation harness prices the conversion at the anchor
  // instead of silently handing out 5× fewer units.
  const capacityUnitPriceAnchor = capacityPricePerUnit(
    sector.sectorType,
    currentYear ?? CAPACITY_ANCHOR_YEAR,
    lookups.eraUnitScale
  );
  // C10: the credit keys on the ACCRUED COST, not on the target slider.
  // `currentGrowthCost` is what the sector is being billed THIS turn;
  // `targetGrowthRate` is where the owner has pointed the slider NEXT. A player
  // who winds the slider back to 0 still pays a decaying `currentGrowthRate`
  // for several turns, so gating on the target confiscated exactly the spend of
  // the players who had already stopped growing. If cost was charged, capacity
  // is owed.
  const flipGrowthCreditOrder: SectorBuildOrder | null =
    isFlipTurn && growthCostAnchorForFlip > 0 && capacityUnitPriceAnchor > 0
      ? {
          unitsOrdered: growthCostAnchorForFlip / capacityUnitPriceAnchor,
          costPaidAnchor: 0,
          startTurn: currentTurn,
          onlineTurn: currentTurn + Math.ceil(CAPACITY_BUILD_TURNS(sector.sectorType) / 2),
          smooth: true,
        }
      : null;
  const nextBuildQueue: SectorBuildOrder[] = flipGrowthCreditOrder
    ? [...outstandingOrders, flipGrowthCreditOrder]
    : outstandingOrders;
  // CIP is the cost still UNDER construction. For a legacy order that is its
  // whole `costPaidAnchor` until it lands; for a `smooth` order it is the cost
  // of the units not yet delivered, which falls a slice at a time. The command
  // restates this exact figure absolutely on every build/cancel, so the two
  // agree and any rounding drift self-heals.
  const constructionInProgressAnchor = queueUndeliveredCost(nextBuildQueue, currentTurn);
  // ─── C4: the turn's queue write is a DELTA, never a whole-array $set ───────
  //
  // `nextBuildQueue` is derived from a snapshot taken at the top of the turn.
  // Persisting it with `$set: { buildQueue: nextBuildQueue }` silently erases
  // any order a CEO placed between the snapshot and the bulkWrite at the end of
  // the turn — a window that spans the whole sector-compute phase. The command's
  // CAS cannot save them: the command wrote first and succeeded, and the turn's
  // unconditional `$set` lands afterwards. The player is charged and the plant
  // never arrives.
  //
  // So the turn writes only what it actually owns: it REMOVES the orders that
  // landed. `onlineTurn <= currentTurn` is the exact landing predicate and it is
  // identity-free, which is what makes it safe as a `$pull` — a freshly placed
  // order always has `onlineTurn = currentTurn + buildTurns > currentTurn`, so
  // it can never match. No `orderId` is needed (and adding one would not help:
  // the ids of concurrently-placed orders are unknown to the snapshot anyway).
  //
  // CIP moves by `$inc` of the same delta rather than being restated, for the
  // same reason: a concurrent order's contribution must survive. Both figures
  // are taken from the ROUNDED values so the stored integer stays exact, and the
  // command re-states CIP absolutely on every write, so any residual drift is
  // self-healing.
  //
  // The flip-turn credit order is a `$push` in a SECOND bulkWrite op — Mongo
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
  // D12: a mothballed sector's plants are cold — they produce nothing, offer
  // nothing (its persisted `producedUnits` is what the clearing pre-pass reads
  // as its offer under plants, so 0 produced ⇒ 0 offered, automatically), and
  // pay only MOTHBALL_UPKEEP_FRACTION of running maintenance.
  const mothballed = plantsEnabled && sector.mothballed === true;
  // The capacity the advance starts from, hoisted out of the `advanceCapitalStock`
  // call below so the P5 book basis can be scaled by exactly the same
  // depreciation factor the stock takes. See the long comment inside the call.
  const plantsBaseStock = plantsEnabled
    ? isFlipTurn
      ? Math.max(
          storedCapacity,
          seedCapitalStock(
            preFlipNameplateRevenue,
            strategyRates.supply ?? {},
            COMMODITY_BASE_PRICES,
            lookups.eraUnitScale
          )
        )
      : storedCapacity
    : 0;
  const plantsPrevStock = plantsBaseStock + landedBuildUnits;
  const plantsCapacity = plantsEnabled
    ? advanceCapitalStock({
        // The max() is a ONE-TIME migration, keyed off the absent ramp anchor.
        // Applying it every turn would re-lift capacity back to whatever the
        // current revenue implies, which is exactly the compounding-nameplate
        // behaviour plants removes — and would silently cancel depreciation.
        //
        // CAPITAL_SEED_HEADROOM on the nameplate arm ONLY: capital-mode seeding
        // (seedCapitalStock) gives a sector 1.1x its implied units so it starts
        // with slack rather than pinned at 100% utilization. Without the same
        // factor here, any sector created AFTER the flip was born at exactly
        // 100% utilization and began depreciating on turn one, while an
        // otherwise identical sector that predated the flip carried slack — the
        // sector's economics depended on which side of the flip it was created.
        // `storedCapacity` is deliberately NOT scaled: a real stored capitalStock
        // already contains its own headroom history (it was seeded with 1.1x and
        // has depreciated/invested since), so re-applying the factor would
        // silently gift capacity on every flip.
        //
        // PROVISIONAL: this makes post-flip sectors consistent with pre-flip
        // ones under the current seeding rule. Whether plants should seed with
        // headroom at all — or start pinned and require a build order — is the
        // flip-day product decision; revisit when P3 build orders land.
        //
        // P3a: capacity delivered by build orders that came online this turn is
        // added BEFORE the advance, so a landed plant produces the turn it
        // lands (and takes that turn's depreciation like every other unit — a
        // ~0.05% haircut, not worth a special case).
        // `seedCapitalStock` IS `impliedOutputUnits(...) x CAPITAL_SEED_HEADROOM`
        // — the same expression the capital-mode seeding arm above uses.
        // Spelling it out inline here made it a divergent twin waiting to
        // happen: the two seeding paths must agree or a sector's capacity
        // changes depending on which tier it was born in. Hoisted to
        // `plantsBaseStock` above.
        prevStock: plantsPrevStock,
        currentGrowthRate: 0,
      })
    : 0;
  // ─── P5: the PAID BASIS of that capacity ──────────────────────────────────
  //
  //   book_next = (book_prev + cash of the orders that just landed) × (the same
  //               depreciation factor the stock just took)
  //
  // Scaling by the stock's own factor is what keeps the PER-UNIT basis flat
  // under depreciation: units and the cash that bought them fall off together,
  // so a plant half worn out books at half what was paid for it — never at half
  // the LIST price, which is the mint this closes.
  //
  // The seed for a sector with no recorded basis is the list value of the stock
  // it starts the turn with. Pre-plants capacity was bought through the legacy
  // growth stack at exactly `capacityPricePerUnit` (identity B), so those units
  // really did cost list; it is only the P3a build path's discounts that make
  // list wrong going forward. This is also the same number
  // `sectorCapacityBookAnchor`'s fallback returns, so the stamp is a no-op for
  // valuation on the turn it happens.
  //
  // Capacity granted for free (an R&D breakthrough, a world grant, an
  // autoSectorSeed multiplier) adds units without adding cash, so it DILUTES
  // the per-unit basis. That is deliberate: free capacity has no paid basis,
  // and must not be exitable for cash it never cost.
  const plantsCapacityDepreciationFactor =
    plantsPrevStock > 0 ? plantsCapacity / plantsPrevStock : 1;
  const priorCapacityBookAnchor =
    typeof sector.capacityBookAnchor === "number" &&
    Number.isFinite(sector.capacityBookAnchor) &&
    sector.capacityBookAnchor >= 0
      ? sector.capacityBookAnchor
      : plantsBaseStock * capacityUnitPriceAnchor;
  const capacityBookAnchor = plantsEnabled
    ? Math.max(
        0,
        (priorCapacityBookAnchor + landedBuildCostAnchor) * plantsCapacityDepreciationFactor
      )
    : 0;
  // Price per output unit of the sector's mix — the inverse of the Σ rate/base
  // term impliedOutputUnits applies, so `units × mixPrice` recovers the revenue
  // those units imply. 0 only for a sector whose output mix genuinely prices to
  // nothing (no output commodity with a positive rate AND a positive base).
  //
  // ZERO-REVENUE TRAP (fixed 2026-08-06). This was `preFlipNameplateRevenue /
  // nameplateUnits`, which is the SAME number whenever revenue > 0, because
  // `nameplateUnits === revenue × k`, but resolves 0/0 to 0 at revenue 0. That
  // made revenue-0 an ABSORBING state, and founding a sector under plants walks
  // straight into it: `expandSector` creates the sector with capitalStock 0 and
  // a starter build order, so the first turn writes back
  // `plantsNameplateRevenue = 0 × mixPrice = 0`, and from the second turn on
  // mixPrice is 0 forever. When the starter build landed, the sector produced
  // real units, sold them at a $0 unit price, and booked $0 revenue and $0 costs
  // permanently, a live, physically-producing sector with no economics at all.
  //
  // `plantsTransition.ts` already names this exact condition a hard NO-GO
  // blocker (`"no-priced-output-mix"`), but the preflight only guards the flip
  // turn; nothing guarded sectors founded AFTER the flip.
  //
  // Deriving the price from the unit yield instead is scale-free, which is what
  // the comment below already claims mixPrice is, so it is identical for every
  // sector carrying positive revenue and simply keeps working at revenue 0.
  // Sectors already stuck at 0 heal on their next turn without a backfill: their
  // capacity is intact, so `capacity × mixPrice` restores the nameplate, and the
  // governor passes the derived revenue through unclamped against a 0 baseline.
  const plantsMixPriceYield = plantsEnabled
    ? unitYieldForSupply(strategyRates.supply ?? {}, lookups.eraUnitScale)
    : 0;
  const plantsMixPrice = plantsMixPriceYield > 0 ? 1 / plantsMixPriceYield : 0;
  // The nameplate plants writes back to `sector.revenue`: what the OWNED
  // capacity is worth at mix prices. This keeps `revenue` a potential/nameplate
  // figure (exactly as every other mode treats it) while making capacity — not
  // last turn's compounding — the only thing that moves it.
  //
  // It must NOT be the realized figure. `sector.revenue` is re-read as next
  // turn's `sectorRevenueAnchor` AND is the base the commodity supply ledger
  // derives world supply from (computeRawSupplyDemand: revenue × rate / base).
  // Persisting realized revenue would multiply the anchor by every realization
  // leg once per turn, compounding them: a sector running at a steady 0.93
  // price realization loses ~7%/turn of its base for as long as the mode is on
  // (measured: −94% over 50 turns with flat capacity and flat produced units),
  // dragging world commodity supply down with it. Capacity-implied revenue is
  // invariant under that feedback because `plantsMixPrice` is 1/Σ(rate/base),
  // independent of the revenue it was measured from.
  //
  // Sectors with no priced output mix (nameplateUnits 0 ⇒ mixPrice 0) have no
  // capacity to price, so they hold the un-compounded anchor instead of being
  // zeroed.
  //
  // ROUNDING IDENTITY (fixed 2026-08): `plantsCapacity` is used RAW here, and the
  // persist block writes it RAW too. Both halves of the stored pair therefore
  // come from one unrounded value and `revenue === capitalStock × mixPrice`
  // holds exactly. It previously did not: `capitalStock` was quantised to 2dp on
  // the way out while `revenue` was priced off the unrounded figure, so the
  // stored pair silently missed the identity that the SOE overlay and the
  // shed/attack conservation arguments both assume.
  //
  // The fix went to the PERSIST side rather than rounding here, because under
  // plants `capitalStock` is not a derived display number — it is the
  // authoritative capacity state, read back verbatim as next turn's
  // `storedCapacity`. Quantising it makes the D9 retool rescale (multiply by
  // RPU_from/RPU_to, and later by its inverse in `cancelSectorStrategy`)
  // non-invertible, and drifts idle-upkeep off the capacity actually held.
  // Below plants `newCapitalStock` keeps its 2dp rounding byte-identically.
  const plantsNameplateRevenue =
    plantsEnabled && plantsMixPrice > 0 ? plantsCapacity * plantsMixPrice : newRevenue;
  // Governor ramp anchor: stamped on the sector's FIRST plants turn and never
  // moved, mirroring clearingStartTurn.
  const plantsStartTurn = plantsEnabled
    ? (sector.plantsStartTurn ?? currentTurn)
    : sector.plantsStartTurn;
  /**
   * THE plants transition ramp, λ ∈ [0, 1]. 0 on the flip turn, reaching 1 over
   * `governorRampTurns`. Every P3a leg that CHANGES a sector's steady-state
   * economics must fade in on this, or the flip turn is not a no-op.
   *
   * Hoisted to one definition because P3a originally grew two: the idle-upkeep
   * charge computed its own λ (and was correctly ramped), while the dominance
   * toll consolidation was applied as a hard switch. That combination broke the
   * flip identity for any sector above the dominance threshold — its margin
   * penalty and regulatory burden both vanished on flip day, an ~7.5% cost drop
   * (see `sectorTurn.p3aFlipIdentity.test.ts`). One λ, one meaning.
   *
   * SINGLE SOURCE OF TRUTH for the plants ramp inside this function — the
   * idle-upkeep charge further down reads THIS const. Do not re-fork it; the
   * budget-side mirror is `plantsUpkeepRampLambda` in
   * `src/lib/budget/publicEnterpriseRevenue.ts`, which must stay in step.
   */
  const plantsRampLambda =
    !plantsEnabled || plantsStartTurn == null || market.governorRampTurns <= 0
      ? 1
      : Math.max(0, Math.min(1, (currentTurn - plantsStartTurn) / market.governorRampTurns));
  // Launch-safety governor: the clearing price/volume leg (clearingFactor)
  // replaces the ledger's priceRealization, but on thin-margin corps a
  // few-percent gap between the two swings earnings (and share prices) by
  // 50-80% on flip. Bound clearing to within ±CAP of the ledger baseline and
  // ramp that divergence in from 0, so the flip is a no-op and valuations
  // drift instead of cratering. Scoped to the clearing leg only — capitalFactor
  // (the deliberate capacity-decay gate for non-investment) still applies in
  // full. Off-mode this is the plain priceRealization path (clearingFactor 1).
  const clearingRevenueLeg = market.clearingEnabled
    ? softenedMarketRealization(
        computePriceRealization(strategyRates.supply, lookups.priceRatioByCommodity),
        clearingFactor,
        clearingStartTurn,
        currentTurn,
        market.governorCap,
        market.governorRampTurns
      )
    : priceRealization;
  // Trade-exposure embargo: fraction of this sector's output that clears abroad,
  // from the prior turn's trade snapshot (same one-turn-lagged intensity the
  // export premium uses). 0 unless the new model is active for this sector.
  const embargoExportExposure = embargoTradeExposureActive
    ? computeExportExposure(
        strategyRates.supply,
        lookups.exportIntensityByCountry.get(sector.countryId ?? corp.countryId) ??
          EMPTY_EXPORT_INTENSITY
      )
    : 0;
  // Revenue kept after the embargo strips its export leg: 0 under the legacy
  // mothball, else the domestic remainder (1 − exported share), else 1.
  const embargoRevenueFactor = embargoLegacyMothball
    ? 0
    : 1 - embargoExportExposure * TRADE_EMBARGO_EXPORT_LOSS_SHARE;
  // ─── P3b scoped touch: ONE capacity system for extraction ────────────────
  // (definition hoisted above `baselineHourlyRevenue` — that anchor now reads it
  // too, so it must be in scope there.)
  //
  // Below plants an extraction sector is gated by TWO capacity systems at once:
  // its own capital stock (the capital tier) and the state's geology, and the
  // geological leg arrives as a soft, apologetic REVENUE haircut — floored at
  // EXTRACTION_CAPACITY_HAIRCUT_FLOOR (0.5) and faded in over a 240-turn
  // per-sector grace window, both bolted on in 2026 to stop the un-floored ramp
  // bankrupting miners while utilization sat at ~0.07.
  //
  // Under plants that is no longer the right shape. Capacity IS the production
  // base, so the deposit is simply a second, HARD ceiling on the same quantity:
  //
  //     producedUnits = min(plant-driven produced, state resource remaining)
  //
  // implemented as the utilization ratio applied straight to the units chain —
  // no 0.5 floor (a deposit that can only yield 7% of what the plants can chew
  // yields 7%, and the answer is to build somewhere else or prospect, not to
  // conjure ore), and no 240-turn per-sector grace (the plants ramp below is the
  // only grace period, and it is the same one every other plants leg uses).
  //
  // FLIP IDENTITY: `plantsRampLambda` is 0 on the sector's first plants turn, so
  // the factor is exactly 1 there — the flip turn is unchanged, and the hard min
  // fades in over `governorRampTurns` for the over-extracted sectors it will
  // cut. Non-extraction sectors have utilization 1 and are unaffected; non-plants
  // worlds keep `capacityHaircut` (floor + 240-turn ramp) byte-identically.
  const plantsExtractionHardMin =
    plantsEnabled && sector.sectorType === "extraction"
      ? 1 - plantsRampLambda * (1 - Math.max(0, Math.min(1, capacityUtil.utilization)))
      : 1;
  // WHY the two capacity legs below are NOT gated the way `productionFactor`
  // gates them (audited 2026-08; the asymmetry is deliberate, do not "fix" it):
  //
  // `baselineHourlyRevenue` is the pre-plants COUNTERFACTUAL. Under plants it is
  // the anchor `softenedMarketRealization` clamps the plant-derived revenue
  // against, so it must carry the legs capital mode carried — `capacityHaircut`
  // and `capitalFactor` included. Gating them off here makes the anchor jump on
  // the flip turn (λ = 0 returns the anchor verbatim), which is exactly what
  // `sectorTurn.p3bExtractionHardMin.test.ts` and the governor cases in
  // `sectorTurn.plants.test.ts` pin: a fully-ramped 0.5 legacy haircut would
  // double a miner's revenue on flip day.
  //
  // It is also NOT a compounding decay, despite looking like a recurrence. The
  // anchor is built from `preFlipNameplateRevenue`, which reads `sector.revenue`,
  // which under plants was restated last turn as `plantsCapacity × plantsMixPrice`
  // — i.e. from CAPACITY, not from realized revenue. And `plantsMixPrice` is
  // 1/Σ(rate/base) identically (see its definition), so that restatement carries
  // no realization leg at all: `revenue_t` is a function of `capacity_t` alone.
  // The haircut therefore multiplies the anchor ONCE per turn at a constant
  // level; it never feeds its own next input. Held capacity constant, revenue is
  // a fixed point, not a geometric series — pinned by the multi-turn regression
  // in `sectorTurn.plantsMultiTurn.test.ts`.
  //
  // The LEVEL question this used to raise is now answered by C8: the ±cap does
  // release. `governorEffectiveCap` widens the clamp with λ and drops it
  // entirely at full ramp, so a fully-ramped extraction sector is priced by
  // `plantsExtractionHardMin` and its own capacity — the anchor (legacy haircut
  // included) governs only the transition, which is all it was ever for.
  const baselineHourlyRevenue =
    (preFlipNameplateRevenue / TURNS_PER_DAY) *
    revenueMultiplier *
    nationalizationTransition *
    capacityHaircut *
    clearingRevenueLeg *
    throughputFactor *
    capitalFactor *
    labourOutputFactor *
    // Embargo: legacy total mothball earns nothing (factor 0); the trade-exposure
    // model keeps the domestic remainder (1 − exported share). 1 when unembargoed.
    embargoRevenueFactor;
  // P1 units telemetry: the production-side legs of the chain above — the ones
  // that gate how much the sector can physically make. The remaining legs
  // (clearingRevenueLeg, embargoRevenueFactor) are sales-side and stay on the
  // dollar side of the identity documented on computeSectorOutputUnits.
  // P3a scoped touch #1 — tech output rate reaches the PLANTS units chain.
  //
  // `techEffects.outputRateMult` is applied to the supply rates the sector
  // reports to the commodity ledger (`effectiveSupply`, below). Under plants
  // that left the effect half-wired: the world received the extra steel, but the
  // sector's own `producedUnits` — hence its derived revenue — never moved,
  // because units come from `capitalStock` rather than from the supply rates.
  // `techOutputUnitsMultiplier` is the same scaling expressed in capacity units
  // (a unit-contribution-weighted mean of the per-commodity multipliers), so the
  // two statements agree.
  //
  // FLIP IDENTITY: the multiplier is exactly 1 for an empty `outputRateMult` —
  // every corp without the tech, and every world with the tech tree off — so the
  // flip turn is unchanged. Plants-gated so non-plants behaviour is byte-identical.
  const plantsTechOutputMultiplier = plantsEnabled
    ? techOutputUnitsMultiplier(strategyRates.supply, techEffects.outputRateMult)
    : 1;
  // P3.5 SEAM — active-disaster penalties are split at their source
  // (disasterMarginPenalty.ts) into a financial leg and a physical leg. This is
  // hoisted above `productionFactor` because the physical leg must gate TONNAGE:
  // pre-P3.5 a blackout shipped a full load at a thinner margin. The financial
  // leg is consumed unchanged further down, in `totalMarginMod`.
  // FLIP IDENTITY: below plants, and for any crisis effect with no
  // `physicality` (i.e. every crisis spawned before P3.5), the split puts the
  // whole penalty in `marginPenalty` and `disasterProductionFactor` returns
  // exactly 1 — non-plants behaviour is byte-identical.
  const disasterPenalty = computeDisasterPenaltySplit(
    lookups.activeDisasterEffectsByState.get(sector.stateId) ?? [],
    { sectorType: sector.sectorType, strategyId: sector.strategyId ?? null },
    currentTurn,
    plantsEnabled
  );
  // FLIP-DAY HANDOVER. The physical leg is a NEW steady-state economics change,
  // so it obeys the same rule every other plants leg obeys: fade it in on
  // `plantsRampLambda`, anchored at `plantsStartTurn`. Without this, a sector
  // whose flip turn happens to fall inside an active physical crisis broke the
  // identity in BOTH directions at once — revenue stayed pinned to
  // `baselineHourlyRevenue` (the governor returns the baseline verbatim at
  // λ = 0, so the tonnage cut never reached the top line) while the penalty's
  // percentage points had already left `disasterMarginMod`, so cost fell by the
  // full penalty and profit jumped. A −8pp port closure handed the sector an 8%
  // free margin gain on flip day.
  //
  // The handover is a partition, not a duplication: λ of the penalty drives
  // tonnage, (1 − λ) stays in the margin stack, and the two always sum to the
  // pre-P3.5 total. At λ = 0 that is `productionPenalty × 0 === 0` and
  // `marginPenalty + productionPenalty` — the old number, exactly. At λ = 1 the
  // whole physical penalty is tonnage, which is the wave's intent.
  const disasterPhysicalRamped = disasterPenalty.productionPenalty * plantsRampLambda;
  const disasterPhysicalDeferred = disasterPenalty.productionPenalty - disasterPhysicalRamped;
  const disasterOutputFactor = disasterProductionFactor(disasterPhysicalRamped);
  // Ticket #1072: which production-policy curve throttles TONNAGE.
  //
  // The policy slider publishes two curves: an OUTPUT curve (−10%…+15%, what
  // the UI labels as the units effect) and a REVENUE curve (−5%…+10%). Under
  // plants, revenue is DERIVED from tonnage, so exactly one of them may gate
  // `productionFactor` or the slider gets counted twice on the top line.
  //
  // It used to be the revenue curve, and the output curve was applied only
  // where output LEFT the sector — the world-supply ledger and the clearing
  // offer, both via `plantsSupplyScaledUnits`. Two things broke from that. The
  // units on screen moved on the wrong curve (−4.4% at policy −22, against the
  // −8.8% the panel promised), and, worse, the offer was the produced tonnage
  // scaled AGAIN by the output curve, so ~9% of every throttled run was
  // physically unsellable: built, paid for, never offered, piling up as unsold
  // inventory the owner is charged to hold. With 100% market share no price
  // move could clear it, because it was never on the book.
  //
  // So under plants the OUTPUT curve gates tonnage, the revenue curve steps
  // aside, and `plantsSupplyScaledUnits` no longer re-applies output. The chain
  // is applied exactly once and produced == offered.
  //
  // FLIP IDENTITY: at policy 0 both curves are 1.0, so nothing moves. Non-plants
  // worlds are untouched — there `producedUnits` is the revenue nameplate and
  // the ledger still owns the output curve on that path.
  const policyTonnageMultiplier = plantsEnabled
    ? getOutputMultiplier(newPolicyLevel)
    : revenueMultiplier;
  const productionFactor =
    disasterOutputFactor *
    policyTonnageMultiplier *
    nationalizationTransition *
    (plantsEnabled ? plantsExtractionHardMin : capacityHaircut) *
    throughputFactor *
    // Under plants, capacity IS the production base (see plantsCapacity), so
    // folding the capacity/implied-units haircut in here as well would gate the
    // same constraint twice.
    (plantsEnabled ? 1 : capitalFactor) *
    plantsTechOutputMultiplier *
    labourOutputFactor;
  // Locked decision 18: chartered financial capacity is split between commodity
  // financial_services output and the branch network (deposit ceiling). Scale
  // only the capacity that enters production; stored capitalStock is untouched.
  // Gated on privateBankingEnabled + ACTIVE charter — zero change otherwise.
  const bankingCommodityScale =
    sector.sectorType === "financial"
      ? commodityProductionCapacityScale(corp.bankCharter, env.privateBankingEnabled === true)
      : 1;
  const productionNameplateUnits = plantsEnabled
    ? mothballed
      ? 0
      : plantsCapacity * bankingCommodityScale
    : nameplateUnits * bankingCommodityScale;
  const { producedUnits, soldUnits } = computeSectorOutputUnits({
    // Plants inverts the P1 decomposition: units come from owned capacity, not
    // from the revenue nameplate. Everything downstream of `unitsBase` is the
    // same production-leg chain.
    // D12: mothballed plants are cold — zero units produced, hence zero offered
    // to the clearing book next turn.
    nameplateUnits: productionNameplateUnits,
    productionFactor,
    soldFraction: market.clearingEnabled && clearing ? clearing.soldFraction : null,
  });
  // Plants: revenue is DERIVED from produced output, exactly inverting the P1
  // identity (producedUnits × mixPrice × sales legs == realizedRevenue). At the
  // flip, capacity == impliedOutputUnits(nameplate) and every leg is unchanged,
  // so this reproduces the old realized revenue EXACTLY — which is why the
  // migration above seeds capacity from implied units.
  const plantsDerivedHourlyRevenue = plantsEnabled
    ? ((producedUnits * plantsMixPrice) / TURNS_PER_DAY) * clearingRevenueLeg * embargoRevenueFactor
    : 0;
  // Launch-safety governor, same shape as the clearing leg: bound the derived
  // revenue to within ±capEffective(λ) of the pre-flip baseline and fade that
  // divergence in from zero over the ramp, anchored at the sector's first plants
  // turn. λ = 0 on the flip turn ⇒ returns the baseline exactly, so a sector
  // arriving with capital-mode headroom (capacity 1.1× implied units) does not
  // jump 10% on day one — it drifts there over the ramp.
  //
  // C5: this is an AMOUNT, so it uses the AMOUNT variant. The factor variant
  // substitutes the baseline whenever its market input is <= 0, which is right
  // for a factor and catastrophic for an amount: a sector that produced nothing
  // (halted, unstaffed, output-less) was handed its FULL baseline revenue with
  // none of the costs — roughly a 6x profit pump — and the boundary was
  // discontinuous, since an epsilon of production earned 85% of nameplate while
  // exactly zero earned 100%. `softenedMarketRealizationAmount` takes zero
  // literally, so the halt is continuous and, at full ramp, lands on 0.
  //
  // A zero BASELINE (legacy embargo mothball, dead sector) has no anchor to
  // govern against, and the amount variant passes the derived value through.
  //
  // D12: a mothballed sector earns exactly 0. This stays an explicit bypass
  // rather than relying on the general rule: it documents the intent, and it
  // holds even mid-ramp, where the general rule would still blend a cold plant
  // part-way toward its running baseline.
  const marketHourlyRevenue = mothballed
    ? 0
    : plantsEnabled
      ? softenedMarketRealizationAmount(
          baselineHourlyRevenue,
          plantsDerivedHourlyRevenue,
          plantsStartTurn,
          currentTurn,
          market.governorCap,
          market.governorRampTurns
        )
      : baselineHourlyRevenue;
  // Final realization leg: output shipped to a government arsenal under a defence contract
  // was already paid for per lot, and does not also get sold on the market. Without this the
  // plant earned its full market revenue AND the contract price for the same production — one
  // plant's output paid for twice, scaling with however many contracts a minister wrote.
  // The matching deduction on the goods side lives in `computeRawSupplyDemand`.
  const militaryDivertedFraction = freshMilitaryDiversion(sector, currentTurn);
  const hourlyRevenue = marketHourlyRevenue * (1 - militaryDivertedFraction);
  // Emit a notification event when a sector newly crosses into capacity-bound
  // territory (was unbound/undefined last turn, now below the threshold).
  if (
    sector.sectorType === "extraction" &&
    capacityUtil.bindingResource != null &&
    capacityUtil.utilization < CAPACITY_BINDING_THRESHOLD &&
    (sector.capacityUtilization == null || sector.capacityUtilization >= CAPACITY_BINDING_THRESHOLD)
  ) {
    pendingCapacityBindingEvents.push({
      sectorId: sector._id.toString(),
      corporationId: corp._id.toString(),
      stateId: sector.stateId,
      bindingResource: capacityUtil.bindingResource,
      utilization: capacityUtil.utilization,
    });
  }
  // Tariff modifiers: foreign corps pay a rate-proportional margin penalty;
  // domestic corps absorb a smaller supply-chain friction malus from broad tariffs.
  // Blend weights shift toward local commodity data when tariffs are in effect,
  // reflecting that import costs push buyers toward domestic alternatives.
  const corpCountry = corp.countryId;
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
  // The blended modifier uses `strategyRates` (resolved above) so it
  // reflects what the sector actually produces/consumes on its current
  // strategy — without that override, sectors on non-standard strategies
  // would be priced against SECTOR_DEMAND/SECTOR_SUPPLY (the "standard" recipe).
  const stateBalances = lookups.rawStateBalances.get(sector.stateId) ?? new Map();
  const baseSupply = applyExtractionResourceCapacityToSupply(
    sector.sectorType,
    strategyRates.supply,
    lookups.stateResourceCapacityByState.get(sector.stateId)
  );
  // Tech production-method effects: scale specific commodity output up and
  // input (demand) down. No-op for commodities a node doesn't target.
  const effectiveSupply = scaleCommodityRates(baseSupply, techEffects.outputRateMult);
  const effectiveDemand = scaleCommodityRates(strategyRates.demand, techEffects.inputRateMult);
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
  // Sector type match: +5% if matches corp type, -15% if mismatch. SOEs are
  // exempt — a NatCorp is a diversified state holding company, not a
  // specialized private firm (Bug #0775).
  const sectorTypeMatchMod = isStateOwned(corp)
    ? 0
    : getSectorTypeMatchModifier(
        sector.sectorType as CorporationType,
        corp.type,
        corp.secondaryType
      );
  // Logistical sprawl: -0.5% per 2 sectors over 15 (reduced by logistics
  // spending). SOEs are exempt — they accumulate sectors by nationalization.
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
  // `strategyRates` was resolved once above (haircut / realization / modifier); reuse it.
  // Penalty scales with progress: no disruption at turn 0, full −5% at turn 12.
  // Falls back to full penalty if transitionStartTurn is missing (legacy safety).
  const transitionProgress =
    strategyRates.isTransitioning && sector.transitionStartTurn != null
      ? Math.min(
          1,
          Math.max(0, ((turn ?? 0) - sector.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
        )
      : 0;
  const strategyMarginMod = strategyRates.isTransitioning
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
  const politicalBoard = lookups.politicalBoardByState?.get(sector.stateId);
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
  // Workers for this sector (revenue + state workforce skill). Computed here
  // — ahead of the labor-cost split below — so labor can be expressed as
  // workers × wage-per-worker. Also persisted on the sector update later.
  // SP4: playable regions' workforce skill resolves from the political board
  // (education.adultSkills, same 0-100 higher-better scale).
  const rawSkill =
    lookups.rawWorkforceSkillByState.get(sector.stateId) ??
    politicalBoard?.["education.adultSkills"] ??
    null;
  const computedWorkers = calculateWorkers(newRevenue, rawSkill);

  const grossMaintenance = hourlyRevenue * (1 - effectiveMargin / 100);
  const {
    maintenance,
    sectorLaborCost,
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
    grossMaintenance,
    computedWorkers,
    techLaborCostMultiplier: techEffects.laborCostMultiplier,
    costOfLivingIndex: sectorMetrics?.economic?.costOfLiving?.value,
    unemploymentRate: sectorMetrics?.economic?.unemploymentRate?.value,
    wageIndexByState,
    automationIndexByState,
    pendingStrikeEvents,
  });
  // Growth cost must be charged on the revenue the sector ACTUALLY realises, not
  // on its nominal book revenue.
  //
  // `newGrowthCost` is derived from raw `newRevenue`, while `hourlyRevenue` is
  // that same figure after seven realisation factors (capacity haircut, price
  // realisation, clearing, throughput, capital utilisation, strike throttle,
  // embargo). Measured on the completed 1000-turn run, realisation averaged
  // 0.417 while growth cost ran at 0.246 of nominal revenue — so expansion
  // consumed 59% of the income it was paid from, and NO firm could stay solvent
  // regardless of margin. It is the single largest driver of the corporate
  // collapse (432 firms to 88, 89% loss-making).
  //
  // Scaling by the realisation ratio keeps the economics honest in both
  // directions: a firm that cannot sell its output also is not billed as though
  // it had, but a badly-run firm still fails, because its realised revenue is
  // genuinely low.
  const nominalHourlyRevenue = preFlipNameplateRevenue / TURNS_PER_DAY;
  const realizationRatio =
    nominalHourlyRevenue > 0 ? Math.max(0, Math.min(1, hourlyRevenue / nominalHourlyRevenue)) : 1;
  const hourlyGrowthCost = (newGrowthCost / TURNS_PER_DAY) * realizationRatio;
  // Dominance regulatory burden: passive revenue tax on dominant sectors
  // (compliance, antitrust legal, lobbying). Deducted before profit so it
  // hits both yearly profit (→ sectorNPV) and corp earnings.
  // Revenue-side twin of the dominance margin penalty — same SOE exemption.
  // P3a scoped touch #2b — the revenue-side twin of the margin penalty above,
  // gated off for the same reason (dominance is tolled once, at build time).
  // See `computeBuildCost` for the design; SOEs stay exempt in every mode.
  const regulatoryBurdenRate = isStateOwned(corp)
    ? 0
    : Math.max(
        getDominanceRegulatoryBurden(sectorMarketSharePct),
        getNationalDominanceRegulatoryBurden(nationalDominanceSharePct)
      ) *
      (1 - techEffects.dominanceShield) *
      (plantsEnabled ? 1 - plantsRampLambda : 1);
  const regulatoryBurden = hourlyRevenue * regulatoryBurdenRate;

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
  const plantsUpkeepMarginBasisLive = Math.max(0, 1 - effectiveMargin / 100);
  const plantsUpkeepMarginBasisAnchor =
    typeof sector.plantsUpkeepMarginBasisAnchor === "number" &&
    Number.isFinite(sector.plantsUpkeepMarginBasisAnchor)
      ? sector.plantsUpkeepMarginBasisAnchor
      : null;
  const plantsUnitUpkeepHourly = plantsEnabled
    ? idleUpkeepUnitPrice({
        mixPrice: plantsMixPrice,
        turnsPerDay: TURNS_PER_DAY,
        anchoredMarginBasis: plantsUpkeepMarginBasisAnchor,
        liveMarginBasis: plantsUpkeepMarginBasisLive,
      })
    : 0;
  // The production legs the owner did NOT choose. `policyTonnageMultiplier`
  // (the production-policy slider) and `plantsTechOutputMultiplier` are
  // deliberately absent: those ARE owner decisions, so capacity idled by
  // throttling the policy slider is still billed — the case the constant was
  // written for.
  const plantsInvoluntaryThrottle =
    disasterOutputFactor *
    nationalizationTransition *
    plantsExtractionHardMin *
    throughputFactor *
    labourOutputFactor;
  const plantsOwnerIdleUnits = plantsEnabled
    ? ownerIdleUnits({
        capacity: plantsCapacity,
        producedUnits,
        involuntaryThrottle: plantsInvoluntaryThrottle,
      })
    : 0;
  // Uses `plantsRampLambda` (defined once above, ~line 882) rather than a local
  // copy: the ramp had forked into two identical expressions and the docblock
  // there already claims one definition. The idle-upkeep branch below only runs
  // when `plantsEnabled`, which is exactly the extra guard `plantsRampLambda`
  // carries, so the two evaluate identically at this use site.
  const plantsUpkeepCost = mothballed
    ? plantsUnitUpkeepHourly * plantsCapacity * MOTHBALL_UPKEEP_FRACTION
    : plantsEnabled
      ? plantsUnitUpkeepHourly * plantsOwnerIdleUnits * IDLE_UPKEEP_FRACTION * plantsRampLambda
      : 0;

  // ─── P3.5: physical cost decomposition (plants only) ──────────────────────
  //
  // `maintenance` above is the margin formula: revenue × (1 − margin/100). It
  // says nothing about what the plant buys, so a sector's cost cannot move with
  // the price of its inputs. Under plants the cost stack is rebuilt out of
  // physical lines instead — see `@/lib/corporations/physicalPnl` for the full
  // rationale and the calibration identity.
  //
  // DISPOSITION of the old margin-modifier stack under plants:
  //  • commodity INPUT modifier  → DELETED, replaced by `inputsCost` (the real
  //    bill). Keeping both would double-count the same condition.
  //  • commodity SURPLUS modifier → DELETED outright. Clearing and price
  //    realization already price a glut on the REVENUE side; the modifier was
  //    the original double-count this wave exists to remove.
  //  • disaster margin penalty  → financial leg, ₳ passthrough (a flood does
  //    not change the price of steel; it imposes a loss). Consumed here as an
  //    input; the disaster files themselves are another wave's territory.
  //  • tech `inputCost` effects → already scale `effectiveDemand`, so they now
  //    reduce UNITS BOUGHT rather than granting margin.
  //  • tech `laborCostReduction` → already the labor wage multiplier.
  //  • tech `growthCostReduction` → already its own line.
  //  • tech `marginBonus` (+ strategy-transition penalty, subsidies, tariffs,
  //    macro, state metrics, home location, sprawl, SOE efficiency, …) → these
  //    are not claims about physical consumption, so they keep driving cost
  //    through ONE named channel: the drift factor on the calibrated residual.
  //  • dominance → already consolidated to the build price in P3a.
  //
  // KNOWN RESIDUALS (deliberate, documented, not silently dropped): the labor
  // carve-out's clamp basis and the P3a idle-upkeep unit price still read the
  // full margin-formula margin. Both are prior waves' lines and both are
  // second-order; moving them is a follow-up, not a flip-day change.
  const plantsPhysicalEnabled = plantsEnabled && !embargoLegacyMothball;
  // The margin stack MINUS the modifiers the physical model now owns. Used only
  // as the residual's drift channel — never to compute a cost directly.
  const plantsResidualMarginBasis =
    1 -
    Math.min(
      100,
      sector.profitMargin +
        (totalMarginMod - commodityMod - surplusMod - disasterMarginMod) +
        nationalizedMarginPenalty
    ) /
      100;
  const inputsCostResult = plantsPhysicalEnabled
    ? computeInputsCost({
        // The recipe rates are expressed against the sector's NOMINAL nameplate,
        // and `plantsNameplateRevenue` is capacity × mixPrice — so multiplying
        // by utilization below gives producedUnits × mixPrice, i.e. inputs are
        // bought for what the plant actually made, and `producedUnits` already
        // carries the physical-disaster haircut, so a halted plant buys less.
        // Matches the units the world ledger books as this sector's demand
        // (`computeRawSupplyDemand`) up to four audited divergences — see the
        // list on `computeInputsCost`; all four are level effects the
        // calibration solve absorbs.
        nominalDailyRevenue: plantsNameplateRevenue,
        rates: effectiveDemand,
        basePrices: COMMODITY_BASE_PRICES,
        // Partition worlds: inputs are BOUGHT in the sector country's
        // reachable market, so they are billed at its price level. The world
        // map stays the fallback for countries/commodities without a book —
        // `reachableInputPriceRatios` overlays reachable ratios on the world
        // map per country, so absent entries fall back to world, not to base.
        priceRatios:
          lookups.reachableInputPriceRatiosByCountry?.get(sectorCountryId) ??
          lookups.priceRatioByCommodity,
        utilization: plantsCapacity > 0 ? producedUnits / plantsCapacity : 1,
        inputMultiplier: getInputMultiplier(newPolicyLevel),
        turnsPerDay: TURNS_PER_DAY,
        mothballed,
        // Money wiring (step 5, phase A): empty map when the flag is off, so
        // this is a no-op until interstateMoneyWiringEnabled is flipped on.
        statePremiums: lookups.landedPremiumByState?.get(sector.stateId),
      })
    : { total: 0, lines: [] };
  const inputsCost = inputsCostResult.total;
  const financialLegs = plantsPhysicalEnabled
    ? computeFinancialLegs({ hourlyRevenue, marginPenaltyPp: disasterMarginMod })
    : 0;
  // Calibration. On the sector's first physical-P&L turn the residual is SOLVED
  // so the physical lines reproduce `maintenance` — the margin formula's answer
  // at this exact state — to the last bit. Then it is persisted per output unit
  // and held, and the physical lines start moving on their own.
  //
  // A sector with no production yet cannot be calibrated per-unit (nothing to
  // divide by), so calibration is DEFERRED: the residual is charged directly for
  // that turn, which is exact anyway, and the anchor is stamped on the first
  // turn the plant actually runs.
  const storedOtherOpexAnchor =
    typeof sector.otherOpexPerUnitAnchor === "number" &&
    Number.isFinite(sector.otherOpexPerUnitAnchor)
      ? sector.otherOpexPerUnitAnchor
      : null;
  // In-flight auto-retools historically rescaled capitalStock but left this
  // per-unit residual on the old unit basis. Heal on the next sector-turn
  // write while transitionFromStrategyId evidence remains; no mongo script.
  const healedOpex = healAutoRetoolOpexAnchor({
    plantsEnabled: plantsPhysicalEnabled,
    isAutoRetool: corp.ceoType === "npp" || sector.autoStrategyAdoptedAtTurn != null,
    transitionFromStrategyId: sector.transitionFromStrategyId,
    strategyId: sector.strategyId,
    sectorType: sector.sectorType as CorporationType,
    retoolRescaleApplied: sector.retoolRescaleApplied,
    otherOpexPerUnitAnchor: storedOtherOpexAnchor ?? undefined,
  });
  const otherOpexAnchorForPnl = healedOpex?.otherOpexPerUnitAnchor ?? storedOtherOpexAnchor;
  const otherOpexCalibrated = plantsPhysicalEnabled && storedOtherOpexAnchor == null;
  const solvedOtherOpexPerUnit = otherOpexCalibrated
    ? solveOtherOpexPerUnit({
        marginFormulaCost: maintenance,
        laborCost: sectorLaborCost,
        inputsCost,
        financialLegs,
        producedUnits,
      })
    : null;
  const otherOpex = !plantsPhysicalEnabled
    ? 0
    : otherOpexCalibrated
      ? // Exact by construction, whether or not the per-unit anchor could be
        // solved this turn.
        maintenance - sectorLaborCost - inputsCost - financialLegs
      : (otherOpexAnchorForPnl ?? 0) *
        producedUnits *
        otherOpexDriftFactor({
          currentMarginBasis: plantsResidualMarginBasis,
          anchorMarginBasis: sector.otherOpexAnchorMarginBasis,
        });
  const physicalPnl = plantsPhysicalEnabled
    ? assemblePhysicalPnl({
        hourlyRevenue,
        inputsCost,
        laborCost: sectorLaborCost,
        // The SAME P3a line, consumed — not a second upkeep charge alongside it.
        upkeep: plantsUpkeepCost,
        complianceCost: regulatoryBurden,
        otherOpex,
        financialLegs,
        growthCost: hourlyGrowthCost,
      })
    : null;
  const hourlyProfit = physicalPnl
    ? physicalPnl.profit
    : hourlyRevenue - maintenance - plantsUpkeepCost - hourlyGrowthCost - regulatoryBurden;
  // NPV on a yearly basis: 1 game year = TURNS_PER_YEAR turns (48h)
  const yearlyProfit = hourlyProfit * TURNS_PER_YEAR;
  const sectorNPV = yearlyProfit > 0 ? Math.round(yearlyProfit / NPV_ANNUAL_DISCOUNT_RATE) : 0;
  // Capital book anchor: under capital mode, a sector that owns productive
  // capacity is valued at its depreciated peak going-concern value, not just
  // this turn's (transiently depressed) NPV — so building real capacity isn't
  // valued as if the corp owns nothing. Seeded at current NPV on the flip
  // turn (no-op), ratchets up with NPV, decays slowly when NPV falls, never
  // exceeds its own historical peak (no over-crediting).
  const capitalBookAnchor = market.capitalEnabled
    ? advanceCapitalBookAnchor({ prevAnchor: sector.capitalBookAnchor, sectorNPV })
    : 0;

  // Build sector update — include transition advancement if applicable.
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
      hourlyRevenue * TURNS_PER_DAY,
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
    currentGrowthRate: newCurrentGrowthRate,
    // Persisted so the brake is durable: without this the next turn's trend
    // simply pulls the rate straight back toward the old, unaffordable target.
    targetGrowthRate: brakedTargetRate,
    currentGrowthCost: writeCorpEconomicLocal(newGrowthCost, sectorCurrencyCode, sectorFxRate),
    workers: computedWorkers,
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
    // it breaks both the `revenue === capitalStock × mixPrice` stored-pair
    // identity and the invertibility of the D9 retool rescale. Capital mode's
    // derived stock keeps its 2dp rounding exactly as before.
    sectorUpdate.capitalStock = plantsEnabled
      ? plantsCapacity
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
      sectorUpdate.capacityBookAnchor = capacityBookAnchor;
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
    // D13 ROLLBACK SAFETY: capital-mode restore point. Remove after the
    // rollback drill passes.
    //
    // `revenue` above is RESTATED from plant output under plants, which
    // destroys the compounding series capital mode would have kept. Persist
    // that series in parallel so a mode rollback can restore each sector's
    // nameplate instead of resuming compounding from a plants-derived number.
    //
    // The series must be INDEPENDENT of `sector.revenue`. Seeding it from
    // `preFlipNameplateRevenue` every turn does not do that:
    // `preFlipNameplateRevenue` is `sectorRevenueAnchor × (1 + g)` and
    // `sectorRevenueAnchor` is read straight off `sector.revenue`, which under
    // plants was already restated from plant output LAST turn. So after the
    // flip turn the shadow just tracked plants revenue — and because plants
    // zeroes `targetGrowthRate` (below), g decayed to 0 and the shadow
    // converged exactly onto it. Restoring from it would have restored what
    // plants produced: precisely the silent permanent rebase this field exists
    // to prevent.
    //
    // So: seed on the FLIP turn from the pre-flip nameplate (which is what
    // capital mode would have written that turn, keeping the flip a no-op),
    // then compound each later turn off the shadow's OWN previous value at the
    // LEGACY growth rate. A sector whose shadow is missing or corrupt on a
    // non-flip turn is re-seeded from the pre-flip nameplate; that reintroduces
    // one turn of plants contamination, but the alternative is no restore point
    // at all.
    const prevShadowLocal = sector.legacyRevenueShadow;
    const prevShadow =
      typeof prevShadowLocal === "number" &&
      Number.isFinite(prevShadowLocal) &&
      prevShadowLocal >= 0
        ? readCorpEconomicAnchor(prevShadowLocal, sectorCurrencyCode, sectorFxRate)
        : null;
    // The legacy growth chain. `brakedTargetRate` / `newCurrentGrowthRate` are
    // the values computed BEFORE the plants zeroing a few lines down, so the
    // flip turn captures the real pre-plants rates. Afterwards the chain trends
    // on its own stored values — the live fields are on their way to zero and
    // the affordability brake reads a plants-derived margin, so re-running the
    // brake here would feed plants state back into the counterfactual.
    const legacyTargetRate =
      !isFlipTurn &&
      typeof sector.legacyTargetGrowthRateShadow === "number" &&
      Number.isFinite(sector.legacyTargetGrowthRateShadow)
        ? sector.legacyTargetGrowthRateShadow
        : brakedTargetRate;
    const legacyCurrentRate =
      !isFlipTurn &&
      typeof sector.legacyGrowthRateShadow === "number" &&
      Number.isFinite(sector.legacyGrowthRateShadow)
        ? trendGrowthRate(sector.legacyGrowthRateShadow, legacyTargetRate)
        : newCurrentGrowthRate;
    // Legacy mothball froze the nameplate under capital mode; the shadow has to
    // freeze with it or the counterfactual drifts above what a rollback should
    // return to.
    const legacyPerTurnRate = embargoLegacyMothball
      ? 0
      : legacyCurrentRate / GROWTH_RATE_TURNS_PER_YEAR;
    const nextShadowAnchor =
      isFlipTurn || prevShadow === null
        ? preFlipNameplateRevenue
        : prevShadow * (1 + legacyPerTurnRate / 100);
    // Written in the same host currency and on the same daily basis as
    // `revenue`; read by nothing in the simulation.
    sectorUpdate.legacyRevenueShadow = writeCorpEconomicLocal(
      nextShadowAnchor,
      sectorCurrencyCode,
      sectorFxRate
    );
    sectorUpdate.legacyGrowthRateShadow = legacyCurrentRate;
    sectorUpdate.legacyTargetGrowthRateShadow = legacyTargetRate;
    // Legacy growth fields are vestigial under plants: capacity is the only
    // thing that moves output, and the flip credit above compensates any
    // in-flight paid ramp. Zeroing the target lets `currentGrowthRate` trend to
    // 0 over the following turns (no cliff — this turn's growth cost is still
    // charged in full, so the flip turn itself is unchanged).
    sectorUpdate.targetGrowthRate = 0;
    sectorUpdate.currentGrowthCost = 0;
    // NOT written back: `mothballed` is derived here purely from the stored
    // field, so echoing it is a no-op that can only do harm — the turn
    // processor's snapshot is taken at turn start, so a player who mothballs
    // while the turn is running would have the toggle silently reverted. The
    // flag is owned by the build command alone.
  }
  // Clearing telemetry + ramp anchor.
  if (market.clearingEnabled && clearing) {
    sectorUpdate.clearingFactor = Math.round(clearingFactor * 1000) / 1000;
    sectorUpdate.soldFraction = Math.round(clearing.soldFraction * 1000) / 1000;
    // Per-output detail behind the weighted headline, so the sector page can
    // show WHICH output failed to clear instead of one blended number.
    const soldByCommodity: Record<string, number> = {};
    for (const [commodity, sold] of Object.entries(clearing.soldByCommodity ?? {})) {
      if (typeof sold === "number" && Number.isFinite(sold)) {
        soldByCommodity[commodity] = Math.round(sold * 1000) / 1000;
      }
    }
    sectorUpdate.soldByCommodity = soldByCommodity;
    sectorUpdate.effectivePosture = Math.round(clearing.effectivePosture * 1000) / 1000;
    sectorUpdate.clearingStartTurn = clearingStartTurn ?? null;
  }
  // Throughput telemetry + ramp anchor (display + next turn's fade-in).
  if (market.throughputEnabled) {
    sectorUpdate.throughputFactor = Math.round(throughputFactor * 1000) / 1000;
    sectorUpdate.throughputBindingInput = throughputRaw.bindingInput ?? null;
    sectorUpdate.throughputStartTurn = throughputStartTurn ?? null;
  }
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
  // Persist the EFFECTIVE margin for this turn — telemetry only, never read
  // back into the economy (same contract as laborCost above).
  //
  // `sector.profitMargin` is a seeded constant that nothing ever writes to, so
  // every modifier computed above (commodity markets, SOE mandates, tech,
  // nationalisation penalty) was applied for the turn and then discarded. The
  // stored field therefore showed exactly two values across the whole world —
  // 35 for market economies and 12 for state enterprises, min == max, for the
  // entire run — which made every margin readout decorative and hid the fact
  // that margins were in fact moving.
  //
  // P3.5 — UNDER PLANTS THIS FIELD IS AN OUTPUT, NOT AN INPUT.
  //
  // Below plants it is the modifier stack, and the stack DERIVES the cost.
  // Under plants the causality reverses: physical lines derive the cost, the
  // cost derives the profit, and the margin is read back off the profit as
  // `100 × (1 − operatingCost / revenue)`. On the calibration turn the derived
  // value equals the stack value exactly, by construction, so the flip shows no
  // step.
  //
  // WHO READS IT (audited 2026-08, the "telemetry-only" claim above is about
  // the COST path, not about readers in general — three exist):
  //  • `corporationDetail.ts` — display. Sees real costs instead of an
  //    assertion, which is the point.
  //  • `nppCorporationBehavior.ts` — the NPP profitability instrument
  //    (`marginCategory`, estimated income). It WANTS the derived number: the
  //    bug that field exists to fix is NPPs reading a frozen seed constant.
  //  • `publicEnterpriseRevenue.ts` — does NOT read it; it recomputes from
  //    `profitMargin + soePenalty`, so SOE remittance estimates are untouched
  //    by this wave and there is no double-deduction against the re-based
  //    subsidy bill.
  //
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
    sectorUpdate.otherOpexAnchorMarginBasis = plantsResidualMarginBasis;
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
    hourlyRevenue,
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
        maintenance + plantsUpkeepCost + hourlyGrowthCost + regulatoryBurden),
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
