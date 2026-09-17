/** Campaign presence can be built once per state per turn, using the same boundary as the build command. */
export function presenceBuiltThisTurn(
  updatedAt: Date | string | null | undefined,
  turnStartedAt: Date | string
): boolean {
  return updatedAt != null && new Date(updatedAt).getTime() >= new Date(turnStartedAt).getTime();
}
