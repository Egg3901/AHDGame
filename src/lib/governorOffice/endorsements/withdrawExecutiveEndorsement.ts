import type { Db, ObjectId } from "mongodb";
import type { ElectionCandidate, ExecutiveEndorsement } from "@/lib/db/types";
import { applyEndorsementSupportBump } from "@/lib/turn/elections/supportEvents";

export type ExecutiveWithdrawReason = NonNullable<ExecutiveEndorsement["withdrawnReason"]>;

export async function withdrawExecutiveEndorsement(
  db: Db,
  endorsementId: ObjectId,
  reason: ExecutiveWithdrawReason = "manual"
): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  // B3 — read the endorsement BEFORE marking inactive so we can find the
  // endorsed candidate and reverse the Support bump that landed when
  // the endorsement was created. Symmetric with createExecutiveEndorsement.
  const endorsement = await db
    .collection<ExecutiveEndorsement>("executiveEndorsements")
    .findOne({ _id: endorsementId, isActive: true });

  const res = await db.collection<ExecutiveEndorsement>("executiveEndorsements").updateOne(
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

  // Reverse the Support bump. Look up the candidate row so we can find
  // its characterId — `endorsement.candidateId` may key by candidate
  // row id depending on schema.
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
