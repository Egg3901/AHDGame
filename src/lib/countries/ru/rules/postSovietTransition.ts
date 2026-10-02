/** A historical date only opens a post-Soviet constitutional decision. */
export function hasAuthorizedPostSovietTransition(
  currentTurn: number,
  successionSinceTurn: number | undefined,
  mandateSinceTurn: number | undefined
): boolean {
  const succession = successionSinceTurn ?? 0;
  const mandate = mandateSinceTurn ?? 0;
  return (
    Number.isSafeInteger(currentTurn) &&
    Number.isSafeInteger(succession) &&
    Number.isSafeInteger(mandate) &&
    succession > 0 &&
    mandate > 0 &&
    succession <= currentTurn &&
    mandate <= currentTurn
  );
}
