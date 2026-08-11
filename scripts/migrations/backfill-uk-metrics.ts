/**
 * One-time backfill for UK state metrics that never got seeded.
 *
 * Background:
 *   educationSpending, powerGridReliability, violentCrimeRate, and
 *   testPerformance were added to `src/lib/seeds/uk/ukStateMetrics.ts` after
 *   the UK regions had already been seeded. The seed isn't idempotent for new
 *   metric fields, so existing UK regions kept their fall-through default of
 *   `value: 100`. The metric system has no per-turn recalculator for these
 *   four metrics, so they stayed flat at 100 indefinitely — visible in the
 *   per-region detail page as "$100" with a flat 96-turn history line.
 *
 * What this does:
 *   - Reads `ukStateMetrics` from the seed.
 *   - For each UK region, sets the four target fields ONLY when the DB value
 *     is exactly 100 AND the seed value differs (i.e. the placeholder has not
 *     been touched). Skips fields where the DB value already differs from 100
 *     to preserve any organic turn drift.
 *   - Recomputes the UK national aggregate (`uk_national`) so the country
 *     dashboard reflects the fix immediately rather than waiting for the next
 *     turn.
 *
 * Usage:
 *   npx tsx scripts/migrations/backfill-uk-metrics.ts            # write
 *   npx tsx scripts/migrations/backfill-uk-metrics.ts --dry-run  # preview
 */

import { connectDb, closeDb } from "../utils/db";
import { ukStateMetrics } from "../../src/lib/seeds/uk/ukStateMetrics";
import { computeNationalMetrics } from "../../src/lib/nationalMetrics";
import type { StateMetrics } from "../../src/lib/db/types";

type MetricPath = `${string}.${string}`;

const TARGET_PATHS: MetricPath[] = [
  "education.educationSpending",
  "education.testPerformance",
  "infrastructure.powerGridReliability",
  "publicSafety.violentCrimeRate",
];

const PLACEHOLDER_VALUE = 100;
const isDryRun = process.argv.includes("--dry-run");

interface MetricCell {
  value?: number;
}

function readPath(doc: Record<string, unknown>, path: MetricPath): number | undefined {
  const [cat, key] = path.split(".") as [string, string];
  const group = doc[cat] as Record<string, MetricCell> | undefined;
  return group?.[key]?.value;
}

function readSeedPath(seed: Record<string, unknown>, path: MetricPath): number | undefined {
  const [cat, key] = path.split(".") as [string, string];
  const group = seed[cat] as Record<string, { value?: number }> | undefined;
  return group?.[key]?.value;
}

async function main() {
  const db = await connectDb();
  console.log(
    `\nBackfilling ${TARGET_PATHS.length} UK metric fields across ${ukStateMetrics.length} regions${isDryRun ? " (dry run)" : ""}.\n`
  );

  const updates = new Map<string, Record<string, { value: number }>>();
  let totalFieldUpdates = 0;
  let skippedAlreadyCorrect = 0;
  let skippedDrifted = 0;
  let skippedSeedAlsoPlaceholder = 0;

  for (const seedDoc of ukStateMetrics) {
    const stateId = seedDoc._id;
    const dbDoc = (await db
      .collection<StateMetrics>("stateMetrics")
      .findOne({ _id: stateId })) as Record<string, unknown> | null;
    if (!dbDoc) {
      console.log(`  ${stateId}: no stateMetrics doc (skipping region)`);
      continue;
    }

    const setOps: Record<string, { value: number }> = {};
    for (const path of TARGET_PATHS) {
      const seedVal = readSeedPath(seedDoc as unknown as Record<string, unknown>, path);
      const dbVal = readPath(dbDoc, path);

      if (typeof seedVal !== "number") continue;
      if (seedVal === PLACEHOLDER_VALUE) {
        // Seed itself is 100 (e.g. some regions have testPerformance: 100).
        // Leave the DB alone — it's already correct or organically drifted.
        skippedSeedAlsoPlaceholder++;
        continue;
      }
      if (dbVal === seedVal) {
        skippedAlreadyCorrect++;
        continue;
      }
      if (dbVal !== PLACEHOLDER_VALUE) {
        // DB has a non-placeholder value that differs from seed — that's
        // organic turn drift or a manual edit. Don't clobber.
        skippedDrifted++;
        continue;
      }

      setOps[`${path}.value`] = { value: seedVal };
      totalFieldUpdates++;
      console.log(`  ${stateId}.${path}: ${dbVal} → ${seedVal}`);
    }

    if (Object.keys(setOps).length > 0) {
      updates.set(stateId, setOps);
    }
  }

  console.log(`\nSummary: ${totalFieldUpdates} field updates across ${updates.size} regions.`);
  console.log(`  Skipped (already correct):              ${skippedAlreadyCorrect}`);
  console.log(`  Skipped (drifted, preserving):          ${skippedDrifted}`);
  console.log(`  Skipped (seed value is also 100):       ${skippedSeedAlsoPlaceholder}`);

  if (isDryRun) {
    console.log("\nDry run — no writes performed.");
    await closeDb();
    return;
  }

  if (updates.size === 0) {
    console.log("\nNothing to update. Exiting.");
    await closeDb();
    return;
  }

  const ops = Array.from(updates.entries()).map(([stateId, setOps]) => ({
    updateOne: {
      filter: { _id: stateId },
      update: {
        $set: {
          ...Object.fromEntries(
            Object.entries(setOps).map(([k, v]) => [k.replace(/\.value$/, ""), v])
          ),
          lastUpdated: new Date(),
        },
      },
    },
  }));

  const result = await db.collection("stateMetrics").bulkWrite(ops as never);
  console.log(
    `\nWrote ${result.modifiedCount} regional updates. Recomputing UK national aggregate…`
  );

  await computeNationalMetrics(db);
  console.log("Recomputed national aggregates (uk_national, federal, etc.).");

  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
