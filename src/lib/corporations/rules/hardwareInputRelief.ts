/** Hardware process efficiency reaches 15% over twelve world turns. */
export const HARDWARE_INPUT_REDUCTION = 0.15;
export const HARDWARE_INPUT_RELIEF_TURNS = 12;

/** Missing activation leaves an existing world unchanged until its release is admitted. */
export function hardwareInputMultiplier(
  sectorType: string,
  strategyId: string,
  currentTurn: number,
  startTurn: number | null | undefined
): number {
  if (
    sectorType !== "technology" ||
    strategyId !== "hardware" ||
    typeof startTurn !== "number" ||
    !Number.isFinite(startTurn) ||
    startTurn < 0 ||
    !Number.isFinite(currentTurn)
  )
    return 1;
  const progress = Math.max(
    0,
    Math.min(1, (currentTurn - startTurn) / HARDWARE_INPUT_RELIEF_TURNS)
  );
  return 1 - HARDWARE_INPUT_REDUCTION * progress;
}
