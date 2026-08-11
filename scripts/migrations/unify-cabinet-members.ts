/**
 * Migration: Unify cabinet member storage.
 * - Copies ukCabinetMembers docs → cabinetMembers (with field renames)
 * - Adds ministerialActions + lastActionGrantedTurn to existing US cabinetMembers
 *
 * Safe to run multiple times — checks for existing docs before inserting.
 *
 * Usage: npx tsx scripts/migrations/unify-cabinet-members.ts
 */
import { connectDb, closeDb } from "../utils/db";

async function migrate() {
  const db = await connectDb();

  // 1. Migrate UK cabinet members → unified cabinetMembers collection
  const ukMembers = await db.collection("ukCabinetMembers").find({}).toArray();
  let ukMigrated = 0;

  for (const m of ukMembers) {
    // Skip if already migrated (check by countryId + positionId)
    const existing = await db
      .collection("cabinetMembers")
      .findOne({ countryId: "UK", positionId: m.positionId });
    if (existing) {
      console.log(`  Skipping UK ${m.positionId} — already exists`);
      continue;
    }

    const unified = {
      _id: m._id,
      countryId: "UK" as const,
      positionId: m.positionId,
      characterId: m.characterId,
      characterName: m.characterName,
      party: m.party,
      appointedByCharacterId: m.appointedByPmCharacterId,
      appointedAt: m.appointedAt,
      confirmedAt: m.appointedAt,
      ministerialActions: m.ministerialActions ?? 2,
      lastActionGrantedTurn: m.lastActionGrantedTurn ?? 0,
      bannerImageUrl: m.bannerImageUrl,
      createdAt: m.appointedAt ?? new Date(),
      updatedAt: new Date(),
    };

    await db.collection("cabinetMembers").insertOne(unified);
    ukMigrated++;
  }
  console.log(
    `Migrated ${ukMigrated} UK cabinet members (${ukMembers.length - ukMigrated} skipped)`
  );

  // 2. Upgrade existing US cabinet members (add action fields if missing)
  const usResult = await db.collection("cabinetMembers").updateMany(
    { countryId: "US", ministerialActions: { $exists: false } },
    {
      $set: {
        ministerialActions: 2,
        lastActionGrantedTurn: 0,
        updatedAt: new Date(),
      },
    }
  );
  console.log(`Upgraded ${usResult.modifiedCount} US cabinet members with action fields`);

  // 3. Create index for efficient lookups
  await db
    .collection("cabinetMembers")
    .createIndex({ countryId: 1, positionId: 1 }, { unique: true });
  console.log("Created unique index on cabinetMembers(countryId, positionId)");

  await closeDb();
  console.log("Migration complete.");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
