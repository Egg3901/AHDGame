/**
 * Phase 6 D6 follow-up: backfill `foreignPolicy` and `culture` on
 * existing default-party rows so they match the seed values from
 * `src/lib/seeds/{reference,uk,de,jp,ie,br,cn}/*Parties.ts`.
 *
 * Newly-seeded games (post-`resetGameWorld`) already get these fields
 * from the seed loaders. This script handles the dev / staging / live
 * DBs that already had default-party rows before the schema landed.
 *
 * Lookup is by `(countryId, name)` — same key `ensureDefaultParties`
 * uses. Only `isDefault: true` rows are touched; custom parties
 * inherit from their charter via `ratifyCharter`.
 *
 * Idempotent: if the row already has both fields set to the seed
 * values, the update is a no-op (Mongo's `$set` of the same value
 * does not change the document).
 *
 * Usage:
 *   # Dry run against live DB (default, no writes):
 *   npx tsx scripts/migrations/2026-05-06-backfill-default-party-platform.ts
 *
 *   # Apply for real:
 *   npx tsx scripts/migrations/2026-05-06-backfill-default-party-platform.ts --apply
 *
 *   # Run against local DB instead:
 *   npx tsx scripts/migrations/2026-05-06-backfill-default-party-platform.ts --db=local
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

import { politicalParties as usParties } from "../../src/lib/seeds/reference/politicalParties";
import { ukParties } from "../../src/lib/seeds/uk/ukParties";
import { deParties } from "../../src/lib/seeds/de/deParties";
import { jpParties } from "../../src/lib/seeds/jp/jpParties";
import { ieParties } from "../../src/lib/seeds/ie/ieParties";
import { brParties } from "../../src/lib/seeds/br/brParties";
import { cnParties } from "../../src/lib/seeds/cn/cnParties";

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

  const allSeeds = [
    ...usParties,
    ...ukParties,
    ...deParties,
    ...jpParties,
    ...ieParties,
    ...brParties,
    ...cnParties,
  ];

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);
    console.log(`Seeds in registry: ${allSeeds.length}`);
    console.log("");

    let touched = 0;
    let alreadyCurrent = 0;
    let missingFromDb = 0;
    let seedsWithoutValues = 0;

    for (const seed of allSeeds) {
      // Defensive: if a seed file forgot to add foreignPolicy/culture,
      // the script doesn't try to overwrite live data with `undefined`.
      if (seed.foreignPolicy === undefined && seed.culture === undefined) {
        seedsWithoutValues++;
        continue;
      }

      const live = await db
        .collection("politicalParties")
        .findOne(
          { countryId: seed.countryId, name: seed.name, isDefault: true },
          { projection: { _id: 1, foreignPolicy: 1, culture: 1 } }
        );

      if (!live) {
        console.log(`  ${seed.countryId} / ${seed.name}: not in DB, skipping`);
        missingFromDb++;
        continue;
      }

      const liveDoc = live as { _id: unknown; foreignPolicy?: number; culture?: number };
      const needsFp = liveDoc.foreignPolicy !== seed.foreignPolicy;
      const needsCulture = liveDoc.culture !== seed.culture;
      if (!needsFp && !needsCulture) {
        alreadyCurrent++;
        continue;
      }

      const setOps: Record<string, unknown> = {};
      if (needsFp && seed.foreignPolicy !== undefined) setOps.foreignPolicy = seed.foreignPolicy;
      if (needsCulture && seed.culture !== undefined) setOps.culture = seed.culture;
      setOps.updatedAt = new Date();

      console.log(
        `  ${seed.countryId} / ${seed.name}: setting ` +
          Object.entries(setOps)
            .filter(([k]) => k !== "updatedAt")
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
      );

      if (apply) {
        await db
          .collection("politicalParties")
          .updateOne({ _id: liveDoc._id as object }, { $set: setOps });
      }
      touched++;
    }

    console.log("");
    console.log("=== Summary ===");
    console.log(`  default-party seeds processed   : ${allSeeds.length}`);
    console.log(`    seeds without fp / culture    : ${seedsWithoutValues}`);
    console.log(`    already current               : ${alreadyCurrent}`);
    console.log(`    not present in DB             : ${missingFromDb}`);
    console.log(`    needed update                 : ${touched}`);
    console.log(apply ? "Applied." : "Dry run — no writes.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
