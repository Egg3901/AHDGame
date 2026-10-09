/** Existing plants can buy integer top-ups on the same minimum as the player build command. */
export function existingPlantGrowthUnits(
  affordableUnits: number,
  inFlightHeadroom: number
): number {
  if (!Number.isFinite(affordableUnits) || !Number.isFinite(inFlightHeadroom)) return 0;
  return Math.max(0, Math.floor(Math.min(affordableUnits, inFlightHeadroom)));
}

/** Size top-ups from proven throughput; the full facility floor belongs to new sites. */
export function existingPlantGrowthStep(runUnits: number, stepShare: number): number {
  if (!Number.isFinite(runUnits) || runUnits <= 0 || !Number.isFinite(stepShare) || stepShare <= 0)
    return 0;
  return Math.max(1, Math.floor(runUnits * Math.min(1, stepShare)));
}
