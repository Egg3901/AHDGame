import type { Db } from "mongodb";
import type { Election, ElectionVoteTally, State } from "@/lib/db/types";
import { buildHuMixedPlan, type HuMixedPlan } from "./rules/mixedElectionPlan";

/** Return null until every regional race has finished and has a valid tally. */
export async function readHuMixedElectionPlan(db: Db, cycle: number): Promise<HuMixedPlan | null> {
  const [regions, elections] = await Promise.all([
    db
      .collection<State>("states")
      .find({ countryId: "HU" }, { projection: { _id: 1, population: 1 } })
      .toArray(),
    db
      .collection<Election>("elections")
      .find({ countryId: "HU", electionType: "nationalAssembly", cycle })
      .toArray(),
  ]);
  if (
    regions.length === 0 ||
    elections.length !== regions.length ||
    elections.some((election) => election.status !== "completed" && election.status !== "resolved")
  ) {
    return null;
  }
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: elections.map((election) => election._id) } })
    .toArray();
  const byElection = new Map(tallies.map((tally) => [tally.electionId.toString(), tally]));
  if (byElection.size !== elections.length) return null;
  const races = elections.map((election) => {
    const tally = byElection.get(election._id.toString())!;
    if (
      !tally.totalVotes ||
      !tally.candidateParties ||
      Object.values(tally.totalVotes).every((votes) => votes <= 0)
    )
      return null;
    return {
      electionId: election._id.toString(),
      regionId: election.state,
      constituencyVotes: tally.huConstituencyVotes,
      listVotes: tally.huListVotes,
      districtSlate: tally.huDistrictSlate,
      candidates: Object.entries(tally.totalVotes).map(([candidateId, votes]) => ({
        candidateId,
        partyId: tally.candidateParties[candidateId],
        votes,
      })),
    };
  });
  if (races.some((race) => race === null)) return null;
  return buildHuMixedPlan(
    regions.map((region) => ({ id: String(region._id), population: region.population })),
    races as NonNullable<(typeof races)[number]>[]
  );
}
