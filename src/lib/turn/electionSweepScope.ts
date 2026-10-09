import type { ObjectId } from "mongodb";

/**
 * Optional restriction of a turn sweep to specific elections. Absent (the
 * turn processor's call) = every election the sweep would normally touch.
 * Exists for harnesses that drive a handful of races through the real engine
 * without disturbing the rest of a world.
 */
export interface ElectionSweepScope {
  electionIds?: ObjectId[];
}

export function scopeFilter(scope?: ElectionSweepScope): { _id?: { $in: ObjectId[] } } {
  return scope?.electionIds ? { _id: { $in: scope.electionIds } } : {};
}
