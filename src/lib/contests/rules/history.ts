import type { ContestRecordKind } from "@/lib/db/types/contestRound";

export interface ContestPlacing {
  kind: ContestRecordKind;
  roundNumber: number;
  iterationKey?: string;
  rank: number;
}

/** Winners are the positive-score awarded placings, rather than every top-three standing. */
export function contestAchievementSlugs(placings: readonly ContestPlacing[]): string[] {
  const slugs: string[] = [];
  if (placings.length > 0) slugs.push("contest_podium");
  const wins = placings.filter((p) => p.rank === 1);
  if (wins.length === 0) return slugs;
  slugs.push("contest_first_win");
  if (wins.length >= 3) slugs.push("contest_repeat_winner");
  if (new Set(wins.map((w) => w.kind)).size >= 3) slugs.push("contest_versatile_winner");
  if (new Set(wins.map((w) => w.iterationKey).filter(Boolean)).size >= 2) {
    slugs.push("contest_cross_iteration");
  }
  const groups = new Map<string, Set<number>>();
  for (const w of wins) {
    // Unknown legacy iterations cannot establish a streak across a reset.
    if (!w.iterationKey || w.kind === "referrals_iteration") continue;
    const key = `${w.kind}:${w.iterationKey}`;
    const rounds = groups.get(key) ?? new Set<number>();
    rounds.add(w.roundNumber);
    groups.set(key, rounds);
  }
  if (
    [...groups.values()].some((rounds) =>
      [...rounds].some((n) => rounds.has(n + 1) && rounds.has(n + 2))
    )
  )
    slugs.push("contest_winning_streak");
  return slugs;
}

/** Input is ordered by settlement. Attribute each milestone to its first qualifying result. */
export function contestAchievementMilestones(
  placings: readonly (ContestPlacing & { characterId?: string | null })[]
): Array<{ slug: string; characterId?: string }> {
  const awarded = new Set<string>();
  const history: ContestPlacing[] = [];
  const result: Array<{ slug: string; characterId?: string }> = [];
  for (const placing of placings) {
    history.push(placing);
    for (const slug of contestAchievementSlugs(history)) {
      if (awarded.has(slug)) continue;
      awarded.add(slug);
      result.push({ slug, ...(placing.characterId ? { characterId: placing.characterId } : {}) });
    }
    if (awarded.size === 6) break;
  }
  return result;
}
