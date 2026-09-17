import type { Db } from "mongodb";
import { MINISTERIAL_ACTION_CAP } from "@/lib/constants/cabinetMechanicsTypes";
import { getCalendarDayInTimezone } from "@/lib/time/dailyReset";
import {
  roleSlotForUkPosition,
  sharedPoolFromRows,
  UK_CENTRAL_POSITION_IDS,
  type UkMinisterialRoleSlot,
} from "@/lib/uk/dualMinistry/rules";
import type { Migration, MigrationResult } from "../types";

export const UK_DUAL_MINISTRY_ROLE_SLOT_INDEX = "cabinetMembers_countryId_characterId_roleSlot";
const LEGACY_ONE_SEAT_INDEX = "cabinetMembers_countryId_characterId";

interface UkCabinetRow {
  _id: unknown;
  positionId: string;
  characterId: { toString(): string } | null;
  ministerialActions?: number;
  lastMinisterialActionResetDay?: string;
  roleSlot?: UkMinisterialRoleSlot;
}

/**
 * UK dual-ministry backfill (issue #2049).
 *
 * Live worlds predate `roleSlot` on cabinet rows and the shared per-player
 * ministerial action pool, so:
 *   1. every UK row missing `roleSlot` is classified (the two central titles
 *      become "central", everything else "departmental");
 *   2. every UK player holder whose character has no shared pool gets one,
 *      initialized from the minimum remaining actions across their rows
 *      (paired with that same row's reset day), so the migration never mints
 *      extra actions — legacy rows missing action fields read as a full cap
 *      pool with no reset day, exactly like the live spend path does;
 *   3. the replacement unique index on (countryId, characterId, roleSlot) is
 *      created BEFORE the legacy one-seat index is dropped.
 *
 * Retains every appointment: rows are only ever updated, never deleted, and
 * characters that already carry a shared pool are left untouched. A holder
 * with two rows in the same slot (impossible while the legacy index is
 * enforced) is reported and skips the index swap rather than being resolved
 * by deletion.
 */
