/**
 * Migration: W10 — units follow their general.
 *
 * The W10 model adds `assignedGeneralId` (the general a unit is led by; null =
 * General Staff / unassigned) and retires the dead `formationId` field (always null,
 * never read). Fresh seeds and the recruit route already emit `assignedGeneralId`;
 * this migration backfills existing units on already-seeded databases.
 *
 * Each unit without `assignedGeneralId` receives `assignedGeneralId: null`,
 * `theaterId: "reserve"`, and has `formationId` $unset. Resetting theaterId is
 * required, not cosmetic: battle math reads the stored theaterId (it does not
 * re-derive), and a null-general unit's theater is unconditionally "reserve" in the
 * W10 model. Leaving a stale front theaterId would make a leaderless unit fight at a
 * front — a state W10 forbids. reconcileUnitTheaters keeps the two in sync thereafter.
 *
 * Idempotent: units already carrying `assignedGeneralId` are skipped.
 *
 * Usage: npx tsx scripts/migrations/2026-07-23-unit-assigned-general.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

export interface AssignedGeneralResult {
  backfilled: number;
  alreadyMigrated: number;
}

/**
 * Pure migration logic. Exported so the test suite can drive it against a MockDb
 * without parsing CLI args or touching env vars.
 */
export async function applyAssignedGeneralMigration(db: Db): Promise<AssignedGeneralResult> {
  const col = db.collection("militaryUnits");
  const backfilled = await col.countDocuments({ assignedGeneralId: { $exists: false } });
  const alreadyMigrated = await col.countDocuments({ assignedGeneralId: { $exists: true } });

  if (backfilled > 0) {
    await col.updateMany(
      { assignedGeneralId: { $exists: false } },
      { $set: { assignedGeneralId: null, theaterId: "reserve" }, $unset: { formationId: "" } }
    );
  }

  return { backfilled, alreadyMigrated };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  const backfilled = await db
    .collection("militaryUnits")
    .countDocuments({ assignedGeneralId: { $exists: false } });
  const alreadyMigrated = await db
    .collection("militaryUnits")
    .countDocuments({ assignedGeneralId: { $exists: true } });

  if (dryRun) {
    console.log(
      `[DRY RUN] ${backfilled} units to backfill ` +
        `(assignedGeneralId:null, theaterId:reserve, $unset formationId); ` +
        `${alreadyMigrated} already migrated.`
    );
    await closeDb();
    return;
  }

  const result = await applyAssignedGeneralMigration(db);
  console.log(`Done. backfilled=${result.backfilled}, alreadyMigrated=${result.alreadyMigrated}`);
  await closeDb();
}

// Only run main when invoked directly via `npx tsx ...`; the test suite imports
// `applyAssignedGeneralMigration` without triggering this block.
if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
