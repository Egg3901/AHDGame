/**
 * Crisis targeting — which nations become flashpoints.
 *
 * A crisis no longer runs an auction. It marks a nation as unusually movable for
 * its window: the turn phase raises that nation's movement ceiling from
 * PER_NATION_TURN_CAP to CRISIS_TURN_CAP while it runs. That grants nobody free
 * ground — it lifts a brake, so it pays off strictly in proportion to what the
 * blocs actually commit, and a crisis nobody acts on changes nothing.
 */
import { ALIGNMENT_GATES, type AlignmentPoleId } from "@/lib/constants/alignmentEras";
import type { AlignmentShares } from "./normalize";

/** Turns a crisis stays open — a quarter game-year. */
export const CRISIS_WINDOW_TURNS = 12;

/**
 * A pole must hold at least this much of a nation for it to count as invested in
 * it. Two blocs at 4 and 3 are not fighting over a country; they are ignoring it.
 */
const TUG_OF_WAR_MIN_SHARE = 25;

/**
 * How contested a nation is. Higher is more contested.
 *
 * Deliberately not just the inverse of the lead: a nation at 6/4 has a lead of 2
 * and is not a flashpoint, it is a backwater. The runner-up's share is what says
 * somebody is actually fighting for the place.
 */
export function contestRank(shares: AlignmentShares, poles: readonly AlignmentPoleId[]): number {
  const held = poles.map((p) => shares.shares[p] ?? 0).sort((a, b) => b - a);
  const top = held[0] ?? 0;
  const second = held[1] ?? 0;
  // Reward investment by both sides, penalise a wide gap.
  return second * 2 - (top - second);
}

/** The most contested entity in a field, or null when the field is empty. */
export function mostContested(
  rows: readonly { entityId: string; shares: AlignmentShares }[],
  poles: readonly AlignmentPoleId[]
): string | null {
  let best: string | null = null;
  let bestRank = -Infinity;
  for (const row of rows) {
    const rank = contestRank(row.shares, poles);
    if (rank > bestRank) {
      best = row.entityId;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Whether a nation is being pulled hard in two directions at once — two blocs
 * both genuinely invested, and no decisive leader. That is what a flashpoint is.
 */
export function tugOfWarCandidate(
  shares: AlignmentShares,
  poles: readonly AlignmentPoleId[]
): boolean {
  const held = poles.map((p) => shares.shares[p] ?? 0).sort((a, b) => b - a);
  const top = held[0] ?? 0;
  const second = held[1] ?? 0;
  if (second < TUG_OF_WAR_MIN_SHARE) return false;
  return top - second <= ALIGNMENT_GATES.nonAligned;
}
