import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";

export type ResignUnionLeadershipResult =
  { ok: true; status: 200 } | { ok: false; status: number; error: string };

/**
 * v3 Phase 8 code-review fix #5: a leader-initiated, voluntary release of
 * union leadership. Before this, leadership could never be reclaimed once
 * claimed (`claimUnion` unconditionally 409s whenever the union already has
 * an owner) — one inactive/banned/quitting leader permanently locked an
 * entire industry's union for the rest of the game. Mirrors CEO vacancy:
 * treasury/membershipPressure are left untouched, the union just becomes
 * unmanned (Phase 5's NPC drift resumes for its sectors).
 */
export async function resignUnionLeadership(
  db: Db,
  character: Character,
  unionId: string
): Promise<ResignUnionLeadershipResult> {
  if (!ObjectId.isValid(unionId)) {
    return { ok: false, status: 400, error: "Invalid union ID" };
  }
  const unionObjectId = new ObjectId(unionId);
  const union = await db.collection<Union>("unions").findOne({ _id: unionObjectId });
  if (!union) {
    return { ok: false, status: 404, error: "Union not found" };
  }
  if (!union.ownerId || union.ownerId.toString() !== character._id.toString()) {
    return { ok: false, status: 403, error: "You do not lead this union." };
  }
  // Union ban (player suggestion #93): the union is suspended wholesale while
  // banned — leadership is frozen in place (not vacated) so a repeal restores
  // the union exactly as the ban found it.
  if (await isUnionsBanned(db, union.countryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const now = new Date();
  await runWithOptionalTransaction(
    async (session) => {
      await db.collection<Union>("unions").updateOne(
        { _id: unionObjectId },
        {
          $set: { ownerId: null, updatedAt: now },
          $unset: { pendingLeaderCharacterId: "", ownerType: "" },
        },
        { session }
      );
      await db
        .collection<Character>("characters")
        .updateOne(
          { _id: character._id },
          { $set: { unionLeaderOf: null, updatedAt: now } },
          { session }
        );
      await db.collection("unionLeaderVotes").deleteMany({ unionId: unionObjectId }, { session });
    },
    async () => {
      await db.collection<Union>("unions").updateOne(
        { _id: unionObjectId },
        {
          $set: { ownerId: null, updatedAt: now },
          $unset: { pendingLeaderCharacterId: "", ownerType: "" },
        }
      );
      await db
        .collection<Character>("characters")
        .updateOne({ _id: character._id }, { $set: { unionLeaderOf: null, updatedAt: now } });
      await db.collection("unionLeaderVotes").deleteMany({ unionId: unionObjectId });
    }
  );

  return { ok: true, status: 200 };
}
