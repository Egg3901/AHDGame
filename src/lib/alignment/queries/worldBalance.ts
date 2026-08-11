/**
 * How the world's standing divides between the poles, two ways.
 *
 * By economy answers "how much of the world's output sits with each bloc"; by
 * nations answers "how many countries". They disagree — a bloc can hold most of
 * the map and little of the money — and the gap between them is worth seeing,
 * which is why both ship rather than one being chosen for the player.
 *
 * Pure. Returns null for an empty roster so the caller can hide the bar; a
 * fabricated 100% remainder would read as "the world is non-aligned" rather
 * than "there is no data".
 */
import type { AlignmentPoleId } from "@/lib/constants/alignmentEras";
import { roundToShareGrid } from "../normalize";
import type { NationStanding } from "./nationStanding";

export interface WorldBalanceWeighting {
  shares: Partial<Record<AlignmentPoleId, number>>;
  nonAligned: number;
}

export interface WorldBalance {
  byEconomy: WorldBalanceWeighting;
  byNations: WorldBalanceWeighting;
  /**
   * How many nations fed each weighting. They differ whenever a nation has no
   * GDP on record, so the toggle captions the active one rather than letting
   * the two silently disagree.
   */
  economyCount: number;
  nationCount: number;
}

function weighted(
  entries: readonly { standing: NationStanding; weight: number }[],
  poles: readonly AlignmentPoleId[]
): WorldBalanceWeighting {
  const totalWeight = entries.reduce((sum, e) => sum + e.weight, 0);
  // No basis to average on. Report a full remainder rather than borrowing the
  // other weighting's answer, which would state a figure nothing supports.
  if (totalWeight <= 0) return { shares: {}, nonAligned: 100 };

  const shares: Partial<Record<AlignmentPoleId, number>> = {};
  for (const pole of poles) {
    const acc = entries.reduce((sum, e) => sum + (e.standing.shares[pole] ?? 0) * e.weight, 0);
    shares[pole] = roundToShareGrid(acc / totalWeight);
  }
  // The remainder is derived, never accumulated separately, so the weighting
  // always totals exactly 100 however the poles rounded.
  const poleTotal = poles.reduce((sum, p) => sum + (shares[p] ?? 0), 0);
  return { shares, nonAligned: roundToShareGrid(100 - poleTotal) };
}

export function computeWorldBalance(
  standings: readonly NationStanding[],
  gdpUsdMillionsByEntity: ReadonlyMap<string, number>,
  poles: readonly AlignmentPoleId[]
): WorldBalance | null {
  if (standings.length === 0) return null;

  const priced = standings
    .map((standing) => ({ standing, weight: gdpUsdMillionsByEntity.get(standing.entityId) ?? 0 }))
    .filter((e) => e.weight > 0);

  return {
    byEconomy: weighted(priced, poles),
    byNations: weighted(
      standings.map((standing) => ({ standing, weight: 1 })),
      poles
    ),
    economyCount: priced.length,
    nationCount: standings.length,
  };
}
