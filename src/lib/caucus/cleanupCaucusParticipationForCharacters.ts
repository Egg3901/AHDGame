import type { Db, ObjectId } from "mongodb";
import type { CaucusChairCandidate, CaucusMembership } from "@/lib/db/types";

interface CleanupOptions {
  caucusId?: ObjectId;
  removeMembership?: boolean;
  membershipStatus?: "left" | "removed";
  now?: Date;
}

export interface CleanupCaucusParticipationResult {
  candidaciesWithdrawn: number;
  votesDeleted: number;
  membershipsClosed: number;
  factionIdsCleared: number;
  chairSeatsCleared: number;
  viceChairSeatsCleared: number;
}

/**
 * Keeps caucus participation consistent when a player leaves, deletes, or is
 * otherwise removed from caucus play. Elections cannot retain stale candidates
 * or votes from ineligible members, and deleted/banned characters should not
 * remain seated as caucus leadership.
 */
export async function cleanupCaucusParticipationForCharacters(
  db: Db,
  characterIds: ObjectId[],
  options: CleanupOptions = {}
): Promise<CleanupCaucusParticipationResult> {
  if (characterIds.length === 0) {
    return {
      candidaciesWithdrawn: 0,
      votesDeleted: 0,
      membershipsClosed: 0,
      factionIdsCleared: 0,
      chairSeatsCleared: 0,
      viceChairSeatsCleared: 0,
    };
  }

  const now = options.now ?? new Date();
  const membershipStatus = options.membershipStatus ?? "removed";
  const scopedCaucusFilter = options.caucusId ? { caucusId: options.caucusId } : {};

  const candidateRes = await db
    .collection<CaucusChairCandidate>("caucusChairCandidates")
    .updateMany(
      {
        characterId: { $in: characterIds },
        status: "active",
        ...scopedCaucusFilter,
      },
      {
        $set: {
          status: "withdrawn",
          withdrawnAt: now,
        },
      }
    );

  const voteFilter = options.caucusId
    ? {
        caucusId: options.caucusId,
        $or: [{ voterId: { $in: characterIds } }, { candidateId: { $in: characterIds } }],
      }
    : {
        $or: [{ voterId: { $in: characterIds } }, { candidateId: { $in: characterIds } }],
      };
  const voteRes = await db.collection("caucusChairVotes").deleteMany(voteFilter);

  let membershipsClosed = 0;
  let factionIdsCleared = 0;
  if (options.removeMembership) {
    const memberships = await db
      .collection<CaucusMembership>("caucusMemberships")
      .find({
        memberType: "character",
        memberId: { $in: characterIds },
        status: "active",
        ...scopedCaucusFilter,
      })
      .toArray();

    if (memberships.length > 0) {
      const membershipIds = memberships.map((membership) => membership._id);
      const caucusIds = [
        ...new Set(memberships.map((membership) => membership.caucusId.toString())),
      ].map(
        (id) => memberships.find((membership) => membership.caucusId.toString() === id)!.caucusId
      );

      const membershipRes = await db.collection<CaucusMembership>("caucusMemberships").updateMany(
        { _id: { $in: membershipIds } },
        {
          $set: {
            status: membershipStatus,
            leftAt: now,
            updatedAt: now,
          },
        }
      );
      membershipsClosed = membershipRes.modifiedCount;

      const factionRes = await db.collection("characters").updateMany(
        {
          _id: { $in: characterIds },
          factionId: { $in: caucusIds },
        },
        {
          $set: {
            factionId: null,
            updatedAt: now,
          },
        }
      );
      factionIdsCleared = factionRes.modifiedCount;
    }
  }

  const chairRes = await db.collection("caucuses").updateMany(
    { chairId: { $in: characterIds }, ...(options.caucusId ? { _id: options.caucusId } : {}) },
    {
      $set: {
        chairId: null,
        updatedAt: now,
      },
    }
  );
  const viceChairRes = await db.collection("caucuses").updateMany(
    { viceChairId: { $in: characterIds }, ...(options.caucusId ? { _id: options.caucusId } : {}) },
    {
      $set: {
        viceChairId: null,
        updatedAt: now,
      },
    }
  );

  return {
    candidaciesWithdrawn: candidateRes.modifiedCount,
    votesDeleted: voteRes.deletedCount,
    membershipsClosed,
    factionIdsCleared,
    chairSeatsCleared: chairRes.modifiedCount,
    viceChairSeatsCleared: viceChairRes.modifiedCount,
  };
}
