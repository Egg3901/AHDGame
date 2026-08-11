/**
 * Idempotent migration: stamp `isPrimaryNationalCorporation: true` and
 * `assignedSectorTypes: []` ("the remainder") onto every existing National
 * Corporation that predates the multi-NatCorp model (spec §24.1).
 *
 * Before this design each country had exactly one National Corporation
 * (`{ countryOwnerId }`); that corp becomes the country's PRIMARY. Split-offs
 * created after this migration carry their own flag (`false`) + one assigned
 * type, so the `{ isPrimaryNationalCorporation: { $exists: false } }` filter
 * skips them. Routing + sovereign-issuer lookups fall back to any
 * `{ countryOwnerId }` when the flag is absent, so this is safe-but-recommended.
 *
 * Idempotent: only touches country-owned corps that lack the flag, so re-runs
 * are no-ops (and any future unflagged primary is healed).
 *
 * Usage:
 *   # Dry run against the LIVE DB (default, no writes):
 *   npx tsx scripts/migrations/nationalizationPrimaryFlag.ts
 *
 *   # Apply for real (live):
 *   npx tsx scripts/migrations/nationalizationPrimaryFlag.ts --apply
 *
 *   # Run against the local DB instead:
 *   npx tsx scripts/migrations/nationalizationPrimaryFlag.ts --db=local --apply
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";

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
    console.log(`Mode: ${dbMode.toUpperCase()}${apply ? " (APPLY)" : " (dry-run)"}`);

    const filter = {
      countryOwnerId: { $exists: true, $ne: null },
      isPrimaryNationalCorporation: { $exists: false },
    };

    const targets = await db
      .collection("corporations")
      .find(filter, { projection: { _id: 1, countryOwnerId: 1, name: 1 } })
      .toArray();

    for (const c of targets) {
      console.log(
        `[${c.countryOwnerId as CountryId}] flag primary: ${c.name ?? c._id}` +
          `${apply ? "" : " (dry-run)"}`
      );
    }

    if (apply && targets.length > 0) {
      const res = await db.collection("corporations").updateMany(filter, {
        $set: {
          isPrimaryNationalCorporation: true,
          assignedSectorTypes: [],
          updatedAt: new Date(),
        },
      });
      console.log(`\nFlagged ${res.modifiedCount} National Corporation(s) as primary.`);
    } else {
      console.log(
        `\nDone. ${targets.length} National Corporation(s) ${apply ? "flagged" : "would be flagged"}.`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
