import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import type { CountryId } from "@/lib/constants/countries";
import { isSameCountry } from "@/lib/api/sameCountry";
import {
  ORGANIZE_ACTION_COST,
  ORGANIZE_STRENGTH_GAIN,
  isUnionLeadershipElectionOpen,
  unionStrength,
} from "@/lib/unions/unionEconomy";
import { isUnionsBanned, UNIONS_BANNED_MESSAGE } from "@/lib/labour/unionLaws";

export type OrganizeUnionResult =
  | {
      ok: true;
      status: 200;
      strength: number;
      myStrength: number;
      electionOpen: boolean;
      actionsSpent: number;
    }
  | { ok: false; status: number; error: string };

/**
 * Run an organize drive. Any character in the union's country may do this, on
 * any union, led or not: this is the rank-and-file loop, and it is the only
 * union action that is not restricted to the president. It costs action points
 * rather than cash so participation tracks turning up, not net worth.
 *
 * Both the union pool and the organizer's own banked strength go up by the
 * same amount. The banked figure is their vote weight if the presidency opens.
 *
 * Writes use `$inc` throughout, with no read-modify-write on a shared field,
 * because the whole point is that hundreds of players can press this button
 * against the same union in the same turn without contending.
 */
export async function organizeUnion(
  db: Db,
  character: Character,
  union: Union
): Promise<OrganizeUnionResult> {
  if (!isSameCountry(character, { countryId: union.countryId as CountryId })) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this union's country to help organize it.",
    };
  }
  if (union.suspended) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }
  // Union ban (player suggestion #93): organizing an outlawed union is blocked.
  if (await isUnionsBanned(db, union.countryId as CountryId)) {
    return { ok: false, status: 403, error: UNIONS_BANNED_MESSAGE };
  }

  const available = character.actions ?? 0;
  if (available < ORGANIZE_ACTION_COST) {
    return {
      ok: false,
      status: 400,
      error: `An organize drive costs ${ORGANIZE_ACTION_COST} action points (you have ${available}).`,
    };
  }

  const now = new Date();
  const spend = await db
    .collection<Character>("characters")
    .updateOne(
      { _id: character._id, actions: { $gte: ORGANIZE_ACTION_COST } },
      { $inc: { actions: -ORGANIZE_ACTION_COST }, $set: { updatedAt: now } }
    );
  if (spend.modifiedCount === 0) {
    return {
      ok: false,
      status: 409,
      error: "Your available actions changed. Please try again.",
    };
  }

  const updatedUnion = await db
    .collection<Union>("unions")
    .findOneAndUpdate(
      { _id: union._id },
      { $inc: { strength: ORGANIZE_STRENGTH_GAIN }, $set: { updatedAt: now } },
      { returnDocument: "after" }
    );
  if (!updatedUnion) {
    // Refund: the union vanished between the read and the write.
    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $inc: { actions: ORGANIZE_ACTION_COST } });
    return { ok: false, status: 404, error: "Union not found." };
  }

  const organizer = await db.collection<UnionOrganizer>("unionOrganizers").findOneAndUpdate(
    { unionId: union._id, characterId: character._id },
    {
      $inc: { organizeCount: 1, strength: ORGANIZE_STRENGTH_GAIN },
      $setOnInsert: {
        unionId: union._id,
        characterId: character._id,
        totalSpent: 0,
        createdAt: now,
      },
      $set: { updatedAt: now },
    },
    { upsert: true, returnDocument: "after" }
  );

  return {
    ok: true,
    status: 200,
    strength: unionStrength(updatedUnion),
    myStrength: organizer?.strength ?? ORGANIZE_STRENGTH_GAIN,
    electionOpen: isUnionLeadershipElectionOpen(updatedUnion),
    actionsSpent: ORGANIZE_ACTION_COST,
  };
}
