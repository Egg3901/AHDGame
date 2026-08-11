import { ObjectId, type Db } from "mongodb";
import { getActionAuditLogCollection } from "@/lib/db/collections/actionAuditLog";
import { getAltLinksCollection } from "@/lib/db/collections/altDetection";
import { getUsersCollection } from "@/lib/db/collections/users";
import { auditProjectionFor, categoryGuardFor } from "@/lib/audit/queryAuditLog";
import type { WatchlistEntry } from "@/lib/db/types/watchlist";
import type { ActionAuditRecord } from "@/lib/db/types/actionAuditLog";
import type { User } from "@/lib/db/types/user";

/**
 * Watchlist read side (forensics v2, Wave 2 "watchlist + alerts"). Builds
 * the "recent activity summary" + "new since last review" view for
 * `GET /api/admin/watchlist`.
 *
 * ── Alert-detection logic ──────────────────────────────────────────────
 * Each `WatchlistEntry` carries an optional `lastNotifiedTurn`. The
 * baseline used for "what's new" is `entry.lastNotifiedTurn ?? 0` — an
 * entry that has never been notified treats its *entire* history as
 * outstanding, which is the right default for "I just pinned this account,
 * show me everything so far".
 *
 * Two independent signals are compared against that baseline:
 *   1. `actionAuditLog` rows where `actor.userId` is the watched user and
 *      `turn > baseline` → "the watched account acted since last review".
 *   2. `altLinks` edges touching the watched user (`userA` or `userB`) with
 *      `turn > baseline` → "a new alt link appeared since last review"
 *      (either a brand-new pairwise edge, or an existing edge that got a
 *      fresh signal added on a later turn — `run.ts` bumps `turn` on every
 *      upsert, so both cases show up here).
 *
 * This module only *reads* `lastNotifiedTurn` — nothing here advances it.
 * Advancing it (marking an entry "reviewed") is intentionally left to a
 * future feature (the Wave 2 daily digest, or a manual "mark reviewed"
 * action); wiring `GET` itself to silently clear alerts on every fetch
 * would mean the moderator who opens the panel first "consumes" the alert
 * before anyone else — including the person who opened it — gets to read
 * the response. Keeping `GET` a pure read avoids that race and keeps the
 * endpoint idempotent.
 */

export const WATCHLIST_RECENT_ACTIONS_LIMIT = 5;
export const WATCHLIST_NEW_LINKS_LIMIT = 10;

export interface WatchlistActivityAction {
  id: string;
  ts: string;
  turn: number;
  action: string;
  category: string;
  outcome: string;
}

export interface WatchlistActivitySummary {
  /** All-time count of `actionAuditLog` rows where this user is the actor
   * (category/net-guarded per role, same as everything else here). */
  totalActions: number;
  lastActionAt: string | null;
  lastActionTurn: number | null;
  /** Newest-first preview, capped at `WATCHLIST_RECENT_ACTIONS_LIMIT`. */
  recentActions: WatchlistActivityAction[];
}

export interface WatchlistNewLink {
  userId: string;
  username: string | null;
  confidence: number;
  turn: number;
}

export interface WatchlistAlerts {
  /** The baseline turn the alerts below were computed against
   * (`entry.lastNotifiedTurn ?? 0`). */
  sinceTurn: number;
  newActivityCount: number;
  hasNewActivity: boolean;
  /** Newest-first (by confidence), capped at `WATCHLIST_NEW_LINKS_LIMIT`. */
  newLinks: WatchlistNewLink[];
  hasNewLinks: boolean;
}

export interface WatchlistEntryView {
  id: string;
  userId: string;
  username: string | null;
  banned: boolean;
  addedBy: string;
  addedByName: string | null;
  reason: string | null;
  createdAt: string;
  lastNotifiedTurn: number | null;
  activity: WatchlistActivitySummary;
  alerts: WatchlistAlerts;
}

type UserLookup = Pick<User, "_id" | "username" | "isBanned">;

function serializeAction(row: ActionAuditRecord): WatchlistActivityAction {
  return {
    id: row._id.toString(),
    ts: row.ts.toISOString(),
    turn: row.turn,
    action: row.action,
    category: row.category,
    outcome: row.outcome,
  };
}

/** Build the activity + alert view for one watchlist entry. `userById` is a
 * pre-fetched batch of users (watched account + `addedBy`, and — for
 * `newLinks` — whichever accounts those links point at) keyed by hex id
 * string, so a multi-entry list doesn't N+1 the `users` collection. */
