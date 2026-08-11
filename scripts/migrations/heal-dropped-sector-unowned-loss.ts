/**
 * Dry-run-first repair for a sector-removal bug that failed to return revenue
 * to the persistent `unownedSectors` pool.
 *
 * Usage:
 *   npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts --state=MN --sector=energy --amount=1543872
 *   npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts --state=MN --sector=energy --previous-total-market=7480000 --missing-share-percent=20.64
 *   npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts --state=MN --sector=energy --amount=1543872 --apply
 *   npx tsx scripts/migrations/heal-dropped-sector-unowned-loss.ts --manifest=scripts/migrations/dropped-sector-unowned-loss.example.json
 *
 * Defaults to MONGODB_URI_LIVE because this is intended for production heals.
 * Pass --db=local to use MONGODB_URI instead. Nothing is written unless --apply
 * is present.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

type CorpSectorRow = {
  _id: ObjectId;
  corporationId: ObjectId;
  revenue: number;
};

type UnownedRow = {
  _id: ObjectId;
  stateId: string;
  sectorType: string;
  countryId: string;
  revenue: number;
};

type StateRow = {
  _id: string;
  name: string;
  countryId: string;
};

type HealManifestEntry = {
  state: string;
  sector: string;
  amount?: number;
  previousTotalMarket?: number;
  missingSharePercent?: number;
  note?: string;
};

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

function getNumberArg(name: string): number | undefined {
  const raw = getArg(name);
  if (raw == null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric value for --${name}: ${raw}`);
  }
  return value;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function readManifest(manifestPath: string): HealManifestEntry[] {
  const raw = fs.readFileSync(path.resolve(process.cwd(), manifestPath), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Manifest at ${manifestPath} must be a JSON array.`);
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Manifest entry ${index} is not an object.`);
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.state !== "string" || typeof record.sector !== "string") {
      throw new Error(`Manifest entry ${index} must include string fields "state" and "sector".`);
    }

    return {
      state: record.state,
      sector: record.sector,
      amount: typeof record.amount === "number" ? record.amount : undefined,
      previousTotalMarket:
        typeof record.previousTotalMarket === "number" ? record.previousTotalMarket : undefined,
      missingSharePercent:
        typeof record.missingSharePercent === "number" ? record.missingSharePercent : undefined,
      note: typeof record.note === "string" ? record.note : undefined,
    };
  });
}

function resolveRepairRevenueFromInputs(
  explicitAmount?: number,
  previousTotalMarket?: number,
  missingSharePercent?: number
): number {
  if (explicitAmount != null) return Math.round(explicitAmount);

  if (previousTotalMarket != null && missingSharePercent != null) {
    return Math.round(previousTotalMarket * (missingSharePercent / 100));
  }

  throw new Error(
    "Provide either --amount=<revenue> or both --previous-total-market=<value> and --missing-share-percent=<percent>."
  );
}

async function processEntry(
  db: ReturnType<MongoClient["db"]>,
  entry: { state: string; sector: string; note?: string },
  repairRevenue: number,
  apply: boolean
) {
  const [state, ownedSectors, unownedDoc] = await Promise.all([
    db
      .collection<StateRow>("states")
      .findOne({ _id: entry.state }, { projection: { _id: 1, name: 1, countryId: 1 } }),
    db
      .collection<CorpSectorRow>("corporateSectors")
      .find(
        { stateId: entry.state, sectorType: entry.sector },
        { projection: { _id: 1, corporationId: 1, revenue: 1 } }
      )
      .toArray(),
    db
      .collection<UnownedRow>("unownedSectors")
      .findOne(
        { stateId: entry.state, sectorType: entry.sector },
        { projection: { _id: 1, stateId: 1, sectorType: 1, countryId: 1, revenue: 1 } }
      ),
  ]);

  if (!state) {
    throw new Error(`State ${entry.state} not found`);
  }

  const countryId = unownedDoc?.countryId ?? state.countryId;
  const ownedRevenue = ownedSectors.reduce((sum, sector) => sum + sector.revenue, 0);
  const beforeUnownedRevenue = unownedDoc?.revenue ?? 0;
  const afterUnownedRevenue = beforeUnownedRevenue + repairRevenue;
  const beforeTotalMarket = ownedRevenue + beforeUnownedRevenue;
  const afterTotalMarket = ownedRevenue + afterUnownedRevenue;

  console.log(
    `\n[heal-dropped-sector-unowned-loss] target=${state.countryId}-${state._id} ${state.name} :: ${entry.sector}`
  );
  if (entry.note) {
    console.log(`  note                     : ${entry.note}`);
  }
  console.log(`  current owned revenue    : ${Math.round(ownedRevenue).toLocaleString()}`);
  console.log(`  current unowned revenue  : ${Math.round(beforeUnownedRevenue).toLocaleString()}`);
  console.log(`  repair delta             : +${repairRevenue.toLocaleString()}`);
  console.log(`  projected unowned        : ${Math.round(afterUnownedRevenue).toLocaleString()}`);
  console.log(
    `  current unowned share    : ${percent(beforeUnownedRevenue, beforeTotalMarket).toFixed(2)}%`
  );
  console.log(
    `  projected unowned share  : ${percent(afterUnownedRevenue, afterTotalMarket).toFixed(2)}%`
  );

  if (!apply) {
    return;
  }

  const now = new Date();
  await db.collection("unownedSectors").updateOne(
    { stateId: entry.state, sectorType: entry.sector },
    {
      $inc: { revenue: repairRevenue },
      $set: { updatedAt: now },
      $setOnInsert: {
        _id: new ObjectId(),
        stateId: entry.state,
        countryId,
        sectorType: entry.sector,
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const afterDoc = await db
    .collection<UnownedRow>("unownedSectors")
    .findOne({ stateId: entry.state, sectorType: entry.sector });
  const finalUnownedRevenue = afterDoc?.revenue ?? 0;
  const finalTotalMarket = ownedRevenue + finalUnownedRevenue;

  console.log(`  applied                  : yes`);
  console.log(`  final unowned revenue    : ${Math.round(finalUnownedRevenue).toLocaleString()}`);
  console.log(`  final total market       : ${Math.round(finalTotalMarket).toLocaleString()}`);
  console.log(
    `  final unowned share      : ${percent(finalUnownedRevenue, finalTotalMarket).toFixed(2)}%`
  );
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

  const stateId = getArg("state");
  const sectorType = getArg("sector");
  const manifestPath = getArg("manifest");
  const manifest = manifestPath ? readManifest(manifestPath) : [];
  const apply = process.argv.includes("--apply");
  const repairRevenue =
    manifest.length === 0
      ? resolveRepairRevenueFromInputs(
          getNumberArg("amount"),
          getNumberArg("previous-total-market"),
          getNumberArg("missing-share-percent")
        )
      : null;

  if (manifest.length === 0 && (!stateId || !sectorType)) {
    throw new Error(
      "Provide either both --state=<stateId> and --sector=<sectorType>, or --manifest=<path>."
    );
  }
  if (repairRevenue != null && repairRevenue <= 0) {
    throw new Error(`Repair revenue must be positive. Resolved amount: ${repairRevenue}`);
  }

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");
    console.log(`[heal-dropped-sector-unowned-loss] env=${envPath ?? "default"} db=${dbMode}`);

    const entries =
      manifest.length > 0
        ? manifest.map((entry) => ({
            entry,
            repairRevenue: resolveRepairRevenueFromInputs(
              entry.amount,
              entry.previousTotalMarket,
              entry.missingSharePercent
            ),
          }))
        : [{ entry: { state: stateId!, sector: sectorType! }, repairRevenue: repairRevenue! }];

    let totalDelta = 0;
    for (const { entry, repairRevenue } of entries) {
      totalDelta += repairRevenue;
      await processEntry(db, entry, repairRevenue, apply);
    }

    console.log(
      `\n[heal-dropped-sector-unowned-loss] entries=${entries.length} aggregate repair delta=${Math.round(totalDelta).toLocaleString()}`
    );
    if (!apply) {
      console.log("DRY RUN — re-run with --apply to write the repair.");
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[heal-dropped-sector-unowned-loss] failed:", error);
  process.exitCode = 1;
});
