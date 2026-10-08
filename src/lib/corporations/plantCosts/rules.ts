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
