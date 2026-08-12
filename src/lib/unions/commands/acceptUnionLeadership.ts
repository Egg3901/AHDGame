import type { ClientSession, Db } from "mongodb";
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
 * corporation CEO acceptance: the offered character may take the seat even
 * when someone (player or NPP) already sits, displacing them.
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
  // Already this union's president — clear a stale offer and succeed.
  if (
    union.ownerId != null &&
    union.ownerType !== "npp" &&
    union.ownerId.toString() === character._id.toString()
  ) {
    await db.collection<Union>("unions").updateOne(
      { _id: union._id },
      { $unset: { pendingLeaderCharacterId: "" }, $set: { updatedAt: new Date() } }
    );
    return { ok: true, status: 200, unionId: union._id };
  }
  if (
    character.unionLeaderOf != null &&
    character.unionLeaderOf.toString() !== union._id.toString()
  ) {
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
  const previousPlayerOwnerId =
    union.ownerId != null && union.ownerType !== "npp" ? union.ownerId : null;

  async function install(session?: ClientSession): Promise<void> {
    const opts = session ? { session } : {};
    const unionClaim = await db.collection<Union>("unions").updateOne(
      { _id: union._id, pendingLeaderCharacterId: character._id },
      {
        $set: {
          ownerId: character._id,
          ownerType: "character" as const,
          updatedAt: now,
        },
        $unset: { pendingLeaderCharacterId: "" },
      },
      opts
    );
    if (unionClaim.modifiedCount === 0) throw new Error("OFFER_GONE");

    const charClaim = await db.collection<Character>("characters").updateOne(
      {
        _id: character._id,
        $or: [
          { unionLeaderOf: null },
          { unionLeaderOf: { $exists: false } },
          { unionLeaderOf: union._id },
        ],
      },
      { $set: { unionLeaderOf: union._id, updatedAt: now } },
      opts
    );
    if (charClaim.modifiedCount === 0) throw new Error("CHARACTER_ALREADY_LEADING");

    if (previousPlayerOwnerId && previousPlayerOwnerId.toString() !== character._id.toString()) {
      await db.collection<Character>("characters").updateOne(
        { _id: previousPlayerOwnerId, unionLeaderOf: union._id },
        { $set: { unionLeaderOf: null, updatedAt: now } },
        opts
      );
    }
  }

  try {
    await runWithOptionalTransaction(
      async (session) => {
        await install(session);
      },
      async () => {
        try {
          await install();
        } catch (error) {
          if ((error as Error).message === "CHARACTER_ALREADY_LEADING") {
            // Restore prior ownership after a partial claim without transactions.
            const restore: Record<string, unknown> = {
              ownerId: union.ownerId,
              updatedAt: now,
              pendingLeaderCharacterId: character._id,
            };
            if (union.ownerType) restore.ownerType = union.ownerType;
            await db.collection<Union>("unions").updateOne(
              { _id: union._id, ownerId: character._id },
              {
                $set: restore,
                ...(union.ownerType ? {} : { $unset: { ownerType: "" } }),
              }
            );
            await db
              .collection<Character>("characters")
              .updateOne(
                { _id: character._id, unionLeaderOf: union._id },
                { $set: { unionLeaderOf: null, updatedAt: now } }
              );
          }
          throw error;
        }
      }
    );
  } catch (error) {
    if (error instanceof Error && error.message === "OFFER_GONE") {
      return { ok: false, status: 409, error: "This presidency offer is no longer available." };
    }
    if (error instanceof Error && error.message === "CHARACTER_ALREADY_LEADING") {
      return { ok: false, status: 409, error: "You already lead a union." };
    }
    throw error;
  }

  return { ok: true, status: 200, unionId: union._id };
}
