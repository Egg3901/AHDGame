/**
 * Chooses between the allocation a resolved election actually seated and the
 * live projection recomputed from the current tally.
 *
 * Ticket #1277: the detail page recomputed the allocation on every load, so a
 * FINISHED election rendered a different result whenever an input to the
 * allocator drifted underneath it — a player held 7 seats while the results
 * page showed 16. `generalResolution` already persists the authoritative
 * allocation to the tally's root `seatsEstimate` alongside `finalized: true`,
 * so once that flag is set the persisted value is the only honest answer.
 *
 * ⚠️ `finalized` is the gate, NOT "is the race past its end time".
 * `accumulateVoteTurn` rewrites the SAME root `seatsEstimate` field every turn
 * of the count (`tallyManagement.ts`, the tally `$set` beside the snapshot
 * push), so before resolution that field holds a mid-count projection. A race
 * that has passed `endTime` but has not yet been resolved by the turn processor
 * must keep projecting, or it would present one turn's in-flight estimate as
 * the final result.
 */

/** The two tally fields this decision reads. */
export interface SeatsEstimateSource {
  finalized?: boolean;
  seatsEstimate?: Record<string, number>;
}

export function resolvedSeatsEstimate(
  tally: SeatsEstimateSource | null | undefined,
  computed: Record<string, number> | null
): Record<string, number> | null {
  const persisted = tally?.finalized === true ? tally.seatsEstimate : undefined;
  // An empty map is not an allocation — older tallies and races that resolved
  // with no eligible candidates carry `{}`, and those still want the projection.
  if (persisted && Object.keys(persisted).length > 0) return { ...persisted };
  return computed;
}
