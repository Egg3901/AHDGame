import { ObjectId, type Db } from "mongodb";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import type { Character } from "@/lib/db/types";
import {
  isSharedPoolStale,
  sharedPoolFromRows,
} from "@/lib/uk/dualMinistry/rules";

/** Fields to seed on a new cabinet appointment's action pool. */
export function initialMinisterialActionFields(now: Date = new Date()) {
  return {
    ministerialActions: MINISTERIAL_ACTION_CAP,
    lastMinisterialActionResetDay: getCalendarDayInTimezone(now),
  };
}

export const MINISTERIAL_ACTION_RESET_HINT = "Resets daily at midnight Eastern Time.";

/**
 * True when this row draws from a shared per-player pool: UK rows held by a
 * player character. NPP-held UK rows (null characterId) and every non-UK row
 * keep the legacy per-row pool.
 */
export function usesSharedMinisterialPool(
  countryId: string,
  member: Pick<UnifiedCabinetMember, "characterId">
): member is UnifiedCabinetMember & { characterId: ObjectId } {
  return countryId === "UK" && member.characterId != null;
}

interface HolderRowState {
  ministerialActions?: number;
  lastMinisterialActionResetDay?: string;
}

function toRowState(row: HolderRowState) {
  return {
    remaining: row.ministerialActions ?? MINISTERIAL_ACTION_CAP,
    resetDay: row.lastMinisterialActionResetDay ?? null,
  };
}

/**
 * Read (and backfill when absent) the shared pool for a UK player holder.
 * A missing character pool initializes from the holder rows via
 * `sharedPoolFromRows`, so the second title starts from the surviving
 * balance instead of minting fresh actions. Never deletes appointments.
 */
export async function ensureUkSharedPool(
  db: Db,
  characterId: ObjectId,
  now: Date = new Date()
): Promise<{ remaining: number; resetDay: string | null }> {
  const today = getCalendarDayInTimezone(now);
  const [character, rows] = await Promise.all([
    db
      .collection<Character>("characters")
      .findOne(
        { _id: characterId },
        { projection: { sharedMinisterialActions: 1, sharedMinisterialActionResetDay: 1 } }
      ),
    getCabinetMembersCollection(db)
      .find({ countryId: "UK" as never, characterId })
      .project({ ministerialActions: 1, lastMinisterialActionResetDay: 1 })
      .toArray(),
  ]);
  if (character?.sharedMinisterialActions != null) {
    return {
      remaining: character.sharedMinisterialActions,
      resetDay: character.sharedMinisterialActionResetDay ?? null,
    };
  }
  const shared = sharedPoolFromRows(rows.map(toRowState), MINISTERIAL_ACTION_CAP);
  await db.collection<Character>("characters").updateOne(
    { _id: characterId },
    {
      $set: {
        sharedMinisterialActions: shared.remaining,
        sharedMinisterialActionResetDay: shared.resetDay ?? today,
        updatedAt: now,
      },
    }
  );
  return { remaining: shared.remaining, resetDay: shared.resetDay ?? today };
}

/**
 * Remaining ministerial actions for a cabinet row. UK player holders read the
 * shared pool; everyone else reads the row (backfilling legacy rows missing
 * action fields exactly as before).
 */
export async function resolveMinisterialRemaining(
  db: Db,
  countryId: string,
  member: UnifiedCabinetMember,
  now: Date = new Date()
): Promise<number> {
  if (usesSharedMinisterialPool(countryId, member)) {
    return (await ensureUkSharedPool(db, member.characterId, now)).remaining;
  }
  if (member.ministerialActions == null || member.lastMinisterialActionResetDay == null) {
    const backfill = {
      ...initialMinisterialActionFields(now),
      ...(member.ministerialActions != null ? { ministerialActions: member.ministerialActions } : {}),
    };
    await getCabinetMembersCollection(db).updateOne({ _id: member._id }, { $set: backfill });
    return backfill.ministerialActions;
  }
  return member.ministerialActions;
}

export interface MinisterialSpendResult {
  ok: boolean;
  remaining: number;
}

/**
 * Spend one ministerial action. UK player holders spend atomically from the
 * character pool (the duplicate-key style lost race returns ok:false) and the
 * spend mirrors to every row the holder keeps, so both office pages show the
 * same balance. Legacy rows keep the per-row atomic spend.
 */
