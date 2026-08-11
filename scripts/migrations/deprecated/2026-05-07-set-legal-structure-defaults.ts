/**
 * Backfill: set `legalStructure` to the country default on every corporation
 * that lacks the field.
 *
 * Background: legal structure was introduced after existing corps were created.
 * Absence of the field means "use country default" in all runtime code, but
 * this migration stamps the default explicitly so the CEO admin panel and
 * sectorCalculations get a concrete value without the runtime fallback.
 *
 * Defaults by country:
 *   US → us_c_corp   UK → uk_plc   JP → jp_kk    DE → de_ag
 *   IE → ie_plc      BR → br_sa_aberta  CN → cn_gufen  NG → ng_plc
 *
 * Also creates a partial unique index on corporationVotes to prevent duplicate
 * open votes per corporation (mirrors the privatization vote guard).
 *
 * Usage:
 *   # Dry run (default):
 *   npx tsx scripts/migrations/2026-05-07-set-legal-structure-defaults.ts
 *
 *   # Apply:
 *   npx tsx scripts/migrations/2026-05-07-set-legal-structure-defaults.ts --apply
 *
 * Idempotent: re-running matches 0 documents once all corps are stamped.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

function loadEnvLocal(): string | null {
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "../.env.local"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

const envFile = loadEnvLocal();
if (envFile) dotenv.config({ path: envFile });

const DEFAULT_BY_COUNTRY: Record<string, string> = {
  US: "us_c_corp",
  UK: "uk_plc",
  JP: "jp_kk",
  DE: "de_ag",
  IE: "ie_plc",
  BR: "br_sa_aberta",
  CN: "cn_gufen",
  NG: "ng_plc",
};

const apply = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--db="));
const dbName = dbArg ? dbArg.slice("--db=".length) : "a-house-divided";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("Missing MONGODB_URI in env");
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);

    // Count corps without legalStructure
    const filter = { legalStructure: { $exists: false } };
    const matchCount = await db.collection("corporations").countDocuments(filter);
    console.log(`Corps without legalStructure: ${matchCount}`);

    if (matchCount > 0) {
      // Sample country distribution
      const countryGroups = await db
        .collection("corporations")
        .aggregate([
          { $match: filter },
          { $group: { _id: "$countryId", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ])
        .toArray();
      console.log("Country distribution:", JSON.stringify(countryGroups, null, 2));
    }

    // Check corporationVotes index (collection may not exist yet if no votes have been cast)
    let haveVotesIdx = false;
    try {
      const votesIdx = await db.collection("corporationVotes").listIndexes().toArray();
      haveVotesIdx = votesIdx.some((i) => i.name === "uniq_open_vote_per_corp");
    } catch {
      haveVotesIdx = false;
    }
    console.log(`corporationVotes uniq_open_vote_per_corp index present: ${haveVotesIdx}`);

    if (!apply) {
      console.log("Dry run — pass --apply to write.");
      return;
    }

    // Backfill each country's default in a single updateMany per country
    let totalUpdated = 0;
    for (const [countryId, defaultStructure] of Object.entries(DEFAULT_BY_COUNTRY)) {
      const result = await db
        .collection("corporations")
        .updateMany(
          { countryId, legalStructure: { $exists: false } },
          { $set: { legalStructure: defaultStructure, updatedAt: new Date() } }
        );
      if (result.modifiedCount > 0) {
        console.log(`  ${countryId}: set ${result.modifiedCount} corps → ${defaultStructure}`);
        totalUpdated += result.modifiedCount;
      }
    }

    // Corps with unknown country — set to us_c_corp as safe fallback
    const unknownResult = await db
      .collection("corporations")
      .updateMany(
        { legalStructure: { $exists: false } },
        { $set: { legalStructure: "us_c_corp", updatedAt: new Date() } }
      );
    if (unknownResult.modifiedCount > 0) {
      console.log(
        `  unknown country: set ${unknownResult.modifiedCount} corps → us_c_corp (fallback)`
      );
      totalUpdated += unknownResult.modifiedCount;
    }

    console.log(`Total updated: ${totalUpdated} corporation documents.`);

    // Create partial unique index on corporationVotes if missing.
    // MongoDB requires the collection to exist first; create it if needed.
    if (!haveVotesIdx) {
      const collections = await db.listCollections({ name: "corporationVotes" }).toArray();
      if (collections.length === 0) {
        await db.createCollection("corporationVotes");
        console.log("Created corporationVotes collection.");
      }
      await db.collection("corporationVotes").createIndex(
        { corporationId: 1 },
        {
          name: "uniq_open_vote_per_corp",
          unique: true,
          partialFilterExpression: { status: "open" },
        }
      );
      console.log("Created partial unique index uniq_open_vote_per_corp on corporationVotes.");
    }
  } finally {
    await client.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
