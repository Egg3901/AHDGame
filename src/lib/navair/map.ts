import { STRATEGIC_REGIONS } from "@/lib/military/regions";
import { REGION_ADJACENCY, regionNeighbors } from "@/lib/military/regionTopology";
import type { StrategicRegion } from "@/lib/military/types";

/**
 * Geography adapter for the naval and air layer.
 *
 * This is deliberately NOT a port of the reference's `map.js`. The reference carries its
 * own copy of the region table; the game already has one, and the two agree exactly (the
 * reference was lifted from `regions.ts`, and both hold the same 19 ids). So the region
 * data and adjacency come from the game and only the graph algorithms are ported.
 *
 * Keeping one geography is the point. A second region table would drift from the one the
 * ground war, occupation, and peace terms already speak.
 */

export type RegionId = string;

export const REGIONS: readonly StrategicRegion[] = STRATEGIC_REGIONS;

const BY_ID = new Map<RegionId, StrategicRegion>(STRATEGIC_REGIONS.map((r) => [r.id, r]));

export function region(id: RegionId): StrategicRegion | undefined {
  return BY_ID.get(id);
}

export function neighbors(id: RegionId): RegionId[] {
  return regionNeighbors(id as keyof typeof REGION_ADJACENCY) ?? [];
}

export function areAdjacent(a: RegionId, b: RegionId): boolean {
  return neighbors(a).includes(b);
}

/** Regions reachable in `hops` or fewer, including `from` itself. */
export function within(from: RegionId, hops: number): RegionId[] {
  const seen = new Set<RegionId>([from]);
  let edge: RegionId[] = [from];
  for (let h = 0; h < hops; h++) {
    const next: RegionId[] = [];
    for (const r of edge) {
      for (const n of neighbors(r)) {
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    edge = next;
  }
  return [...seen];
}

/** Hop distance between two regions, or Infinity if disconnected. */
export function distance(from: RegionId, to: RegionId): number {
  if (from === to) return 0;
  const seen = new Set<RegionId>([from]);
  let edge: RegionId[] = [from];
  let d = 0;
  while (edge.length) {
    d++;
    const next: RegionId[] = [];
    for (const r of edge) {
      for (const n of neighbors(r)) {
        if (n === to) return d;
        if (seen.has(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    edge = next;
  }
  return Infinity;
}

/** Hops to the nearest region in `targets`, or Infinity. */
export function distanceToAny(from: RegionId, targets: RegionId[]): number {
  let best = Infinity;
  for (const t of targets) best = Math.min(best, distance(from, t));
  return best;
}

/** Can a fleet sit here? Land regions are closed to naval assets. */
export function isWaterAccessible(id: RegionId): boolean {
  const r = region(id);
  return !!r && (r.type === "naval" || r.type === "mixed");
}

/**
 * Can a fleet sail THROUGH here? Any region with a port has a coastline to sail past.
 *
 * Distinct from `isWaterAccessible` on purpose. Western Europe is typed `land` because
 * that is what the theatre is, but a fleet plainly transits the Atlantic approaches into
 * the Mediterranean; routing on region type alone made the Med unreachable from the North
 * Atlantic, which is wrong. Landlocked regions (Central Asia, port 0) stay closed.
 */
export function isNavigable(id: RegionId): boolean {
  const r = region(id);
  return !!r && r.port > 0;
}

/**
 * Sailing distance in hops: shortest path over navigable regions, ending in water.
 *
 * Infinity when there is no sea route, which is the answer for a landlocked destination
 * and for any region a fleet simply cannot get to.
 */
export function navalDistance(from: RegionId, to: RegionId): number {
  if (!isWaterAccessible(to)) return Infinity;
  if (from === to) return 0;
  const seen = new Set<RegionId>([from]);
  let edge: RegionId[] = [from];
  let d = 0;
  while (edge.length) {
    d++;
    const next: RegionId[] = [];
    for (const r of edge) {
      for (const n of neighbors(r)) {
        if (n === to) return d;
        if (seen.has(n) || !isNavigable(n)) continue;
        seen.add(n);
        next.push(n);
      }
    }
    edge = next;
  }
  return Infinity;
}

/**
 * The furthest region toward `to` a fleet can reach this turn, or null if it is already
 * there or there is no sea route.
 *
 * Redeployment across the map takes several turns; without this a squadron could only
 * ever answer a threat one hop away, so anything three hops off was permanently safe.
 */
export function stepToward(from: RegionId, to: RegionId, maxHops: number): RegionId | null {
  if (from === to || !Number.isFinite(navalDistance(from, to))) return null;
  let best: RegionId | null = null;
  let bestDist = navalDistance(from, to);
  for (const candidate of REGIONS) {
    if (candidate.id === from || !isWaterAccessible(candidate.id)) continue;
    const cost = navalDistance(from, candidate.id);
    if (!Number.isFinite(cost) || cost > maxHops) continue;
    const remaining = navalDistance(candidate.id, to);
    if (!Number.isFinite(remaining) || remaining >= bestDist) continue;
    bestDist = remaining;
    best = candidate.id;
  }
  return best;
}

/**
 * Where a fleet supporting operations at `region` actually sits.
 *
 * A land region is not a place a ship can be. Defaulting a naval formation onto the
 * front's own region put carrier groups in Eastern Europe, which is both nonsense and
 * quietly wrong in effect: the fleet contested "sea control" over a land tile that no
 * front ever reads, so a navy could be totally dominant and change nothing.
 *
 * Returns the region itself when it is water, otherwise the adjacent navigable water with
 * the best port, which is where a fleet operating in support of that front would base.
 * Null when there is no water within reach at all, which is the honest answer for a
 * genuinely landlocked theatre: that fleet cannot participate.
 */
export function navalStationFor(frontRegion: RegionId, homeRegion?: RegionId): RegionId | null {
  if (isWaterAccessible(frontRegion)) return frontRegion;

  const options = neighbors(frontRegion).filter(isWaterAccessible).filter(isNavigable);
  if (!options.length) return null;

  // Nearest to home first, port size only as a tiebreak.
  //
  // Ranking by port alone put the US fleet fighting in Central Europe into the PERSIAN
  // GULF, because the Middle East (port 6) outranks the Arctic (port 2) as a neighbour of
  // Eastern Europe. It did the same to the Royal Navy and the Irish fleet, parking both
  // in the Mediterranean because it out-ports the North Atlantic 8 to 7. A fleet bases
  // where it can actually sail from, and that is near home, not wherever the biggest
  // harbour happens to be.
  return [...options].sort((a, b) => {
    if (homeRegion) {
      const da = navalDistance(homeRegion, a);
      const db = navalDistance(homeRegion, b);
      if (da !== db) return da - db;
    }
    return portOf(b) - portOf(a);
  })[0];
}

function portOf(id: RegionId): number {
  return region(id)?.port ?? 0;
}
