/**
 * Migration: Copy missing state baselines from legacy stateMetricBaselines
 * into the new stateBaselines collection, and seed DE/JP/BR/IE baselines
 * for any countries that need them.
 *
 * Bug #0571 root cause: stateBaselines only had US+UK; DE/JP/BR/IE/CN
 * baselines were stranded in the legacy stateMetricBaselines collection or
 * missing entirely. processStatePolicyEffects only reads stateBaselines,
 * so all metrics for those states decayed toward the hardcoded fallback of 50.
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  // 1. Copy baselines from legacy stateMetricBaselines for any IDs not in stateBaselines
  const legacyDocs = await db.collection("stateMetricBaselines").find({}).toArray();
  const modernIds = new Set(
    (await db.collection("stateBaselines").find({}).project({ _id: 1 }).toArray()).map((d) => d._id)
  );

  let copied = 0;
  const copyOps = [];

  for (const doc of legacyDocs) {
    if (!modernIds.has(doc._id)) {
      copyOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { _id: doc._id, baselines: doc.baselines } },
          upsert: true,
        },
      });
    }
  }

  if (copyOps.length > 0) {
    if (dryRun) {
      console.log(`[DRY RUN] Would copy ${copyOps.length} baselines from legacy collection:`);
      console.log(copyOps.map((op) => op.updateOne.filter._id).join(", "));
    } else {
      await db.collection("stateBaselines").bulkWrite(copyOps);
      copied = copyOps.length;
      console.log(`Copied ${copied} baselines from stateMetricBaselines → stateBaselines`);
    }
  } else {
    console.log("No legacy baselines to copy (all already present in stateBaselines)");
  }

  // 2. Seed DE baselines from TypeScript source (authoritative) in case legacy is stale
  const { deStateBaselines } = await import("@/lib/seeds/de/deStateBaselines");
  let deSeeded = 0;
  for (const baseline of deStateBaselines) {
    if (dryRun) {
      console.log(`[DRY RUN] Would upsert DE baseline for ${baseline._id}`);
    } else {
      await db
        .collection<{ _id: string }>("stateBaselines")
        .updateOne({ _id: baseline._id }, { $set: baseline }, { upsert: true });
      deSeeded++;
    }
  }
  if (deSeeded > 0) console.log(`Seeded ${deSeeded} DE baselines from deStateBaselines.ts`);

  // 3. Verify counts
  const finalCount = await db.collection("stateBaselines").countDocuments();
  console.log(`\nFinal stateBaselines count: ${finalCount}`);

  const missingInModern = legacyDocs.filter((d) => !modernIds.has(d._id));
  if (missingInModern.length > 0) {
    console.log(`IDs now covered: ${missingInModern.map((d) => d._id).join(", ")}`);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
