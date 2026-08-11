import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";

export type DeclineUnionLeadershipResult =
  { ok: true; status: 200 } | { ok: false; status: number; error: string };

/** Decline a pending union presidency offer. Votes remain; organizers can pick someone else. */
export async function declineUnionLeadership(
  db: Db,
  character: Character,
  union: Union
): Promise<DeclineUnionLeadershipResult> {
  if (!union.pendingLeaderCharacterId) {
    return { ok: false, status: 400, error: "No presidency offer is pending for this union." };
  }
  if (union.pendingLeaderCharacterId.toString() !== character._id.toString()) {
    return { ok: false, status: 403, error: "You have not been offered this union's presidency." };
  }
  // Union ban (player suggestion #93): every union mutation 403s while banned.
  if (await isUnionsBanned(db, union.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  await db
    .collection<Union>("unions")
    .updateOne(
      { _id: union._id, pendingLeaderCharacterId: character._id },
      { $unset: { pendingLeaderCharacterId: "" }, $set: { updatedAt: new Date() } }
    );

  return { ok: true, status: 200 };
}
