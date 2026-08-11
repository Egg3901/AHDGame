/**
 * Migration: Add NPP economy fields
 * Adds funds, donorBaseLevel, actionPoints, lastActionProcessedTurn to all NPPs
 * Adds nppEconomyEnabled to gameConfig (defaults to false)
 */

import { connectDb, closeDb } from "../utils/db";
import type { GameConfig } from "../../src/lib/db/types/gameConfig";

async function migrate() {
  console.log("Starting NPP economy fields migration...");
  const db = await connectDb();

  // Add fields to all NPP documents
  const nppResult = await db.collection("npps").updateMany(
    {},
    {
      $set: {
        funds: 0,
        donorBaseLevel: 0,
        actionPoints: 0,
        lastActionProcessedTurn: 0,
      },
    }
  );
  console.log(`Updated ${nppResult.modifiedCount} NPP documents`);

  // Add nppEconomyEnabled to gameConfig (default false)
  const configResult = await db
    .collection<GameConfig>("gameConfig")
    .updateOne({ _id: "default" }, { $set: { nppEconomyEnabled: false } }, { upsert: true });
  console.log(`GameConfig updated: ${configResult.modifiedCount || configResult.upsertedCount}`);

  await closeDb();
  console.log("Migration complete!");
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
