/**
 * One-time migration: backfill the uniform state metric set added by the May
 * 2026 Hermes metrics pass.
 *
 * Adds missing stateMetrics cells from seed/default values and stamps matching
 * stateBaselines entries so policy decay does not immediately pull new values
 * toward generic fallback baselines.
 *
 * Usage:
 *   npx tsx scripts/migrations/add-missing-metrics-2026-05.ts --dry-run
 *   npx tsx scripts/migrations/add-missing-metrics-2026-05.ts
 */

import { closeDb, connectDb } from "../utils/db";
import type { StateMetrics } from "../../src/lib/db/types";
import type { StateMetricBaseline } from "../../src/lib/db/types/statePolicy";
import { stateMetrics as usStateMetrics } from "../../src/lib/seeds/reference/stateMetrics";
import { ukStateMetrics } from "../../src/lib/seeds/uk/ukStateMetrics";
import { jpStateMetrics } from "../../src/lib/seeds/jp/jpStateMetrics";
import { deStateMetrics } from "../../src/lib/seeds/de/deStateMetrics";
import { ieStateMetrics } from "../../src/lib/seeds/ie/ieStateMetrics";
import { brStateMetrics } from "../../src/lib/seeds/br/brStateMetrics";
import { cnStateMetrics } from "../../src/lib/seeds/cn/cnStateMetrics";
import { computeNationalMetrics } from "../../src/lib/nationalMetrics";
import {
  UNIFORM_METRIC_PATHS,
  uniformMetricDefault,
  withUniformMetricSet,
  type UniformMetricPath,
} from "../../src/lib/seeds/shared/uniformStateMetrics";

type MetricPath = UniformMetricPath;

const TARGET_PATHS: readonly MetricPath[] = UNIFORM_METRIC_PATHS;

const isDryRun = process.argv.includes("--dry-run");

const seedByStateId = new Map<string, StateMetrics>();
for (const seed of [
  ...usStateMetrics,
  ...ukStateMetrics,
  ...jpStateMetrics,
  ...deStateMetrics,
  ...ieStateMetrics,
  ...brStateMetrics,
  ...cnStateMetrics,
]) {
  seedByStateId.set(seed._id, seed);
}

function readMetricValue(doc: Record<string, unknown>, path: MetricPath): number | undefined {
  const [category, metricId] = path.split(".") as [string, string];
  const categoryDoc = doc[category] as Record<string, { value?: number }> | undefined;
  const value = categoryDoc?.[metricId]?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function resolveBackfillValue(
  currentDoc: StateMetrics,
  seedDoc: StateMetrics | undefined,
  path: MetricPath
): number {
  const currentValue = readMetricValue(currentDoc as unknown as Record<string, unknown>, path);
  if (currentValue !== undefined) return currentValue;

  const sourceDoc = seedDoc ?? withUniformMetricSet(currentDoc);
  return (
    readMetricValue(sourceDoc as unknown as Record<string, unknown>, path) ??
    uniformMetricDefault(sourceDoc, path)
  );
}

function readBaselineValue(
  doc: StateMetricBaseline | null | undefined,
  path: MetricPath
): number | undefined {
  const [category, metricId] = path.split(".") as [string, string];
  const value = doc?.baselines?.[category]?.[metricId];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function main() {
  const db = await connectDb();
  const metricsDocs = await db.collection<StateMetrics>("stateMetrics").find({}).toArray();
  const baselineDocs = await db
    .collection<StateMetricBaseline>("stateBaselines")
    .find({})
    .toArray();
  const baselineByStateId = new Map(baselineDocs.map((doc) => [String(doc._id), doc]));

  const metricOps = [];
  const baselineOps = [];
  let metricFieldsAdded = 0;
  let baselineFieldsAdded = 0;

  for (const doc of metricsDocs) {
    const stateId = String(doc._id);
    const seed = seedByStateId.get(stateId);

    const metricSet: Record<string, number | Date> = {};
    const baselineSet: Record<string, number> = {};
    const baselineDoc = baselineByStateId.get(stateId);

    for (const path of TARGET_PATHS) {
      const backfillValue = resolveBackfillValue(doc, seed, path);

      if (readMetricValue(doc as unknown as Record<string, unknown>, path) === undefined) {
        metricSet[`${path}.value`] = backfillValue;
        metricFieldsAdded++;
      }

      if (readBaselineValue(baselineDoc, path) === undefined) {
        baselineSet[`baselines.${path}`] = backfillValue;
        baselineFieldsAdded++;
      }
    }

    if (Object.keys(metricSet).length > 0) {
      metricOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { ...metricSet, lastUpdated: new Date() } },
        },
      });
    }

    if (Object.keys(baselineSet).length > 0) {
      baselineOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: baselineSet },
          upsert: true,
        },
      });
    }
  }

  console.log(
    `Prepared ${metricFieldsAdded} stateMetrics fields and ${baselineFieldsAdded} baseline fields across ${metricsDocs.length} docs.`
  );

  if (!isDryRun) {
    if (metricOps.length > 0)
      await db.collection<StateMetrics>("stateMetrics").bulkWrite(metricOps);
    if (baselineOps.length > 0) {
      await db.collection<StateMetricBaseline>("stateBaselines").bulkWrite(baselineOps);
    }
    await computeNationalMetrics(db);
    console.log("Backfill complete and national metrics recomputed.");
  } else {
    console.log("Dry run only. No writes performed.");
  }

  await closeDb();
}

main().catch(async (error) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
