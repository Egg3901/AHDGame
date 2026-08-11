/** Label helpers for character-creation player counts. */

/** "0 registered players" / "1 registered player" / "N registered players" */
export function registeredPlayersLabel(n: number): string {
  return `${n} registered player${n === 1 ? "" : "s"}`;
}

/** "(0 players here)" / "(1 player here)" / "(N players here)" */
export function playersHereSuffix(n: number): string {
  return `(${n} player${n === 1 ? "" : "s"} here)`;
}
