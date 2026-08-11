/**
 * Cleanup: drop the duplicated `tariff_passed` sentiment pulses left behind
 * by the pre-fix reconcile spam.
 *
 * Background:
 *   `reconcileSignedTariffBills` (called on every GET /api/tariffs and a few
 *   other read paths) used to replay `applyTariffProvision` for every signed
 *   tariff bill, which fired a sentiment pulse pair per replay. Over a 24h TTL
 *   window this accumulated thousands of duplicate `tariff_passed` pulses,
 *   pinning affected corps to the negative sentiment cap. The fix at
 *   `applyTariffProvision` decoupled pulse firing from the data write so new
 *   spam can no longer accumulate, but the existing pile still occupies memory
 *   in `applyPriceMultipliers` (every 5 min) until it decays out.
 *
 * Why all-of-eventType is safe:
 *   The original bill-enactment pulse (created when the bill was actually
 *   signed days ago) has long since decayed to ≈0 via the 0.82-per-15-min
 *   decay rate. Every `tariff_passed` pulse currently in the DB is a recent
 *   reconcile replay — there's no "legitimate" pulse to preserve.
 *
 * Run AFTER the fix is deployed:
 *   The pre-fix `reconcileSignedTariffBills` code path spawns a fresh pulse
 *   pair per signed sector tariff on every GET /api/tariffs request. If this
 *   migration is run while the old code is still serving traffic, the pile
 *   will be repopulated within minutes. Confirm the deploy is live (the
 *   newest `tariff_passed` pulse should be from before the cutover) before
 *   running with --apply.
 *
 * Usage:
 *   # Dry run against live DB (default, no writes):
 *   npx tsx scripts/migrations/2026-05-05-cleanup-duplicate-tariff-pulses.ts
 *
 *   # Apply for real:
 *   npx tsx scripts/migrations/2026-05-05-cleanup-duplicate-tariff-pulses.ts --apply
 *
 *   # Run against local DB instead:
 *   npx tsx scripts/migrations/2026-05-05-cleanup-duplicate-tariff-pulses.ts --db=local
 *
 * Idempotent: re-running on a clean DB deletes 0 documents and exits.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "..", ".env.local"),
    path.resolve(process.cwd(), "..", "..", ".env.local"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      dotenv.config({ path: candidate });
      return candidate;
    }
  }
  dotenv.config();
  return null;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const envPath = loadEnvLocal();
  const dbMode = getArg("db") === "local" ? "local" : "live";
  const uriKey = dbMode === "local" ? "MONGODB_URI" : "MONGODB_URI_LIVE";
  const uri = process.env[uriKey];
  if (!uri) {
    throw new Error(
      `Missing ${uriKey}. Loaded env from ${envPath ?? "default dotenv resolution"}.`
    );
  }
  const apply = hasFlag("apply");

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    const collection = db.collection("sentimentPulses");

    const filter = { eventType: "tariff_passed" };
    const totalBefore = await collection.countDocuments(filter);
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);
    console.log(`Found ${totalBefore} tariff_passed pulses.`);

    if (totalBefore === 0) {
      console.log("Nothing to clean up. Exiting.");
      return;
    }

    // Show the bucket breakdown so it's clear what's being removed.
    const breakdown = await collection
      .aggregate<{
        _id: { country: string | null; sector: string | null; hq: string | null };
        count: number;
        oldest: Date;
        newest: Date;
      }>([
        { $match: filter },
        {
          $group: {
            _id: {
              country: "$countryId",
              sector: "$sectorType",
              hq: "$hqRelation",
            },
            count: { $sum: 1 },
            oldest: { $min: "$createdAt" },
            newest: { $max: "$createdAt" },
          },
        },
        { $sort: { count: -1 } },
      ])
      .toArray();

    console.log(
      `\nBuckets to clear (eventType=tariff_passed grouped by country|sector|hqRelation):`
    );
    for (const b of breakdown) {
      const key = `${b._id.country ?? "—"}|${b._id.sector ?? "—"}|${b._id.hq ?? "—"}`;
      console.log(
        `  ${key.padEnd(40)} count=${String(b.count).padStart(5)}  ` +
          `oldest=${b.oldest.toISOString()} newest=${b.newest.toISOString()}`
      );
    }

    if (!apply) {
      console.log(
        `\nDry run — no documents were deleted. Pass --apply to actually delete ${totalBefore} pulses.`
      );
      return;
    }

    const result = await collection.deleteMany(filter);
    const totalAfter = await collection.countDocuments(filter);
    console.log(`\nDeleted ${result.deletedCount} pulses. Remaining (should be 0): ${totalAfter}.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
