import type { Db } from "mongodb";
import { IDENTITY_OBSERVATIONS_COLLECTION } from "@/lib/db/types/identityObservation";
import { ensureIndex } from "./helpers";

/** 90 days. The retention period for identity history, enforced in the
 * database rather than in application code. Anchored on `lastSeen`, so a run
 * is reaped 90 days after it ENDED and an IP in continuous use never expires.
 *
 * Kept numerically in step with IDENTITY_HISTORY_MAX_AGE_MS (the same period in
 * milliseconds). These are the ONLY two places the retention period appears. */
const IDENTITY_HISTORY_TTL_SECONDS = 7_776_000;

export async function seedIdentityHistoryIndexes(db: Db, log: (msg: string) => void) {
  log("Identity history indexes:");

  await ensureIndex(
    db,
    IDENTITY_OBSERVATIONS_COLLECTION,
    { lastSeen: 1 },
    {
      expireAfterSeconds: IDENTITY_HISTORY_TTL_SECONDS,
      background: true,
      name: "identityObservations_lastSeen_ttl",
    },
    log
  );

  // Panel paged read, and the open-run lookup on every write.
  await ensureIndex(
    db,
    IDENTITY_OBSERVATIONS_COLLECTION,
    { userId: 1, track: 1, lastSeen: -1 },
    { background: true, name: "identityObservations_user_track_lastSeen" },
    log
  );

  // Cross-user value lookup: the grouping arrays and sharedWithCount.
  await ensureIndex(
    db,
    IDENTITY_OBSERVATIONS_COLLECTION,
    { track: 1, value: 1, lastSeen: -1 },
    { background: true, name: "identityObservations_track_value_lastSeen" },
    log
  );

  log("Identity history indexes ensured");
}
