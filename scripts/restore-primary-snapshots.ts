/**
 * Restore primary snapshots by running the existing recordPrimarySnapshots
 * function against the current game state.
 *
 * Usage: npx tsx scripts/restore-primary-snapshots.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { connectDb, closeDb } from "./utils/db";
import { recordPrimarySnapshots } from "@/lib/turn/primaryResolution";

async function main() {
  const db = await connectDb();

  const gameState = await db.collection("gameState").findOne({ _id: "current" } as any);
  if (!gameState) {
    console.error("No gameState found");
    process.exit(1);
  }
  const currentTurn = gameState.currentTurn as number;
  console.log(`Game at turn ${currentTurn}. Regenerating primary snapshots...`);

  const beforeCount = await db.collection("primarySnapshots").countDocuments({});
  console.log(`primarySnapshots before: ${beforeCount}`);

  const count = await recordPrimarySnapshots(new Date(), currentTurn);

  const afterCount = await db.collection("primarySnapshots").countDocuments({});
  console.log(`recordPrimarySnapshots returned: ${count}`);
  console.log(`primarySnapshots after: ${afterCount}`);

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
