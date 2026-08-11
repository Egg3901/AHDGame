/**
 * Withdraws party-leadership / committee candidacies and deletes party-leadership
 * / committee votes belonging to a banned user's character(s).
 *
 * Called from the admin ban handler. Mirrors the existing
 * `withdrawAllCandidatesForUser` cleanup for governmental elections, but
 * targets the three party-internal election types — national party leadership,
 * state party leadership, and national committee — none of which were covered
 * before. Without this, banned users' votes continue to count toward leadership
 * tallies and their names remain on candidate lists.
 */

import type { Db, ObjectId } from "mongodb";
import type {
  Character,
  StatePartyCandidate,
  StatePartyVote,
  NationalPartyCandidate,
  NationalPartyVote,
  NationalCommitteeCandidate,
  NationalCommitteeVote,
} from "@/lib/db/types";
import { cleanupCaucusParticipationForCharacters } from "@/lib/caucus/cleanupCaucusParticipationForCharacters";

export interface CleanupResult {
  characterIds: string[];
  nationalPartyCandidatesWithdrawn: number;
  nationalPartyVotesDeleted: number;
  statePartyCandidatesWithdrawn: number;
  statePartyVotesDeleted: number;
  committeeCandidatesWithdrawn: number;
  committeeVotesDeleted: number;
  caucusChairCandidatesWithdrawn: number;
  caucusChairVotesDeleted: number;
}

export async function cleanupPartyElectionsForBannedUser(
  db: Db,
  userId: ObjectId
): Promise<CleanupResult> {
  const characters = await db
    .collection<Character>("characters")
    .find({ userId })
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();

  const result: CleanupResult = {
    characterIds: characters.map((c) => c._id.toString()),
    nationalPartyCandidatesWithdrawn: 0,
    nationalPartyVotesDeleted: 0,
    statePartyCandidatesWithdrawn: 0,
    statePartyVotesDeleted: 0,
    committeeCandidatesWithdrawn: 0,
    committeeVotesDeleted: 0,
    caucusChairCandidatesWithdrawn: 0,
    caucusChairVotesDeleted: 0,
  };

  if (characters.length === 0) return result;

  const characterIds = characters.map((c) => c._id);
  const now = new Date();

  // National party leadership (chair / vice chair / treasurer).
  const npcRes = await db
    .collection<NationalPartyCandidate>("nationalPartyCandidates")
    .updateMany(
      { characterId: { $in: characterIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  result.nationalPartyCandidatesWithdrawn = npcRes.modifiedCount;

  const npvRes = await db
    .collection<NationalPartyVote>("nationalPartyVotes")
    .deleteMany({ voterId: { $in: characterIds } });
  result.nationalPartyVotesDeleted = npvRes.deletedCount;

  // State party leadership.
  const spcRes = await db
    .collection<StatePartyCandidate>("statePartyCandidates")
    .updateMany(
      { characterId: { $in: characterIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  result.statePartyCandidatesWithdrawn = spcRes.modifiedCount;

  const spvRes = await db
    .collection<StatePartyVote>("statePartyVotes")
    .deleteMany({ voterId: { $in: characterIds } });
  result.statePartyVotesDeleted = spvRes.deletedCount;

  // National committee.
  const nccRes = await db
    .collection<NationalCommitteeCandidate>("nationalCommitteeCandidates")
    .updateMany(
      { characterId: { $in: characterIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );
  result.committeeCandidatesWithdrawn = nccRes.modifiedCount;

  const ncvRes = await db
    .collection<NationalCommitteeVote>("nationalCommitteeVotes")
    .deleteMany({ voterId: { $in: characterIds } });
  result.committeeVotesDeleted = ncvRes.deletedCount;

  const caucusCleanup = await cleanupCaucusParticipationForCharacters(db, characterIds, {
    removeMembership: false,
    now,
  });
  result.caucusChairCandidatesWithdrawn = caucusCleanup.candidaciesWithdrawn;
  result.caucusChairVotesDeleted = caucusCleanup.votesDeleted;

  return result;
}
