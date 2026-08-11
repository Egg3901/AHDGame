/**
 * Migration: Add targetGrowthRate and currentGrowthRate fields to existing sectors
 *
 * This migration supports the target-based growth system that prevents stock price
 * manipulation. The player-set growthRate is now a target that the currentGrowthRate
 * ticks toward at ~0.5%/turn.
 *
 * Run with: npx tsx scripts/migrations/add-growth-rate-fields.ts
 */

import { MongoClient, type Db } from "mongodb";
import * as dotenv from "dotenv";
dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017";
const DB_NAME = "a-house-divided";

async function migrate(db: Db): Promise<void> {
  const sectorsCollection = db.collection<Record<string, unknown>>("corporateSectors");

  // Find sectors that don't have the new fields
  const sectorsToUpdate = await sectorsCollection
    .find({
      $or: [{ targetGrowthRate: { $exists: false } }, { currentGrowthRate: { $exists: false } }],
    })
    .toArray();

  if (sectorsToUpdate.length === 0) {
    console.log("All sectors already have targetGrowthRate and currentGrowthRate fields.");
    return;
  }

  console.log(`Found ${sectorsToUpdate.length} sectors to update...`);

  // Update each sector: copy growthRate to both targetGrowthRate and currentGrowthRate
  const bulkOps = sectorsToUpdate.map((sector) => ({
    updateOne: {
      filter: { _id: sector._id },
      update: {
        $set: {
          targetGrowthRate: typeof sector.growthRate === "number" ? sector.growthRate : 0,
          currentGrowthRate: typeof sector.growthRate === "number" ? sector.growthRate : 0,
          updatedAt: new Date(),
        },
      },
    },
  }));

  const result = await sectorsCollection.bulkWrite(bulkOps);
  console.log(
    `Updated ${result.modifiedCount} sectors with targetGrowthRate and currentGrowthRate.`
  );
  console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
}

async function main(): Promise<void> {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    console.log("Connected to MongoDB");

    const db = client.db(DB_NAME);
    await migrate(db);

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
