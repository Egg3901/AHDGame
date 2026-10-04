/**
 * Russia resolves its direct popular ballot and schedules any fresh vote together.
 * resolveRussianPresidentialElection commits certification and runoff/repeat
 * creation in one transaction, so a late failure cannot strand a finalized tally.
 */
import { ObjectId, type Db } from "mongodb";
import { runRequiredTransaction } from "@/lib/db/runRequiredTransaction";
import { materializeRussianPresidentialElectionResult } from "./presidentialElectionResult";
import { materializeRussianPresidentialFollowup } from "./presidentialElectionFollowup";
export async function resolveRussianPresidentialElection(input: {
  db: Db;
  electionId: ObjectId;
  turn: number;
  now: Date;
}) {
  const electionId = new ObjectId();
  const candidateIds: [ObjectId, ObjectId] = [new ObjectId(), new ObjectId()];
  return runRequiredTransaction(
    async (session) => {
      const result = await materializeRussianPresidentialElectionResult({ ...input, session });
      await materializeRussianPresidentialFollowup({
        ...input,
        session,
        predecessorElectionId: input.electionId,
        electionId,
        candidateIds,
      });
      return result;
    },
    { client: input.db.client }
  );
}
