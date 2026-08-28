import { regionNeighbors } from "@/lib/military/regionTopology";
import type { RegionCode } from "@/lib/military/types";

/**
 * The regions a war is actually fought across.
 *
 * A conflict has a primary region and may extend into adjacent ground as it grows. Every
 * consumer should ask this rather than reading `region` directly, or a war that has
 * spread will keep being treated as if it were still confined to where it started.
 */
export function conflictRegions(conflict: {
  region: RegionCode;
  extendedRegions?: RegionCode[];
}): RegionCode[] {
  return [...new Set<RegionCode>([conflict.region, ...(conflict.extendedRegions ?? [])])];
}

/**
 * May this war extend into `target`?
 *
 * Only into ground touching the theatre it already holds. The invariant is connectivity:
 * a war must be one contiguous piece of map, because a "single conflict" spanning two
 * unconnected theatres is two wars wearing one document, and every front-level
 * calculation (supply, air superiority, sea control) would silently average across a gap
 * no army could cross.
 */
export function canExtendConflictTo(
  conflict: { region: RegionCode; extendedRegions?: RegionCode[] },
  target: RegionCode
): boolean {
  const held = conflictRegions(conflict);
  if (held.includes(target)) return false;
  return held.some((r) => regionNeighbors(r).includes(target));
}

/** Extend a war into an adjacent region, or return it unchanged when that is not legal. */
export function extendConflict<T extends { region: RegionCode; extendedRegions?: RegionCode[] }>(
  conflict: T,
  target: RegionCode
): T {
  if (!canExtendConflictTo(conflict, target)) return conflict;
  return { ...conflict, extendedRegions: [...(conflict.extendedRegions ?? []), target] };
}

/**
 * Whether two regions are close enough to be one theatre.
 *
 * Used when deciding if a newly joined belligerent's ground extends the existing war or
 * opens a separate one.
 */
export function regionsFormOneTheatre(a: RegionCode, b: RegionCode): boolean {
  return a === b || regionNeighbors(a).includes(b);
}
