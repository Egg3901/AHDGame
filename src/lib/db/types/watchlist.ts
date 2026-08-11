import type { ObjectId } from "mongodb";

/**
 * `watchlist` — moderator/admin-pinned accounts (forensics v2, Wave 2
 * "watchlist + alerts"). Deliberately tiny: this is a bookmark, not a
 * detector. The detection itself already happens continuously in
 * `actionAuditLog` (every action) and `altLinks` (the alt-scoring pass);
 * watchlisting an account just gives staff a standing shortlist and a way
 * to ask "has anything happened on this account since I last looked?"
 * without re-running a search every time.
 *
 * Read side lives in `src/lib/audit/watchlist.ts`
 * (`buildWatchlistEntryView`/`buildWatchlistViews`), which joins each entry
 * against `actionAuditLog` (recent activity summary) and `altLinks` (new
 * links since `lastNotifiedTurn`). See that module's doc comment for the
 * exact alert-detection logic.
 */
export interface WatchlistEntry {
  _id: ObjectId;
  /** The watched account. Unique — an account can only be pinned once. */
  userId: ObjectId;
  /** Staff member (moderator or admin) who pinned it. */
  addedBy: ObjectId;
  /** Free-text note on why this account is being watched. */
  reason?: string;
  createdAt: Date;
  /**
   * The turn as of which this entry was last "reviewed" — the baseline the
   * alert computation compares `actionAuditLog`/`altLinks` `turn`s against
   * to decide what counts as new. Absent until something advances it (a
   * future digest/acknowledge feature; out of scope for this vertical — see
   * `src/lib/audit/watchlist.ts`). Nothing in the watchlist API mutates
   * this field today; `GET` only reads it.
   */
  lastNotifiedTurn?: number;
}

/** Input to `POST /api/admin/watchlist` — `_id`/`createdAt` are computed at
 * insert time. */
export type WatchlistEntryInput = Pick<WatchlistEntry, "userId" | "addedBy" | "reason">;
