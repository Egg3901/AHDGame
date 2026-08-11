/**
 * Migration: Patch missing targetGrowthRate fields in corporateSector documents.
 *
 * Background:
 * - Legacy sector documents may not have targetGrowthRate (added in a migration)
 * - The API route returned sector.targetGrowthRate directly without a fallback
 * - When users tried to change growth rate: undefined + 0.5 = NaN, failing Zod validation
 *
 * This script:
 * - Finds all corporateSector documents missing targetGrowthRate
 * - Sets targetGrowthRate to 0 (neutral default)
 * - Sets currentGrowthRate to 0 (or existing growthRate if present)
 *
 * Run with: npx tsx scripts/migrations/migrate-sector-growth-rates.ts
 */
import { connectDb, closeDb } from "../utils/db";

async function main() {
  const db = await connectDb();

  const sectorCol = db.collection("corporateSectors");

  // Find all sectors missing targetGrowthRate
  const docs = await sectorCol
    .find({
      targetGrowthRate: { $exists: false },
    })
    .toArray();

  console.log(`Found ${docs.length} corporateSector docs missing targetGrowthRate`);

  if (docs.length === 0) {
    console.log("No migration needed - all sectors have targetGrowthRate");
    await closeDb();
    return;
  }

  // Show sample of what will be migrated
  console.log("\nSample documents to migrate:");
  docs.slice(0, 3).forEach((doc) => {
    console.log(
      `  - _id: ${doc._id}, corporationId: ${doc.corporationId}, stateId: ${doc.stateId}, growthRate: ${doc.growthRate}`
    );
  });

  if (docs.length > 3) {
    console.log(`  ... and ${docs.length - 3} more`);
  }

  console.log("\nMigration will set:");
  console.log("  - targetGrowthRate = 0 (neutral default)");
  console.log("  - currentGrowthRate = growthRate ?? 0");
  console.log("\nProceed? (y/n): ");

  // For non-interactive run, just proceed
  let migrated = 0;
  for (const doc of docs) {
    const updateResult = await sectorCol.updateOne(
      { _id: doc._id },
      {
        $set: {
          targetGrowthRate: 0,
          currentGrowthRate: doc.growthRate ?? 0,
          updatedAt: new Date(),
        },
      }
    );

    if (updateResult.modifiedCount > 0) {
      migrated++;
    }
  }

  console.log(`\nMigrated ${migrated} corporateSector documents`);

  // Verify no documents are missing targetGrowthRate after migration
  const remaining = await sectorCol.countDocuments({
    targetGrowthRate: { $exists: false },
  });

  if (remaining > 0) {
    console.error(`WARNING: ${remaining} documents still missing targetGrowthRate`);
  } else {
    console.log("Verification passed: all sectors now have targetGrowthRate");
  }

  await closeDb();
}

main().catch(console.error);
