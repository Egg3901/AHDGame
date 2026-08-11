import { connectDb, closeDb } from "../utils/db";

/**
 * Adds a compound index on electionCandidates { characterId, status } to eliminate
 * the full collection scan in findBlockingActiveCandidacy.
 *
 * Without this index, every call to /api/character/me scans all 6,000+ candidate
 * documents to find active candidacies for a given character.
 */
async function addIndex() {
  const db = await connectDb();

  await db
    .collection("electionCandidates")
    .createIndex({ characterId: 1, status: 1 })
    .catch(() => {});

  console.log("✅ electionCandidates { characterId, status } index created");
}

addIndex()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Error creating index:", error);
    await closeDb();
    process.exit(1);
  });
