/**
 * Migration: Create UK Cabinet collections with indexes
 *
 * Run: npx tsx scripts/migrations/add-uk-cabinet-collections.ts
 */

import { connectDb, closeDb } from "../utils/db";

async function migrate() {
  const db = await connectDb();

  console.log("Creating UK Cabinet collections and indexes...");

  // Create ukCabinetCooldowns collection with TTL index
  const cooldownsCollection = db.collection("ukCabinetCooldowns");

  // TTL index for automatic cleanup of expired cooldowns
  await cooldownsCollection.createIndex({ cooldownUntil: 1 }, { expireAfterSeconds: 0 });
  console.log("✅ Created TTL index on ukCabinetCooldowns.cooldownUntil");

  // Unique compound index on countryId + positionId
  await cooldownsCollection.createIndex({ countryId: 1, positionId: 1 }, { unique: true });
  console.log("✅ Created unique index on ukCabinetCooldowns [countryId, positionId]");

  // Create ukCabinetMembers collection
  const membersCollection = db.collection("ukCabinetMembers");

  // Unique index on positionId (one member per position)
  await membersCollection.createIndex({ countryId: 1, positionId: 1 }, { unique: true });
  console.log("✅ Created unique index on ukCabinetMembers [countryId, positionId]");

  // Index on characterId to prevent duplicate appointments
  await membersCollection.createIndex({ countryId: 1, characterId: 1 }, { unique: true });
  console.log("✅ Created unique index on ukCabinetMembers [countryId, characterId]");

  console.log("✅ Migration complete");

  await closeDb();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
