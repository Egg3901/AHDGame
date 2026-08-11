/**
 * fix-npp-candidacies.ts
 *
 * Cleans up NPP election candidate data issues:
 * 1. Fixes "time-travel" withdrawnAt timestamps (withdrawnAt < enteredAt)
 * 2. Withdraws overlapping candidacies (NPP active in multiple elections),
 *    keeping only the most recently entered one
 *
 * Usage: npx tsx scripts/fix-npp-candidacies.ts [--dry-run]
 */

import { connectDb, closeDb } from "./utils/db";
import { ObjectId } from "mongodb";

interface Candidate {
  _id: ObjectId;
  electionId: ObjectId;
  characterName: string;
  nppId?: ObjectId;
  isNPP?: boolean;
  status: string;
  enteredAt: Date;
  withdrawnAt?: Date;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("=== DRY RUN MODE ===\n");

  const db = await connectDb();
  const coll = db.collection<Candidate>("electionCandidates");

  // ── Fix 1: Time-travel withdrawnAt ──────────────────────────────────────────
  // Find candidates where withdrawnAt < enteredAt and fix them
  console.log("=== Fix 1: Time-travel withdrawnAt ===");

  const timeTravelCandidates = await coll
    .find({
      isNPP: true,
      status: "withdrawn",
      withdrawnAt: { $exists: true },
    })
    .toArray();

  let timeTravelFixed = 0;
  for (const c of timeTravelCandidates) {
    if (c.withdrawnAt && c.withdrawnAt < c.enteredAt) {
      timeTravelFixed++;
      if (!dryRun) {
        // Set withdrawnAt to enteredAt (the earliest valid withdrawal time)
        await coll.updateOne({ _id: c._id }, { $set: { withdrawnAt: c.enteredAt } });
      }
    }
  }
  console.log(`  Time-travel records ${dryRun ? "found" : "fixed"}: ${timeTravelFixed}`);

  // ── Fix 2: Overlapping active candidacies ───────────────────────────────────
  // Find NPPs with multiple active candidacies, keep only the most recent
  console.log("\n=== Fix 2: Overlapping active candidacies ===");

  const activeCandidates = await coll
    .find({ isNPP: true, status: "active" })
    .sort({ enteredAt: -1 })
    .toArray();

  // Group by nppId
  const byNpp = new Map<string, Candidate[]>();
  for (const c of activeCandidates) {
    if (!c.nppId) continue;
    const key = c.nppId.toString();
    if (!byNpp.has(key)) byNpp.set(key, []);
    byNpp.get(key)!.push(c);
  }

  const now = new Date();
  let overlapsFixed = 0;
  for (const [, cands] of byNpp) {
    if (cands.length <= 1) continue;

    // Already sorted by enteredAt desc — keep first (most recent), withdraw rest
    const toWithdraw = cands.slice(1);
    for (const c of toWithdraw) {
      overlapsFixed++;
      if (!dryRun) {
        await coll.updateOne({ _id: c._id }, { $set: { status: "withdrawn", withdrawnAt: now } });
      } else {
        console.log(`  Would withdraw: ${c.characterName} from election ${c.electionId}`);
      }
    }
  }
  console.log(`  Overlapping candidacies ${dryRun ? "found" : "fixed"}: ${overlapsFixed}`);

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n=== Summary ===");
  console.log(`  Time-travel fixes: ${timeTravelFixed}`);
  console.log(`  Overlap fixes: ${overlapsFixed}`);
  if (dryRun) console.log("\n  Re-run without --dry-run to apply changes.");

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
