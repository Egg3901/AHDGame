/**
 * Regenerate `src/lib/demographics/compositionWeights.generated.ts` from the
 * seeded country models.
 *
 * The archetype→bucket weights live in each country's seed
 * (`CountryLayer1Model.composition`). That module also carries every region's
 * census marginals and per-era positions — ~460KB — so a client component that
 * only needs the weights cannot import it. This lifts out the weights alone
 * (~25KB) into a module with no seed dependency.
 *
 * The seed stays the single source of truth: `compositionWeights.test.ts`
 * regenerates this in memory and fails if the checked-in file differs, so the
 * copy cannot drift from the seed it came from.
 *
 *   npm run generate:composition
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCountryLayer1Model } from "../src/lib/seeds/international";
import type { EraId } from "../src/lib/seeds/presetSelector";

// Composition is era-stable by design (an archetype's defining demographics do
// not move between eras, only its politics do), so the first era a country is
// seeded for gives the whole table.
const PROBE_ERAS: EraId[] = ["2019", "modern", "1979", "1953"] as EraId[];

const COUNTRIES = [
  "UK",
  "DE",
  "JP",
  "IE",
  "BR",
  "CN",
  "RU",
  "SE",
  "FR",
  "IT",
  "AT",
  "DD",
  "ES",
  "FI",
  "GR",
  "NG",
  "TR",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BLR",
  "CS",
  "BAL",
];

/**
 * Countries with no Layer-1 model of their own that share another country's
 * archetype ids. Scotland and Wales use the UK's twelve voter groups; without
 * this they fall through to the US table, which no longer carries UK ids at all,
 * so every one of their archetype-keyed effects registers as an unmapped drop.
 */
const ALIASES: Record<string, string> = { SCO: "UK", WAL: "UK" };

export function buildCompositionWeights(): Record<
  string,
  Record<string, Array<{ dim: string; key: string; w: number }>>
> {
  const out: Record<string, Record<string, Array<{ dim: string; key: string; w: number }>>> = {};
  for (const cc of COUNTRIES) {
    for (const era of PROBE_ERAS) {
      let model;
      try {
        model = getCountryLayer1Model(cc, era);
      } catch {
        continue;
      }
      const composition = model?.composition;
      if (!composition) continue;
      const table: Record<string, Array<{ dim: string; key: string; w: number }>> = {};
      for (const [archetypeId, entry] of Object.entries(composition)) {
        if (entry?.weights?.length) {
          table[archetypeId] = entry.weights.map((w) => ({ dim: w.dim, key: w.key, w: w.w }));
        }
      }
      if (Object.keys(table).length > 0) {
        out[cc] = table;
        break;
      }
    }
  }
  for (const [alias, source] of Object.entries(ALIASES)) {
    if (out[source]) out[alias] = out[source];
  }
  return out;
}

const HEADER = `// GENERATED FILE — do not edit by hand.
// Regenerate with:  npm run generate:composition
//
// Archetype → Layer-1 bucket weights, lifted out of the country seeds so a
// client bundle can project archetype-keyed effects without pulling in ~460KB
// of census marginals. The seed remains the source of truth;
// compositionWeights.test.ts fails if this file drifts from it.

import type { ArchetypeBucketWeight } from "./archetypeBucketMap";

export const COMPOSITION_WEIGHTS: Record<string, Record<string, ArchetypeBucketWeight[]>> =
`;

function main() {
  const data = buildCompositionWeights();
  const body = JSON.stringify(data, null, 2);
  const target = resolve(__dirname, "../src/lib/demographics/compositionWeights.generated.ts");
  writeFileSync(target, `${HEADER}${body};\n`, "utf8");
  const archetypes = Object.values(data).reduce((s, c) => s + Object.keys(c).length, 0);
  console.log(`Wrote ${Object.keys(data).length} countries / ${archetypes} archetypes → ${target}`);
}

if (require.main === module) main();
