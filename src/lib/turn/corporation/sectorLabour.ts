import type { CorporateSector } from "@/lib/db/types";
import {
  accumulateAutomationIndex,
  accumulateWageIndex,
  clampWageLevel,
  computeSectorLaborCost,
  getSectorLaborShare,
  makeAutomationIndexAccumulator,
  makeWageIndexAccumulator,
  minWageFloorMultiplier,
  type LabourContext,
  WAGE_LEVEL_MIN,
} from "@/lib/labour/laborCost";
import {
  STRIKE_MARGIN_PENALTY_PP,
  STRIKE_REVENUE_THROTTLE,
  lawAdjustedUnionizationThreshold,
  stepStrike,
  trendWorkerExpectation,
} from "@/lib/labour/strikes";
import {
  decayUnionizationUnderBan,
  realWageIndex,
  trendUnionization,
  unionPremium,
  unionizationDriftTarget,
} from "@/lib/labour/unionization";
import { servicesStrikeSoftening } from "@/lib/unions/unionServices";
import {
  accumulateLabourDemand,
  filledWorkers,
  glideStaffingFactor,
  staffingFactorFromTightness,
  type LabourDemandByState,
} from "@/lib/labour/labourMarket";
import { calculateWorkers } from "@/lib/constants/corporations";
import { TURNS_PER_DAY } from "@/lib/constants/turnTime";
import type { SectorTurnEnv } from "./sectorTurnTypes";

export interface SectorLabourProductionEffects {
  strikeActive: boolean;
  outputFactor: number;
  strikeMarginModifier: number;
  /**
   * Pro rata share of desired headcount the sector's state can actually supply,
   * 0 to 1. Exactly 1 wherever the labour market is not oversubscribed.
   */
  staffingFactor: number;
}

/**
 * Resolve labour action effects once for every revenue path in sectorTurn.
 * The legacy revenue anchor and plants output are alternatives, so both consume
 * the same factor. Plants idle-upkeep also receives it only to classify action-
 * idled capacity as involuntary rather than owner-idled capacity.
 */
export function resolveSectorLabourProductionEffects(
  labour: LabourContext,
  sector: Pick<
    CorporateSector,
    "_id" | "strikeStartedAtTurn" | "labourStaffingFactor" | "wageLevel"
  >,
  stateLabourTightness?: number,
  stateDemandWageIndex?: number
): SectorLabourProductionEffects {
  const protectedByAgreement =
    labour.noStrikeProtectedSectorIds?.has(sector._id.toString()) === true;
  // Settlement takes effect before this turn's revenue is calculated. The
  // strike state machine clears persisted state later in the same sector pass,
  // but labor peace must also suppress the production hit immediately.
  const strikeActive =
    labour.unionsEnabled === true && sector.strikeStartedAtTurn != null && !protectedByAgreement;
  const rawIndustrialActionFactor =
    labour.unionsEnabled === true
      ? labour.industrialActionOutputFactorBySectorId?.get(sector._id.toString())
      : undefined;
  const industrialActionFactor =
    typeof rawIndustrialActionFactor === "number" && Number.isFinite(rawIndustrialActionFactor)
      ? Math.max(0, Math.min(1, rawIndustrialActionFactor))
      : 1;
  const strikeFactor = strikeActive ? 1 - STRIKE_REVENUE_THROTTLE : 1;

  // Phase 2 labour rationing. A state's sectors cannot collectively staff more
  // people than the state has, so each fills the same pro rata share of what it
  // asked for and the capacity it could not staff does not produce.
  //
  // Folded into `outputFactor` rather than returned as a separate leg because
  // that factor is already threaded through every revenue and production path
  // in sectorTurn; a separate leg would have to be remembered at four call
  // sites and would be silently dropped at whichever one was missed. It is
  // exactly the same shape as the strike throttle sitting beside it: labour the
  // sector does not have does not make output.
  // Glided from last turn's value rather than snapped to target, so a state
  // that newly reads oversubscribed loses output over ten turns instead of one.
  // See LABOUR_STAFFING_MAX_TURN_MOVE for why this is not capacityHaircutFactor.
  const staffingFactor = glideStaffingFactor(
    staffingFactorFromTightness(
      stateLabourTightness,
      labour.wagesEnabled ? clampWageLevel(sector.wageLevel ?? 1) : 1,
      labour.wagesEnabled ? stateDemandWageIndex : 1
    ),
    sector.labourStaffingFactor
  );

  return {
    strikeActive,
    outputFactor: strikeFactor * industrialActionFactor * staffingFactor,
    strikeMarginModifier: strikeActive ? STRIKE_MARGIN_PENALTY_PP : 0,
    staffingFactor,
  };
}

