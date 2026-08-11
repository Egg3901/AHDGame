import type { Db, ObjectId } from "mongodb";
import type { ElectionCandidate, GovernorEndorsement } from "@/lib/db/types";
import { applyEndorsementSupportBump } from "@/lib/turn/elections/supportEvents";

export type WithdrawReason = NonNullable<GovernorEndorsement["withdrawnReason"]>;

export async function withdrawEndorsement(
  db: Db,
  endorsementId: ObjectId,
  reason: WithdrawReason = "manual"
): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  // B3 — read the endorsement before marking inactive so we can reverse
  // the Support bump on the endorsed candidate.
  const endorsement = await db
    .collection<GovernorEndorsement>("governorEndorsements")
    .findOne({ _id: endorsementId, isActive: true });

  const res = await db.collection<GovernorEndorsement>("governorEndorsements").updateOne(
    { _id: endorsementId, isActive: true },
    {
      $set: {
        isActive: false,
        withdrawnAt: new Date(),
        withdrawnReason: reason,
      },
    }
  );
  if (res.modifiedCount !== 1) {
    return { status: 404, body: { error: "Endorsement not found or already withdrawn." } };
  }

  if (endorsement && !endorsement.candidateIsNPP) {
    const candidate = await db
      .collection<ElectionCandidate>("electionCandidates")
      .findOne({ _id: endorsement.candidateId });
    if (candidate?.characterId) {
      await applyEndorsementSupportBump(db, candidate.characterId, true);
    }
  }

  return { status: 200, body: { success: true } };
}
