import type { Db } from "mongodb";
import type { Character, Union } from "@/lib/db/types";
import type { UnionOrganizer } from "@/lib/db/types/union";
import type { CountryId } from "@/lib/constants/countries";
import { isSameCountry } from "@/lib/api/sameCountry";
import { getCurrentTurn } from "@/lib/currentTurn";
import { unionApproval } from "@/lib/unions/unionDues";
import { isUnionsBanned } from "@/lib/labour/unionLaws";
import { extendUnionBanStrikeFromUnderground } from "@/lib/crises/unionBanStrike";
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
      crisisExtended: boolean;
    }
  | { ok: false; status: number; error: string };

export function isUndergroundDriveMode(value: unknown): value is UndergroundDriveMode {
  return value === "quiet" || value === "mass";
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Run an underground organizing drive against a suspended union. Any
 * character in the union's country may do this, led or not, mirroring the
 * legal rank-and-file loop — but only while the ban holds, at 2x action
 * cost, into the shadow pool instead of legal strength, and with heat.
 *
 * Treasury is never touched: the frozen treasury is the point of the ban.
 * One drive per character per turn across all unions (the existing action-point
 * Sybil throttle, plus an atomic character claim so a single actor cannot burst
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
  // The budget is authoritative. Relying on the union flag alone would let a
  // stale suspended document keep accepting drives after repeal, while relying
  // on it as the fast path misses unions seeded during an active ban.
  if (!(await isUnionsBanned(db, union.countryId as CountryId))) {
    return {
      ok: false,
      status: 403,
      error:
        "Underground organizing is only possible while unions are banned. Run a legal organize drive instead.",
    };
  }

  const currentTurn = await getCurrentTurn(db);
  const organizers = db.collection<UnionOrganizer>("unionOrganizers");
  // Prosecution follows the character across unions, not only the cell that
  // the government caught. The organizer row remains the authoritative bar.
  const prosecuted = await organizers.findOne({
    characterId: character._id,
    barredUntilTurn: { $gte: currentTurn },
  });
  if (prosecuted) {
    return {
      ok: false,
      status: 403,
      error: "You are barred from underground organizing by prosecution.",
    };
  }
  const existing = await organizers.findOne({
    unionId: union._id,
    characterId: character._id,
  });
  if (typeof existing?.barredUntilTurn === "number" && currentTurn <= existing.barredUntilTurn) {
    return {
      ok: false,
      status: 403,
      error: "You are barred from underground organizing by prosecution.",
    };
  }
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
  const spend = await db.collection<Character>("characters").updateOne(
    {
      _id: character._id,
      actions: { $gte: UNDERGROUND_ACTION_COST },
      lastUndergroundDriveTurn: { $ne: currentTurn },
    },
    {
      $inc: { actions: -UNDERGROUND_ACTION_COST },
      $set: { lastUndergroundDriveTurn: currentTurn, updatedAt: now },
    }
  );
  if (spend.modifiedCount === 0) {
    return {
      ok: false,
      status: 409,
      error: "Your available actions changed, or you already ran an underground drive this turn.",
    };
  }

  const exposed = isUnionExposed(union, currentTurn);
  const { strengthGain, heat } = resolveUndergroundDrive({
    mode,
    approval: unionApproval(union),
    exposed,
  });

  // The character write claims this turn across all unions. Keep the unique
  // organizer claim as a second guard against stale or older callers, and
  // refund the character claim if that guard loses.
  let organizer: UnionOrganizer | null;
  try {
    organizer = await organizers.findOneAndUpdate(
      {
        unionId: union._id,
        characterId: character._id,
        $or: [
          { lastUndergroundDriveTurn: { $exists: false } },
          { lastUndergroundDriveTurn: null },
          { lastUndergroundDriveTurn: { $ne: currentTurn } },
        ],
        barredUntilTurn: { $not: { $gte: currentTurn } },
      },
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
      { upsert: true, returnDocument: "after" }
    );
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    organizer = null;
  }

  if (!organizer) {
    await db.collection<Character>("characters").updateOne(
      { _id: character._id, lastUndergroundDriveTurn: currentTurn },
      {
        $inc: { actions: UNDERGROUND_ACTION_COST },
        $set: { lastUndergroundDriveTurn: character.lastUndergroundDriveTurn ?? null },
      }
    );
    return {
      ok: false,
      status: 409,
      error: "You already ran an underground drive this turn. Lay low until the next one.",
    };
  }

  const updatedUnion = await db.collection<Union>("unions").findOneAndUpdate(
    { _id: union._id },
    [
      {
        $set: {
          undergroundStrength: { $add: [{ $ifNull: ["$undergroundStrength", 0] }, strengthGain] },
          // Clamp inside the atomic write. Multiple actors can drive one cell
          // concurrently, so a later turn pass is too late to enforce 0-100.
          heat: {
            $min: [100, { $max: [0, { $add: [{ $ifNull: ["$heat", 0] }, heat] }] }],
          },
          recentUndergroundDriveCount: {
            $add: [{ $ifNull: ["$recentUndergroundDriveCount", 0] }, 1],
          },
          lastUndergroundDriveTurn: currentTurn,
          updatedAt: now,
        },
      },
    ],
    { returnDocument: "after" }
  );
  if (!updatedUnion) {
    // Refund: the union vanished between the read and the write.
    await db.collection<Character>("characters").updateOne(
      { _id: character._id, lastUndergroundDriveTurn: currentTurn },
      {
        $inc: { actions: UNDERGROUND_ACTION_COST },
        $set: { lastUndergroundDriveTurn: character.lastUndergroundDriveTurn ?? null },
      }
    );
    if (existing) {
      await organizers.updateOne(
        { _id: organizer._id, lastUndergroundDriveTurn: currentTurn },
        {
          $inc: { undergroundStrength: -strengthGain },
          $set: { lastUndergroundDriveTurn: existing.lastUndergroundDriveTurn, updatedAt: now },
        }
      );
    } else if (organizer._id) {
      await organizers.deleteOne({ _id: organizer._id });
    }
    return { ok: false, status: 404, error: "Union not found." };
  }

  const crisisExtended =
    mode === "mass" && undergroundStrength(updatedUnion) >= 15
      ? await extendUnionBanStrikeFromUnderground(db, union.countryId as CountryId, currentTurn)
      : false;

  return {
    ok: true,
    status: 200,
    undergroundStrength: undergroundStrength(updatedUnion),
    statusLabel: undergroundStatus(updatedUnion, currentTurn),
    heatText: undergroundHeatText(updatedUnion),
    strengthGain,
    actionsSpent: UNDERGROUND_ACTION_COST,
    crisisExtended,
  };
}
