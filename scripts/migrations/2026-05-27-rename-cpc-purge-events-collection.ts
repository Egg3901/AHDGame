/**
 * Migration: Rename `cpcPurgeEvents` collection to `rulingPartyPurgeEvents`.
 *
 * Phase 3 of the one-party-state refactor renames the CPC-named collection
 * to reflect that any future one-party country (not just CN) writes purge
 * events to the same place. The schema is unchanged — every doc already
 * carries `countryId`.
 *
 * Idempotent: skips if `rulingPartyPurgeEvents` already has documents.
 *
 * Usage: npx tsx scripts/migrations/2026-05-27-rename-cpc-purge-events-collection.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

export interface RenameResult {
  copied: number;
  skipped: boolean;
}

export async function renameCpcPurgeEventsCollection(db: Db): Promise<RenameResult> {
  const existingCount = await db.collection("rulingPartyPurgeEvents").countDocuments({});
  if (existingCount > 0) {
    return { copied: 0, skipped: true };
  }

  const oldDocs = await db.collection("cpcPurgeEvents").find({}).toArray();

  if (oldDocs.length > 0) {
    await db.collection("rulingPartyPurgeEvents").insertMany(oldDocs);
  }

  // Drop the old collection regardless of doc count (idempotent: tolerate
  // already-missing).
  try {
    await db.dropCollection("cpcPurgeEvents");
  } catch {
    /* collection didn't exist — fine */
  }

  return { copied: oldDocs.length, skipped: false };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();

  if (dryRun) {
    const existing = await db.collection("rulingPartyPurgeEvents").countDocuments({});
    const old = await db.collection("cpcPurgeEvents").countDocuments({});
    console.log(`[DRY RUN] cpcPurgeEvents=${old} docs, rulingPartyPurgeEvents=${existing} docs`);
    console.log(
      existing > 0
        ? "Would skip (target populated)"
        : `Would copy ${old} doc(s) and drop the old collection`
    );
    await closeDb();
    return;
  }

  const result = await renameCpcPurgeEventsCollection(db);
  console.log(
    result.skipped
      ? "Skipped (target populated)"
      : `Copied ${result.copied} doc(s); dropped cpcPurgeEvents`
  );
  await closeDb();
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
