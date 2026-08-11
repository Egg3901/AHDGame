/**
 * Reset all corporate bond and stock issuance cooldown timers.
 *
 * Bond cooldown: Sets issuedAtTurn to -1000 (ensures cooldown expired regardless of current turn)
 * Stock cooldown: Clears lastShareIssuance on all corporations (24h cooldown reset)
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function resetIssuanceCooldowns(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI not found in .env.local");
  }

  const client = new MongoClient(process.env.MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db("a-house-divided");

    // Get current turn for reporting
    const gameState = await db
      .collection<{ _id: string; currentTurn?: number }>("gameState")
      .findOne({ _id: "current" });
    const currentTurn = gameState?.currentTurn ?? 1;
    console.log(`Current game turn: ${currentTurn}`);

    // Reset bond issuance cooldowns (set issuedAtTurn to -1000 to ensure cooldown is expired)
    const bondResult = await db
      .collection("bonds")
      .updateMany(
        { corporationId: { $exists: true }, issuedAtTurn: { $exists: true } },
        { $set: { issuedAtTurn: -1000 } }
      );
    console.log(`Bond cooldowns reset: ${bondResult.modifiedCount} bonds updated`);

    // Reset stock/share issuance cooldowns (clear lastShareIssuance on all corporations)
    const corpResult = await db
      .collection("corporations")
      .updateMany({ lastShareIssuance: { $exists: true } }, { $set: { lastShareIssuance: null } });
    console.log(
      `Corporation stock cooldowns reset: ${corpResult.modifiedCount} corporations updated`
    );

    console.log("\nDone! All corporate bond and stock issuance cooldowns have been reset.");
  } catch (error) {
    console.error("Error resetting cooldowns:", error);
    throw error;
  } finally {
    await client.close();
    console.log("Database connection closed");
  }
}

resetIssuanceCooldowns()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