/**
 * Resolve a sector's headcount for the turn: what it WANTS at its current
 * revenue, and what its state's labour market lets it actually STAFF.
 *
 * Owns the workforce-skill resolution too, because skill only exists here to
 * size headcount. SP4: playable regions resolve skill from the political board
 * (`education.adultSkills`, same 0-100 higher-better scale) when the state has
 * no metric-engine reading.
 *
 * Records DESIRED headcount into the per-state demand accumulator, never the
 * staffed figure. Next turn's tightness sums that accumulator, so recording the
 * rationed result would drive the reading toward 1 and silently switch
 * rationing back off one turn later. Accumulation happens here rather than in
 * `resolveSectorLabourEconomics` because that function early-returns when
 * `labour.wagesEnabled` is off, and how many jobs a sector wants is a fact
 * about the sector rather than about whether the wage system is switched on.
 */
export function resolveSectorHeadcount(args: {
  revenue: number;
  stateId: string;
  rawWorkforceSkillByState: Map<string, number>;
  politicalBoard: Record<string, number> | undefined;
  staffingFactor: number;
  labourDemandByState: LabourDemandByState;
  labourDemandWageIndexByState?: Map<string, import("@/lib/labour/laborCost").WageIndexAccumulator>;
  wageLevel?: number;
}): { desiredWorkers: number; workers: number } {
  const rawSkill =
    args.rawWorkforceSkillByState.get(args.stateId) ??
    args.politicalBoard?.["education.adultSkills"] ??
    null;
  const desiredWorkers = calculateWorkers(args.revenue, rawSkill);
  accumulateLabourDemand(args.labourDemandByState, args.stateId, desiredWorkers);
  if (args.labourDemandWageIndexByState) {
    let wageDemand = args.labourDemandWageIndexByState.get(args.stateId);
    if (!wageDemand) {
      wageDemand = makeWageIndexAccumulator();
      args.labourDemandWageIndexByState.set(args.stateId, wageDemand);
    }
    accumulateWageIndex(wageDemand, desiredWorkers, clampWageLevel(args.wageLevel ?? 1), 1);
  }
  return { desiredWorkers, workers: filledWorkers(desiredWorkers, args.staffingFactor) };
}

export interface SectorLabourEconomicsInput {
  labour: LabourContext;
  sector: CorporateSector;
  sectorCountryId: string;
  currentTurn: number;
  currentYear?: number;
  hourlyRevenue: number;
  grossMaintenance: number;
  computedWorkers: number;
  techLaborCostMultiplier: number;
  costOfLivingIndex?: number;
  unemploymentRate?: number;
  wageIndexByState: SectorTurnEnv["wageIndexByState"];
  automationIndexByState: SectorTurnEnv["automationIndexByState"];
  pendingStrikeEvents: SectorTurnEnv["pendingStrikeEvents"];
}

export interface SectorLabourEconomicsResult {
  maintenance: number;
  sectorLaborCost: number;
  /**
   * Pay for ONE worker in this sector, per real day, which is what union dues
   * and services are priced against (`annualWageFromDaily` in
   * `src/lib/unions/unionServices.ts`).
   *
   * This exists because the dues model had no producer at all: `wagePerWorker`
   * was read by `unionDues`/`unionActions`/`processUnionsTurn` and written by
   * nothing, so every union's `averageAnnualWage` was 0. That made the dues
   * ceiling 0 (dues could not be set at all), the approval dues penalty 0 (so
   * approval sat at the 55 base for every union in the world), and the service
   * bill 0 (services ran free and never lapsed).
   *
   * Derivation: `sectorLaborCost` is this sector's whole labour bill for one
   * turn, so the per-worker per-turn figure is that over the headcount, and a
   * day is {@link TURNS_PER_DAY} turns. Read back as an annual figure this is
   * `perTurn × TURNS_PER_YEAR`, which is the same basis the labour bill itself
   * is charged on, so dues are a true share of pay rather than a scale
   * mismatch. Undefined when the sector has no workers, so a headcount-less
   * sector contributes no wage rather than an Infinity.
   */
  wagePerWorker?: number;
  newUnionization?: number;
  newWorkerExpectationIndex?: number;
  newStrikeStartedAtTurn?: number | null;
  newStrikeCooldownUntilTurn?: number | null;
}

/**
 * Own the complete wage, unionization, and strike state transition for one
 * sector. The caller supplies already-derived revenue and workforce inputs;
 * this module owns labour policy reads, indexes, and next-turn state.
 */
