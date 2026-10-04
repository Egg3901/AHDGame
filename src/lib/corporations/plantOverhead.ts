/** Plant services per unit, priced at the era's nominal output basket. */
export const PLANT_OVERHEAD_OUTPUT_SHARE = 0.04;

/**
 * Positive process overhead for output actually produced. Payroll, materials
 * and idle-site upkeep are separate bills. The nominal basket already carries
 * the world's era price level; market scarcity and target margin never enter.
 */
export function computePlantOverhead(args: {
  nominalDailyRevenue: number;
  capacity: number;
  producedUnits: number;
  turnsPerDay: number;
  mothballed: boolean;
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
  return (
    (nominalDailyRevenue / capacity / turnsPerDay) * producedUnits * PLANT_OVERHEAD_OUTPUT_SHARE
  );
}
