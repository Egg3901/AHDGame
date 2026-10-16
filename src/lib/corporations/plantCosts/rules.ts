import { COLD_CAPACITY_UPKEEP_FRACTION } from "@/lib/corporations/investment/rules";
import { STRATEGY_TRANSITION_TURNS } from "@/lib/constants/sectorStrategyTypes";
import { eraLaborMultiplier, getSectorLaborShare } from "@/lib/labour/laborCost";

/** Hardware retains the technology payroll intensity from before the service-payroll increase. */
export const HARDWARE_LABOR_INTENSITY = 0.3;

/** Explicit plants price payroll for their production method, including a retool in progress. */
export function plantLaborShare(args: {
  sectorType: string;
  strategyId?: string;
  transitionFromStrategyId?: string | null;
  transitionStartTurn?: number | null;
  currentTurn: number;
  year?: number;
}): number {
  const baseline = getSectorLaborShare(args.sectorType, args.year);
  if (args.sectorType !== "technology") return baseline;
  const share = (strategyId: string | undefined) =>
    strategyId === "hardware" ? HARDWARE_LABOR_INTENSITY * eraLaborMultiplier(args.year) : baseline;
  const target = share(args.strategyId);
  if (!args.transitionFromStrategyId || args.transitionStartTurn == null) return target;
  const progress = Math.min(
    1,
    Math.max(0, (args.currentTurn - args.transitionStartTurn) / STRATEGY_TRANSITION_TURNS)
  );
  const source = share(args.transitionFromStrategyId);
  return source + (target - source) * progress;
}

/** Plant services per unit, priced at the era's nominal output basket. */
export const PLANT_OVERHEAD_OUTPUT_SHARE = 0.04;

/**
 * Share of that overhead that is fixed to the plant's active capacity rather
 * than to what it produced. Site services, plant management and compliance
 * staffing are carried whether the line runs full or starved, so a plant that
 * sells or makes little of its capacity pays the same bill on less revenue.
 * At full utilization the split is invisible (fixed and variable halves are
 * equal), so a fully running plant is billed exactly as before.
 */
export const PLANT_OVERHEAD_FIXED_SHARE = 0.5;

/**
 * Positive process overhead. Payroll, materials and idle-site upkeep are
 * separate bills. The nominal basket already carries the world's era price
 * level; market scarcity and target margin never enter, so the fixed half
 * does not grow when a shortage lifts the selling price. A plant that produced
 * nothing this turn is billed nothing, as before (disaster and halt paths own
 * that case).
 */
export function computePlantOverhead(args: {
  nominalDailyRevenue: number;
  capacity: number;
  producedUnits: number;
  turnsPerDay: number;
  mothballed: boolean;
  /** Share of capacity not mothballed, 0..1. Absent means fully active. */
  activeFraction?: number;
}): number {
  const { nominalDailyRevenue, capacity, producedUnits, turnsPerDay, mothballed } = args;
  if (
    mothballed ||
    ![nominalDailyRevenue, capacity, producedUnits, turnsPerDay].every(Number.isFinite) ||
    nominalDailyRevenue <= 0 ||
    capacity <= 0 ||
    producedUnits <= 0 ||
    turnsPerDay <= 0
  )
    return 0;
  const active = Number.isFinite(args.activeFraction)
    ? Math.max(0, Math.min(1, args.activeFraction as number))
    : 1;
  const billedUnits =
    (1 - PLANT_OVERHEAD_FIXED_SHARE) * producedUnits +
    PLANT_OVERHEAD_FIXED_SHARE * Math.max(producedUnits, capacity * active);
  return (nominalDailyRevenue / capacity / turnsPerDay) * billedUnits * PLANT_OVERHEAD_OUTPUT_SHARE;
}

/** Funded-market site invoices depend on owned capacity, never the asking price or sales. */
export function standingProducerSiteBill(input: {
  nominalHourlyCapacityValue: number;
  activeFraction: number;
  financialPenaltyPercent: number;
}): number {
  const { nominalHourlyCapacityValue, activeFraction, financialPenaltyPercent } = input;
  if (
    ![nominalHourlyCapacityValue, activeFraction, financialPenaltyPercent].every(Number.isFinite) ||
    nominalHourlyCapacityValue < 0 ||
    activeFraction < 0 ||
    activeFraction > 1 ||
    financialPenaltyPercent < 0
  )
    throw new Error("Invalid producer site cost basis");
  const bill =
    nominalHourlyCapacityValue *
    (PLANT_OVERHEAD_OUTPUT_SHARE *
      (activeFraction + COLD_CAPACITY_UPKEEP_FRACTION * (1 - activeFraction)) +
      (activeFraction * financialPenaltyPercent) / 100);
  if (!Number.isFinite(bill)) throw new Error("Producer site cost overflow");
  return bill;
}
