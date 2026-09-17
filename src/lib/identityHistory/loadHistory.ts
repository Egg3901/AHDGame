import type { Db, ObjectId } from "mongodb";
import {
  IDENTITY_OBSERVATIONS_COLLECTION,
  type IdentityObservation,
  type IdentityTrack,
} from "@/lib/db/types/identityObservation";
import { maskIp } from "@/lib/utils/maskIp";

export const IDENTITY_HISTORY_PAGE_SIZE = 10;

export interface IdentityHistoryRow {
  value: string;
  /** Null when `datesKnown` is false. The UI shows "date unknown" rather than
   * a fabricated timestamp. */
  firstSeen: string | null;
  lastSeen: string | null;
  observations: number;
  source: string;
  datesKnown: boolean;
  /** Other accounts with a run on this same value, excluding the subject.
   * Banned accounts ARE counted: the existing grouping deliberately keeps
   * banned members visible so the evidence trail survives moderation. */
  sharedWithCount: number;
}

export interface IdentityHistoryPage {
  rows: IdentityHistoryRow[];
  page: number;
  totalPages: number;
  total: number;
}

/**
 * One page of a user's observation runs for a single track, newest first.
 *
 * `revealNetwork` mirrors the existing admin/moderator split: admins read raw
 * addresses, moderators read them masked. It is the caller's job to derive it
 * from the authenticated role, never from anything client-supplied.
 */
export async function loadIdentityHistory(
  db: Db,
  userId: ObjectId,
  track: IdentityTrack,
  page: number,
  { revealNetwork }: { revealNetwork: boolean }
): Promise<IdentityHistoryPage> {
  const collection = db.collection<IdentityObservation>(IDENTITY_OBSERVATIONS_COLLECTION);
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;

  const total = await collection.countDocuments({ userId, track });
  const totalPages = Math.max(1, Math.ceil(total / IDENTITY_HISTORY_PAGE_SIZE));

  // Past the last page, answer without querying. `skip` past the end still
  // walks the index, so an arbitrarily large `?page=` would otherwise turn a
  // URL parameter into real server work. The response still reports the page
  // that was asked for rather than silently clamping to the last one.
  const docs =
    safePage > totalPages
      ? []
      : await collection
          .find({ userId, track })
          .sort({ lastSeen: -1 })
          .skip((safePage - 1) * IDENTITY_HISTORY_PAGE_SIZE)
          .limit(IDENTITY_HISTORY_PAGE_SIZE)
          .toArray();

  // Resolved for the page's values only, in one round trip. This is the whole
  // point of the panel: a row that reads "also used by 2 other accounts" is
  // what catches rotation without a human diffing hashes by eye.
  const values = docs.map((d) => d.value);
  const sharers = new Map<string, number>();
  if (values.length > 0) {
    const grouped = await collection
      .aggregate<{ _id: string; users: ObjectId[] }>([
        { $match: { track, value: { $in: values } } },
        { $group: { _id: "$value", users: { $addToSet: "$userId" } } },
      ])
      .toArray();
    const subject = userId.toString();
    for (const entry of grouped) {
      sharers.set(entry._id, entry.users.filter((u) => String(u) !== subject).length);
    }
  }

  return {
    rows: docs.map((doc) => ({
      value: track === "ip" && !revealNetwork ? maskIp(doc.value) : doc.value,
      firstSeen: doc.datesKnown ? doc.firstSeen.toISOString() : null,
      lastSeen: doc.datesKnown ? doc.lastSeen.toISOString() : null,
      observations: doc.observations,
      source: doc.source,
      datesKnown: doc.datesKnown,
      sharedWithCount: sharers.get(doc.value) ?? 0,
    })),
    page: safePage,
    totalPages,
    total,
  };
}
