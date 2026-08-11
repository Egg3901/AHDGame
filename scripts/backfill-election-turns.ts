/**
 * Backfill startTurn / primaryEndTurn / endTurn for in-flight elections
 * (status "active" or "upcoming") in the `elections` collection.
 *
 *   npx tsx scripts/backfill-election-turns.ts            # dry-run (report only)
 *   npx tsx scripts/backfill-election-turns.ts --apply    # write
 *
 * After the turn-based-deadline migration the server resolves election phase
 * transitions from these turn fields (Date fields kept for display + as a
 * fallback for un-backfilled rows). New elections set all three at creation;
 * this script stamps rows that pre-date the migration so they too resolve on
 * turns rather than the drift-prone wall clock.
 *
 * Idempotent: for each active/upcoming election it sets only the turn fields
 * that are still missing, and only when the matching Date exists. Re-running
 * after a partial apply touches nothing already stamped.
 *
 *   turn = currentTurn + round((Date - effectiveNow) / MS_PER_TURN)
 *
 * effectiveNow = pausedAt ?? lastTurnProcessed — the game clock the Date was
 * anchored to (1 turn = 1 game-hour). Targets MONGODB_URI_LIVE (production).
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MS_PER_TURN = 60 * 60 * 1000;

interface ElectionRow {
  _id: unknown;
  status: string;
  startTime?: Date;
  primaryEndTime?: Date;
  endTime?: Date;
  startTurn?: number;
  primaryEndTurn?: number;
  endTurn?: number;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const uri = process.env.MONGODB_URI_LIVE;
  if (!uri) throw new Error("MONGODB_URI_LIVE not set in .env.local");

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db();
    const gs = await db
      .collection<{
        _id: string;
        currentTurn: number;
        lastTurnProcessed: Date;
        pausedAt: Date | null;
      }>("gameState")
      .findOne({ _id: "current" });
    if (!gs) throw new Error("gameState/current not found");
    const currentTurn = gs.currentTurn;
    const effectiveNow = gs.pausedAt ? new Date(gs.pausedAt) : new Date(gs.lastTurnProcessed);
    console.log(
      `currentTurn=${currentTurn} effectiveNow=${effectiveNow.toISOString()} (${gs.pausedAt ? "paused" : "active"})`
    );

    const dateToTurn = (d: Date): number =>
      currentTurn + Math.round((new Date(d).getTime() - effectiveNow.getTime()) / MS_PER_TURN);

    // Any in-flight election missing at least one turn field whose Date exists.
    const docs = await db
      .collection<ElectionRow>("elections")
      .find({
        status: { $in: ["active", "upcoming"] },
        $or: [
          { startTurn: { $exists: false }, startTime: { $exists: true } },
          { primaryEndTurn: { $exists: false }, primaryEndTime: { $exists: true } },
          { endTurn: { $exists: false }, endTime: { $exists: true } },
        ],
      })
      .toArray();

    let total = 0;
    for (const d of docs) {
      const set: Record<string, number> = {};
      if (typeof d.startTurn !== "number" && d.startTime) set.startTurn = dateToTurn(d.startTime);
      if (typeof d.primaryEndTurn !== "number" && d.primaryEndTime)
        set.primaryEndTurn = dateToTurn(d.primaryEndTime);
      if (typeof d.endTurn !== "number" && d.endTime) set.endTurn = dateToTurn(d.endTime);
      if (Object.keys(set).length === 0) continue;

      const parts = Object.entries(set)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`elections ${String(d._id)} [${d.status}]: ${parts}`);
      total++;
      if (apply) {
        await db.collection("elections").updateOne({ _id: d._id as never }, { $set: set });
      }
    }

    console.log(
      `\n${apply ? "APPLIED" : "DRY-RUN"}: ${total} election(s)${apply ? " updated" : " would be updated"}.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
