import type { Db, ObjectId } from "mongodb";
import type { ElectionCandidate, ElectionVoteTally, Election } from "@/lib/db/types";
import { initElectionVoteTally } from "@/lib/electionEngine";
import { initPresidentVoteTally } from "@/lib/presidentialElectionEngine";

export async function getOrCreateVoteTally(
  db: Db,
  electionId: ObjectId,
  election: Election,
  candidates: ElectionCandidate[],
  displayCandidates: Array<{ id: string }>,
  inPrimary: boolean,
  isEnded: boolean
): Promise<ElectionVoteTally | null> {
  let voteTally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId });

  // If the primary has ended but there's no vote tally yet, create one on-the-fly
  // so the vote engine has a document to write to on the next turn.
  if (!inPrimary && !voteTally && !isEnded && displayCandidates.length > 0) {
    try {
      // Pass the de-duped list so the tally is initialized correctly
      const tallyCandidates = candidates.filter((c) =>
        displayCandidates.some((dc) => dc.id === c._id.toString())
      );

      if (election.electionType === "president") {
        await initPresidentVoteTally(electionId, tallyCandidates);
      } else {
        await initElectionVoteTally(electionId, tallyCandidates, election.state as string);
      }

      voteTally = await db
        .collection<ElectionVoteTally>("electionVoteTallies")
        .findOne({ electionId });
    } catch (err) {
      console.error("Failed to auto-init vote tally:", err);
    }
  }

  return voteTally;
}