export function resolveSectorLabourEconomics({
  labour,
  sector,
  sectorCountryId,
  currentTurn,
  currentYear,
  hourlyRevenue,
  grossMaintenance,
  computedWorkers,
  techLaborCostMultiplier,
  costOfLivingIndex,
  unemploymentRate,
  wageIndexByState,
  automationIndexByState,
  pendingStrikeEvents,
}: SectorLabourEconomicsInput): SectorLabourEconomicsResult {
  if (!labour.wagesEnabled) {
    return { maintenance: grossMaintenance, sectorLaborCost: 0 };
  }

  // An active agreement is a floor UNDER the employer's own wage level for the
  // life of the agreement, not a rewrite of it. Persisting the floor into
  // `sector.wageLevel` would make every settlement permanent, nothing lowers
  // the field again when the agreement expires, so the term length would
  // carry no meaning and pay would only ever ratchet up.
  const negotiatedWageFloor =
    labour.collectiveAgreementWageFloorBySectorId?.get(sector._id.toString()) ?? WAGE_LEVEL_MIN;
  const wageLevel = Math.max(clampWageLevel(sector.wageLevel ?? 1), negotiatedWageFloor);
  const floorMultiplier = minWageFloorMultiplier(
    sector.sectorType,
    labour.minWageRatioByCountry?.get(sectorCountryId) ?? 0
  );
  const unionsBanned =
    labour.unionsEnabled && labour.unionsBannedByCountry?.has(sectorCountryId) === true;
  const unionPremiumPercent =
    labour.unionsEnabled && !unionsBanned ? unionPremium(sector.unionization ?? 0) : 0;
  const wageMultiplier =
    wageLevel * floorMultiplier * techLaborCostMultiplier * (1 + unionPremiumPercent / 100);

  let wageAccumulator = wageIndexByState.get(sector.stateId);
  if (!wageAccumulator) {
    wageAccumulator = makeWageIndexAccumulator();
    wageIndexByState.set(sector.stateId, wageAccumulator);
  }
  accumulateWageIndex(wageAccumulator, computedWorkers, wageLevel, floorMultiplier);

  let automationAccumulator = automationIndexByState.get(sector.stateId);
  if (!automationAccumulator) {
    automationAccumulator = makeAutomationIndexAccumulator();
    automationIndexByState.set(sector.stateId, automationAccumulator);
  }
  accumulateAutomationIndex(automationAccumulator, computedWorkers, techLaborCostMultiplier);

  const split = computeSectorLaborCost({
    hourlyRevenue,
    grossMaintenance,
    laborShare0: getSectorLaborShare(sector.sectorType, currentYear),
    wageMultiplier,
  });
  const result: SectorLabourEconomicsResult = {
    maintenance: split.maintenance,
    sectorLaborCost: split.laborCost,
    // Per-worker daily pay, the basis union dues and services are priced
    // against. See the field docs on SectorLabourEconomicsResult.
    wagePerWorker:
      computedWorkers > 0 && Number.isFinite(split.laborCost)
        ? (split.laborCost / computedWorkers) * TURNS_PER_DAY
        : undefined,
  };

  if (!labour.unionsEnabled) return result;

  const unionLawBias = labour.fullEnabled
    ? labour.unionLawBiasByCountry?.get(sectorCountryId)
    : undefined;
  // Union dues v1: resolve the representing union DIRECTLY off the sector's own
  // `representingUnionId`, never by (countryId, sectorType), players can found
  // rivals in the same industry, so the industry pair no longer identifies one
  // union, and a sector with no `representingUnionId` must not inherit some
  // other union's approval.
  const representingUnion =
    labour.fullEnabled && sector.representingUnionId
      ? labour.unionsById?.get(sector.representingUnionId.toString())
      : undefined;
  let newUnionization = unionsBanned
    ? decayUnionizationUnderBan(sector.unionization ?? 0)
    : trendUnionization(
        sector.unionization ?? 0,
        unionizationDriftTarget({
          wageLevel,
          costOfLivingIndex,
          unemploymentRate,
          minWageKaitzRatio: labour.minWageRatioByCountry?.get(sectorCountryId),
          unionLawBias,
          representingUnionApproval: representingUnion?.approval,
        })
      );
  const realWage = realWageIndex(wageLevel, costOfLivingIndex);
  const newWorkerExpectationIndex = trendWorkerExpectation(sector.workerExpectationIndex, realWage);
  // Union dues v1: service programmes damp the strike trigger's gap for
  // sectors the running union represents. 0 when unrepresented or every
  // service is off, so an unheld sector's strike math is unchanged.
  const strikeSoftening = representingUnion
    ? servicesStrikeSoftening(representingUnion.activeServices)
    : 0;
  const strikeStep = stepStrike({
    unionization: newUnionization,
    realWage,
    workerExpectation: newWorkerExpectationIndex,
    turn: currentTurn,
    prior: {
      strikeStartedAtTurn: sector.strikeStartedAtTurn ?? null,
      strikeCooldownUntilTurn: sector.strikeCooldownUntilTurn ?? null,
    },
    ...(unionLawBias !== undefined && {
      unionizationThreshold: lawAdjustedUnionizationThreshold(unionLawBias),
    }),
    unionsBanned,
    noStrikeProtected: labour.noStrikeProtectedSectorIds?.has(sector._id.toString()) === true,
    strikeSoftening,
  });
  if (strikeStep.unionizationBump > 0) {
    newUnionization = Math.min(100, newUnionization + strikeStep.unionizationBump);
  }
  if (strikeStep.event) {
    pendingStrikeEvents.push({
      sectorId: sector._id.toString(),
      sectorType: sector.sectorType,
      countryId: sectorCountryId,
      event: strikeStep.event,
    });
  }

  return {
    ...result,
    newUnionization,
    newWorkerExpectationIndex,
    newStrikeStartedAtTurn: strikeStep.next.strikeStartedAtTurn,
    newStrikeCooldownUntilTurn: strikeStep.next.strikeCooldownUntilTurn,
  };
}
