/**
 * Codegen: per-region board TEXTURE for the playable countries.
 *
 * Regenerate with:
 *   npx tsx scripts/seeds/derive-playable-texture.ts --emit
 * Without --emit it prints a summary and writes nothing.
 *
 * Deterministic and offline. Reads only committed seed data.
 *
 * This script is COMMITTED on purpose. The equivalent non-playable generator
 * (scripts/debug/derive-nonplayable-boards.ts, named in nonPlayableBoards.ts's
 * header as the way to regenerate it) exists in no checkout, which leaves that
 * 40k-line committed file unreproducible. Do not repeat that.
 */
import { writeFileSync } from "fs";
import path from "path";
import { deriveCountryBoard } from "@/lib/politicalMetrics/derive/deriveFamilies";
import {
  countryLeanFromParties,
  type LeanPartySeed,
} from "@/lib/politicalMetrics/derive/countryLean";
import {
  playableRegionSeeds1953,
  type PlayableCountryId,
} from "@/lib/politicalMetrics/derive/playableLegacySeeds";
import { textureFromBoards } from "@/lib/politicalMetrics/derive/playableTexture";
import { REGIONAL_MODIFIERS_1953 } from "@/lib/politicalMetrics/seeds/regionalModifiers1953";
import type { PoliticalMetricId, PoliticalMetricsCountryId } from "@/lib/politicalMetrics/types";
import { politicalParties } from "@/lib/seeds/reference/politicalParties";
import { ukParties } from "@/lib/seeds/uk/ukParties";
import { ruParties } from "@/lib/seeds/ru/ruParties";
import { ddParties } from "@/lib/seeds/dd/ddParties";

const PRESET = "1953-default";
const YEAR = 1953;
const COUNTRIES: PlayableCountryId[] = ["US", "UK", "RU", "DD"];

const PARTIES: Record<PlayableCountryId, readonly LeanPartySeed[]> = {
  US: politicalParties as readonly LeanPartySeed[],
  UK: ukParties as readonly LeanPartySeed[],
  RU: ruParties as readonly LeanPartySeed[],
  DD: ddParties as readonly LeanPartySeed[],
};

function textureForCountry(countryId: PlayableCountryId): Record<string, Record<string, number>> {
  const seeds = playableRegionSeeds1953(countryId);
  const lean = countryLeanFromParties(PARTIES[countryId], PRESET);
  console.log(
    `   lean: ${lean ? `economic ${lean.economic.toFixed(2)}, social ${lean.social.toFixed(2)}` : "none (tier-3 families stay correlated)"}`
  );

  const boards: Record<string, Record<string, number>> = {};
  for (const seed of seeds) {
    const board = deriveCountryBoard({
      countryId,
      legacy: seed.legacy,
      macro: seed.macro,
      lean,
      year: YEAR,
    });
    const flat: Record<string, number> = {};
    for (const [family, derived] of Object.entries(board.values)) flat[family] = derived.value;
    boards[seed.regionId] = flat;
  }

  // Hand-authored modifiers win outright: they encode deliberate history
  // (Mississippi society.integration -18) that a category average would dilute.
  //
  // Passed as an EXCLUSION rather than deleted from the result, so the mean is
  // taken over the regions that actually receive texture. Deleting afterwards
  // removes a biased tail -- authored modifiers sit exactly where the region is
  // already extreme -- and shifted the US society.integration country mean by
  // 1.02 points.
  const authored = REGIONAL_MODIFIERS_1953[countryId as PoliticalMetricsCountryId] ?? {};
  let collisions = 0;
  const exclude = (regionId: string, family: string): boolean => {
    const hit = authored[regionId]?.[family as PoliticalMetricId] !== undefined;
    if (hit) collisions++;
    return hit;
  };

  const texture = textureFromBoards(boards, exclude);
  console.log(`   excluded ${collisions} pairs covered by a hand-authored modifier`);
  return texture;
}

function emit(all: Record<string, Record<string, Record<string, number>>>): string {
  const lines: string[] = [];
  lines.push("/**");
  lines.push(" * GENERATED - do not edit by hand.");
  lines.push(" *");
  lines.push(" * Regenerate with:");
  lines.push(" *   npx tsx scripts/seeds/derive-playable-texture.ts --emit");
  lines.push(" *");
  lines.push(" * Per-region DEVIATION from the country mean, per family, for the playable");
  lines.push(" * countries. The LEVEL still comes from NATIONAL_BASELINES_1953 via");
  lines.push(" * baselineFor(); this file only supplies the regional texture that the");
  lines.push(" * national-value-replicated-per-region seed was missing (ticket #1129).");
  lines.push(" *");
  lines.push(" * Deviations are mean-centred and scaled into +/-12, so applying them leaves");
  lines.push(" * every country mean where the authored baseline put it. Preservation is");
  lines.push(" * approximate, not exact - see playableTexture.ts on the noise floor.");
  lines.push(" *");
  lines.push(" * A (region, family) carrying a hand-authored REGIONAL_MODIFIERS_1953 entry is");
  lines.push(" * absent here: the authored value wins outright.");
  lines.push(" */");
  lines.push('import type { PoliticalMetricId } from "@/lib/politicalMetrics/types";');
  lines.push("");
  lines.push("export const REGIONAL_TEXTURE_1953: Record<");
  lines.push("  string,");
  lines.push("  Record<string, Partial<Record<PoliticalMetricId, number>>>");
  lines.push("> = {");
  for (const countryId of Object.keys(all).sort()) {
    lines.push(`  ${countryId}: {`);
    for (const regionId of Object.keys(all[countryId]).sort()) {
      lines.push(`    ${JSON.stringify(regionId)}: {`);
      for (const family of Object.keys(all[countryId][regionId]).sort()) {
        lines.push(
          `      ${JSON.stringify(family)}: ${all[countryId][regionId][family].toFixed(2)},`
        );
      }
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("};");
  lines.push("");
  return lines.join("\n");
}

const all: Record<string, Record<string, Record<string, number>>> = {};
for (const countryId of COUNTRIES) {
  console.log(`\n${countryId}:`);
  all[countryId] = textureForCountry(countryId);
  const regions = Object.keys(all[countryId]).length;
  const entries = Object.values(all[countryId]).reduce((n, f) => n + Object.keys(f).length, 0);
  const families = new Set(Object.values(all[countryId]).flatMap((f) => Object.keys(f)));
  console.log(
    `   ${regions} regions textured, ${entries} (region,family) entries, ${families.size} distinct families`
  );
}

if (process.argv.includes("--emit")) {
  const target = path.resolve(
    process.cwd(),
    "src/lib/politicalMetrics/seeds/regionalTexture1953.ts"
  );
  writeFileSync(target, emit(all), "utf8");
  console.log(`\nwrote ${target}`);
} else {
  console.log("\nDry run. Pass --emit to write the file.");
}
