/**
 * Migration: unify `militaryUnits` onto the W1 schema.
 *
 * The W1 model adds veterancy / xp / equipment / drill and replaces the
 * region-based `location` with a `theaterId` (homeland = "reserve"). Fresh seeds
 * (`seedMilitaryUnits.ts`) and the recruit route already emit the new fields;
 * this migration backfills existing units on already-seeded databases.
 *
 * Legacy units are those without `vet`. They receive:
 *   vet:1, xp:0, equipment:{firepower:1,protection:1,support:1}, drill:null,
 *   theaterId:"reserve", formationId:null   (and `location` is $unset).
 *
 * Idempotent: units already carrying `vet` are skipped. The dry run and the
 * returned `locationSamples` capture each unit's old `location` as a rollback
 * record before it is unset.
 *
 * Usage: npx tsx scripts/migrations/2026-07-14-unify-military-unit-fields.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

export interface UnifyResult {
  legacyFound: number;
  alreadyMigrated: number;
  /** unitId → old location value, captured before $unset (rollback record). */
  locationSamples: Record<string, string>;
}

interface LegacyUnitDoc {
  _id: unknown;
  location?: string;
}

const UNIFIED_DEFAULTS = {
  vet: 1,
  xp: 0,
  equipment: { firepower: 1, protection: 1, support: 1 },
  drill: null,
  theaterId: "reserve",
  formationId: null,
};

/**
 * Pure migration logic. Exported so the test suite can drive it against a
 * MockDb without parsing CLI args or touching env vars.
 */
export async function applyUnifiedMilitaryFieldsMigration(db: Db): Promise<UnifyResult> {
  const legacy = await db
    .collection<LegacyUnitDoc>("militaryUnits")
    .find({ vet: { $exists: false } })
    .toArray();
  const alreadyMigrated = await db
    .collection("militaryUnits")
    .countDocuments({ vet: { $exists: true } });

  const locationSamples: Record<string, string> = {};
  for (const u of legacy) {
    if (u.location) locationSamples[String(u._id)] = u.location;
  }

  if (legacy.length > 0) {
    await db
      .collection("militaryUnits")
      .updateMany(
        { vet: { $exists: false } },
        { $set: { ...UNIFIED_DEFAULTS }, $unset: { location: "" } }
      );
  }

  return { legacyFound: legacy.length, alreadyMigrated, locationSamples };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  const legacy = await db
    .collection<LegacyUnitDoc>("militaryUnits")
    .find({ vet: { $exists: false } })
    .toArray();
  const alreadyMigrated = await db
    .collection("militaryUnits")
    .countDocuments({ vet: { $exists: true } });

  if (dryRun) {
    console.log(
      `[DRY RUN] ${legacy.length} legacy units to migrate; ${alreadyMigrated} already unified.`
    );
    console.log(`[DRY RUN] location values (rollback record):`);
    for (const u of legacy) {
      console.log(`  - ${String(u._id)} location=${u.location ?? "(none)"}`);
    }
    await closeDb();
    return;
  }

  const result = await applyUnifiedMilitaryFieldsMigration(db);
  console.log(`Done. legacyFound=${result.legacyFound}, alreadyMigrated=${result.alreadyMigrated}`);
  console.log(`location rollback record: ${JSON.stringify(result.locationSamples)}`);
  await closeDb();
}

// Only run main when invoked directly via `npx tsx ...`; the test suite imports
// `applyUnifiedMilitaryFieldsMigration` without triggering this block.
if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
