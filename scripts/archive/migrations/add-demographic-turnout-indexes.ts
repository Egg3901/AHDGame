import { connectDb, closeDb } from "../utils/db";

async function addIndexes() {
  const db = await connectDb();

  // StateDemographicTurnout indexes
  await db
    .collection("stateDemographicTurnout")
    .createIndex({ lastUpdated: 1 })
    .catch(() => {});

  // PartyBudget indexes
  await db
    .collection("partyBudget")
    .createIndex({ partyId: 1, scope: 1 })
    .catch(() => {});
  await db
    .collection("partyBudget")
    .createIndex({ stateId: 1 })
    .catch(() => {});
  await db
    .collection("partyBudget")
    .createIndex({ chairCharacterId: 1 })
    .catch(() => {});

  console.log("✅ Indexes created successfully");
}

addIndexes()
  .then(async () => {
    await closeDb();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Error creating indexes:", error);
    await closeDb();
    process.exit(1);
  });
