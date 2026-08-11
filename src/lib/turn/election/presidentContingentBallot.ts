import type { Db } from "@/lib/mongodb";
import { ObjectId } from "mongodb";
import type { Election, ElectionCandidate, ElectionVoteTally } from "@/lib/db/types";
import {
  resolveContingentElection,
  type ContingentElectionResult,
} from "@/lib/turn/election/contingentElection";
import { loadContingentElectionData } from "@/lib/turn/election/loadContingentElectionData";

export async function runPresidentialContingentBallot(
  db: Db,
  election: Election,
  tally: ElectionVoteTally,
  candidates: ElectionCandidate[],
  electoralVotesByCandidate: Record<string, number>,
  now: Date
): Promise<ContingentElectionResult> {
  const resolutionCountryId = election.countryId ?? "US";

  const contingentData = await loadContingentElectionData(
    db,
    election._id,
    resolutionCountryId,
    candidates,
    electoralVotesByCandidate,
    tally.contingentChamberSnapshot
      ? { chamberSnapshot: tally.contingentChamberSnapshot }
      : undefined
  );

  if (contingentData.chamberSnapshot && !tally.contingentChamberSnapshot) {
    await db.collection<ElectionVoteTally>("electionVoteTallies").updateOne(
      { electionId: election._id },
      {
        $set: {
          contingentChamberSnapshot: contingentData.chamberSnapshot,
          updatedAt: now,
        },
      }
    );
  }

  const { chamberSnapshot: _snapshot, ...contingentInput } = contingentData;
  return resolveContingentElection({
    electionId: election._id,
    electoralVotesByCandidate,
    ...contingentInput,
  });
}

export async function markContingentResolutionPending(
  db: Db,
  electionId: ObjectId,
  now: Date
): Promise<void> {
  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne({ electionId }, { $set: { contingentResolutionPending: true, updatedAt: now } });
}
