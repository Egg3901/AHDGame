import type { CorporateSector } from "@/lib/db/types";
import { IDLE_UPKEEP_FRACTION, MOTHBALL_UPKEEP_FRACTION } from "@/lib/constants/capacityEconomy";
import { TURNS_PER_DAY } from "@/lib/constants/corporations";
import { idleUpkeepUnitPrice, ownerIdleUnits } from "@/lib/corporations/physicalPnl";

/**
 * P3a: idle / mothball upkeep, plants only (#588).
 *
 * Maintenance elsewhere derives from REALIZED revenue, so it scales with
 * utilization: a sector running at 40% pays 40% of maintenance and idle
 * capacity is free to hold. Under plants that is not honest — capacity is a
 * thing you BOUGHT and must keep, and an over-built sector should feel it.
 *
 * The charge is ADDITIVE on idle units rather than a multiplier on
 * maintenance, for two reasons: the multiplier form divides by utilization,
 * which is undefined at zero and zero is exactly the mothballed case; and the
 * additive form prices idle units at nominal mix prices instead of inheriting
 * the sales legs, so an idle plant's upkeep does not fall because the market
 * price of its output fell.
 *
 * Two corrections are load-bearing and easy to undo by accident:
 *
 * 1. The unit price is ANCHORED, not `(1 - margin_now)`. Pricing a fixed
 *    site/skeleton-crew cost off the live margin made it GROW as the margin
 *    fell, so the most distressed sectors paid the most per idle unit. Stamped
 *    once on the sector's first plants turn and then held.
 * 2. The base is OWNER-idle capacity, not `capacity - producedUnits`. Every
 *    live sector sat at the launch governor's 0.85 throughput floor —
 *    input-starved, not over-built — and was already losing that 15% off its
 *    top line before being billed upkeep on the same 15% again.
 *
 * The flip turn seeds capacity at 1.1x implied units, so utilization is ~0.909
 * and this would be a visible ~2.7% profit step on a tier whose promise is that
 * the flip changes nothing. It is faded in over the same governor ramp every
 * other plants leg uses. A MOTHBALLED sector is not ramped: mothballing is a
 * deliberate action taken after the flip, so there is no continuity to protect.
 */
export interface IdleUpkeepInput {
  sector: Pick<CorporateSector, "plantsUpkeepMarginBasisAnchor">;
  plantsEnabled: boolean;
  mothballed: boolean;
  effectiveMargin: number;
  plantsMixPrice: number;
  plantsCapacity: number;
  producedUnits: number;
  /** Governor ramp, 0 on the flip turn rising to 1. */
  plantsRampLambda: number;
  /**
   * Output the owner did NOT choose to give up. The production-policy slider
   * and tech output multiplier are deliberately excluded: those ARE owner
   * decisions, so capacity idled by throttling the slider is still billed —
   * the case the constant was written for.
   */
  disasterOutputFactor: number;
  nationalizationTransition: number;
  plantsExtractionHardMin: number;
  throughputFactor: number;
  labourOutputFactor: number;
}

export interface IdleUpkeepResult {
  /** Hourly upkeep charged for idle (or mothballed) capacity. */
  plantsUpkeepCost: number;
  /** The live margin basis, stamped on the sector's first plants turn. */
  plantsUpkeepMarginBasisLive: number;
  /** The held anchor, or null before it has been stamped. */
  plantsUpkeepMarginBasisAnchor: number | null;
}

export function computeIdleUpkeep(input: IdleUpkeepInput): IdleUpkeepResult {
  const plantsUpkeepMarginBasisLive = Math.max(0, 1 - input.effectiveMargin / 100);
  const plantsUpkeepMarginBasisAnchor =
    typeof input.sector.plantsUpkeepMarginBasisAnchor === "number" &&
    Number.isFinite(input.sector.plantsUpkeepMarginBasisAnchor)
      ? input.sector.plantsUpkeepMarginBasisAnchor
      : null;

  const plantsUnitUpkeepHourly = input.plantsEnabled
    ? idleUpkeepUnitPrice({
        mixPrice: input.plantsMixPrice,
        turnsPerDay: TURNS_PER_DAY,
        anchoredMarginBasis: plantsUpkeepMarginBasisAnchor,
        liveMarginBasis: plantsUpkeepMarginBasisLive,
      })
    : 0;

  const involuntaryThrottle =
    input.disasterOutputFactor *
    input.nationalizationTransition *
    input.plantsExtractionHardMin *
    input.throughputFactor *
    input.labourOutputFactor;

  const plantsOwnerIdleUnits = input.plantsEnabled
    ? ownerIdleUnits({
        capacity: input.plantsCapacity,
        producedUnits: input.producedUnits,
        involuntaryThrottle,
      })
    : 0;

  const plantsUpkeepCost = input.mothballed
    ? plantsUnitUpkeepHourly * input.plantsCapacity * MOTHBALL_UPKEEP_FRACTION
    : input.plantsEnabled
      ? plantsUnitUpkeepHourly *
        plantsOwnerIdleUnits *
        IDLE_UPKEEP_FRACTION *
        input.plantsRampLambda
      : 0;

  return { plantsUpkeepCost, plantsUpkeepMarginBasisLive, plantsUpkeepMarginBasisAnchor };
}
