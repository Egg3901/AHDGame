import type { Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { isSameCountry } from "@/lib/api/sameCountry";
import { runWithOptionalTransaction } from "@/lib/db/runWithOptionalTransaction";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";

export type AcceptUnionLeadershipResult =
  { ok: true; status: 200; unionId: ObjectId } | { ok: false; status: number; error: string };

/**
 * Accept a union presidency offer (`pendingLeaderCharacterId`). Mirrors
 * corporation CEO acceptance — only the offered character may take the seat.
 */
export async function acceptUnionLeadership(
  db: Db,
  character: Character,
  union: Union
): Promise<AcceptUnionLeadershipResult> {
  if (!union.pendingLeaderCharacterId) {
    return { ok: false, status: 400, error: "No presidency offer is pending for this union." };
  }
  if (union.pendingLeaderCharacterId.toString() !== character._id.toString()) {
    return { ok: false, status: 403, error: "You have not been offered this union's presidency." };
  }
  if (union.ownerId != null) {
    return { ok: false, status: 409, error: "This union already has a president." };
  }
  if (character.unionLeaderOf != null) {
    return { ok: false, status: 409, error: "You already lead a union." };
  }
  if (!isSameCountry(character, { countryId: union.countryId as CountryId })) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this union's country to accept the presidency.",
    };
  }
  // Union ban (player suggestion #93): no new leadership while banned.
  if (await isUnionsBanned(db, union.countryId as CountryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const now = new Date();
  try {
    await runWithOptionalTransaction(
      async (session) => {
        const unionClaim = await db.collection<Union>("unions").updateOne(
          { _id: union._id, ownerId: null, pendingLeaderCharacterId: character._id },
          {
            $set: { ownerId: character._id, updatedAt: now },
            $unset: { pendingLeaderCharacterId: "" },
          },
          { session }
        );
        if (unionClaim.modifiedCount === 0) throw new Error("UNION_ALREADY_OWNED");

        const charClaim = await db
          .collection<Character>("characters")
          .updateOne(
            { _id: character._id, unionLeaderOf: null },
            { $set: { unionLeaderOf: union._id, updatedAt: now } },
            { session }
          );
        if (charClaim.modifiedCount === 0) throw new Error("CHARACTER_ALREADY_LEADING");
      },
      async () => {
        const unionClaim = await db.collection<Union>("unions").updateOne(
          { _id: union._id, ownerId: null, pendingLeaderCharacterId: character._id },
          {
            $set: { ownerId: character._id, updatedAt: now },
            $unset: { pendingLeaderCharacterId: "" },
          }
        );
        if (unionClaim.modifiedCount === 0) throw new Error("UNION_ALREADY_OWNED");

        try {
          const charClaim = await db
            .collection<Character>("characters")
            .updateOne(
              { _id: character._id, unionLeaderOf: null },
              { $set: { unionLeaderOf: union._id, updatedAt: now } }
            );
          if (charClaim.modifiedCount === 0) {
            await db
              .collection<Union>("unions")
              .updateOne({ _id: union._id }, { $set: { ownerId: null } });
            throw new Error("CHARACTER_ALREADY_LEADING");
          }
        } catch (error) {
          if ((error as Error).message !== "CHARACTER_ALREADY_LEADING") {
            await db
              .collection<Union>("unions")
              .updateOne({ _id: union._id }, { $set: { ownerId: null } });
          }
          throw error;
        }
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "UNION_ALREADY_OWNED") {
      return { ok: false, status: 409, error: "This union already has a president." };
    }
    if (error instanceof Error && error.message === "CHARACTER_ALREADY_LEADING") {
      return { ok: false, status: 409, error: "You already lead a union." };
    }
    throw error;
  }

  return { ok: true, status: 200, unionId: union._id };
}
