/**
 * One-time migration: clear lastShareStructureTurn from corporations that had it
 * set in a previous game iteration.
 *
 * When the game is reset, currentTurn reverts to 1 but corporations keep their
 * lastShareStructureTurn values from the old run. This causes those corps to
 * appear on a 48-turn cooldown in the new game even though they never split.
 *
 * This migration clears lastShareStructureTurn from all corporations except those
 * where the value is >= the threshold turn (indicating a genuine split in the
 * current game run, not a stale pre-reset value).
 *
 * Usage: npx tsx scripts/migrations/clear-stale-share-structure-cooldowns.ts
 */

import { MongoClient } from "mongodb";
import * as fs from "fs";

// Corps that split on turn >= this value are assumed to be from the current game.
// Set to 2 so that turn-1 values (which are the stale pre-reset ones) get cleared.
const CURRENT_GAME_MIN_TURN = 2;

async function main() {
  const envFile = fs.readFileSync(".env.local", "utf-8");
  const uriMatch = envFile.match(/MONGODB_URI=(.+)/);
  if (!uriMatch) throw new Error("MONGODB_URI not found in .env.local");
  const uri = uriMatch[1].trim();

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");

  const affected = await db
    .collection("corporations")
    .find({ lastShareStructureTurn: { $exists: true, $lt: CURRENT_GAME_MIN_TURN } })
    .toArray();

  console.log(`Found ${affected.length} corporation(s) with stale lastShareStructureTurn:`);
  affected.forEach((c) =>
    console.log(`  ${c.name ?? c._id} — lastShareStructureTurn: ${c.lastShareStructureTurn}`)
  );

  if (affected.length === 0) {
    console.log("Nothing to fix.");
    await client.close();
    return;
  }

  const result = await db
    .collection("corporations")
    .updateMany(
      { lastShareStructureTurn: { $exists: true, $lt: CURRENT_GAME_MIN_TURN } },
      { $unset: { lastShareStructureTurn: "" } }
    );

  console.log(`Cleared lastShareStructureTurn from ${result.modifiedCount} corporation(s).`);
  await client.close();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
