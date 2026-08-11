/**
 * Read-only audit for sector-removal bugs that failed to return revenue to the
 * persistent `unownedSectors` pool.
 *
 * Usage:
 *   npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts
 *   npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts --state=MN --sector=energy
 *   npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts --state=MN --sector=energy --amount=1543872
 *   npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts --state=MN --sector=energy --previous-total-market=7480000 --missing-share-percent=20.64
 *   npx tsx scripts/migrations/inspect-dropped-sector-unowned-loss.ts --manifest=scripts/migrations/dropped-sector-unowned-loss.example.json
 *
 * Defaults to MONGODB_URI_LIVE because this script is intended for production
 * investigation. Pass --db=local to use MONGODB_URI instead.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

const UNOWNED_ROLLOUT_AT = new Date("2026-04-11T00:00:00.000Z");

type CorpSectorRow = {
  _id: ObjectId;
  corporationId: ObjectId;
  revenue: number;
  stateId: string;
  sectorType: string;
  countryId: string;
};

type UnownedRow = {
  _id: ObjectId;
  stateId: string;
  sectorType: string;
  countryId: string;
  revenue: number;
  updatedAt?: Date;
  createdAt?: Date;
};

type StateRow = {
  _id: string;
  name: string;
  countryId: string;
};

type CorpRow = {
  _id: ObjectId;
  name: string;
  sequentialId?: number;
};

type AuditManifestEntry = {
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

function readManifest(manifestPath: string): AuditManifestEntry[] {
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
): number | null {
  if (explicitAmount != null) return Math.round(explicitAmount);

  if (previousTotalMarket != null && missingSharePercent != null) {
    return Math.round(previousTotalMarket * (missingSharePercent / 100));
  }

  return null;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100;
}

async function printMarketSnapshot(
  db: ReturnType<MongoClient["db"]>,
  stateId: string,
  sectorType: string,
  repairRevenue: number | null,
  note?: string
) {
  const [state, ownedSectors, unownedDoc] = await Promise.all([
    db
      .collection<StateRow>("states")
      .findOne({ _id: stateId }, { projection: { _id: 1, name: 1, countryId: 1 } }),
    db
      .collection<CorpSectorRow>("corporateSectors")
      .find(
        { stateId, sectorType },
        {
          projection: {
            _id: 1,
            corporationId: 1,
            revenue: 1,
            stateId: 1,
            sectorType: 1,
            countryId: 1,
          },
        }
      )
      .toArray(),
    db.collection<UnownedRow>("unownedSectors").findOne(
      { stateId, sectorType },
      {
        projection: {
          _id: 1,
          stateId: 1,
          sectorType: 1,
          countryId: 1,
          revenue: 1,
          updatedAt: 1,
          createdAt: 1,
        },
      }
    ),
  ]);

  if (!state) {
    throw new Error(`State ${stateId} not found`);
  }

  const corpIds = [...new Set(ownedSectors.map((sector) => sector.corporationId.toString()))].map(
    (id) => new ObjectId(id)
  );
  const corpMap = new Map<string, CorpRow>(
    (corpIds.length > 0
      ? await db
          .collection<CorpRow>("corporations")
          .find({ _id: { $in: corpIds } }, { projection: { _id: 1, name: 1, sequentialId: 1 } })
          .toArray()
      : []
    ).map((corp) => [corp._id.toString(), corp])
  );

  const ownedRevenue = ownedSectors.reduce((sum, sector) => sum + sector.revenue, 0);
  const unownedRevenue = unownedDoc?.revenue ?? 0;
  const totalMarket = ownedRevenue + unownedRevenue;

  console.log(
    `\n[inspect-dropped-sector-unowned-loss] ${state.countryId}-${state._id} ${state.name} :: ${sectorType}`
  );
  if (note) {
    console.log(`  note            : ${note}`);
  }
  console.log(`  owned revenue   : ${Math.round(ownedRevenue).toLocaleString()}`);
  console.log(`  unowned revenue : ${Math.round(unownedRevenue).toLocaleString()}`);
  console.log(`  total market    : ${Math.round(totalMarket).toLocaleString()}`);
  console.log(`  unowned share   : ${percent(unownedRevenue, totalMarket).toFixed(2)}%`);

  for (const sector of ownedSectors.sort((a, b) => b.revenue - a.revenue)) {
    const corp = corpMap.get(sector.corporationId.toString());
    const label = corp
      ? `${corp.name} (#${corp.sequentialId ?? "?"})`
      : sector.corporationId.toString();
    console.log(
      `  - ${label.padEnd(40)} ${Math.round(sector.revenue).toLocaleString().padStart(12)} :: ${percent(sector.revenue, totalMarket).toFixed(2)}%`
    );
  }

  if (repairRevenue != null) {
    const healedUnownedRevenue = unownedRevenue + repairRevenue;
    const healedTotalMarket = ownedRevenue + healedUnownedRevenue;

    console.log(
      `\n[inspect-dropped-sector-unowned-loss] simulated repair delta: +${repairRevenue.toLocaleString()}`
    );
    console.log(`  healed unowned  : ${Math.round(healedUnownedRevenue).toLocaleString()}`);
    console.log(`  healed market   : ${Math.round(healedTotalMarket).toLocaleString()}`);
    console.log(
      `  healed unowned% : ${percent(healedUnownedRevenue, healedTotalMarket).toFixed(2)}%`
    );
    for (const sector of ownedSectors.sort((a, b) => b.revenue - a.revenue)) {
      const corp = corpMap.get(sector.corporationId.toString());
      const label = corp
        ? `${corp.name} (#${corp.sequentialId ?? "?"})`
        : sector.corporationId.toString();
      console.log(
        `  - ${label.padEnd(40)} ${percent(sector.revenue, healedTotalMarket).toFixed(2)}%`
      );
    }
  }
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
  const repairRevenue = resolveRepairRevenueFromInputs(
    getNumberArg("amount"),
    getNumberArg("previous-total-market"),
    getNumberArg("missing-share-percent")
  );
  const manifestPath = getArg("manifest");
  const manifest = manifestPath ? readManifest(manifestPath) : [];

  const client = new MongoClient(uri);
  await client.connect();

  try {
    const db = client.db("a-house-divided");

    const dissolutionCount = await db.collection("wireEvents").countDocuments({
      type: "corporation_dissolved",
      timestamp: { $gte: UNOWNED_ROLLOUT_AT },
    });
    const recentDissolutions = await db
      .collection<{ headline: string; timestamp: Date }>("wireEvents")
      .find({
        type: "corporation_dissolved",
        timestamp: { $gte: UNOWNED_ROLLOUT_AT },
      })
      .sort({ timestamp: -1 })
      .limit(10)
      .toArray();

    console.log(`[inspect-dropped-sector-unowned-loss] env=${envPath ?? "default"} db=${dbMode}`);
    console.log(
      `[inspect-dropped-sector-unowned-loss] corporation_dissolved events since ${UNOWNED_ROLLOUT_AT.toISOString()}: ${dissolutionCount}`
    );
    for (const event of recentDissolutions) {
      console.log(`  - ${event.timestamp.toISOString()} :: ${event.headline}`);
    }
    console.log(
      "[inspect-dropped-sector-unowned-loss] Note: plain sector abandon leaves no durable audit row, so old abandon cases are not discoverable from live data alone."
    );

    if (manifest.length === 0 && (!stateId || !sectorType)) {
      return;
    }

    if (manifest.length > 0) {
      console.log(
        `\n[inspect-dropped-sector-unowned-loss] manifest entries: ${manifest.length} (${manifestPath})`
      );
      for (const entry of manifest) {
        const manifestRevenue = resolveRepairRevenueFromInputs(
          entry.amount,
          entry.previousTotalMarket,
          entry.missingSharePercent
        );
        await printMarketSnapshot(db, entry.state, entry.sector, manifestRevenue, entry.note);
      }
    } else if (stateId && sectorType) {
      await printMarketSnapshot(db, stateId, sectorType, repairRevenue);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("[inspect-dropped-sector-unowned-loss] failed:", error);
  process.exitCode = 1;
});
