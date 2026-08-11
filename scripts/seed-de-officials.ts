/**
 * Seed DE elected officials — Bundestag members + Ministerpräsidenten.
 *
 * Replaces the party-proportional backbench pool created by seed-de-npps.ts
 * with seated NPPs tied to historical 2021 Bundestag composition and Feb 2020
 * Land heads of government. Run AFTER seed-de.ts.
 *
 * Steps:
 *   1. Delete any existing DE electedOfficials (idempotent reset)
 *   2. Delete DE backbench NPPs (currentOffice: null, retiredAt: null)
 *   3. Run the country-scoped historical seed (Bundestag + Ministerpräsidenten)
 *
 * Note: The Federal President (Bundespräsident) is no longer seeded as an NPP.
 * It is created at runtime via the admin imperial-character flow
 * (config.hasImperialRole = true).
 *
 * Usage:
 *   npx tsx scripts/seed-de-officials.ts
 */
import { connectDb, closeDb } from "./utils/db";
import { seedHistoricalOfficialsForCountry } from "../src/lib/npp/seedHistorical";

async function main() {
  console.log("=== DE Officials Seed Script ===\n");
  const db = await connectDb();

  console.log("1. Deleting existing DE electedOfficials...");
  const delOfficials = await db.collection("electedOfficials").deleteMany({ countryId: "DE" });
  console.log(`   ✓ Deleted ${delOfficials.deletedCount} DE elected officials.`);

  console.log("2. Deleting DE backbench NPPs (unseated)...");
  const delNpps = await db.collection("npps").deleteMany({
    countryId: "DE",
    currentOffice: null,
    retiredAt: null,
  });
  console.log(`   ✓ Deleted ${delNpps.deletedCount} DE backbench NPPs.`);

  console.log("3. Seeding DE Bundestag + Ministerpräsidenten from 2019-default preset...");
  const result = await seedHistoricalOfficialsForCountry(db, "DE", "2019-default");
  console.log(
    `   ✓ Created ${result.nppsCreated} NPPs and ${result.officialsCreated} elected officials.`
  );

  console.log("\n=== DE Officials Seed Complete ===");
}

main()
  .catch((err) => {
    console.error("DE officials seed failed:", err);
    process.exit(1);
  })
  .finally(closeDb);
