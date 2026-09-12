/**
 * Removes a withdrawn candidate's data from an election vote tally.
 *
 * When a candidate withdraws, their historical votes, name, party,
 * seat estimate, and presidential unit-vote entries must be purged so that
 * remaining candidates' vote shares and electoral-vote projections are
 * calculated correctly.
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

  for (const [unitId, unitVotes] of Object.entries(tally.totalVotesByUnit ?? {})) {
    if (candidateId in unitVotes) {
      unsetPaths[`totalVotesByUnit.${unitId}.${candidateId}`] = "";
    }
  }

  if (tally.seatsEstimate && candidateId in tally.seatsEstimate) {
    unsetPaths[`seatsEstimate.${candidateId}`] = "";
  }

  // Presidential maps and EV projections read this granular tally rather than
  // totalVotes. Leaving a withdrawn candidate here let their stale state lead
  // keep earning EVs with no name or party remaining to render (#1306).
  for (const unitId of Object.keys(tally.totalVotesByUnit ?? {})) {
    unsetPaths[`totalVotesByUnit.${unitId}.${candidateId}`] = "";
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
