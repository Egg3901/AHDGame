/**
 * Ticket #1129 balance report: per-region board texture for playable countries.
 *
 * Answers the two questions a balance reviewer asks:
 *   1. Does the country mean move? (It must not - the texture is mean-centred,
 *      so this change adds regional VARIATION without re-levelling any country.)
 *   2. How much regional spread does it actually create, per family?
 *
 * Read-only, deterministic, no database.
 * Run: npx tsx scripts/sim/ticket1129RegionTexture.ts
 */
import { REGIONAL_TEXTURE_1953 } from "@/lib/politicalMetrics/seeds/regionalTexture1953";
import { REGIONAL_MODIFIERS_1953 } from "@/lib/politicalMetrics/seeds/regionalModifiers1953";
import { NATIONAL_BASELINES_1953 } from "@/lib/politicalMetrics/seeds/nationalBaselines1953";
import {
  playableRegionSeeds1953,
  type PlayableCountryId,
} from "@/lib/politicalMetrics/derive/playableLegacySeeds";
import { TEXTURE_CAP } from "@/lib/politicalMetrics/derive/playableTexture";
import type { PoliticalMetricId, PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";

const clampScore = (v: number) => Math.max(0, Math.min(100, v));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const spread = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

/** A country mean moving more than this is a re-levelling, not texture. */
const MEAN_MOVE_TOLERANCE = 0.75;

const COUNTRIES: PlayableCountryId[] = ["US", "UK", "RU", "DD"];

console.log("Ticket #1129 - per-region board texture, balance report");
console.log(`cap +/-${TEXTURE_CAP} points, applied by proportional scaling\n`);

let totalOffenders = 0;

for (const countryId of COUNTRIES) {
  const regions = playableRegionSeeds1953(countryId).map((s) => s.regionId);
  const families = Object.keys(
    NATIONAL_BASELINES_1953[countryId as PoliticalMetricsCountryId]
  ) as PoliticalMetricId[];

  const rows: Array<{ family: string; before: number; after: number; meanMove: number }> = [];

  for (const family of families) {
    const authored = NATIONAL_BASELINES_1953[countryId as PoliticalMetricsCountryId][family].value;
    const before: number[] = [];
    const after: number[] = [];
    for (const regionId of regions) {
      const modifier =
        REGIONAL_MODIFIERS_1953[countryId as PoliticalMetricsCountryId]?.[regionId]?.[family];
      const texture = (
        REGIONAL_TEXTURE_1953 as Record<string, Record<string, Record<string, number>>>
      )[countryId]?.[regionId]?.[family];
      before.push(clampScore(authored + (modifier ?? 0)));
      after.push(clampScore(authored + (modifier ?? texture ?? 0)));
    }
    rows.push({
      family,
      before: spread(before),
      after: spread(after),
      meanMove: Math.abs(mean(after) - mean(before)),
    });
  }

  const gained = rows.filter((r) => r.after > r.before + 0.5);
  const offenders = rows.filter((r) => r.meanMove > MEAN_MOVE_TOLERANCE);
  totalOffenders += offenders.length;
  const flatBefore = rows.filter((r) => r.before === 0).length;
  const flatAfter = rows.filter((r) => r.after === 0).length;

  console.log(`=== ${countryId} (${regions.length} regions, ${families.length} families) ===`);
  console.log(`  families with NO regional spread:  ${flatBefore} -> ${flatAfter}`);
  console.log(`  families gaining spread:           ${gained.length}`);
  console.log(
    `  country means moved > ${MEAN_MOVE_TOLERANCE}pt:        ${offenders.length}  (target 0)`
  );
  if (offenders.length > 0) {
    for (const o of offenders) {
      console.log(`     OFFENDER ${o.family} moved ${o.meanMove.toFixed(3)}pt`);
    }
  }
  console.log(
    `  largest mean move:                 ${Math.max(...rows.map((r) => r.meanMove)).toFixed(3)}pt`
  );

  console.log("  largest spread gains:");
  for (const r of [...rows].sort((a, b) => b.after - b.before - (a.after - a.before)).slice(0, 8)) {
    console.log(
      `    ${r.family.padEnd(30)} ${r.before.toFixed(1).padStart(6)} -> ${r.after.toFixed(1).padStart(6)}`
    );
  }

  // The families the ticket is actually about.
  const ag = rows.filter((r) => r.family.startsWith("order."));
  console.log("  Attorney General portfolio (order.*):");
  for (const r of ag) {
    console.log(
      `    ${r.family.padEnd(30)} ${r.before.toFixed(1).padStart(6)} -> ${r.after.toFixed(1).padStart(6)}`
    );
  }
  console.log("");
}

console.log(
  totalOffenders === 0
    ? "PASS - no country mean moved beyond tolerance; this adds variation, not re-levelling."
    : `FAIL - ${totalOffenders} families re-levelled their country. Investigate before merging.`
);
