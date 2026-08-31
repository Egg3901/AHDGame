/**
 * Seed whole plant ownership from the facility count players already see.
 *
 * Dry-run by default:
 *   npx tsx scripts/migrations/2026-08-31-seed-whole-plant-ledger.ts --json
 *
 * Apply:
 *   npx tsx scripts/migrations/2026-08-31-seed-whole-plant-ledger.ts --apply --json
 *
 * This migration writes only `plantCount` and `plantUnitRemainder`. It never
 * changes capacity, book basis, revenue, cash, or build queues.
 */
import "dotenv/config";
import { MongoClient, type AnyBulkWriteOperation } from "mongodb";
import type { CorporateSector } from "../../src/lib/db/types/corporation";
import { resolveMongoDbName } from "../../src/lib/mongodb";
import { seedPlantLedger } from "../../src/lib/corporations/plantLedger";

const apply = process.argv.includes("--apply");
const json = process.argv.includes("--json");
const uri: string = (() => {
  const value = process.env.MONGODB_URI ?? process.env.MONGO_URL;
  if (!value) throw new Error("MONGODB_URI or MONGO_URL is required");
  return value;
})();

interface Report {
  mode: "dry-run" | "apply";
  marketSystemMode: string | null;
  scanned: number;
  alreadySeeded: number;
  toSeed: number;
  zeroPlantSectors: number;
  totalPlants: number;
  modified: number;
  conservation: {
    capitalStockBefore: number;
    capacityBookAnchorBefore: number;
    fieldsTouched: ["plantCount", "plantUnitRemainder"];
  };
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(
      resolveMongoDbName({
        MONGODB_URI: process.env.MONGODB_URI,
        MONGO_URL: process.env.MONGO_URL,
        MONGODB_DB: process.env.MONGODB_DB,
        MONGO_DB_NAME: process.env.MONGO_DB_NAME,
      })
    );
    const cfg = await db
      .collection<{ _id: string; marketSystemMode?: string }>("gameConfig")
      .findOne({ _id: "default" }, { projection: { marketSystemMode: 1 } });
    const marketSystemMode =
      typeof cfg?.marketSystemMode === "string" ? cfg.marketSystemMode : null;
    if (marketSystemMode !== "plants") {
      throw new Error(`Refusing plant-ledger seed while marketSystemMode=${marketSystemMode}`);
    }

    const report: Report = {
      mode: apply ? "apply" : "dry-run",
      marketSystemMode,
      scanned: 0,
      alreadySeeded: 0,
      toSeed: 0,
      zeroPlantSectors: 0,
      totalPlants: 0,
      modified: 0,
      conservation: {
        capitalStockBefore: 0,
        capacityBookAnchorBefore: 0,
        fieldsTouched: ["plantCount", "plantUnitRemainder"],
      },
    };
    let operations: AnyBulkWriteOperation<CorporateSector>[] = [];

    const flush = async () => {
      if (!apply || operations.length === 0) {
        operations = [];
        return;
      }
      const result = await db
        .collection<CorporateSector>("corporateSectors")
        .bulkWrite(operations, { ordered: false });
      report.modified += result.modifiedCount;
      operations = [];
    };

    const cursor = db.collection<CorporateSector>("corporateSectors").find(
      {},
      {
        projection: {
          _id: 1,
          sectorType: 1,
          capitalStock: 1,
          capacityBookAnchor: 1,
          plantCount: 1,
          plantUnitRemainder: 1,
        },
      }
    );
    for await (const sector of cursor) {
      report.scanned += 1;
      report.conservation.capitalStockBefore +=
        typeof sector.capitalStock === "number" && Number.isFinite(sector.capitalStock)
          ? sector.capitalStock
          : 0;
      report.conservation.capacityBookAnchorBefore +=
        typeof sector.capacityBookAnchor === "number" && Number.isFinite(sector.capacityBookAnchor)
          ? sector.capacityBookAnchor
          : 0;

      const hasCount = Number.isInteger(sector.plantCount) && (sector.plantCount ?? 0) >= 0;
      const hasRemainder =
        typeof sector.plantUnitRemainder === "number" &&
        Number.isFinite(sector.plantUnitRemainder) &&
        sector.plantUnitRemainder >= 0;
      if (hasCount && hasRemainder) {
        report.alreadySeeded += 1;
        report.totalPlants += sector.plantCount as number;
        if ((sector.plantCount as number) === 0) report.zeroPlantSectors += 1;
        continue;
      }

      const seeded = hasCount
        ? { plantCount: sector.plantCount as number, plantUnitRemainder: 0 }
        : seedPlantLedger(sector.sectorType, sector.capitalStock);
      report.toSeed += 1;
      report.totalPlants += seeded.plantCount;
      if (seeded.plantCount === 0) report.zeroPlantSectors += 1;
      operations.push({
        updateOne: {
          filter: {
            _id: sector._id,
            ...(sector.plantCount === undefined
              ? { plantCount: { $exists: false } }
              : { plantCount: sector.plantCount }),
            ...(sector.plantUnitRemainder === undefined
              ? { plantUnitRemainder: { $exists: false } }
              : { plantUnitRemainder: sector.plantUnitRemainder }),
          },
          update: { $set: seeded },
        },
      });
      if (operations.length >= 500) await flush();
    }
    await flush();

    if (json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(
        `${report.mode}: ${report.toSeed}/${report.scanned} sectors, ${report.totalPlants.toLocaleString("en-US")} whole plants, ${report.modified} modified`
      );
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
