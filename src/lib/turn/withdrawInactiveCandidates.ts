import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, ElectionCandidate } from "@/lib/db/types";
import { activeUserIds } from "@/lib/players/playerActivity";

/**
 * Withdraws the active candidacies of players inactive for >96 turns, using the
 * same representation as a manual withdrawal (`status: "withdrawn"` +
 * `withdrawnAt`). One-way: a returning player re-enters races manually.
 *
 * ORDERING: must run BEFORE election resolution and BEFORE autoReelectionEntry
 * so a withdrawn inactive player is neither counted in a resolving race nor
 * re-added the same turn. NPP candidacies (`isNPP`) have no user and are
 * excluded at the query level; missing character/user docs are treated as
 * active (skip-on-missing) and left alone.
 */
export async function withdrawInactiveCandidates(
  db: Db,
  now: Date
): Promise<{ withdrawn: number }> {
  const rawCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ status: "active", isNPP: { $ne: true } })
    .project<{ _id: ObjectId; characterId: ObjectId | null }>({ _id: 1, characterId: 1 })
    .toArray();
  // NPP rows are excluded above; a non-NPP row with no characterId is a data
  // anomaly — drop it (nothing to resolve a user from).
  const candidates = rawCandidates.filter(
    (c): c is { _id: ObjectId; characterId: ObjectId } => c.characterId != null
  );
  if (candidates.length === 0) return { withdrawn: 0 };

  const characterIds = candidates.map((c) => c.characterId);
  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: characterIds } })
    .project<{ _id: ObjectId; userId: ObjectId }>({ _id: 1, userId: 1 })
    .toArray();
  const userIdByCharacter = new Map(characters.map((c) => [c._id.toString(), c.userId]));

  const userIds = characters.map((c) => c.userId).filter((id): id is ObjectId => id != null);
  const activeIds = await activeUserIds(db, userIds, now);

  const toWithdraw: ObjectId[] = [];
  for (const cand of candidates) {
    const userId = userIdByCharacter.get(cand.characterId.toString());
    // Missing character/user → treat as active (skip-on-missing); don't withdraw.
    if (!userId) continue;
    if (!activeIds.has(userId.toString())) toWithdraw.push(cand._id);
  }
  if (toWithdraw.length === 0) return { withdrawn: 0 };

  const result = await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany({ _id: { $in: toWithdraw } }, { $set: { status: "withdrawn", withdrawnAt: now } });
  return { withdrawn: result.modifiedCount };
}
