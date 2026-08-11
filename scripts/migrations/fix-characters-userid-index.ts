/**
 * Migration: Fix characters.userId unique index
 *
 * The characters collection had a { userId: 1 } unique index that prevented
 * multi-character creation in test mode and admin bypass scenarios. This
 * migration drops the unique index and recreates it as a non-unique index
 * for lookup efficiency.
 *
 * Run: npx tsx scripts/migrations/fix-characters-userid-index.ts
 */

import { connectDb, closeDb } from "../utils/db";

async function main() {
  const db = await connectDb();
  const col = db.collection("characters");

  // Check if the unique index exists
  const indexes = await col.indexes();
  const uniqueUserIdIndex = indexes.find((idx) => idx.key?.userId === 1 && idx.unique === true);

  if (!uniqueUserIdIndex) {
    console.log("No unique userId index found — nothing to do.");
    await closeDb();
    return;
  }

  console.log(`Dropping unique index: ${uniqueUserIdIndex.name}`);
  await col.dropIndex(uniqueUserIdIndex.name as string);

  console.log("Recreating as non-unique index...");
  await col.createIndex({ userId: 1 });

  console.log("Done. characters.userId index is now non-unique.");
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
