/**
 * One-off live-data heal for `corporateSectors` rows whose `countryId` does not
 * match the authoritative country of their `stateId`.
 *
 * ROOT CAUSE:
 *   Cross-border sector expansion stamped new sector rows with the owning
 *   corporation's HQ country instead of the destination state's country. Later,
 *   hostile takeovers keyed sector merges on `countryId:stateId:sectorType`,
 *   which let a stale cross-border row survive as a parallel duplicate in the
 *   same market.
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Find every `corporateSectors` row whose `countryId !== states.countryId`
 *   2. Normalize those rows to the authoritative country from `states`
 *   3. Re-group sectors by `(corporationId, stateId, sectorType)` after normalization
 *   4. Merge any duplicates by:
 *      - keeping the oldest document
 *      - summing `revenue`
 *      - summing `workers`
 *      - revenue-weighting `profitMargin`
 *      - deleting the duplicate rows
 *
 * USAGE:
 *   # Dry-run all affected sectors on live (default)
 *   npx tsx scripts/migrations/heal-cross-border-sector-country-mismatches.ts
 *
 *   # Dry-run only General Electric (#6)
 *   npx tsx scripts/migrations/heal-cross-border-sector-country-mismatches.ts --corpSeq=6
 *
 *   # Apply to all currently affected sectors on live
 *   npx tsx scripts/migrations/heal-cross-border-sector-country-mismatches.ts --execute
 *
 *   # Apply only to one corporation
 *   npx tsx scripts/migrations/heal-cross-border-sector-country-mismatches.ts --execute --corpSeq=6
 *
 * SAFETY:
 *   - Uses `MONGODB_URI_LIVE`
 *   - Dry-run by default
 *   - Prints every normalization and merge before writing
 *   - Idempotent: once rows are normalized/merged, a rerun becomes a no-op
 */
import { MongoClient, ObjectId } from "mongodb";
import * as dotenv from "dotenv";
import path from "path";
import type { Corporation, CorporateSector, State } from "../../src/lib/db/types";
import type { CountryId } from "../../src/lib/constants/countries";
import {
  buildSectorStateCountryMap,
  getCorporateSectorLocationKey,
  getSectorOperatingCountryId,
} from "../../src/lib/corporations/sectorLocation";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const uri = process.env.MONGODB_URI_LIVE;
if (!uri) {
  console.error("MONGODB_URI_LIVE not set");
  process.exit(1);
}

type PlanNormalization = {
  sectorId: ObjectId;
  corporationId: ObjectId;
  corporationName: string;
  corpSeq?: number;
  stateId: string;
  stateName: string;
  sectorType: string;
  fromCountryId: CountryId;
  toCountryId: CountryId;
};

type PlanMerge = {
  keeperId: ObjectId;
  duplicateIds: ObjectId[];
  corporationId: ObjectId;
  corporationName: string;
  corpSeq?: number;
  stateId: string;
  stateName: string;
  sectorType: string;
  count: number;
  combinedRevenue: number;
  combinedWorkers: number;
  weightedMargin: number;
};

