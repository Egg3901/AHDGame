import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { User } from "@/lib/db/types";

/**
 * Turns of inactivity (= real hours; one turn is one hour) before a player
 * stops counting toward state-party PS limits, elections, and party-membership
 * rosters. Mirrors the cadence used by `inactiveCeoSectorShed`.
 */
export const INACTIVE_PLAYER_TURN_THRESHOLD = 96;

/**
 * Turns of inactivity (= real hours) before a player's non-CEO share positions
 * are returned to public float. Longer than the PS/election window so only
 * genuinely abandoned holdings are swept.
 */
export const INACTIVE_SHAREHOLDER_TURN_THRESHOLD = 168;

/**
 * Turns of CEO inactivity at which shareholders of a corporation are warned that
 * it is about to shed its cross-corp holdings to public float — 24 turns before
 * the INACTIVE_SHAREHOLDER_TURN_THRESHOLD release.
 */
export const INACTIVE_SHAREHOLDER_WARN_TURN_THRESHOLD = INACTIVE_SHAREHOLDER_TURN_THRESHOLD - 24;

const TURN_MS = 60 * 60 * 1000;

/**
 * A player is active when their last activity (or `createdAt` fallback) is
 * within the inactivity window ending at `now`. Missing both reference dates →
 * active (never punish data gaps). Exactly at the threshold is still active;
 * strictly older than the threshold is inactive.
 *
 * `thresholdTurns` defaults to the player limit (96) but callers with a different
 * inactivity cadence (e.g. the 168-turn shareholder sweep) may override it.
 */
export function isUserActive(
  lastActivity: Date | null | undefined,
  createdAt: Date | null | undefined,
  now: Date,
  thresholdTurns: number = INACTIVE_PLAYER_TURN_THRESHOLD
): boolean {
  const reference = lastActivity ?? createdAt;
  if (!reference) return true;
  const cutoffMs = now.getTime() - thresholdTurns * TURN_MS;
  return reference.getTime() >= cutoffMs;
}

/**
 * Given a set of user ids, return the subset (as hex strings) that is active.
 * Performs one projected `users` find. User ids with no matching document are
 * treated as active (their id is included) — matching the skip-on-missing rule
 * used elsewhere for inactivity, so data gaps never silently penalize a player.
 */
export async function activeUserIds(db: Db, userIds: ObjectId[], now: Date): Promise<Set<string>> {
  const active = new Set<string>();
  if (userIds.length === 0) return active;

  const users = await db
    .collection<User>("users")
    .find({ _id: { $in: userIds } })
    .project<{ _id: ObjectId; lastActivity?: Date; createdAt?: Date }>({
      _id: 1,
      lastActivity: 1,
      createdAt: 1,
    })
    .toArray();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));

  for (const id of userIds) {
    const u = userById.get(id.toString());
    if (!u || isUserActive(u.lastActivity, u.createdAt, now)) {
      active.add(id.toString());
    }
  }
  return active;
}
