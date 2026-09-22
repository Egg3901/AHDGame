/**
 * Extraction capacity and realized revenue: the P3b hard min, the production
 * chain, and the launch-safety governor (#588).
 *
 * Pure computation split out of processSector. Below plants an extraction
 * sector is gated by its capital stock and a soft geological revenue haircut
 * (floor + 240-turn grace); under plants the deposit is a HARD ceiling on
 * produced units and the plants ramp is the only fade-in. The governor binds
 * derived plants revenue to within ±cap of the pre-flip baseline counterfactual
 * so the flip turn is a no-op. Returns the capacity-binding notification as
 * data; the caller pushes it. No reads or writes here, only the turn inputs.
 */
import { activeCapacityConstraintFactor } from "@/lib/corporations/investment/rules";
import { techOutputUnitsMultiplier } from "@/lib/constants/capacityEconomy";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import { getOutputMultiplier } from "@/lib/utils/productionPolicy";
import { CAPACITY_BINDING_THRESHOLD } from "@/lib/extraction/capacityHaircut";
import { softenedMarketRealization, softenedMarketRealizationAmount } from "@/lib/market/capital";
import { computePriceRealization } from "@/lib/market/priceRealization";
import { TRADE_EMBARGO_EXPORT_LOSS_SHARE } from "@/lib/trade/constants";
import { computeExportExposure } from "@/lib/trade/exportPremium";
import { freshMilitaryDiversion } from "@/lib/military/arsenal";
import { commodityProductionCapacityScale } from "@/lib/banking/capacityAllocation";
import type { getSectorTechEffects } from "@/lib/constants/techTree";
import type { CorporateSector, Corporation } from "@/lib/db/types";
import type { MarketContext } from "@/lib/market/marketContext";
import type { SectorClearingResult } from "@/lib/market/clearing";
import type { CommodityType } from "@/lib/constants/commodities";
import type { ExtractableResource } from "@/lib/constants/commodities";
import type { CorporationLookups } from "../types";
import { computeContractProduction } from "../contractProduction";

export interface PlantsRevenueInput {
  sector: Pick<
    CorporateSector,
    | "_id"
    | "sectorType"
    | "countryId"
    | "stateId"
    | "soldUnits"
    | "producedUnits"
    | "capacityUtilization"
    | "militaryDivertedFraction"
    | "militaryDivertedTurn"
  >;
  corp: Pick<Corporation, "_id" | "countryId" | "bankCharter">;
  strategySupply: Partial<Record<CommodityType, number>> | undefined;
  techEffects: Pick<
    ReturnType<typeof getSectorTechEffects>,
    "outputRateMult" | "priceRealizationBonus"
  >;
  plantsEnabled: boolean;
  mothballed: boolean;
  /** P1 nameplate units from the market-tier computation (non-plants base). */
  nameplateUnits: number;
  activeFraction: number;
  plantsRampLambda: number;
  capacityUtil: { utilization: number; bindingResource: ExtractableResource | null };
  capacityHaircut: number;
  capitalFactor: number;
  capacityHaircutStartTurn?: number;
  clearing: SectorClearingResult | undefined;
  clearingEnabled: boolean;
  clearingFactor: number;
  clearingStartTurn: number | undefined;
  priceRealization: number;
  priceRatioByCommodity: CorporationLookups["priceRatioByCommodity"];
  embargoLegacyMothball: boolean;
  embargoTradeExposureActive: boolean;
  exportIntensityByCountry: CorporationLookups["exportIntensityByCountry"];
  preFlipNameplateRevenue: number;
  plantsNameplateRevenue: number;
  revenueMultiplier: number;
  nationalizationTransition: number;
  throughputFactor: number;
  labourOutputFactor: number;
  strategyIsTransitioning: boolean;
  retoolCapacityRatio: number;
  priorProductionUnitRatio: number;
  disasterOutputFactor: number;
  newPolicyLevel: number;
  plantsCapacity: number;
  plantsMixPrice: number;
  plantsStartTurn: number | undefined | null;
  currentTurn: number;
  governorCap: number;
  governorRampTurns: number;
  privateBankingEnabled?: boolean;
  marketPlantsEnabled: boolean;
  contractProductionTargetBySectorId: MarketContext["contractProductionTargetBySectorId"];
}

export interface CapacityBindingEvent {
  sectorId: string;
  corporationId: string;
  stateId: string;
  bindingResource: ExtractableResource;
  utilization: number;
}

export interface PlantsRevenueResult {
  clearingRevenueLeg: number;
  embargoExportExposure: number;
  embargoRevenueFactor: number;
  plantsExtractionHardMin: number;
  activeExtractionHardMin: number;
  baselineHourlyRevenue: number;
  plantsTechOutputMultiplier: number;
  policyTonnageMultiplier: number;
  productionFactor: number;
  bankingCommodityScale: number;
  productionNameplateUnits: number;
  producedUnits: number;
  soldUnits: number;
  contractAchievableUnits: number;
  demandThrottleFactor: number;
  plantsTechPriceLeg: number;
  plantsDerivedHourlyRevenue: number;
  marketHourlyRevenue: number;
  militaryDivertedFraction: number;
  hourlyRevenue: number;
  capacityBindingEvent: CapacityBindingEvent | null;
}