function parseCorpSeq(): number | null {
  const arg = process.argv.find((value) => value.startsWith("--corpSeq="));
  if (!arg) return null;
  const raw = arg.slice("--corpSeq=".length).trim();
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid --corpSeq value: ${raw}`);
  }
  return parsed;
}

function fmtNumber(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtMargin(value: number): string {
  return `${value.toFixed(2)}%`;
}

async function main() {
  const execute = process.argv.includes("--execute");
  const corpSeqFilter = parseCorpSeq();
  const client = new MongoClient(uri!);
  await client.connect();
  const db = client.db("a-house-divided");

  const [states, corporations, sectors] = await Promise.all([
    db
      .collection<State>("states")
      .find({}, { projection: { _id: 1, countryId: 1, name: 1 } })
      .toArray(),
    db
      .collection<Corporation>("corporations")
      .find({}, { projection: { _id: 1, sequentialId: 1, name: 1 } })
      .toArray(),
    db.collection<CorporateSector>("corporateSectors").find({}).sort({ createdAt: 1 }).toArray(),
  ]);

  const stateCountryByStateId = buildSectorStateCountryMap(states);
  const stateNameByStateId = new Map(states.map((state) => [String(state._id), state.name]));
  const corpById = new Map(corporations.map((corp) => [corp._id.toString(), corp]));

  const scopedSectors = corpSeqFilter
    ? sectors.filter(
        (sector) => corpById.get(sector.corporationId.toString())?.sequentialId === corpSeqFilter
      )
    : sectors;

  const normalizations: PlanNormalization[] = [];
  for (const sector of scopedSectors) {
    const operatingCountryId = getSectorOperatingCountryId(sector, stateCountryByStateId);
    if (sector.countryId === operatingCountryId) continue;
    const corp = corpById.get(sector.corporationId.toString());
    normalizations.push({
      sectorId: sector._id,
      corporationId: sector.corporationId,
      corporationName: corp?.name ?? "(unknown corp)",
      corpSeq: corp?.sequentialId,
      stateId: sector.stateId,
      stateName: stateNameByStateId.get(sector.stateId) ?? sector.stateId,
      sectorType: sector.sectorType,
      fromCountryId: sector.countryId,
      toCountryId: operatingCountryId,
    });
  }

  const normalizedPreview = scopedSectors.map((sector) => {
    const correctedCountryId = getSectorOperatingCountryId(sector, stateCountryByStateId);
    return { ...sector, countryId: correctedCountryId };
  });

  const grouped = new Map<string, CorporateSector[]>();
  for (const sector of normalizedPreview) {
    const key = getCorporateSectorLocationKey(sector, stateCountryByStateId);
    const existing = grouped.get(key) ?? [];
    existing.push(sector);
    grouped.set(key, existing);
  }

  const merges: PlanMerge[] = [];
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const [keeper, ...duplicates] = group;
    const corp = corpById.get(keeper.corporationId.toString());
    const combinedRevenue = group.reduce((sum, sector) => sum + sector.revenue, 0);
    const combinedWorkers = group.reduce((sum, sector) => sum + sector.workers, 0);
    const weightedMargin =
      combinedRevenue > 0
        ? group.reduce((sum, sector) => sum + sector.profitMargin * sector.revenue, 0) /
          combinedRevenue
        : keeper.profitMargin;

    merges.push({
      keeperId: keeper._id,
      duplicateIds: duplicates.map((sector) => sector._id),
      corporationId: keeper.corporationId,
      corporationName: corp?.name ?? "(unknown corp)",
      corpSeq: corp?.sequentialId,
      stateId: keeper.stateId,
      stateName: stateNameByStateId.get(keeper.stateId) ?? keeper.stateId,
      sectorType: keeper.sectorType,
      count: group.length,
      combinedRevenue,
      combinedWorkers,
      weightedMargin,
    });
  }

  console.log(
    `Scanned ${scopedSectors.length} sector row(s) ${corpSeqFilter ? `for corp #${corpSeqFilter}` : "across all corporations"} on live.`
  );
  console.log(`Mode: ${execute ? "EXECUTE" : "DRY-RUN"}`);
  console.log(`\n=== Country Normalizations (${normalizations.length}) ===`);
  if (normalizations.length === 0) {
    console.log("None.");
  } else {
    for (const item of normalizations) {
      console.log(
        `  #${item.corpSeq ?? "?"} ${item.corporationName}: ${item.stateName} (${item.stateId}) ${item.sectorType} ` +
          `${item.fromCountryId} -> ${item.toCountryId} [${item.sectorId.toString()}]`
      );
    }
  }

  console.log(`\n=== Duplicate Merges (${merges.length}) ===`);
  if (merges.length === 0) {
    console.log("None.");
  } else {
    for (const item of merges) {
      console.log(
        `  #${item.corpSeq ?? "?"} ${item.corporationName}: ${item.stateName} (${item.stateId}) ${item.sectorType} ` +
          `count=${item.count} revenue=${fmtNumber(item.combinedRevenue)} workers=${fmtNumber(item.combinedWorkers)} ` +
          `margin=${fmtMargin(item.weightedMargin)} keep=${item.keeperId.toString()} delete=${item.duplicateIds.map((id) => id.toString()).join(", ")}`
      );
    }
  }

  if (!execute) {
    console.log("\nDry-run complete. Re-run with --execute to apply.");
    await client.close();
    return;
  }

  if (normalizations.length === 0 && merges.length === 0) {
    console.log("\nNothing to heal.");
    await client.close();
    return;
  }

  const now = new Date();

  for (const item of normalizations) {
    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: item.sectorId },
      {
        $set: {
          countryId: item.toCountryId,
          updatedAt: now,
        },
      }
    );
  }

  for (const item of merges) {
    await db.collection<CorporateSector>("corporateSectors").updateOne(
      { _id: item.keeperId },
      {
        $set: {
          countryId: stateCountryByStateId.get(item.stateId),
          revenue: item.combinedRevenue,
          workers: item.combinedWorkers,
          profitMargin: item.weightedMargin,
          updatedAt: now,
        },
      }
    );
    await db.collection<CorporateSector>("corporateSectors").deleteMany({
      _id: { $in: item.duplicateIds },
    });
  }

  console.log(
    `\nApplied ${normalizations.length} normalization(s) and ${merges.length} merge group(s).`
  );
  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