async function backfillUkDualMinistry(db: Db, dryRun: boolean): Promise<MigrationResult> {
  const notes: string[] = [];
  const members = db.collection("cabinetMembers");

  const rows = (await members
    .find({ countryId: "UK" })
    .project({
      positionId: 1,
      characterId: 1,
      ministerialActions: 1,
      lastMinisterialActionResetDay: 1,
      roleSlot: 1,
    })
    .toArray()) as UkCabinetRow[];
  notes.push(`${rows.length} UK cabinet row(s) scanned`);

  const missingSlot = rows.filter((row) => row.roleSlot == null);
  const centralMissing = missingSlot.filter((row) =>
    (UK_CENTRAL_POSITION_IDS as readonly string[]).includes(row.positionId)
  ).length;
  notes.push(
    `${missingSlot.length} row(s) missing roleSlot ` +
      `(${centralMissing} central, ${missingSlot.length - centralMissing} departmental)`
  );

  // Holder rows grouped by character for pool init and same-slot detection.
  const rowsByHolder = new Map<string, UkCabinetRow[]>();
  for (const row of rows) {
    if (row.characterId == null) continue;
    const key = row.characterId.toString();
    const held = rowsByHolder.get(key) ?? [];
    held.push(row);
    rowsByHolder.set(key, held);
  }
  const conflicts: string[] = [];
  for (const [holderId, held] of rowsByHolder) {
    const slots = held.map((row) => row.roleSlot ?? roleSlotForUkPosition(row.positionId));
    if (new Set(slots).size !== slots.length) conflicts.push(holderId);
  }
  if (conflicts.length > 0) {
    notes.push(
      `${conflicts.length} holder(s) with two rows in the same slot (index swap skipped): ` +
        conflicts.sort().join(", ")
    );
  }

  if (dryRun) {
    notes.push(
      `dry run: would classify ${missingSlot.length} row(s), ` +
        `initialize ${rowsByHolder.size} holder pool(s), ` +
        (conflicts.length > 0
          ? "skip the index swap (conflicts present)"
          : `create ${UK_DUAL_MINISTRY_ROLE_SLOT_INDEX} then drop ${LEGACY_ONE_SEAT_INDEX}`) +
        "; no writes performed"
    );
    return { documentsScanned: rows.length, notes };
  }

  const now = new Date();
  const today = getCalendarDayInTimezone(now);
  let documentsUpdated = 0;

  // 1. Classify rows missing roleSlot. Two targeted updates keep this a
  // no-op for rows the live appoint path already stamps.
  for (const slot of ["central", "departmental"] as const) {
    const filter =
      slot === "central"
        ? {
            countryId: "UK",
            roleSlot: { $exists: false },
            positionId: { $in: [...UK_CENTRAL_POSITION_IDS] },
          }
        : {
            countryId: "UK",
            roleSlot: { $exists: false },
            positionId: { $nin: [...UK_CENTRAL_POSITION_IDS] },
          };
    const result = await members.updateMany(filter, {
      $set: { roleSlot: slot, updatedAt: now },
    });
    documentsUpdated += result.modifiedCount ?? 0;
  }
  notes.push(`classified ${documentsUpdated} row(s) with roleSlot`);

  // 2. Initialize missing shared pools from the holder rows. Guarded to
  // characters without a pool, so live pools (and reruns) are untouched.
  let poolsInitialized = 0;
  for (const held of rowsByHolder.values()) {
    const holderId = held[0]!.characterId;
    if (holderId == null || typeof holderId !== "object") continue;
    const shared = sharedPoolFromRows(
      held.map((row) => ({
        remaining: row.ministerialActions ?? MINISTERIAL_ACTION_CAP,
        resetDay: row.lastMinisterialActionResetDay ?? null,
      })),
      MINISTERIAL_ACTION_CAP
    );
    const result = await db.collection("characters").updateOne(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { _id: holderId as any, sharedMinisterialActions: { $exists: false } },
      {
        $set: {
          sharedMinisterialActions: shared.remaining,
          sharedMinisterialActionResetDay: shared.resetDay ?? today,
          updatedAt: now,
        },
      }
    );
    if ((result.upsertedCount ?? 0) > 0 || (result.modifiedCount ?? 0) > 0) poolsInitialized++;
  }
  documentsUpdated += poolsInitialized;
  notes.push(`initialized ${poolsInitialized} shared holder pool(s)`);

  // 3. Index swap: replacement first, legacy drop only after it exists.
  if (conflicts.length === 0) {
    try {
      await members.createIndex(
        { countryId: 1, characterId: 1, roleSlot: 1 },
        {
          unique: true,
          name: UK_DUAL_MINISTRY_ROLE_SLOT_INDEX,
          partialFilterExpression: { characterId: { $type: "objectId" } },
        }
      );
      notes.push(`created ${UK_DUAL_MINISTRY_ROLE_SLOT_INDEX}`);
    } catch (error) {
      notes.push(
        `replacement index creation failed (${error instanceof Error ? error.message : String(error)}); legacy index kept`
      );
      return { documentsScanned: rows.length, documentsUpdated, documentsDeleted: 0, notes };
    }
    try {
      await members.dropIndex(LEGACY_ONE_SEAT_INDEX);
      notes.push(`dropped ${LEGACY_ONE_SEAT_INDEX}`);
    } catch {
      notes.push(`${LEGACY_ONE_SEAT_INDEX} already absent`);
    }
  }

  notes.push("no appointments deleted");
  return { documentsScanned: rows.length, documentsUpdated, documentsDeleted: 0, notes };
}

export const migration: Migration = {
  id: "2026-09-17-uk-dual-ministry-role-slot",
  description:
    "Classify UK cabinet rows into departmental/central role slots, init shared holder action pools from current balances, and swap the one-seat index for the role-slot index (no appointments deleted)",
  idempotent: true,
  execute: (db, ctx) => backfillUkDualMinistry(db, ctx.dryRun),
};
