/**
 * Repair script for Bug #0850 / #0832 data corruption.
 *
 * Corporations that adopted dual-class supershares and then ran a share split
 * BEFORE the Bug #0832 fix (2026-06-23) had their superShares field wiped from
 * every shareholder entry by the old split code. The code is now fixed, but
 * existing data needs repair.
 *
 * This script finds every corp where:
 *   - superShareMultiplier is set (2–10)  →  dual-class structure adopted
 *   - NO shareholder has superShares > 0  →  data was wiped by buggy split
 *
 * For each affected corp it restores superShares on the CEO's entry to the
 * CEO's current share count (safe: effectiveSuperShares = min(superShares, shares)).
 *
 * Usage:
 *   npx tsx scripts/repair-supershares-0850.ts [--dry-run]
 */

import * as fs from "fs";
import * as path from "path";
import { MongoClient, ObjectId } from "mongodb";

const isDryRun = process.argv.includes("--dry-run");

function readMongoUri(): string {
  const envPath = path.join(__dirname, "../.env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const m = content.match(/^MONGODB_URI=(.+)$/m);
  if (!m) throw new Error("MONGODB_URI not found in .env.local");
  return m[1].trim();
}

interface Shareholder {
  characterId?: ObjectId;
  imperialCharacterId?: ObjectId;
  corporationId?: ObjectId;
  fundId?: ObjectId;
  nppId?: ObjectId;
  shares: number;
  superShares?: number;
}

interface Corporation {
  _id: ObjectId;
  name: string;
  sequentialId?: number;
  ceoId: ObjectId;
  ceoType?: "character" | "imperial" | "npp";
  superShareMultiplier?: number;
  shareholders: Shareholder[];
}

async function main() {
  const uri = readMongoUri();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db("a-house-divided");
  const col = db.collection<Corporation>("corporations");

  // Find all dual-class corps where NO shareholder has superShares > 0
  const affected = await col
    .find({
      superShareMultiplier: { $exists: true, $gte: 2, $lte: 10 },
      shareholders: { $not: { $elemMatch: { superShares: { $gt: 0 } } } },
    })
    .toArray();

  if (affected.length === 0) {
    console.log("No affected corporations found — nothing to repair.");
    await client.close();
    return;
  }

  console.log(
    `Found ${affected.length} affected corporation(s)${isDryRun ? " (dry run — no writes)" : ""}:\n`
  );

  let repaired = 0;
  let skipped = 0;

  for (const corp of affected) {
    const ceoType = corp.ceoType ?? "character";
    const label = `[${corp.sequentialId ?? corp._id}] ${corp.name} (${corp.superShareMultiplier}x supershares, ceoType=${ceoType})`;

    if (ceoType === "npp") {
      console.warn(`  SKIP ${label} — NPP CEOs cannot hold supershares`);
      skipped++;
      continue;
    }

    // Locate CEO's shareholder entry
    const ceoEntry = corp.shareholders.find((sh) => {
      if (ceoType === "imperial") return sh.imperialCharacterId?.equals(corp.ceoId);
      return sh.characterId?.equals(corp.ceoId);
    });

    if (!ceoEntry) {
      console.warn(`  SKIP ${label} — CEO shareholder entry not found in cap table`);
      skipped++;
      continue;
    }

    const ceoShares = ceoEntry.shares;
    if (ceoShares <= 0) {
      console.warn(`  SKIP ${label} — CEO has 0 shares (sold out?)`);
      skipped++;
      continue;
    }

    console.log(`  REPAIR ${label}`);
    console.log(
      `    CEO shares: ${ceoShares.toLocaleString()} → restoring superShares = ${ceoShares.toLocaleString()}`
    );

    if (!isDryRun) {
      const result = await col.updateOne(
        { _id: corp._id },
        { $set: { "shareholders.$[ceoEntry].superShares": ceoShares } },
        {
          arrayFilters: [
            {
              [`ceoEntry.${ceoType === "imperial" ? "imperialCharacterId" : "characterId"}`]:
                corp.ceoId,
            },
          ],
        }
      );
      if (result.modifiedCount === 1) {
        console.log(`    ✓ Repaired`);
        repaired++;
      } else {
        console.warn(`    ✗ Update matched 0 documents — check manually`);
        skipped++;
      }
    } else {
      repaired++;
    }
  }

  console.log(`\nDone. Repaired: ${repaired}, Skipped: ${skipped}${isDryRun ? " (dry run)" : ""}.`);

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
