/**
 * Script: Forgive Bee Industries Debt
 *
 * Deletes all bonds issued by Bee Industries and compensates holders
 * with cash equal to the face value of their bond holdings.
 *
 * Usage: npx tsx scripts/forgive-bee-industries-debt.ts
 */

import { MongoClient, ObjectId } from "mongodb";
import * as fs from "fs";

const BEE_CORP_ID = "69dba435f7665fdc91aa435b";
const BOND_UNIT_FACE_VALUE = 1_000;

async function main() {
  // Read MongoDB URI from .env.local
  const envContent = fs.readFileSync(".env.local", "utf8");
  const mongoUri = envContent.match(/MONGODB_URI=(.+)/)?.[1]?.trim();

  if (!mongoUri) {
    console.error("MONGODB_URI not found in .env.local");
    process.exit(1);
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log("Connected to MongoDB\n");

    const db = client.db("a-house-divided");

    // Verify Bee Industries exists
    const beeCorp = await db.collection("corporations").findOne({ _id: new ObjectId(BEE_CORP_ID) });

    if (!beeCorp) {
      console.error("Bee Industries corporation not found!");
      process.exit(1);
    }

    console.log("Bee Industries Corporation:");
    console.log("  Name:", beeCorp.name);
    console.log("  Liquid Capital: $", beeCorp.liquidCapital.toLocaleString());
    console.log("  Share Price: $", beeCorp.sharePrice.toFixed(2));
    console.log();

    // Find all bonds issued by Bee Industries
    const bonds = await db
      .collection("bonds")
      .find({ corporationId: new ObjectId(BEE_CORP_ID) })
      .toArray();

    console.log(`Found ${bonds.length} bond(s) issued by Bee Industries\n`);

    if (bonds.length === 0) {
      console.log("No bonds found. Nothing to do.");
      process.exit(0);
    }

    // Collect all unique holders and their total holdings
    const holders = new Map<
      string,
      {
        type: "character" | "corporation";
        id: ObjectId;
        totalUnits: number;
        totalFaceValue: number;
      }
    >();

    for (const bond of bonds) {
      console.log(`Bond ${bond._id}:`);
      console.log(`  Total Issued: $${bond.totalIssued.toLocaleString()}`);
      console.log(`  Coupon Rate: ${bond.couponRate}%`);
      console.log(`  Matured: ${bond.matured}, Defaulted: ${bond.defaulted}`);
      console.log(`  Holders: ${bond.holders.length}`);

      for (const holder of bond.holders) {
        const key = holder.characterId
          ? `char-${holder.characterId.toString()}`
          : `corp-${holder.corporationId!.toString()}`;

        const existing =
          holders.get(key) ||
          ({
            type: holder.characterId ? "character" : "corporation",
            id: (holder.characterId || holder.corporationId!) as ObjectId,
            totalUnits: 0,
            totalFaceValue: 0,
          } as const);

        const units = holder.units;
        const faceValue = units * BOND_UNIT_FACE_VALUE;

        holders.set(key, {
          type: existing.type,
          id: existing.id,
          totalUnits: existing.totalUnits + units,
          totalFaceValue: existing.totalFaceValue + faceValue,
        });
      }
      console.log();
    }

    // Show compensation summary
    console.log("=".repeat(60));
    console.log("COMPENSATION SUMMARY");
    console.log("=".repeat(60));

    let totalCompensation = 0;
    const compensationDetails: Array<{
      name: string;
      type: "character" | "corporation";
      units: number;
      amount: number;
    }> = [];

    for (const [, holder] of holders) {
      let name: string;
      if (holder.type === "character") {
        const char = await db.collection("characters").findOne({ _id: holder.id });
        name = char ? char.name : "Unknown Character";
      } else {
        const corp = await db.collection("corporations").findOne({ _id: holder.id });
        name = corp ? corp.name : "Unknown Corporation";
      }

      console.log(`${holder.type === "character" ? "Character" : "Corporation"}: ${name}`);
      console.log(`  Bond Units: ${holder.totalUnits.toLocaleString()}`);
      console.log(`  Compensation: $${holder.totalFaceValue.toLocaleString()}`);
      console.log();

      compensationDetails.push({
        name,
        type: holder.type,
        units: holder.totalUnits,
        amount: holder.totalFaceValue,
      });

      totalCompensation += holder.totalFaceValue;
    }

    console.log("=".repeat(60));
    console.log(`TOTAL COMPENSATION: $${totalCompensation.toLocaleString()}`);
    console.log("=".repeat(60));
    console.log();

    // Confirm before proceeding
    console.log("This will:");
    console.log(`  1. Delete ${bonds.length} bond(s)`);
    console.log(
      `  2. Distribute $${totalCompensation.toLocaleString()} to ${holders.size} holder(s)`
    );
    console.log();

    const confirm = process.argv.includes("--confirm");
    if (!confirm) {
      console.log("Run with --confirm to execute");
      process.exit(0);
    }

    console.log("Executing...\n");

    // Step 1: Compensate all holders
    for (const [key, holder] of holders) {
      if (holder.type === "character") {
        await db
          .collection("characters")
          .updateOne({ _id: holder.id }, { $inc: { cashOnHand: holder.totalFaceValue } });
        console.log(
          `✓ Compensated character ${key} with $${holder.totalFaceValue.toLocaleString()}`
        );
      } else {
        await db
          .collection("corporations")
          .updateOne({ _id: holder.id }, { $inc: { liquidCapital: holder.totalFaceValue } });
        console.log(
          `✓ Compensated corporation ${key} with $${holder.totalFaceValue.toLocaleString()}`
        );
      }
    }

    console.log();

    // Step 2: Delete all bonds
    const deleteResult = await db
      .collection("bonds")
      .deleteMany({ corporationId: new ObjectId(BEE_CORP_ID) });

    console.log(`✓ Deleted ${deleteResult.deletedCount} bond(s)`);

    console.log("\nDone! Bee Industries debt has been forgiven.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
