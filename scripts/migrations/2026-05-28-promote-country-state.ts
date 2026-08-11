/**
 * Migration: Promote per-country runtime fields out of COUNTRY_CONFIGS
 * into the new `countryState` DB collection.
 *
 * Background: governmentType / rulingPartyId / opsVoteMultipliers /
 * hasLeaderConfidenceModel are mutated mid-game by the one-party-state
 * collapse subsystem (and future regime-change mechanics). They must
 * live in the DB, not in compile-time constants.
 *
 * Behavior:
 *   - For every country in COUNTRY_CONFIGS, ensure a countryState doc exists.
 *   - Idempotent: skips countries that already have a doc.
 *   - Does NOT touch existing docs (preserves any in-flight runtime state).
 *
 * Usage: npx tsx scripts/migrations/2026-05-28-promote-country-state.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";
import { COUNTRY_CONFIGS, type CountryId } from "@/lib/constants/countries";
import { seedCountryStateFromConfig } from "@/lib/countryState/seed";
import type { CountryState } from "@/lib/db/types/countryState";

export interface PromoteResult {
  created: number;
  skipped: number;
  /** How many pre-existing rows had the Phase-5 reform fields backfilled. */
  backfilled: number;
}

export async function applyPromoteCountryState(db: Db): Promise<PromoteResult> {
  const coll = db.collection<CountryState>("countryState");
  const existing = await coll.find({}).toArray();
  const existingIds = new Set(existing.map((doc) => doc._id));

  const now = new Date();
  let created = 0;
  let skipped = 0;

  for (const countryId of Object.keys(COUNTRY_CONFIGS) as CountryId[]) {
    if (existingIds.has(countryId)) {
      skipped++;
      continue;
    }

    const doc = seedCountryStateFromConfig(countryId, now);
    await coll.insertOne(doc);
    created++;
  }

  // Phase-5 backfill: any pre-existing row from the first migration pass
  // (or a partially-migrated production env) won't have the new
  // reformCooldowns / popularBoostModifiers fields. Sweep them in so
  // Phase-5 reads don't surface `undefined` and Phase-5 writes don't
  // step on a missing-field shape.
  const backfillResult = await coll.updateMany(
    { reformCooldowns: { $exists: false } },
    {
      $set: {
        reformCooldowns: {},
        popularBoostModifiers: [],
        updatedAt: now,
      },
    }
  );

  return { created, skipped, backfilled: backfillResult.modifiedCount ?? 0 };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  if (dryRun) {
    const coll = db.collection<CountryState>("countryState");
    const existing = await coll.find({}).toArray();
    const existingIds = new Set(existing.map((doc) => doc._id));
    const all = Object.keys(COUNTRY_CONFIGS) as CountryId[];
    const toCreate = all.filter((id) => !existingIds.has(id));
    console.log(
      `[DRY RUN] ${all.length} configured countries; ${existingIds.size} already migrated; ${toCreate.length} will be created:`
    );
    for (const id of toCreate) {
      console.log(`  - ${id}`);
    }
    await closeDb();
    return;
  }

  const result = await applyPromoteCountryState(db);
  console.log(
    `Done. created=${result.created}, skipped=${result.skipped}, backfilled=${result.backfilled}`
  );
  await closeDb();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
