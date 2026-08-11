/**
 * Backfill default metricEffects on legislation type policy options.
 *
 * For each legislationType that has effectTargetsWeighted but whose policyOptions
 * lack metricEffects, this script computes sensible per-turn defaults from the
 * decay system and writes them to the DB.
 *
 * Admins can override the computed values via the admin UI — this script only
 * writes to options that have no metricEffects yet (safe to re-run).
 *
 * Formula:
 *   ratePerTurn = effectDirection × weight × MAX_EFFECT_PER_LAW
 *                 × (isHigherBetter ? 1 : −1) × DECAY_FACTOR
 *
 * where DECAY_FACTOR = 1 − exp(−1/139) ≈ 0.00718 (the decay constant used in
 * the policy engine), yielding the implied per-turn contribution of the target
 * displacement pushed by this policy option.
 *
 * Usage:
 *   npx tsx scripts/backfill-metric-effects.ts [--dry-run]
 */

import { connectDb, closeDb } from "./utils/db";
import type {
  LegislationType,
  LegislationPolicyOption,
  PolicyOptionMetricEffect,
} from "../src/lib/db/types";
import type { MetricCategoryId } from "../src/lib/db/types/stateMetrics";
import { getMetricDefinition } from "./seeds/metricDefinitions";
import { MAX_EFFECT_PER_LAW, getPolicyDecayFactor } from "../shared/constants/formulas";

const DECAY_FACTOR = getPolicyDecayFactor(); // ~0.00718

const isDryRun = process.argv.includes("--dry-run");

async function main() {
  const db = await connectDb();
  const col = db.collection<LegislationType>("legislationTypes");

  const legTypes = await col.find({}).toArray();

  let updated = 0;
  let skipped = 0;
  let noTargets = 0;

  for (const legType of legTypes) {
    if (!legType.effectTargetsWeighted?.length) {
      noTargets++;
      continue;
    }

    if (!legType.policyOptions?.length) {
      skipped++;
      continue;
    }

    // Check if any option is missing metricEffects
    const optionsNeedingDefaults = legType.policyOptions.filter(
      (opt: LegislationPolicyOption) => !opt.metricEffects?.length
    );

    if (optionsNeedingDefaults.length === 0) {
      skipped++;
      continue;
    }

    // Compute new metricEffects for each option that needs them
    const updatedOptions = legType.policyOptions.map((opt: LegislationPolicyOption) => {
      if (opt.metricEffects?.length) {
        // Already has admin-defined effects — do not overwrite
        return opt;
      }

      const effects: PolicyOptionMetricEffect[] = [];

      for (const target of legType.effectTargetsWeighted!) {
        const metricDef = getMetricDefinition(
          target.metricCategoryId as MetricCategoryId,
          target.metricId
        );
        const isHigherBetter = metricDef?.isHigherBetter ?? true;
        const effectSign = isHigherBetter ? 1 : -1;

        const ratePerTurn =
          opt.effectDirection * target.weight * MAX_EFFECT_PER_LAW * effectSign * DECAY_FACTOR;

        if (Math.abs(ratePerTurn) < 0.0001) continue; // Skip negligible effects

        effects.push({
          category: target.metricCategoryId as MetricCategoryId,
          metricId: target.metricId,
          ratePerTurn: Math.round(ratePerTurn * 10000) / 10000, // 4 decimal places
        });
      }

      return { ...opt, metricEffects: effects };
    });

    const hasChanges = updatedOptions.some((opt: LegislationPolicyOption, i: number) => {
      const original = legType.policyOptions![i];
      return !original.metricEffects?.length && opt.metricEffects?.length;
    });

    if (!hasChanges) {
      skipped++;
      continue;
    }

    console.log(`  ${legType._id}: "${legType.name}"`);
    for (const opt of updatedOptions) {
      const original = legType.policyOptions!.find(
        (o: LegislationPolicyOption) => o.id === opt.id
      )!;
      if (!original.metricEffects?.length && opt.metricEffects?.length) {
        console.log(`    [${opt.effectDirection > 0 ? "+" : opt.effectDirection}] ${opt.name}`);
        for (const e of opt.metricEffects) {
          const sign = e.ratePerTurn >= 0 ? "+" : "";
          console.log(`      ${e.category}.${e.metricId}: ${sign}${e.ratePerTurn.toFixed(4)}/turn`);
        }
      }
    }

    if (!isDryRun) {
      await col.updateOne({ _id: legType._id }, { $set: { policyOptions: updatedOptions } });
    }

    updated++;
  }

  console.log(`\nDone.${isDryRun ? " (DRY RUN — no changes written)" : ""}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Skipped (already has effects or no options): ${skipped}`);
  console.log(`  No effectTargetsWeighted: ${noTargets}`);

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
