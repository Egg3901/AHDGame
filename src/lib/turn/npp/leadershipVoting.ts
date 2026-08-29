// src/lib/turn/npp/leadershipVoting.ts
/**
 * NPP Leadership Voting
 *
 * Vote-casting for leadership-style races. NPPs no longer decide these on their
 * own: US congressional leadership elections are player-only, so the sole entry
 * point is `castLeadershipVote`, driven by a party whip from
 * `lib/congress/applyWhipVotes.ts` when a player whips their caucus.
 */

import { type ObjectId, type Db } from "mongodb";

/**
 * Cast a vote for a nomination (speaker or leadership style), handling
 * re-votes by removing any previous vote for a different candidate.
 * `seatWeight` defaults to 1; pass the voter's `seatsHeld` so multi-seat
 * members contribute their full chamber weight to the cached `votesFor`.
 * Returns true if a new vote was cast, false if already voted for this candidate.
 */
export async function castLeadershipVote(
  db: Db,
  collectionName: string,
  nominations: Array<{ _id: ObjectId; votes?: Record<string, string> }>,
  nppKey: string,
  bestId: ObjectId,
  now: Date,
  seatWeight = 1
): Promise<boolean> {
  const weight = Math.max(1, seatWeight);
  const previousNom = nominations.find((n) => n.votes?.[nppKey] && !n._id.equals(bestId));
  if (previousNom) {
    await db.collection(collectionName).updateOne(
      { _id: previousNom._id },
      {
        $unset: { [`votes.${nppKey}`]: "" },
        $inc: { votesFor: -weight },
        $set: { updatedAt: now },
      }
    );
  }

  const targetNom = nominations.find((n) => n._id.equals(bestId));
  if (targetNom && !targetNom.votes?.[nppKey]) {
    await db.collection(collectionName).updateOne(
      { _id: bestId },
      {
        $set: { [`votes.${nppKey}`]: "for", status: "voting", updatedAt: now },
        $inc: { votesFor: weight },
      }
    );
    return true;
  }
  return false;
}
