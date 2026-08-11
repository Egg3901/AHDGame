import { connectDb, closeDb } from "../../utils/db";

async function runMigration() {
  console.log("Starting UK bills index migration...");
  const db = await connectDb();

  try {
    await addUKBillsIndex(db);
    console.log("✅ Migration complete!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await closeDb();
  }
}

async function addUKBillsIndex(db: any) {
  console.log("Creating index on bills.currentChamber + proposedAt...");

  try {
    await db
      .collection("bills")
      .createIndex(
        { currentChamber: 1, proposedAt: -1 },
        { name: "bills_currentChamber_proposedAt" }
      );
    console.log("  ✓ bills_currentChamber_proposedAt");
  } catch {
    // Index might already exist, that's ok
    console.log("  ⚠ bills_currentChamber_proposedAt (may already exist)");
  }
}

runMigration();
