/**
 * Standalone seed of per-country default strategic sectors (spec §6.3) for a
 * LIVE game that predates the nationalization feature. The reset-time seeder
 * (`runCoreSeed → seedStrategicSectors`) cannot run on a live world, so this
 * applies the same idempotent defaults on their own.
 *
 * Each (countryId, sectorType) in DEFAULT_STRATEGIC_SECTORS is upserted into
 * `strategicSectorDesignations` at turn 0 with source "seed". A head-of-government
 * designation later overwrites the same row. Without these, the strategic-sector
 * nationalization trigger simply has no defaults (officials can still designate
 * in-game) — so this is recommended, not required.
 *
 * Idempotent + additive: re-runs only insert missing (country, sector) rows.
 *
 * Usage:
 *   # Dry run against the LIVE DB (default, no writes):
 *   npx tsx scripts/migrations/2026-06-06-seed-strategic-sectors.ts
 *
 *   # Apply for real (live):
 *   npx tsx scripts/migrations/2026-06-06-seed-strategic-sectors.ts --apply
 *
 *   # Run against the local DB instead:
 *   npx tsx scripts/migrations/2026-06-06-seed-strategic-sectors.ts --db=local --apply
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import { DEFAULT_STRATEGIC_SECTORS } from "@/lib/seeds/reference/strategicSectors";
import { seedStrategicSectors } from "@/lib/admin/seed/seedStrategicSectors";

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

    if (apply) {
      const n = await seedStrategicSectors(db);
      console.log(`\nUpserted ${n} default strategic-sector designation(s).`);
      return;
    }

    // Dry run: report which (country, sector) defaults are missing vs present.
    const coll = db.collection("strategicSectorDesignations");
    let missing = 0;
    let present = 0;
    for (const [countryId, sectors] of Object.entries(DEFAULT_STRATEGIC_SECTORS)) {
      for (const sectorType of sectors ?? []) {
        const exists = await coll.findOne({ countryId, sectorType }, { projection: { _id: 1 } });
        if (exists) {
          present += 1;
        } else {
          missing += 1;
          console.log(`[${countryId}] would seed strategic: ${sectorType} (dry-run)`);
        }
      }
    }
    console.log(`\nDone. ${missing} designation(s) would be seeded, ${present} already present.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
