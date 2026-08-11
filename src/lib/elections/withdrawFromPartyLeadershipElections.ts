import type { Db, ObjectId } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type {
  NationalPartyElection,
  NationalPartyCandidate,
  NationalPartyVote,
} from "@/lib/db/types";

export interface WithdrawFromPartyLeadershipElectionsResult {
  candidatesWithdrawn: number;
  votesDeleted: number;
}

/**
 * Remove departing members from a party's national leadership elections.
 *
 * When a member leaves a party (founding a chartered breakaway, defecting in a
 * one-party-state faction split, …) their participation in the OLD party's
 * chair / vice-chair / treasurer races must be torn down: they can no longer
 * stand as a candidate, their own ballot no longer counts, and ballots cast for
 * them must not keep tallying toward a seat in a party they left.
 *
 * Scoped to the party's currently-`voting` elections only — concluded races are
 * historical record and left untouched. For each such election this:
 *   - withdraws the departing members' still-`active` candidacies, and
 *   - deletes every vote where a departing member is the voter OR the candidate.
 *
 * National-party vote tallies are aggregated live from `nationalPartyVotes` at
 * resolution (no denormalized tally), and the candidate list filters out
 * `withdrawn` rows, so these two writes fully remove the member from the race.
 *
 * No-op when `characterIds` is empty or the party has no voting elections.
 */
export async function withdrawFromPartyLeadershipElections(
  db: Db,
  characterIds: ObjectId[],
  partyId: string,
  countryId?: CountryId
): Promise<WithdrawFromPartyLeadershipElectionsResult> {
  if (characterIds.length === 0) return { candidatesWithdrawn: 0, votesDeleted: 0 };

  // Scope by countryId when known to avoid cross-country sequentialId
  // collisions; callers that lack it (rare) fall back to partyId alone.
  const electionQuery: Record<string, unknown> = { partyId, status: "voting" };
  if (countryId) electionQuery.countryId = countryId;
  const votingElections = await db
    .collection<NationalPartyElection>("nationalPartyElections")
    .find(electionQuery)
    .project<{ _id: ObjectId }>({ _id: 1 })
    .toArray();
  if (votingElections.length === 0) return { candidatesWithdrawn: 0, votesDeleted: 0 };

  const electionIds = votingElections.map((e) => e._id);
  const now = new Date();

  const candRes = await db
    .collection<NationalPartyCandidate>("nationalPartyCandidates")
    .updateMany(
      { electionId: { $in: electionIds }, characterId: { $in: characterIds }, status: "active" },
      { $set: { status: "withdrawn", withdrawnAt: now } }
    );

  const voteRes = await db.collection<NationalPartyVote>("nationalPartyVotes").deleteMany({
    electionId: { $in: electionIds },
    $or: [{ voterId: { $in: characterIds } }, { candidateId: { $in: characterIds } }],
  });

  return { candidatesWithdrawn: candRes.modifiedCount, votesDeleted: voteRes.deletedCount };
}
