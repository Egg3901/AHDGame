import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import type { CountryId } from "@/lib/constants/countries";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getCurrentTurn } from "@/lib/currentTurn";
import { unionApproval } from "@/lib/unions/unionDues";
import { isUnionsBanned } from "@/lib/labour/unionLaws";
import {
  UNDERGROUND_ACTION_COST,
  isUnionExposed,
  resolveUndergroundDrive,
  undergroundHeatText,
  undergroundStatus,
  undergroundStrength,
  type UndergroundDriveMode,
  type UndergroundHeatText,
  type UndergroundStatus,
} from "@/lib/unions/underground";

export type OrganizeUndergroundResult =
  | {
      ok: true;
      status: 200;
      undergroundStrength: number;
      statusLabel: UndergroundStatus;
      heatText: UndergroundHeatText;
      strengthGain: number;
      actionsSpent: number;
    }
  | { ok: false; status: number; error: string };

export function isUndergroundDriveMode(value: unknown): value is UndergroundDriveMode {
  return value === "quiet" || value === "mass";
}

/**
 * Run an underground organizing drive against a suspended union. Any
 * character in the union's country may do this, led or not, mirroring the
 * legal rank-and-file loop — but only while the ban holds, at 2x action
 * cost, into the shadow pool instead of legal strength, and with heat.
 *
 * Treasury is never touched: the frozen treasury is the point of the ban.
 * One drive per character per turn (the existing action-point Sybil
 * throttle, plus an explicit rate limit so a single actor cannot burst
 * heat past decay in one turn). Writes use `$inc` throughout, same
 * contention reasoning as the legal drive; heat is clamped on read and by
 * the turn step.
 */
export async function organizeUnderground(
  db: Db,
  character: Character,
  union: Union,
  mode: UndergroundDriveMode
): Promise<OrganizeUndergroundResult> {
  if (!isSameCountry(character, { countryId: union.countryId as CountryId })) {
    return {
      ok: false,
      status: 403,
      error: "You must be in this union's country to help organize it underground.",
    };
  }
  // Suspended flag is the fast path; the budget flag covers unions seeded
  // while a ban was already enacted (same dual-read as the detail route).
  if (union.suspended !== true && !(await isUnionsBanned(db, union.countryId as CountryId))) {
    return {
      ok: false,
      status: 403,
      error:
        "Underground organizing is only possible while unions are banned. Run a legal organize drive instead.",
    };
  }

  const currentTurn = await getCurrentTurn(db);
  const organizers = db.collection<UnionOrganizer>("unionOrganizers");
  const existing = await organizers.findOne({
    unionId: union._id,
    characterId: character._id,
  });
  if (existing?.lastUndergroundDriveTurn === currentTurn) {
    return {
      ok: false,
      status: 400,
      error: "You already ran an underground drive this turn. Lay low until the next one.",
    };
  }

  const available = character.actions ?? 0;
  if (available < UNDERGROUND_ACTION_COST) {
    return {
      ok: false,
      status: 400,
      error: `An underground drive costs ${UNDERGROUND_ACTION_COST} action points (you have ${available}).`,
    };
  }

  const now = new Date();
  const spend = await db
    .collection<Character>("characters")
    .updateOne(
      { _id: character._id, actions: { $gte: UNDERGROUND_ACTION_COST } },
      { $inc: { actions: -UNDERGROUND_ACTION_COST }, $set: { updatedAt: now } }
    );
  if (spend.modifiedCount === 0) {
    return {
      ok: false,
      status: 409,
      error: "Your available actions changed. Please try again.",
    };
  }

  const exposed = isUnionExposed(union, currentTurn);
  const { strengthGain, heat } = resolveUndergroundDrive({
    mode,
    approval: unionApproval(union),
    exposed,
  });

  const updatedUnion = await db.collection<Union>("unions").findOneAndUpdate(
    { _id: union._id },
    {
      $inc: { undergroundStrength: strengthGain, heat },
      $set: { lastUndergroundDriveTurn: currentTurn, updatedAt: now },
    },
    { returnDocument: "after" }
  );
  if (!updatedUnion) {
    // Refund: the union vanished between the read and the write.
    await db
      .collection<Character>("characters")
      .updateOne({ _id: character._id }, { $inc: { actions: UNDERGROUND_ACTION_COST } });
    return { ok: false, status: 404, error: "Union not found." };
  }

  await organizers.findOneAndUpdate(
    { unionId: union._id, characterId: character._id },
    {
      $inc: { undergroundStrength: strengthGain },
      $setOnInsert: {
        unionId: union._id,
        characterId: character._id,
        organizeCount: 0,
        totalSpent: 0,
        createdAt: now,
      },
      $set: { lastUndergroundDriveTurn: currentTurn, updatedAt: now },
    },
    { upsert: true }
  );

  return {
    ok: true,
    status: 200,
    undergroundStrength: undergroundStrength(updatedUnion),
    statusLabel: undergroundStatus(updatedUnion, currentTurn),
    heatText: undergroundHeatText(updatedUnion),
    strengthGain,
    actionsSpent: UNDERGROUND_ACTION_COST,
  };
}
