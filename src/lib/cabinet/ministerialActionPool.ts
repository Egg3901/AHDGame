/** Ministerial pools share one guarded player balance across UK appointments. */
import { ObjectId, type Db, type AnyBulkWriteOperation } from "mongodb";
import {
  MINISTERIAL_ACTION_ACCRUAL_TURNS,
  MINISTERIAL_ACTION_CAP,
} from "@/lib/constants/cabinetMechanicsTypes";
import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";
import { getCabinetMembersCollection } from "@/lib/db/collections/cabinetMembers";
import type { UnifiedCabinetMember } from "@/lib/db/types/unifiedCabinetMember";
import type { Character } from "@/lib/db/types";
import type { CountryId } from "@/lib/constants/countries";
import { sharedPoolFromRows } from "@/lib/uk/dualMinistry/rules";
import { isOfficePoolAccrualTurn } from "@/lib/actions/officePoolAccrual";

export { MINISTERIAL_ACTION_RESET_HINT } from "./ministerialActionHint";

/** Fields to seed on a new cabinet appointment's action pool. */
export function initialMinisterialActionFields(now: Date = new Date()) {
  return {
    ministerialActions: MINISTERIAL_ACTION_CAP,
    lastMinisterialActionResetDay: getCalendarDayInTimezone(now),
  };
}

/**
 * True when this row draws from a shared per-player pool: UK rows held by a
 * player character. NPP-held UK rows (null characterId) and every non-UK row
 * keep the legacy per-row pool.
 */
export function usesSharedMinisterialPool(
  countryId: string,
  member: Pick<UnifiedCabinetMember, "characterId">
): member is UnifiedCabinetMember & { characterId: ObjectId } {
  return countryId === ("UK" as CountryId) && member.characterId != null;
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
      ...(member.ministerialActions != null
        ? { ministerialActions: member.ministerialActions }
        : {}),
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
    const updated = await db
      .collection<Character>("characters")
      .findOneAndUpdate(
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
  await db.collection<Character>("characters").updateOne(
    { _id: characterId },
    {
      $set: {
        sharedMinisterialActions: shared.remaining,
        sharedMinisterialActionResetDay: resetDay,
        updatedAt: now,
      },
    }
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
 * Per-turn accrual for UK shared pools: every `MINISTERIAL_ACTION_ACCRUAL_TURNS`
 * turns each UK player holder gains +1 shared action, banked up to the cap, and
 * the new balance is mirrored to every row they hold. Missing pools initialize
 * from the holder rows first (same as a read would). The per-character
 * `sharedMinisterialActionAccrualTurn` stamp makes a re-run of the same turn a
 * no-op. Bounded by the UK holder count.
 */
export async function accrueUkSharedPools(
  db: Db,
  rows: { characterId?: ObjectId | null; countryId?: string }[],
  currentTurn: number,
  now: Date = new Date()
): Promise<number> {
  if (!isMinisterialAccrualTurn(currentTurn)) return 0;
  const holderIds = [
    ...new Set(
      rows
        .filter((row) => row.countryId === "UK" && row.characterId != null)
        .map((row) => (row.characterId as ObjectId).toString())
    ),
  ].map((id) => new ObjectId(id));
  if (!holderIds.length) return 0;
  const characters = db.collection<Character>("characters");
  const members = getCabinetMembersCollection(db);
  const [holders, holderRows] = await Promise.all([
    characters
      .find({ _id: { $in: holderIds } })
      .project({ sharedMinisterialActions: 1 })
      .toArray(),
    members
      .find({ countryId: "UK" as never, characterId: { $in: holderIds } })
      .project({ characterId: 1, ministerialActions: 1, lastMinisterialActionResetDay: 1 })
      .toArray(),
  ]);
  const backfills: AnyBulkWriteOperation<Character>[] = holders
    .filter((holder) => holder.sharedMinisterialActions == null)
    .map((holder) => {
      const shared = sharedPoolFromRows(
        holderRows.filter((row) => row.characterId?.equals(holder._id)).map(toRowState),
        MINISTERIAL_ACTION_CAP
      );
      return {
        updateOne: {
          filter: {
            _id: holder._id,
            $or: [
              { sharedMinisterialActions: { $exists: false } },
              { sharedMinisterialActions: { $type: "null" } },
            ],
          },
          update: {
            $set: {
              sharedMinisterialActions: shared.remaining,
              sharedMinisterialActionResetDay: shared.resetDay ?? getCalendarDayInTimezone(now),
              updatedAt: now,
            },
          },
        },
      };
    });
  if (backfills.length) await characters.bulkWrite(backfills);
  const result = await characters.updateMany(
    {
      _id: { $in: holderIds },
      sharedMinisterialActions: { $lt: MINISTERIAL_ACTION_CAP },
      sharedMinisterialActionAccrualTurn: { $ne: currentTurn },
    },
    {
      $inc: { sharedMinisterialActions: 1 },
      $set: { sharedMinisterialActionAccrualTurn: currentTurn, updatedAt: now },
    }
  );
  // Read actual guarded results, including a previous run whose mirror failed.
  const updated = await characters
    .find({ _id: { $in: holderIds }, sharedMinisterialActionAccrualTurn: currentTurn })
    .project({ sharedMinisterialActions: 1 })
    .toArray();
  if (updated.length)
    await members.bulkWrite(
      updated.map((holder) => ({
        updateMany: {
          filter: { countryId: "UK" as never, characterId: holder._id },
          update: { $set: { ministerialActions: holder.sharedMinisterialActions, updatedAt: now } },
        },
      }))
    );
  return result.modifiedCount;
}

/** True on turns where ministerial pools gain their +1 accrual. */
export function isMinisterialAccrualTurn(currentTurn: number): boolean {
  return isOfficePoolAccrualTurn(currentTurn, MINISTERIAL_ACTION_ACCRUAL_TURNS);
}
