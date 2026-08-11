/**
 * Migration: record every belligerent on a battle report.
 *
 * Before coalitions a battle was strictly bilateral, so a report named one attacker
 * and one defender. It now carries `attackers` / `defenders` arrays, with the two
 * scalars retained as the principal on each side. Historical reports predate the
 * arrays; this backfills them from the scalars, which is exactly what they meant.
 *
 * Readers must still tolerate the arrays being absent — a report written between
 * deploy and this migration has none, and the UI falls back to the scalars.
 *
 * Idempotent: only documents missing `attackers` are touched, so a re-run reports
 * zero updated and cannot overwrite a real coalition roster with a single name.
 *
 * Usage: npx tsx scripts/migrations/2026-08-04-battle-report-participants.ts [--dry-run]
 */
import type { Db } from "mongodb";
import { connectDb, closeDb } from "../utils/db";

export interface ReportParticipantsResult {
  updated: number;
  alreadyDone: number;
}

export async function backfillReportParticipants(
  db: Db,
  dryRun = false
): Promise<ReportParticipantsResult> {
  const col = db.collection("battleReports");
  const alreadyDone = await col.countDocuments({ attackers: { $exists: true } });
  const stale = await col.find({ attackers: { $exists: false } }).toArray();

  if (dryRun || stale.length === 0) {
    return { updated: stale.length, alreadyDone };
  }

  const ops = stale.map((doc) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: {
        $set: {
          attackers: [doc.declarerCountry],
          defenders: [doc.targetCountry],
        },
      },
    },
  }));
  await col.bulkWrite(ops);
  return { updated: stale.length, alreadyDone };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connectDb();
  const r = await backfillReportParticipants(db, dryRun);
  console.log(`${dryRun ? "[DRY RUN] " : ""}updated=${r.updated}, alreadyDone=${r.alreadyDone}`);
  await closeDb();
}

if (process.argv[1] && process.argv[1].includes("2026-08-04-battle-report-participants")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
