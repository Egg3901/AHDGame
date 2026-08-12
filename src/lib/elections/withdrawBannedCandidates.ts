/**
 * Withdraws all active election candidates belonging to a user's character.
 *
 * Called when a user is banned so their candidates don't remain in active
 * elections. Mirrors the per-candidate cleanup in the player withdraw route:
 * sets status to "withdrawn", purges tally data, and archives campaign docs.
 */

import type { Db, ObjectId } from "mongodb";
import type { Character, ElectionCandidate } from "@/lib/db/types";
import { removeWithdrawnCandidateFromTally } from "@/lib/electionEngine/tallyCleaner";

export async function withdrawAllCandidatesForUser(db: Db, userId: ObjectId): Promise<number> {
  const character = await db.collection<Character>("characters").findOne({ userId });
  if (!character) return 0;

  const activeCandidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ characterId: character._id, status: "active" })
    .toArray();

  if (activeCandidates.length === 0) return 0;

  const now = new Date();
  const candidateIds = activeCandidates.map((c) => c._id);

  // Bulk-withdraw all active candidates
  await db
    .collection<ElectionCandidate>("electionCandidates")
    .updateMany(
      { _id: { $in: candidateIds } },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  // Clean up tallies concurrently (atomic per-election updates) and archive
  // all campaigns in one updateMany instead of a serial per-candidate walk.
  await Promise.all([
    ...activeCandidates.map((candidate) =>
      removeWithdrawnCandidateFromTally(db, candidate.electionId, candidate._id.toString())
    ),
    activeCandidates.length > 0
      ? db.collection("campaigns").updateMany(
          {
            $or: activeCandidates.map((candidate) => ({
              electionId: candidate.electionId,
              candidateId: candidate.characterId,
            })),
            status: { $ne: "archived" },
          },
          {
            $set: {
              status: "archived",
              archivedAt: now,
              archivedReason: "banned",
              updatedAt: now,
            },
          }
        )
      : Promise.resolve(null),
  ]);

  return activeCandidates.length;
}
