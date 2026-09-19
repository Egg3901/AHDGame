/**
 * UK JR surprise spawn hazard — rarer than SCOTUS surprise (0.004), tuned for
 * occasional institutional weather over a long playthrough.
 */
export const UK_JR_SURPRISE_SPAWN_PROBABILITY_PER_TURN = 0.0035;

export function rollUkJrSurpriseSpawn(
  randomDraw: number,
  probability: number = UK_JR_SURPRISE_SPAWN_PROBABILITY_PER_TURN
): boolean {
  return randomDraw < probability;
}
