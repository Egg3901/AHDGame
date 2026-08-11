/**
 * Fog for the war-room forecast: the player sees how the opposing force compares,
 * never its composition. Deterministic (no rng) so repeated views are stable and the
 * band can never contradict the odds shown beside it.
 */
export type EnemyBand =
  | "No forces detected"
  | "Token resistance"
  | "Weaker force"
  | "Evenly matched"
  | "Stronger force"
  | "Overwhelming force";

/** Coarse bucket of enemy:own effective strength. */
export function enemyBand(
  attStr: number,
  defStr: number,
  opts: { unopposed?: boolean } = {}
): EnemyBand {
  if (opts.unopposed) return "No forces detected";
  const r = defStr / Math.max(1, attStr);
  if (r < 0.5) return "Token resistance";
  if (r < 0.85) return "Weaker force";
  if (r <= 1.2) return "Evenly matched";
  if (r <= 2.0) return "Stronger force";
  return "Overwhelming force";
}
