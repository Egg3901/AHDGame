/**
 * Migration: Add isAppointment field to ElectedOfficial documents
 *
 * Run: npx tsx scripts/migrations/add-appointment-fields.ts
 */

import { connectDb, closeDb } from "../utils/db";

async function migrate() {
  const db = await connectDb();

  console.log("Updating ElectedOfficial documents with isAppointment field...");

  const result = await db.collection("electedOfficials").updateMany(
    { isAppointment: { $exists: false } },
    {
      $set: { isAppointment: false },
    }
  );

  console.log(`✅ Updated ${result.modifiedCount} documents`);

  await closeDb();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
