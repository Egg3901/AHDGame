import type { Db, ObjectId } from "mongodb";

/**
 * Keep suspicious-activity flags in sync with a user's ban state.
 *
 * On ban: archive every non-resolved suspicious record for the user to the
 * resolved pool, marked `resolvedByBan` so the move is reversible. This clears
 * the banned account out of the active moderation queue (the detector already
 * skips the resolved pool).
 *
 * On unban: restore ONLY the records that were resolved by the ban — leaving a
 * moderator's permanent dismissals (no `resolvedByBan` marker) untouched — back
 * to the active pool, so the detector evaluates the account again and future
 * flags surface normally.
 */
export async function syncSuspiciousFlagsForBanState(
  db: Db,
  userId: ObjectId,
  banned: boolean
): Promise<void> {
  const now = new Date();
  if (banned) {
    await db
      .collection("suspiciousCharacters")
      .updateMany(
        { userId, pool: { $ne: "resolved" } },
        { $set: { pool: "resolved", dismissed: true, resolvedByBan: true, lastUpdated: now } }
      );
  } else {
    await db.collection("suspiciousCharacters").updateMany(
      { userId, resolvedByBan: true },
      {
        $set: { pool: "active", dismissed: false, lastUpdated: now },
        $unset: { resolvedByBan: "" },
      }
    );
  }
}