export async function buildWatchlistEntryView(
  db: Db,
  entry: WatchlistEntry,
  userById: Map<string, UserLookup>,
  isAdmin: boolean
): Promise<WatchlistEntryView> {
  const baseline = entry.lastNotifiedTurn ?? 0;
  const categoryGuard = categoryGuardFor(isAdmin);
  const projection = auditProjectionFor(isAdmin);

  const [actionsCol, linksCol] = await Promise.all([
    getActionAuditLogCollection(db),
    getAltLinksCollection(db),
  ]);

  const [recentActions, totalActions, newActivityCount, newLinkDocs] = await Promise.all([
    actionsCol
      .find({ "actor.userId": entry.userId, ...categoryGuard }, { projection })
      .sort({ ts: -1 })
      .limit(WATCHLIST_RECENT_ACTIONS_LIMIT)
      .toArray(),
    actionsCol.countDocuments({ "actor.userId": entry.userId, ...categoryGuard }),
    actionsCol.countDocuments({
      "actor.userId": entry.userId,
      turn: { $gt: baseline },
      ...categoryGuard,
    }),
    linksCol
      .find({
        $or: [{ userA: entry.userId }, { userB: entry.userId }],
        turn: { $gt: baseline },
      })
      .sort({ confidence: -1 })
      .limit(WATCHLIST_NEW_LINKS_LIMIT)
      .toArray(),
  ]);

  const entryUserIdStr = entry.userId.toString();
  const missingOtherIds = new Set<string>();
  for (const link of newLinkDocs) {
    const otherId = link.userA.toString() === entryUserIdStr ? link.userB : link.userA;
    if (!userById.has(otherId.toString())) missingOtherIds.add(otherId.toString());
  }
  if (missingOtherIds.size > 0) {
    const usersCol = await getUsersCollection(db);
    const fetched = await usersCol
      .find(
        { _id: { $in: [...missingOtherIds].map((id) => new ObjectId(id)) } },
        { projection: { username: 1, isBanned: 1 } }
      )
      .toArray();
    for (const u of fetched) userById.set(u._id.toString(), u);
  }

  const newLinks: WatchlistNewLink[] = newLinkDocs.map((link) => {
    const otherId = link.userA.toString() === entryUserIdStr ? link.userB : link.userA;
    const otherIdStr = otherId.toString();
    return {
      userId: otherIdStr,
      username: userById.get(otherIdStr)?.username ?? null,
      confidence: link.confidence,
      turn: link.turn,
    };
  });

  const lastAction = recentActions[0] ?? null;
  const watchedUser = userById.get(entryUserIdStr);
  const addedByUser = userById.get(entry.addedBy.toString());

  return {
    id: entry._id.toString(),
    userId: entryUserIdStr,
    username: watchedUser?.username ?? null,
    banned: watchedUser?.isBanned ?? false,
    addedBy: entry.addedBy.toString(),
    addedByName: addedByUser?.username ?? null,
    reason: entry.reason ?? null,
    createdAt: entry.createdAt.toISOString(),
    lastNotifiedTurn: entry.lastNotifiedTurn ?? null,
    activity: {
      totalActions,
      lastActionAt: lastAction ? lastAction.ts.toISOString() : null,
      lastActionTurn: lastAction ? lastAction.turn : null,
      recentActions: recentActions.map(serializeAction),
    },
    alerts: {
      sinceTurn: baseline,
      newActivityCount,
      hasNewActivity: newActivityCount > 0,
      newLinks,
      hasNewLinks: newLinks.length > 0,
    },
  };
}

/** Batch entry point for the list route: fetches every referenced user
 * (watched accounts + who added them) once, then builds each entry's view
 * in parallel. */
export async function buildWatchlistViews(
  db: Db,
  entries: WatchlistEntry[],
  isAdmin: boolean
): Promise<WatchlistEntryView[]> {
  if (entries.length === 0) return [];

  const idSet = new Set<string>();
  for (const entry of entries) {
    idSet.add(entry.userId.toString());
    idSet.add(entry.addedBy.toString());
  }
  const usersCol = await getUsersCollection(db);
  const users = await usersCol
    .find(
      { _id: { $in: [...idSet].map((id) => new ObjectId(id)) } },
      { projection: { username: 1, isBanned: 1 } }
    )
    .toArray();
  const userById = new Map<string, UserLookup>(users.map((u) => [u._id.toString(), u]));

  return Promise.all(entries.map((entry) => buildWatchlistEntryView(db, entry, userById, isAdmin)));
}
