/**
 * Removes a withdrawn candidate's data from an election vote tally.
 *
 * When a candidate withdraws, their historical votes, name, party,
 * and seat estimate entries must be purged so that remaining candidates'
 * vote shares and seat projections are calculated correctly.
 */

import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { ElectionVoteTally } from "@/lib/db/types";
import { invalidateSuspendEndorsementsForWithdrawnCandidate } from "@/lib/campaigns/suspendEndorseLifecycle";

export async function removeWithdrawnCandidateFromTally(
  db: Db,
  electionId: ObjectId,
  candidateId: string
): Promise<void> {
  const tally = await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .findOne({ electionId });

  if (!tally) return;

  const unsetPaths: Record<string, ""> = {
    [`totalVotes.${candidateId}`]: "",
    [`candidateNames.${candidateId}`]: "",
    [`candidateParties.${candidateId}`]: "",
  };

  if (tally.seatsEstimate && candidateId in tally.seatsEstimate) {
    unsetPaths[`seatsEstimate.${candidateId}`] = "";
  }

  await db
    .collection<ElectionVoteTally>("electionVoteTallies")
    .updateOne({ electionId }, { $unset: unsetPaths, $set: { updatedAt: new Date() } });

  if (ObjectId.isValid(candidateId)) {
    await invalidateSuspendEndorsementsForWithdrawnCandidate(
      db,
      electionId,
      new ObjectId(candidateId)
    );
  }
}
