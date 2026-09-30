import type { Db } from "mongodb";
import type { Election, ElectionVoteTally } from "@/lib/db/types";
import { bgNationwideEligibleParties } from "@/lib/countries/bg/rules/ordinaryElection";

/** Read the full 1991 slate once before any regional race is seated. */
export async function readBgOrdinaryEligibleParties(db: Db): Promise<ReadonlySet<string> | null> {
  const elections = await db
    .collection<Election>("elections")
    .find({ countryId: "BG", electionType: "nationalAssembly", cycle: 1 })
    .toArray();
  const tallies = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .find({ electionId: { $in: elections.map((e) => e._id) } })
    .toArray();
  const talliesById = new Map(tallies.map((tally) => [tally.electionId.toString(), tally]));
  return bgNationwideEligibleParties(
    elections.map((election) => {
      const tally = talliesById.get(election._id.toString());
      const lastSnapshot = tally?.turnSnapshots?.[tally.turnSnapshots.length - 1];
      const votes =
        tally && Object.keys(tally.totalVotes).length > 0
          ? tally.totalVotes
          : (lastSnapshot?.cumulativeVotes ?? {});
      return {
        state: election.state,
        totalSeats: election.totalSeats ?? 0,
        status: election.status,
        votes,
        candidateParties: tally?.candidateParties ?? {},
      };
    })
  );
}
