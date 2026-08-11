/**
 * Lookup banned-user character IDs.
 *
 * Used by election tally and display routes to defensively filter out votes
 * cast by characters whose owning user has been banned. Pairs with the
 * ban-time cleanup in cleanupPartyElectionsForBannedUser — that handler
 * removes votes/candidacies for newly banned users; this helper covers
 * already-banned users whose state pre-dates the cleanup work.
 */

import { type Db, type ObjectId } from "mongodb";
import type { Character, User } from "@/lib/db/types";

/**
 * Returns a Set of stringified character `_id` values for every character
 * owned by a banned user. Returns an empty Set when no users are banned.
 */
export async function getBannedCharacterIds(db: Db): Promise<Set<string>> {
  const bannedUsers = await db
    .collection<User>("users")
    .find({ isBanned: true })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  if (bannedUsers.length === 0) return new Set();

  const userIds = bannedUsers.map((u) => u._id);
  const characters = await db
    .collection<Character>("characters")
    .find({ userId: { $in: userIds } })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  return new Set(characters.map((c) => c._id.toString()));
}