export async function spendMinisterialAction(
  db: Db,
  countryId: string,
  member: UnifiedCabinetMember,
  now: Date = new Date()
): Promise<MinisterialSpendResult> {
  const membersCol = getCabinetMembersCollection(db);
  if (usesSharedMinisterialPool(countryId, member)) {
    const pool = await ensureUkSharedPool(db, member.characterId, now);
    if (pool.remaining < 1) return { ok: false, remaining: pool.remaining };
    const updated = await db.collection<Character>("characters").findOneAndUpdate(
      { _id: member.characterId, sharedMinisterialActions: { $gte: 1 } },
      { $inc: { sharedMinisterialActions: -1 }, $set: { updatedAt: now } },
      { returnDocument: "after", projection: { sharedMinisterialActions: 1 } }
    );
    if (!updated || (updated.sharedMinisterialActions ?? 0) < 0) {
      const current = await ensureUkSharedPool(db, member.characterId, now);
      return { ok: false, remaining: current.remaining };
    }
    const remaining = updated.sharedMinisterialActions ?? pool.remaining - 1;
    await membersCol.updateMany(
      { countryId: "UK" as never, characterId: member.characterId },
      {
        $set: {
          ministerialActions: remaining,
          lastMinisterialActionResetDay: getCalendarDayInTimezone(now),
          updatedAt: now,
        },
      }
    );
    return { ok: true, remaining };
  }
  const before = await resolveMinisterialRemaining(db, countryId, member, now);
  if (before < 1) return { ok: false, remaining: before };
  const spendResult = await membersCol.updateOne(
    { _id: member._id, ministerialActions: { $gte: 1 } },
    { $inc: { ministerialActions: -1 } }
  );
  if (spendResult.modifiedCount === 0) {
    const current = await membersCol.findOne(
      { _id: member._id },
      { projection: { ministerialActions: 1 } }
    );
    return { ok: false, remaining: current?.ministerialActions ?? before };
  }
  return { ok: true, remaining: before - 1 };
}

/**
 * Refund one ministerial action after a failed order write. Mirrors the spend:
 * shared pools refund to the character pool and every holder row.
 */
export async function refundMinisterialAction(
  db: Db,
  countryId: string,
  member: UnifiedCabinetMember,
  now: Date = new Date()
): Promise<void> {
  if (usesSharedMinisterialPool(countryId, member)) {
    await db
      .collection<Character>("characters")
      .updateOne({ _id: member.characterId }, { $inc: { sharedMinisterialActions: 1 } });
    const pool = await db
      .collection<Character>("characters")
      .findOne({ _id: member.characterId }, { projection: { sharedMinisterialActions: 1 } });
    if (pool?.sharedMinisterialActions != null) {
      await getCabinetMembersCollection(db).updateMany(
        { countryId: "UK" as never, characterId: member.characterId },
        { $set: { ministerialActions: pool.sharedMinisterialActions, updatedAt: now } }
      );
    }
    return;
  }
  await getCabinetMembersCollection(db).updateOne(
    { _id: member._id },
    { $inc: { ministerialActions: 1 } }
  );
}

/**
 * Reconcile a UK holder after an appointment change: recompute the shared
 * pool from all holder rows and mirror it everywhere. Used after appoint so
 * a fresh cap row cannot lift the surviving balance.
 */
export async function reconcileUkSharedPool(
  db: Db,
  characterId: ObjectId,
  now: Date = new Date()
): Promise<{ remaining: number; resetDay: string }> {
  const today = getCalendarDayInTimezone(now);
  const rows = await getCabinetMembersCollection(db)
    .find({ countryId: "UK" as never, characterId })
    .project({ ministerialActions: 1, lastMinisterialActionResetDay: 1 })
    .toArray();
  const shared = sharedPoolFromRows(rows.map(toRowState), MINISTERIAL_ACTION_CAP);
  const resetDay = shared.resetDay ?? today;
  await db
    .collection<Character>("characters")
    .updateOne(
      { _id: characterId },
      { $set: { sharedMinisterialActions: shared.remaining, sharedMinisterialActionResetDay: resetDay, updatedAt: now } }
    );
  await getCabinetMembersCollection(db).updateMany(
    { countryId: "UK" as never, characterId },
    {
      $set: {
        ministerialActions: shared.remaining,
        lastMinisterialActionResetDay: resetDay,
        updatedAt: now,
      },
    }
  );
  return { remaining: shared.remaining, resetDay };
}

/**
 * UK holder character ids whose shared pool is missing or stale, from already
 * loaded member rows plus one projected character read. Lets the turn reset
 * refill shared pools without touching fat documents.
 */
export async function ukSharedPoolIdsNeedingReset(
  db: Db,
  rows: { characterId?: ObjectId | null; countryId?: string }[],
  today: string
): Promise<string[]> {
  const holderIds = [
    ...new Set(
      rows
        .filter((row) => row.countryId === "UK" && row.characterId != null)
        .map((row) => (row.characterId as ObjectId).toString())
    ),
  ];
  if (holderIds.length === 0) return [];
  const objectIds = holderIds.map((id) => new ObjectId(id));
  const characters = await db
    .collection<Character>("characters")
    .find({ _id: { $in: objectIds } } as never)
    .project({ sharedMinisterialActions: 1, sharedMinisterialActionResetDay: 1 })
    .toArray();
  const poolById = new Map(characters.map((c) => [c._id.toString(), c]));
  return holderIds.filter((id) => {
    const pool = poolById.get(id);
    if (pool?.sharedMinisterialActions == null) return true;
    return isSharedPoolStale(pool.sharedMinisterialActionResetDay, today);
  });
}
