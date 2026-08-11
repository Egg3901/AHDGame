/**
 * Migration: Fix Coalition Data Issues
 *
 * This script fixes two bugs:
 * 1. Duplicate members in coalition.members arrays (Issue #1)
 * 2. Stale coalition.chairCharacterId not matching party.chairId (Issue #2)
 *
 * Run with: npx tsx scripts/migrations/fix-coalition-data.ts
 */

import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

async function main() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not found in environment");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);
  await client.connect();
  const db = client.db("a-house-divided");

  console.log("Starting coalition data migration...\n");

  // ─── Issue 1: Remove duplicate members ───────────────────────────────────────
  console.log("=== Fixing duplicate members ===");

  const coalitions = await db.collection("coalitions").find({}).toArray();
  let duplicateCount = 0;

  for (const coalition of coalitions) {
    const seenPartyIds = new Set<string>();
    const uniqueMembers: typeof coalition.members = [];
    let hasDuplicates = false;

    for (const member of coalition.members) {
      const partyIdStr = member.partyId.toString();
      if (seenPartyIds.has(partyIdStr)) {
        hasDuplicates = true;
        console.log(
          `  Found duplicate in coalition "${coalition.name}" (${coalition.countryId}): partyId ${partyIdStr}`
        );
      } else {
        seenPartyIds.add(partyIdStr);
        uniqueMembers.push(member);
      }
    }

    if (hasDuplicates) {
      await db
        .collection("coalitions")
        .updateOne(
          { _id: coalition._id },
          { $set: { members: uniqueMembers, updatedAt: new Date() } }
        );
      duplicateCount++;
    }
  }

  console.log(`Fixed ${duplicateCount} coalitions with duplicate members.\n`);

  // ─── Issue 2: Update stale chairCharacterId ───────────────────────────────────
  console.log("=== Fixing stale coalition chair IDs ===");

  let staleCount = 0;

  for (const coalition of coalitions) {
    // Find the chair party
    const chairParty = await db.collection("politicalParties").findOne({
      _id: coalition.chairPartyId,
    });

    if (!chairParty) {
      console.log(
        `  Warning: Chair party not found for coalition "${coalition.name}" (${coalition.countryId})`
      );
      continue;
    }

    // Check if chairCharacterId matches party's current chairId
    const expectedChairId = chairParty.chairId;
    const currentChairId = coalition.chairCharacterId;

    if (!expectedChairId) {
      // Party has no chair - coalition chair should be null or we skip
      console.log(
        `  Info: Chair party "${chairParty.name}" has no chairId, skipping coalition "${coalition.name}"`
      );
      continue;
    }

    if (!currentChairId || !currentChairId.equals(expectedChairId)) {
      console.log(`  Updating coalition "${coalition.name}" (${coalition.countryId}):`);
      console.log(`    Party: ${chairParty.name}`);
      console.log(`    Old chair ID: ${currentChairId?.toString() ?? "null"}`);
      console.log(`    New chair ID: ${expectedChairId.toString()}`);

      // Get character name for logging
      const chairChar = await db.collection("characters").findOne({ _id: expectedChairId });
      console.log(`    New chair name: ${chairChar?.name ?? "Unknown"}`);

      await db
        .collection("coalitions")
        .updateOne(
          { _id: coalition._id },
          { $set: { chairCharacterId: expectedChairId, updatedAt: new Date() } }
        );
      staleCount++;
    }
  }

  console.log(`\nFixed ${staleCount} coalitions with stale chair IDs.`);

  // ─── Summary ────────────────────────────────────────────────────────────────
  console.log("\n=== Migration Summary ===");
  console.log(`Coalitions processed: ${coalitions.length}`);
  console.log(`Duplicates fixed: ${duplicateCount}`);
  console.log(`Stale chairs fixed: ${staleCount}`);
  console.log("\nMigration complete!");

  await client.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
