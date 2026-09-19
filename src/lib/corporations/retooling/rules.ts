/**
 * Retooling blends the old and new production recipes over several turns.
 * retoolOperatingCapacityRatio preserves plant value while units change;
 * retoolProductionMeasurements keeps sales and utilization on the same basis.
 *
 * THE CONVERSION INVARIANT (issue #2009): owned capital, destination
 * technology productivity, transitional operating capacity, and commodity
 * output share one unit basis per strategy pair. Owned capital converts to
 * the destination strategy's units once, at the retool boundary, by the RPU
 * ratio (`capacityRescaleRatio`); transitional operating capacity is that
 * converted stock expressed in the blended recipe's units
 * (`transitionalOperatingCapacity`). At every transition progress p, for
 * every strategy pair:
 *
 *   operatingCapacity(p) x effectiveMixPrice(p) == ownedCapital x RPU(from)
 *
 * so a retool is a re-aim, never a capital grant, in either direction. Any
 * operating capacity above converted-stock x blend ratio is unsupported
 * output the sector never built and never paid for.
 */
import type { CorporationType } from "@/lib/constants/corporations";
import { unitYieldForSupply } from "@/lib/constants/capacityEconomy";
import { getEffectiveStrategyRates, getStrategy } from "@/lib/constants/sectorStrategies";

/**
 * Owned stock and paid orders convert to the destination unit at retool time.
 * Production still blends recipes. Convert the stock into that temporary mix
 * for production only, so changing units cannot change the plant's nameplate.
 * Neither owned stock nor paid basis is rewritten by this calculation.
 */
interface RetoolCapacityBasis {
  sectorType: CorporationType;
  strategyId?: string | null;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  retoolRescaleApplied?: boolean;
  currentTurn: number;
}

export function retoolOperatingCapacityRatio(args: RetoolCapacityBasis): number {
  // The flag is proof the owned stock is on the destination basis. Without
  // it the stock may still be source-basis (a pre-rescale or pre-plants
  // commitment surfaced under plants, issue #2009): applying the blend ratio
  // to that stock manufactures unsupported capacity, up to ~585x for an
  // oil_gas to rare_earth_mining pair.
  if (args.retoolRescaleApplied !== true || !args.transitionFromStrategyId) return 1;
  return retoolBlendRatio(args);
}

/**
 * The bare blended-recipe to destination-recipe unit ratio, without the
 * rescale gate. Pure ratio of unit yields: what one destination-basis owned
 * unit is worth in transitional operating units at this progress. The era
 * scale cancels between the two yields.
 */