const EMPTY_EXPORT_INTENSITY: ReadonlyMap<CommodityType, number> = new Map();

export function resolvePlantsRevenue(input: PlantsRevenueInput): PlantsRevenueResult {
  const {
    sector,
    corp,
    strategySupply,
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
    clearingEnabled,
    clearingFactor,
    clearingStartTurn,
    currentTurn,
    priceRealization,
    priceRatioByCommodity,
    embargoLegacyMothball,
    embargoTradeExposureActive,
    exportIntensityByCountry,
    preFlipNameplateRevenue,
    plantsNameplateRevenue,
    revenueMultiplier,
    nationalizationTransition,
    throughputFactor,
    labourOutputFactor,
    strategyIsTransitioning,
    retoolCapacityRatio,
    priorProductionUnitRatio,
    disasterOutputFactor,
    newPolicyLevel,
    plantsCapacity,
    plantsMixPrice,
    plantsStartTurn,
    governorCap,
    governorRampTurns,
    privateBankingEnabled,
    marketPlantsEnabled,
    contractProductionTargetBySectorId,
  } = input;

  // Launch-safety governor: the clearing price/volume leg (clearingFactor)
  // replaces the ledger's priceRealization, but on thin-margin corps a
  // few-percent gap between the two swings earnings (and share prices) by
  // 50-80% on flip. Bound clearing to within ±CAP of the ledger baseline and
  // ramp that divergence in from 0, so the flip is a no-op and valuations
  // drift instead of cratering. Scoped to the clearing leg only — capitalFactor
  // (the deliberate capacity-decay gate for non-investment) still applies in
  // full. Off-mode this is the plain priceRealization path (clearingFactor 1).
  const clearingRevenueLeg = clearingEnabled
    ? softenedMarketRealization(
        computePriceRealization(strategySupply ?? {}, priceRatioByCommodity),
        clearingFactor,
        clearingStartTurn,
        currentTurn,
        governorCap,
        governorRampTurns
      )
    : priceRealization;
  // Trade-exposure embargo: fraction of this sector's output that clears abroad,
  // from the prior turn's trade snapshot (same one-turn-lagged intensity the
  // export premium uses). 0 unless the new model is active for this sector.
  const embargoExportExposure = embargoTradeExposureActive
    ? computeExportExposure(
        strategySupply,
        exportIntensityByCountry.get(sector.countryId ?? corp.countryId) ?? EMPTY_EXPORT_INTENSITY
      )
    : 0;
  // Revenue kept after the embargo strips its export leg: 0 under the legacy
  // mothball, else the domestic remainder (1 − exported share), else 1.
  const embargoRevenueFactor = embargoLegacyMothball
    ? 0
    : 1 - embargoExportExposure * TRADE_EMBARGO_EXPORT_LOSS_SHARE;
  // ─── P3b scoped touch: ONE capacity system for extraction ────────────────
  //
  // Below plants an extraction sector is gated by TWO capacity systems at once:
  // its own capital stock (the capital tier) and the state's geology, and the
  // geological leg arrives as a soft REVENUE haircut - floored at
  // EXTRACTION_CAPACITY_HAIRCUT_FLOOR (0.5) and faded in over a 240-turn
  // per-sector grace window.
  //
  // Under plants, capacity IS the production base, so the deposit is a HARD
  // ceiling on the same quantity:
  //
  //     producedUnits = min(plant-driven produced, state resource remaining)
  //
  // No 0.5 floor, no 240-turn per-sector grace - the plants ramp below is the
  // only fade-in, and it is the same one every other plants leg uses.
  //
  // FLIP IDENTITY: `plantsRampLambda` is 0 on the sector's first plants turn, so
  // the factor is exactly 1 there. Non-extraction sectors have utilization 1 and
  // are unaffected; non-plants worlds keep `capacityHaircut` (floor + 240-turn
  // ramp) byte-identically.
  const plantsExtractionHardMin =
    plantsEnabled && sector.sectorType === "extraction"
      ? 1 - plantsRampLambda * (1 - Math.max(0, Math.min(1, capacityUtil.utilization)))
      : 1;
  const activeExtractionHardMin = activeCapacityConstraintFactor(
    plantsExtractionHardMin,
    activeFraction
  );
  // `baselineHourlyRevenue` is the pre-plants COUNTERFACTUAL. Under plants it is
  // the governor's clamp anchor, so it must carry the legs capital mode carried
  // (`capacityHaircut` and `capitalFactor`). Gating them off here jumps the
  // anchor on flip (λ = 0 returns the anchor verbatim). Do not "fix" the
  // asymmetry. Not a compounding decay: under plants `sector.revenue` was
  // restated as `plantsCapacity x plantsMixPrice`, so the haircut multiplies the
  // anchor once per turn at a constant level. `governorEffectiveCap` drops the
  // clamp at full ramp; after that `plantsExtractionHardMin` and capacity price
  // it.
  // A mid-transition sector governs against its transitioning nameplate once
  // divergence is allowed, but on the flip turn (lambda 0) the governor
  // returns the anchor verbatim: the anchor must be the capital-mode
  // counterfactual there, or the flip books headroom plus the blend as
  // revenue (measured +12% on a manufacturing standard to premium flip).
  const baselineHourlyRevenue =
    ((plantsEnabled && strategyIsTransitioning && retoolCapacityRatio !== 1 && plantsRampLambda > 0
      ? plantsNameplateRevenue
      : preFlipNameplateRevenue) /
      TURNS_PER_DAY) *
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
    ? techOutputUnitsMultiplier(strategySupply, techEffects.outputRateMult)
    : 1;
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
    (plantsEnabled ? activeExtractionHardMin : capacityHaircut) *
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
      ? commodityProductionCapacityScale(corp.bankCharter, privateBankingEnabled === true)
      : 1;
  const productionNameplateUnits = plantsEnabled
    ? mothballed
      ? 0
      : plantsCapacity * bankingCommodityScale * activeFraction
    : nameplateUnits * bankingCommodityScale;
  const production = computeContractProduction({
    plantsEnabled,
    actualNameplateUnits: productionNameplateUnits,
    actualProductionFactor: productionFactor,
    fullPolicyNameplateUnits: plantsCapacity * bankingCommodityScale,
    involuntaryProductionFactor:
      disasterOutputFactor *
      nationalizationTransition *
      plantsExtractionHardMin *
      throughputFactor *
      plantsTechOutputMultiplier *
      labourOutputFactor,
    priorSoldUnits:
      sector.soldUnits == null ? sector.soldUnits : sector.soldUnits * priorProductionUnitRatio,
    priorProducedUnits:
      sector.producedUnits == null
        ? sector.producedUnits
        : sector.producedUnits * priorProductionUnitRatio,
    guaranteedDemandUnits: marketPlantsEnabled
      ? contractProductionTargetBySectorId?.get(sector._id.toString())
      : undefined,
    soldFraction: clearingEnabled && clearing ? clearing.soldFraction : null,
  });
  const { producedUnits, soldUnits, contractAchievableUnits, demandThrottleFactor } = production;
  // Plants: revenue is DERIVED from produced output, exactly inverting the P1
  // identity (producedUnits × mixPrice × sales legs == realizedRevenue). At the
  // flip, capacity == impliedOutputUnits(nameplate) and every leg is unchanged,
  // so this reproduces the old realized revenue EXACTLY — which is why the
  // migration above seeds capacity from implied units.
  // Tech price-realization: multiplies realised revenue only, beside the
  // clearing leg. Deliberately NOT on `plantsMixPrice` (which would inflate the
  // nameplate, the world supply ledger and idle upkeep) and NOT on the
  // clearing/priceRealization factor (which feeds the launch governor and
  // would clamp the bonus during the ramp).
  const plantsTechPriceLeg = 1 + techEffects.priceRealizationBonus;
  const plantsDerivedHourlyRevenue = plantsEnabled
    ? ((producedUnits * plantsMixPrice) / TURNS_PER_DAY) *
      clearingRevenueLeg *
      embargoRevenueFactor *
      plantsTechPriceLeg
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
          baselineHourlyRevenue * activeFraction,
          plantsDerivedHourlyRevenue,
          plantsStartTurn,
          currentTurn,
          governorCap,
          governorRampTurns
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
  // Returned as data; the caller pushes it, preserving the single write site.
  const capacityBindingEvent: CapacityBindingEvent | null =
    sector.sectorType === "extraction" &&
    capacityUtil.bindingResource != null &&
    capacityUtil.utilization < CAPACITY_BINDING_THRESHOLD &&
    (sector.capacityUtilization == null || sector.capacityUtilization >= CAPACITY_BINDING_THRESHOLD)
      ? {
          sectorId: sector._id.toString(),
          corporationId: corp._id.toString(),
          stateId: sector.stateId,
          bindingResource: capacityUtil.bindingResource,
          utilization: capacityUtil.utilization,
        }
      : null;

  return {
    clearingRevenueLeg,
    embargoExportExposure,
    embargoRevenueFactor,
    plantsExtractionHardMin,
    activeExtractionHardMin,
    baselineHourlyRevenue,
    plantsTechOutputMultiplier,
    policyTonnageMultiplier,
    productionFactor,
    bankingCommodityScale,
    productionNameplateUnits,
    producedUnits,
    soldUnits,
    contractAchievableUnits,
    demandThrottleFactor,
    plantsTechPriceLeg,
    plantsDerivedHourlyRevenue,
    marketHourlyRevenue,
    militaryDivertedFraction,
    hourlyRevenue,
    capacityBindingEvent,
  };
}
