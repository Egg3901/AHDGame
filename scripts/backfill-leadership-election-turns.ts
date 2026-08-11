/**
 * Backfill endsOnTurn for in-flight leadership elections (status "voting").
 *
 *   npx tsx scripts/backfill-leadership-election-turns.ts            # dry-run (report only)
 *   npx tsx scripts/backfill-leadership-election-turns.ts --apply    # write
 *
 * Idempotent: only touches voting elections that lack endsOnTurn. Targets
 * MONGODB_URI_LIVE (production). endsOnTurn = currentTurn +
 * round((endsAt - effectiveNow) / MS_PER_TURN), effectiveNow =
 * pausedAt ?? lastTurnProcessed (the game clock the endsAt was anchored to).
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const MS_PER_TURN = 60 * 60 * 1000;
const COLLECTIONS = [
  "houseLeadershipElections",
  "senateLeadershipElections",
  "speakerElections",
  "bundestagspraesidentElections",
];

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

    let total = 0;
    for (const coll of COLLECTIONS) {
      const docs = await db
        .collection<{ _id: unknown; endsAt: Date; status: string }>(coll)
        .find({ status: "voting", endsOnTurn: { $exists: false }, endsAt: { $exists: true } })
        .toArray();
      for (const d of docs) {
        const turnsAhead = Math.round(
          (new Date(d.endsAt).getTime() - effectiveNow.getTime()) / MS_PER_TURN
        );
        const endsOnTurn = currentTurn + turnsAhead;
        console.log(
          `${coll} ${String(d._id)}: endsAt=${new Date(d.endsAt).toISOString()} -> endsOnTurn=${endsOnTurn} (currentTurn + ${turnsAhead})`
        );
        total++;
        if (apply) {
          await db.collection(coll).updateOne({ _id: d._id as never }, { $set: { endsOnTurn } });
        }
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
