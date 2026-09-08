/**
 * Retooling blends the old and new production recipes over several turns.
 * retoolOperatingCapacityRatio preserves plant value while units change;
 * retoolProductionMeasurements keeps sales and utilization on the same basis.
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
  if (args.retoolRescaleApplied !== true || !args.transitionFromStrategyId) return 1;
  const effective = getEffectiveStrategyRates(
    args.sectorType,
    args.strategyId ?? "standard",
    args.transitionFromStrategyId,
    args.transitionStartTurn,
    args.currentTurn
  );
  if (!effective.isTransitioning) return 1;
  const target = getStrategy(args.sectorType, args.strategyId ?? "standard");
  // The era scale cancels between the two yields.
  const targetYield = unitYieldForSupply(target.supply, 1);
  const effectiveYield = unitYieldForSupply(effective.supply, 1);
  const ratio = effectiveYield / targetYield;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
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
  if (ratio === 1) return {};
  const converted: ReturnType<typeof retoolProductionMeasurements> = {
    operatingCapacityTurn: args.currentTurn,
  };
  const capacity = args.operatingCapacityUnits ?? args.capitalStock;
  if (capacity != null) converted.operatingCapacityUnits = capacity * ratio;
  for (const key of ["producedUnits", "soldUnits", "contractAchievableUnits"] as const) {
    if (args[key] != null) converted[key] = args[key] * ratio;
  }
  return converted;
}
