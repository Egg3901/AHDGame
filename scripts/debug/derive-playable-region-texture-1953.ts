/**
 * Offline codegen for the playable-region 1953 texture (issue #704).
 *
 * Derives per-region deviations from the authoritative legacy regional seeds
 * (see src/lib/politicalMetrics/derive/playableTexture.ts for the pipeline)
 * and either prints a review report (default) or writes the committed data
 * file (with --emit). The committed output is the reviewable artifact the
 * seed path reads; this script is what makes it reproducible.
 *
 * Run: npx tsx scripts/debug/derive-playable-region-texture-1953.ts [--emit]
 */
import { writeFileSync } from "node:fs";
import {
  derivePlayableTexture1953,
  PLAYABLE_TEXTURE_BOUND,
  PLAYABLE_TEXTURE_PRESET,
  PLAYABLE_TEXTURE_YEAR,
  type PlayableTexture,
} from "@/lib/politicalMetrics/derive/playableTexture";

const EMIT = process.argv.includes("--emit");
const OUT_PATH = "src/lib/politicalMetrics/seeds/regionalTexture1953.ts";

function serialize(texture: PlayableTexture): string {
  const lines: string[] = [
    "/**",
    " * GENERATED - do not edit by hand.",
    " *",
    " * Regenerate with:",
    " *   npx tsx scripts/debug/derive-playable-region-texture-1953.ts --emit",
    " *",
    " * Per-region TEXTURE for the 1953 playable-country boards (US/UK/RU/DD),",
    " * issue #704. Each entry is a region's deviation from its",
    " * population-weighted country mean for one family, derived from the",
    " * authoritative legacy regional seeds (same construction the metric",
    " * seeders apply: base bundle + era adjustments + 1953 metric-preset",
    " * overlay, scored against 1953 bands with the 1953-gated roster lean).",
    " *",
    " * The seeder adds this on top of the authored NATIONAL_BASELINES_1953",
    " * level, so the national level is preserved exactly (the deviations sum",
    " * to a zero population-weighted mean per country per family) while every",
    " * region opens with its own character. Deviations are proportionally",
    " * scaled to +/-12 per family, never clamped, so scaling cannot shift the",
    " * mean. Entries where REGIONAL_MODIFIERS_1953 has a hand-authored value",
    " * are zero here: deliberate history wins outright and the seeder applies",
    " * the modifier instead.",
    " *",
    " * Defense families are absent: defense posture is national by nature (the",
    " * tier-4 table has no playable rows and legacy seeds carry no defense",
    " * layer), so every region's deviation is 0 and there is nothing to emit.",
    " *",
    " * SCOPE: 1953-default only. The playable anchor table carries a single",
    " * 1953 anchor; the seeder ignores this table for every other preset.",
    " */",
    'import type { PoliticalMetricId, PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";',
    "",
    "export const REGIONAL_TEXTURE_1953: Record<",
    "  PoliticalMetricsCountryId,",
    "  Record<string, Partial<Record<PoliticalMetricId, number>>>",
    "> = {",
  ];
  for (const countryId of ["US", "UK", "RU", "DD"] as const) {
    lines.push(`  ${countryId}: {`);
    for (const regionId of Object.keys(texture[countryId]).sort()) {
      const entries = Object.entries(texture[countryId][regionId])
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([fid, v]) => `"${fid}": ${v}`);
      if (entries.length === 0) {
        lines.push(`    ${regionId}: {},`);
      } else {
        lines.push(`    ${regionId}: { ${entries.join(", ")} },`);
      }
    }
    lines.push("  },");
  }
  lines.push("};", "");
  return lines.join("\n");
}

function main(): void {
  const { texture, diagnostics } = derivePlayableTexture1953();

  console.log(
    `preset ${PLAYABLE_TEXTURE_PRESET}, year ${PLAYABLE_TEXTURE_YEAR}, bound +/-${PLAYABLE_TEXTURE_BOUND}`
  );
  console.log("cc     regions  varying  unauthored  scaled  textured-regions");
  let totalEntries = 0;
  for (const d of diagnostics) {
    const scaled = d.families.filter((f) => f.scale < 1).length;
    const entries = Object.values(texture[d.countryId]).reduce(
      (n, r) => n + Object.keys(r).length,
      0
    );
    totalEntries += entries;
    console.log(
      `${d.countryId.padEnd(6)} ${String(d.regions).padStart(7)}  ${String(d.varyingFamilies).padStart(7)}  ` +
        `${String(d.unauthored.length).padStart(10)}  ${String(scaled).padStart(6)}  ${entries}`
    );
    console.log(`  lean=${JSON.stringify(d.lean)} unauthored=[${d.unauthored.join(",")}]`);
    for (const f of d.families.filter((f) => f.scale < 1 || f.modifierZeroed > 0)) {
      console.log(
        `  ${f.familyId}: rawMaxAbs=${f.rawMaxAbs} scale=${f.scale} modifierZeroed=${f.modifierZeroed} regions=${f.regionsTextured}`
      );
    }
  }
  console.log(`total texture entries: ${totalEntries}`);

  if (EMIT) {
    writeFileSync(OUT_PATH, serialize(texture));
    console.log(`wrote ${OUT_PATH}`);
  }
}

main();
