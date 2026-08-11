/**
 * Backfill `createdTurn` on player banner ads that pre-date the turn-based
 * submission-cooldown migration.
 *
 * The cooldown moved from a wall-clock window (createdAt + windowMs) to a
 * turn window (createdTurn + windowTurns). Existing ads have no createdTurn,
 * so the rate-limit query (`createdTurn >= currentTurn - windowTurns`) would
 * silently exclude them. This backfills an approximate turn for each.
 *
 * For each ad missing createdTurn, compute the equivalent turn from the
 * game-clock anchor (same formula as the deadline-turn backfill):
 *   createdTurn = max(0, currentTurn + round((createdAt - lastTurnProcessed) / MS_PER_TURN))
 * Since createdAt is in the past, this yields a turn <= currentTurn.
 * Precision is not critical: the rate windows are 24-72 turns, so backfilled
 * ads age out of the window quickly.
 *
 * Usage
 * -----
 *   npx tsx scripts/migrations/2026-06-04-backfill-banner-ad-turns.ts          # dry-run
 *   npx tsx scripts/migrations/2026-06-04-backfill-banner-ad-turns.ts --apply  # commit
 */
import { MongoClient, type ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) throw new Error("MONGODB_URI_LIVE must be set in .env.local");
const APPLY = process.argv.includes("--apply");

const MS_PER_TURN = 60 * 60 * 1000; // 1 turn = 1 hour real time

function turnFor(createdAt: Date, currentTurn: number, lastTurnProcessed: Date): number {
  const deltaMs = createdAt.getTime() - lastTurnProcessed.getTime();
  return Math.max(0, currentTurn + Math.round(deltaMs / MS_PER_TURN));
}

async function main() {
  const client = new MongoClient(uri!);
  await client.connect();
  console.log(APPLY ? "=== APPLY MODE ===" : "=== DRY RUN ===");
  try {
    const db = client.db("a-house-divided");
    const gs = (await db
      .collection("gameState")
      .findOne({ _id: "current" as unknown as never })) as {
      currentTurn?: number;
      lastTurnProcessed?: Date;
    } | null;
    if (!gs?.currentTurn || !gs.lastTurnProcessed) {
      throw new Error("gameState.currentTurn or lastTurnProcessed missing");
    }
    const currentTurn = gs.currentTurn as number;
    const ltp = new Date(gs.lastTurnProcessed as Date);
    console.log(`Reference: currentTurn=${currentTurn} lastTurnProcessed=${ltp.toISOString()}`);

    const ops: Array<{
      updateOne: { filter: { _id: ObjectId }; update: { $set: { createdTurn: number } } };
    }> = [];
    const ads = await db
      .collection("playerBannerAds")
      .find({ createdTurn: { $exists: false } })
      .project({ _id: 1, createdAt: 1 })
      .toArray();
    for (const ad of ads) {
      // Fall back to the game-clock anchor when createdAt is somehow missing,
      // so the ad still gets a usable (current) turn rather than being skipped.
      const createdAt = ad.createdAt ? new Date(ad.createdAt) : ltp;
      const createdTurn = turnFor(createdAt, currentTurn, ltp);
      ops.push({ updateOne: { filter: { _id: ad._id }, update: { $set: { createdTurn } } } });
    }
    console.log(`playerBannerAds: ${ops.length} docs to backfill`);

    if (!APPLY) {
      console.log("\n[DRY RUN] no writes performed.");
      return;
    }
    if (ops.length > 0) {
      const r = await db.collection("playerBannerAds").bulkWrite(ops);
      console.log(
        `playerBannerAds bulkWrite: matched=${r.matchedCount} modified=${r.modifiedCount}`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
