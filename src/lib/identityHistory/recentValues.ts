import type { Db, ObjectId } from "mongodb";
import {
  IDENTITY_HISTORY_MAX_AGE_MS,
  IDENTITY_OBSERVATIONS_COLLECTION,
  type IdentityObservation,
} from "@/lib/db/types/identityObservation";

/** Most recent values per track per user handed to the client grouper. Bounds
 * the list payload: 500 users x 2 tracks x 20 values. */
export const IDENTITY_HISTORY_VALUE_CAP = 20;

export interface RecentIdentityValues {
  ips: string[];
  fingerprints: string[];
}

/**
 * Recent identity values per user, for the duplicate grouper.
 *
 * `getDuplicateGroups` is pure and runs client-side, so it cannot query this
 * collection. The list endpoints project the values in instead.
 *
 * Every value here has already passed the write-time shape guards
 * (`isGroupableIdentityValue`), so no sentinel or Cloudflare edge address can
 * reach grouping through this path.
 */
export async function loadRecentIdentityValues(
  db: Db,
  userIds: ObjectId[],
  now: Date
): Promise<Map<string, RecentIdentityValues>> {
  const result = new Map<string, RecentIdentityValues>();
  if (userIds.length === 0) return result;

  const cutoff = new Date(now.getTime() - IDENTITY_HISTORY_MAX_AGE_MS);

  // Deduped, sorted and capped SERVER-side. Fetching every run for the page and
  // capping in JS would be unbounded: this runs on the admin user list, which
  // loads up to 500 accounts at a time, and a single account that rotates
  // heavily can accumulate a run per hour for 90 days.
  //
  // The first $group collapses repeat runs on one value to its most recent
  // sighting, so the $slice keeps 20 DISTINCT values rather than 20 rows.
  const grouped = await db
    .collection<IdentityObservation>(IDENTITY_OBSERVATIONS_COLLECTION)
    .aggregate<{ _id: { userId: ObjectId; track: string }; values: string[] }>([
      { $match: { userId: { $in: userIds }, lastSeen: { $gte: cutoff } } },
      {
        $group: {
          _id: { userId: "$userId", track: "$track", value: "$value" },
          lastSeen: { $max: "$lastSeen" },
        },
      },
      { $sort: { lastSeen: -1 } },
      {
        $group: {
          _id: { userId: "$_id.userId", track: "$_id.track" },
          values: { $push: "$_id.value" },
        },
      },
      { $project: { values: { $slice: ["$values", IDENTITY_HISTORY_VALUE_CAP] } } },
    ])
    .toArray();

  for (const entry of grouped) {
    const key = entry._id.userId.toString();
    let bucket = result.get(key);
    if (!bucket) {
      bucket = { ips: [], fingerprints: [] };
      result.set(key, bucket);
    }
    if (entry._id.track === "ip") bucket.ips = entry.values;
    else bucket.fingerprints = entry.values;
  }

  return result;
}
