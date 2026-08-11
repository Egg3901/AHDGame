/** Single gate for the US House districted-redistricting system. Default off. */
export function isRedistrictingEnabled(
  gameState: { redistrictingEnabled?: boolean } | null | undefined
): boolean {
  return gameState?.redistrictingEnabled === true;
}
