/**
 * cleanup-stale-candidacies.ts
 *
 * Withdraws orphaned `status: "active"` electionCandidates rows whose parent
 * election has already wound up (cancelled / completed / resolved / closed).
 *
 * Symptom on prod: after a snap election dissolves the regular cycle, the
 * regular-election candidate rows are left active. The slate flow then 409s
 * with "already filed in another race" when the chair tries to slate the
 * same player into the snap race. Bug #0550.
 *
 * Usage: npx tsx scripts/cleanup-stale-candidacies.ts [--dry-run]
 */

import { connectDb, closeDb } from "./utils/db";
import { ObjectId } from "mongodb";

const TERMINAL_STATUSES = ["cancelled", "completed", "resolved", "closed"] as const;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("=== DRY RUN MODE ===\n");

  const db = await connectDb();
  const now = new Date();

  const terminalElections = await db
    .collection<{ _id: ObjectId; status: string; countryId?: string }>("elections")
    .find(
      { status: { $in: TERMINAL_STATUSES as unknown as string[] } },
      { projection: { _id: 1, countryId: 1, status: 1 } }
    )
    .toArray();
  const terminalIds = terminalElections.map((e) => e._id);
  console.log(`Found ${terminalIds.length} terminal elections.`);

  const orphanRows = await db
    .collection("electionCandidates")
    .find(
      { electionId: { $in: terminalIds }, status: "active" },
      { projection: { _id: 1, electionId: 1, characterName: 1 } }
    )
    .toArray();

  // Group by election status / country for visibility.
  const byParent = new Map<string, number>();
  const statusByElection = new Map<string, { country?: string; status: string }>();
  for (const e of terminalElections) {
    statusByElection.set(e._id.toHexString(), { country: e.countryId, status: e.status });
  }
  for (const r of orphanRows) {
    const meta = statusByElection.get(r.electionId.toHexString());
    const key = `${meta?.country ?? "??"}:${meta?.status ?? "??"}`;
    byParent.set(key, (byParent.get(key) ?? 0) + 1);
  }
  console.log("Orphan active rows by (country, parent-status):");
  for (const [k, n] of [...byParent.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }
  console.log(`Total orphan rows: ${orphanRows.length}`);

  if (!dryRun && orphanRows.length > 0) {
    const res = await db
      .collection("electionCandidates")
      .updateMany(
        { _id: { $in: orphanRows.map((r) => r._id) } },
        { $set: { status: "withdrawn", withdrawnAt: now } }
      );
    console.log(`\nWithdrew ${res.modifiedCount} rows.`);
  } else if (dryRun) {
    console.log("\nRe-run without --dry-run to apply.");
  }

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
