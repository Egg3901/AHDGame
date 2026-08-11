import { connectDb, closeDb } from "../utils/db";

async function runMigration() {
  console.log("Starting countryId migration...");
  const db = await connectDb();

  try {
    // Backfill countryId for all collections
    await backfillCountryId(db);

    // Add indexes
    await addCountryIndexes(db);

    console.log("✅ Migration complete!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await closeDb();
  }
}

async function backfillCountryId(db: any) {
  console.log("Backfilling countryId fields...");

  const collections = [
    "states",
    "elections",
    "electionCandidates",
    "npps",
    "characters",
    "statePartyOrg",
    "stateDemographics",
    "stateDemographicTurnout",
    "electedOfficials",
    "governmentApproval",
    "stateMetrics",
    "stateBaselines",
    "politicalParties",
  ];

  for (const collectionName of collections) {
    // Backfill US for documents without countryId
    const usResult = await db
      .collection(collectionName)
      .updateMany(
        { countryId: { $exists: false }, _id: { $not: /^UK_/ } },
        { $set: { countryId: "US" } }
      );

    // Backfill UK for documents with UK_ prefix
    const ukResult = await db
      .collection(collectionName)
      .updateMany({ countryId: { $exists: false }, _id: /^UK_/ }, { $set: { countryId: "UK" } });

    if (usResult.modifiedCount > 0 || ukResult.modifiedCount > 0) {
      console.log(
        `  ${collectionName}: US=${usResult.modifiedCount}, UK=${ukResult.modifiedCount}`
      );
    }
  }
}

async function addCountryIndexes(db: any) {
  console.log("Adding database indexes...");

  const indexes = [
    { collection: "states", index: { countryId: 1 } },
    { collection: "elections", index: { countryId: 1, status: 1 } },
    { collection: "electionCandidates", index: { countryId: 1 } },
    { collection: "npps", index: { countryId: 1, party: 1 } },
    { collection: "characters", index: { countryId: 1 } },
    { collection: "statePartyOrg", index: { countryId: 1 } },
    { collection: "stateDemographics", index: { countryId: 1 } },
    { collection: "stateDemographicTurnout", index: { countryId: 1 } },
    { collection: "electedOfficials", index: { countryId: 1, officeType: 1 } },
    { collection: "governmentApproval", index: { countryId: 1 } },
    { collection: "stateMetrics", index: { countryId: 1 } },
    { collection: "politicalParties", index: { countryId: 1 } },
  ];

  for (const { collection, index } of indexes) {
    try {
      await db.collection(collection).createIndex(index);
      console.log(`  ✓ ${collection}`);
    } catch {
      // Index might already exist, that's ok
      console.log(`  ⚠ ${collection} (may already exist)`);
    }
  }
}

runMigration();
