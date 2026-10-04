/**
 * Effective influence gains divide actual alignment movement among the plays
 * that contributed to it. effectivePlayPoints preserves background credit and
 * the final share total; it never changes drift or refunds.
 */
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
import type { AlignmentShares } from "../normalize";

export interface PlayContribution {
  id: string;
  poleId: AlignmentPoleId;
  points: number;
}

/**
 * Apportion the observed positive share gain, not the uncapped input pressure.
 * Plays on the same pole share credit in proportion to their contributions;
 * positive background pull retains its own share. Opposition and negative
 * background pull have already reduced the observed gain. Largest remainders
 * allocate whole hundredths deterministically without inventing extra movement.
 * This is reporting only: it never controls drift or refund eligibility.
 */
export function effectivePlayPoints(input: {
  before: AlignmentShares;
  after: AlignmentShares;
  background: Partial<Record<AlignmentPoleId, number>>;
  plays: readonly PlayContribution[];
}): Map<string, number> {
  const result = new Map(input.plays.map((play) => [play.id, 0]));
  const byPole = new Map<AlignmentPoleId, PlayContribution[]>();
  for (const play of input.plays) {
    if (!(play.points > 0) || !Number.isFinite(play.points)) continue;
    const group = byPole.get(play.poleId) ?? [];
    group.push(play);
    byPole.set(play.poleId, group);
  }
  for (const [pole, plays] of byPole) {
    const gain = Math.max(
      0,
      Math.round(((input.after.shares[pole] ?? 0) - (input.before.shares[pole] ?? 0)) * 100)
    );
    const playTotal = plays.reduce((sum, play) => sum + play.points, 0);
    const total = playTotal + Math.max(0, input.background[pole] ?? 0);
    const budget = Math.min(gain, Math.round((gain * playTotal) / total));
    const allocations = plays.map((play) => {
      const exact = (gain * play.points) / total;
      return { id: play.id, units: Math.floor(exact), remainder: exact % 1 };
    });
    allocations.sort(
      (a, b) => b.remainder - a.remainder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
    let remaining = budget - allocations.reduce((sum, a) => sum + a.units, 0);
    for (const allocation of allocations) {
      if (remaining > 0) {
        allocation.units++;
        remaining--;
      }
      result.set(allocation.id, allocation.units / 100);
    }
  }
  return result;
}