export function retoolBlendRatio(args: Omit<RetoolCapacityBasis, "retoolRescaleApplied">): number {
  if (!args.transitionFromStrategyId) return 1;
  const effective = getEffectiveStrategyRates(
    args.sectorType,
    args.strategyId ?? "standard",
    args.transitionFromStrategyId,
    args.transitionStartTurn,
    args.currentTurn
  );
  if (!effective.isTransitioning) return 1;
  const target = getStrategy(args.sectorType, args.strategyId ?? "standard");
  const targetYield = unitYieldForSupply(target.supply, 1);
  const effectiveYield = unitYieldForSupply(effective.supply, 1);
  const ratio = effectiveYield / targetYield;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

/**
 * THE invariant as a function: transitional operating capacity for owned
 * capital on a KNOWN basis. `basisConverted` must be true only when the
 * owned stock is on the destination strategy's units (rescaled at the
 * retool boundary, or converted by the stock catch-up). False keeps the
 * stock untouched (ratio 1): a smaller truthful plant, never a grant.
 */
export function transitionalOperatingCapacity(args: {
  sectorType: CorporationType;
  strategyId?: string | null;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  currentTurn: number;
  ownedCapacity: number;
  basisConverted: boolean;
}): number {
  const owned =
    typeof args.ownedCapacity === "number" && Number.isFinite(args.ownedCapacity)
      ? args.ownedCapacity
      : 0;
  if (owned <= 0 || !args.basisConverted) return owned;
  return owned * retoolBlendRatio(args);
}

/**
 * Does this transition's owned stock still sit on the source basis, so the
 * turn must convert it before the blend ratio may touch it (issue #2009)?
 *
 * True exactly when no plants-gated writer could have converted the stock:
 * the rescale flag is absent (legacy row) or explicitly false (committed
 * under capital mode, where the RPU basis does not apply), AND the
 * transition was committed before this sector ran under plants - evidenced
 * by `transitionStartTurn` predating the sector's first plants turn. A
 * missing start or a missing plants anchor cannot prove a plants-era commit,
 * so both read as pre-plants: converting then is the coherent direction
 * (stock and rates end on the destination basis together), while refusing
 * to convert strands source-basis stock under destination rates permanently.
 *
 * Committed under plants without a flag (pre-flag writers, which converted
 * stock but recorded nothing): false. That stock is already converted; only
 * the per-unit opex anchor may still need its heal.
 */
export function needsRetoolStockCatchup(args: {
  transitionFromStrategyId?: string | null;
  retoolRescaleApplied?: boolean;
  transitionStartTurn?: number | null;
  plantsStartTurn?: number | null;
}): boolean {
  if (!args.transitionFromStrategyId) return false;
  if (args.retoolRescaleApplied === true) return false;
  if (args.transitionStartTurn == null) return true;
  if (args.plantsStartTurn == null) return true;
  return args.transitionStartTurn < args.plantsStartTurn;
}

/** Express a prior production measurement in the current blended recipe units. */
export function retoolMeasurementRatio(
  args: RetoolCapacityBasis & { operatingCapacityTurn?: number | null }
): number {
  if (
    args.operatingCapacityTurn == null &&
    args.transitionStartTurn != null &&
    args.currentTurn <= args.transitionStartTurn
  )
    return 1;
  const current = retoolOperatingCapacityRatio(args);
  // Before this correction, measurements used destination stock directly.
  const previous =
    args.operatingCapacityTurn == null
      ? 1
      : retoolOperatingCapacityRatio({ ...args, currentTurn: args.operatingCapacityTurn });
  return current / previous;
}

/** A read-only conversion for clearing and other pre-production consumers. */
export function retoolProductionMeasurements(
  args: RetoolCapacityBasis & {
    operatingCapacityTurn?: number | null;
    operatingCapacityUnits?: number;
    capitalStock?: number;
    producedUnits?: number;
    soldUnits?: number;
    contractAchievableUnits?: number;
  }
): Partial<{
  operatingCapacityTurn: number;
  operatingCapacityUnits: number;
  producedUnits: number;
  soldUnits: number;
  contractAchievableUnits: number;
}> {
  const ratio = retoolMeasurementRatio(args);
  const initializeCapacity =
    args.operatingCapacityUnits == null &&
    args.capitalStock != null &&
    retoolOperatingCapacityRatio(args) !== 1;
  if (ratio === 1 && !initializeCapacity) return {};
  const converted: ReturnType<typeof retoolProductionMeasurements> = {
    operatingCapacityTurn: args.currentTurn,
  };
  if (args.operatingCapacityUnits != null) {
    converted.operatingCapacityUnits = args.operatingCapacityUnits * ratio;
  } else if (args.capitalStock != null) {
    // On the first retool turn, old sales already use the source recipe, but
    // owned stock has converted to destination units. Capacity needs its own
    // conversion even when the sales measurement ratio is one.
    converted.operatingCapacityUnits = args.capitalStock * retoolOperatingCapacityRatio(args);
  }
  for (const key of ["producedUnits", "soldUnits", "contractAchievableUnits"] as const) {
    if (args[key] != null) converted[key] = args[key] * ratio;
  }
  return converted;
}
