/** Campaign presence can be built once per state per turn, using the same boundary as the build command. */
export function presenceBuiltThisTurn(
  updatedAt: Date | string | null | undefined,
  turnStartedAt: Date | string
): boolean {
  return updatedAt != null && new Date(updatedAt).getTime() >= new Date(turnStartedAt).getTime();
}

/** Read the recorded spend only when its own build timestamp belongs to this turn. */
export function presenceSpendThisTurn(
  receipt: { lastBuildAt?: Date | string; lastBuildFunds?: number } | undefined,
  turnStartedAt: Date | string
): number | null {
  return receipt?.lastBuildAt &&
    presenceBuiltThisTurn(receipt.lastBuildAt, turnStartedAt) &&
    typeof receipt.lastBuildFunds === "number" &&
    Number.isFinite(receipt.lastBuildFunds) &&
    receipt.lastBuildFunds >= 0
    ? receipt.lastBuildFunds
    : null;
}
