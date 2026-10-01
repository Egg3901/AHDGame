/**
 * Keep every tally field while reducing the append-only snapshot history to
 * the turn numbers used by accumulation and primary-resolution guards.
 */
export const TALLY_WITH_SNAPSHOT_TURNS_ONLY = {
  "turnSnapshots.recordedAt": 0,
  "turnSnapshots.cumulativeVotes": 0,
  "turnSnapshots.sharesPct": 0,
  "turnSnapshots.seatsEstimate": 0,
} as const;

/** Keep every tally field and only the latest snapshot used for recovery. */
export const TALLY_WITH_LATEST_SNAPSHOT_ONLY = {
  turnSnapshots: { $slice: -1 },
} as const;
