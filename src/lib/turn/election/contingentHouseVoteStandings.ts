/**
 * Live standings of the open House vote: loads the sitting House through the
 * same voter-profile path the engine's ballot uses, then applies the cast
 * votes (see `computeHouseVoteStandings`).
 */
import { ObjectId } from "mongodb";
import type { Db } from "@/lib/mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";
import {
  computeHouseVoteStandings,
  type HouseVoteStandings,
} from "@/lib/elections/contingentHouseStandings";
import { loadContingentElectionData } from "@/lib/turn/election/loadContingentElectionData";

export type ContingentHouseVoteRecord = NonNullable<ElectionVoteTally["contingentHouseVote"]>;

export async function loadHouseVoteStandings(
  db: Db,
  election: Pick<Election, "_id" | "countryId">,
  tally: Pick<ElectionVoteTally, "electoralVotesByCandidate">,
  vote: Pick<ContingentHouseVoteRecord, "eligibleCandidateIds" | "votes">
): Promise<HouseVoteStandings> {
  // Candidacies are read by id, not status: seating the winner withdraws it.
  const candidates = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find({ _id: { $in: vote.eligibleCandidateIds.map((id) => new ObjectId(id)) } })
    .toArray();
  const data = await loadContingentElectionData(
    db,
    election._id,
    election.countryId ?? "US",
    candidates,
    tally.electoralVotesByCandidate ?? {}
  );
  const eligible = new Set(vote.eligibleCandidateIds);
  return computeHouseVoteStandings({
    delegations: data.houseDelegations,
    candidates: data.presidentCandidates.filter((c) => eligible.has(c.id)),
    votes: vote.votes ?? {},
    tieSeed: election._id.toString(),
  });
}
