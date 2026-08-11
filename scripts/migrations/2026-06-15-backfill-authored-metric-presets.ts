/**
 * One-time migration: backfill the HAND-AUTHORED 2019 metric presets onto live worlds.
 *
 * The 2026-06-15 metric-preset work replaced the formula-derived (`uniformMetricDefault`)
 * values for the new overhaul ROOT metrics with per-region, per-era HAND-AUTHORED values
 * (see src/lib/seeds/<cc>/<cc>MetricPresets.ts + src/lib/seeds/reference/usMetricPresets.ts).
 * Fresh seeds/resets pick these up automatically; existing live 2019 worlds still carry the
 * old formula-derived values until backfilled.
 *
 * This overlays `getRegionMetricPresets(countryId, regionId, "2019-default")` onto each live
 * `stateMetrics` doc (preserving any `trend`) and the matching `stateBaselines` decay target,
 * for every country with an authored bundle (IE, DE, JP, BR, CN, UK, US). Only cells that
 * actually differ are touched.
 *
 * HELD — dry-run first; needs explicit go-ahead before running against production.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-06-15-backfill-authored-metric-presets.ts --dry-run
 *   npx tsx scripts/migrations/2026-06-15-backfill-authored-metric-presets.ts
 */

import { closeDb, connectDb } from "../utils/db";
import type { CountryId } from "../../src/lib/constants/countries";
import { getRegionMetricPresets } from "../../src/lib/seeds/metricPresets";

const isDryRun = process.argv.includes("--dry-run");

const PRESET = "2019-default";
const EPSILON = 1e-9;

type MetricDoc = {
  _id: string;
  countryId?: CountryId;
  [category: string]: unknown;
};

type BaselineDoc = {
  _id: string;
  countryId?: CountryId;
  baselines?: Record<string, Record<string, number>>;
};

function readMetricValue(doc: MetricDoc, path: string): number | undefined {
  const [category, metricId] = path.split(".");
  const cat = doc[category] as Record<string, { value?: number }> | undefined;
  const v = cat?.[metricId]?.value;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

async function main() {
  const db = await connectDb();
  const mode = isDryRun ? "DRY-RUN" : "APPLY";
  console.log(`\n[backfill-authored-metric-presets] mode=${mode} preset=${PRESET}\n`);

  const metricsCol = db.collection<MetricDoc>("stateMetrics");
  const baselinesCol = db.collection<BaselineDoc>("stateBaselines");

  const allMetrics = await metricsCol.find({}).toArray();
  const baselineById = new Map<string, BaselineDoc>();
  for (const b of await baselinesCol.find({}).toArray()) baselineById.set(String(b._id), b);

  const perCountryMetricCells: Record<string, number> = {};
  const perCountryBaselineCells: Record<string, number> = {};
  let metricsDocsTouched = 0;
  let baselineDocsTouched = 0;
  let regionsWithoutBundle = 0;

  for (const doc of allMetrics) {
    const country = doc.countryId;
    const region = String(doc._id);
    if (!country) continue;
    const overlay = getRegionMetricPresets(country, region, PRESET);
    if (!overlay) {
      regionsWithoutBundle++;
      continue;
    }

    // ── stateMetrics ────────────────────────────────────────────────────────
    const metricSet: Record<string, number> = {};
    for (const [path, target] of Object.entries(overlay)) {
      const current = readMetricValue(doc, path);
      if (current === undefined || Math.abs(current - target) > EPSILON) {
        metricSet[`${path}.value`] = target;
      }
    }
    const metricCells = Object.keys(metricSet).length;
    if (metricCells > 0) {
      metricsDocsTouched++;
      perCountryMetricCells[country] = (perCountryMetricCells[country] ?? 0) + metricCells;
      if (!isDryRun) {
        await metricsCol.updateOne({ _id: doc._id }, { $set: metricSet });
      }
    }

    // ── stateBaselines (decay targets) ──────────────────────────────────────
    const baseline = baselineById.get(region);
    if (baseline?.baselines) {
      const baselineSet: Record<string, number> = {};
      for (const [path, target] of Object.entries(overlay)) {
        const [cat, id] = path.split(".");
        const current = baseline.baselines[cat]?.[id];
        if (typeof current !== "number" || Math.abs(current - target) > EPSILON) {
          baselineSet[`baselines.${cat}.${id}`] = target;
        }
      }
      const baselineCells = Object.keys(baselineSet).length;
      if (baselineCells > 0) {
        baselineDocsTouched++;
        perCountryBaselineCells[country] = (perCountryBaselineCells[country] ?? 0) + baselineCells;
        if (!isDryRun) {
          await baselinesCol.updateOne({ _id: baseline._id }, { $set: baselineSet });
        }
      }
    }
  }

  console.log("Per-country authored-cell changes:");
  const countries = [
    ...new Set([...Object.keys(perCountryMetricCells), ...Object.keys(perCountryBaselineCells)]),
  ].sort();
  for (const c of countries) {
    console.log(
      `  ${c}: metrics ${perCountryMetricCells[c] ?? 0} cells, baselines ${perCountryBaselineCells[c] ?? 0} cells`
    );
  }
  console.log(
    `\nstateMetrics docs touched: ${metricsDocsTouched}` +
      `\nstateBaselines docs touched: ${baselineDocsTouched}` +
      `\nregions with no authored bundle (skipped): ${regionsWithoutBundle}`
  );
  console.log(
    isDryRun
      ? "\nDRY-RUN — no writes performed. Re-run without --dry-run to apply.\n"
      : "\nAPPLIED.\n"
  );

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
