/**
 * Migration: Backfill `countryId` on every `stateMetrics` document.
 *
 * `stateMetrics` rows pre-date the multi-country migration and ship without
 * the `countryId` field. `computeApprovalMap(db, countryId)` filters by
 * `{ countryId }`, so every per-country approval overlay (map page → Approval
 * tab) returns zero entries and the UI falls back to slate-gray on every
 * region — even though the underlying metrics are seeded.
 *
 * This script cross-references `states.countryId` (which is always set) using
 * the shared `_id` field and writes the matching `countryId` onto each
 * `stateMetrics` row. Runs in dry-run mode by default. Pass `--apply` to
 * actually write changes.
 *
 * Run (dry-run):  npx tsx scripts/migrations/backfill-state-metrics-country-id.ts
 * Run (apply):    npx tsx scripts/migrations/backfill-state-metrics-country-id.ts --apply
 */

import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not set. Read it from .env.local or export it.");
  process.exit(1);
}
const DB_NAME = "a-house-divided";

interface StateRow {
  _id: string;
  countryId?: string;
}

interface StateMetricsRow {
  _id: string;
  countryId?: string;
}

async function migrate(db: Db, apply: boolean): Promise<void> {
  const states = await db.collection<StateRow>("states").find({}).toArray();
  const stateCountry = new Map<string, string | undefined>(states.map((s) => [s._id, s.countryId]));

  const metrics = await db
    .collection<StateMetricsRow>("stateMetrics")
    .find({})
    .project<Pick<StateMetricsRow, "_id" | "countryId">>({ _id: 1, countryId: 1 })
    .toArray();

  let alreadyOk = 0;
  let toBackfill = 0;
  const missing: string[] = [];
  const byCountry = new Map<string, number>();
  const ops: {
    updateOne: {
      filter: { _id: string };
      update: { $set: { countryId: string } };
    };
  }[] = [];

  for (const m of metrics) {
    if (m.countryId) {
      alreadyOk += 1;
      continue;
    }
    const countryId = stateCountry.get(m._id);
    if (!countryId) {
      missing.push(m._id);
      continue;
    }
    toBackfill += 1;
    byCountry.set(countryId, (byCountry.get(countryId) ?? 0) + 1);
    ops.push({
      updateOne: {
        filter: { _id: m._id },
        update: { $set: { countryId } },
      },
    });
  }

  console.log(`stateMetrics rows total:     ${metrics.length}`);
  console.log(`  countryId already set:     ${alreadyOk}`);
  console.log(`  will backfill:             ${toBackfill}`);
  if (byCountry.size > 0) {
    for (const [cid, count] of [...byCountry.entries()].sort()) {
      console.log(`    ${cid}: ${count}`);
    }
  }
  console.log(`  no matching state row:     ${missing.length}`);
  if (missing.length > 0) {
    console.log(`    orphaned _ids: ${missing.join(", ")}`);
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to persist changes.");
    return;
  }
  if (ops.length === 0) {
    console.log("\nNothing to write.");
    return;
  }

  console.log(`\nApplying ${ops.length} updates...`);
  const result = await db.collection<StateMetricsRow>("stateMetrics").bulkWrite(ops);
  console.log(`matched=${result.matchedCount} modified=${result.modifiedCount}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const client = new MongoClient(MONGODB_URI!);
  try {
    await client.connect();
    console.log("Connected to MongoDB");
    const db = client.db(DB_NAME);
    await migrate(db, apply);
    console.log("\nDone.");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
