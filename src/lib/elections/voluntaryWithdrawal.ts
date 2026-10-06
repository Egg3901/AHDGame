import type { Db, ObjectId } from "mongodb";
import type { ElectionCandidate } from "@/lib/db/types";

/**
 * Elections (as id strings) among `electionIds` that this character left
 * through the withdraw route. Withdrawing bars re-entry into the same
 * election (`withdrawalWarning.ts`, wiki Withdrawal Mechanics), so the enter
 * route refuses these and the election list hides their Enter button.
 */
export async function findVoluntaryWithdrawals(
  db: Db,
  characterId: ObjectId,
  electionIds: ObjectId[]
): Promise<Set<string>> {
  if (electionIds.length === 0) return new Set();
  const rows = await db
    .collection<ElectionCandidate>("electionCandidates")
    .find(
      {
        characterId,
        electionId: { $in: electionIds },
        status: "withdrawn",
        withdrawnBy: "candidate",
      },
      { projection: { electionId: 1 } }
    )
    .toArray();
  return new Set(rows.map((row) => row.electionId.toHexString()));
}
