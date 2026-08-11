/**
 * Backfill closesOnTurn for in-flight PM-appointment and no-confidence votes.
 *
 *   npx tsx scripts/backfill-parliamentary-vote-turns.ts            # dry-run (report only)
 *   npx tsx scripts/backfill-parliamentary-vote-turns.ts --apply    # write
 *
 * Idempotent: only touches active votes that lack closesOnTurn. Targets
 * MONGODB_URI_LIVE (production). closesOnTurn = currentTurn +
 * round((closesAt - effectiveNow) / MS_PER_TURN), where effectiveNow =
 * pausedAt ?? lastTurnProcessed (the game clock the closesAt was anchored to).
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MS_PER_TURN = 60 * 60 * 1000;

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

    let totalPlanned = 0;
    for (const coll of ["pmAppointmentVotes", "noConfidenceVotes"]) {
      const docs = await db
        .collection<{ _id: unknown; closesAt: Date; status: string }>(coll)
        .find({ status: "active", closesOnTurn: { $exists: false }, closesAt: { $exists: true } })
        .toArray();
      for (const d of docs) {
        const turnsAhead = Math.round(
          (new Date(d.closesAt).getTime() - effectiveNow.getTime()) / MS_PER_TURN
        );
        const closesOnTurn = currentTurn + turnsAhead;
        console.log(
          `${coll} ${String(d._id)}: closesAt=${new Date(d.closesAt).toISOString()} -> closesOnTurn=${closesOnTurn} (currentTurn + ${turnsAhead})`
        );
        totalPlanned++;
        if (apply) {
          await db.collection(coll).updateOne({ _id: d._id as never }, { $set: { closesOnTurn } });
        }
      }
    }
    console.log(
      `\n${apply ? "APPLIED" : "DRY-RUN"}: ${totalPlanned} vote(s)${apply ? " updated" : " would be updated"}.`
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
