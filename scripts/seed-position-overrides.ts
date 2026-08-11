/**
 * Promotes the in-code Layer-1 demographic positions/turnout/composition into
 * the `demographicConfigOverrides` MongoDB collection so they become live-editable
 * via the admin Position Editor without requiring a code deploy.
 *
 * Covers every country + era pair for which a Layer-1 model exists:
 *   US  — all 6 eras (positions from DEMOGRAPHIC_POSITIONS, composition/turnout
 *          from ERA_COMPOSITIONS)
 *   International (UK, DE, JP, BR, CN, NG, FR, SE, IT, ES, TR, SU, DD, HU, PL,
 *          RO, YU, BG, BY, CS, BAL, IE) — whichever eras getCountryLayer1Model returns
 *          a non-null model for.
 *
 * Usage:
 *   npx tsx scripts/seed-position-overrides.ts            # dry-run (no writes)
 *   npx tsx scripts/seed-position-overrides.ts --apply    # write to DB
 */

import { getEraPositions, getEraComposition } from "../src/lib/seeds/demographicCategories";
import { getCountryLayer1Model } from "../src/lib/seeds/international/index";
import type { EraId } from "../src/lib/seeds/presetSelector";
import type { DemographicConfigOverride } from "../src/lib/db/types/demographicConfigOverride";
import { connectDb, closeDb } from "./utils/db";

const ERAS: EraId[] = ["1979", "1991", "1999", "2007", "2019", "2023"];

const INTERNATIONAL_COUNTRIES = [
  "UK",
  "DE",
  "JP",
  "BR",
  "CN",
  "NG",
  "FR",
  "SE",
  "IT",
  "ES",
  "TR",
  "RU",
  "DD",
  "HU",
  "PL",
  "RO",
  "YU",
  "BG",
  "BY",
  "CS",
  "BAL",
  "IE",
];

const apply = process.argv.includes("--apply");

function countPositionKeys(positions: Record<string, Record<string, unknown>>): {
  dims: number;
  keys: number;
} {
  let keys = 0;
  for (const dim of Object.values(positions)) keys += Object.keys(dim).length;
  return { dims: Object.keys(positions).length, keys };
}

/** Turn a nested Record<dim, Record<key, rate>> into a plain object (strips type wrappers). */
function flattenTurnout(
  turnoutRates: Record<string, Record<string, number>>
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [dim, keys] of Object.entries(turnoutRates)) {
    out[dim] = { ...keys };
  }
  return out;
}

async function main() {
  console.log(
    `\nLayer-1 position override seeder — mode: ${apply ? "APPLY (writes to DB)" : "DRY RUN (no writes)"}\n`
  );

  const db = await connectDb();
  const col = db.collection<DemographicConfigOverride>("demographicConfigOverrides");

  let upserted = 0;
  let skipped = 0;

  // ── US ──────────────────────────────────────────────────────────────────────
  console.log("── US ─────────────────────────────────────────────────────────");
  for (const era of ERAS) {
    const positions = getEraPositions(era) as Record<
      string,
      Record<string, { economicLean: number; socialLean: number }>
    >;
    const comp = getEraComposition(era);

    const turnout = flattenTurnout(
      comp.turnoutRates as unknown as Record<string, Record<string, number>>
    );

    const composition: DemographicConfigOverride["composition"] = {};
    for (const [archetypeId, entry] of Object.entries(comp.voterGroupComposition)) {
      composition[archetypeId] = {
        weights: entry.weights.map((w) => ({ dim: w.dim as string, key: w.key, w: w.w })),
        civicMultiplier: entry.civicMultiplier ?? 1,
      };
    }

    const { dims, keys } = countPositionKeys(positions);
    const id = `US:${era}`;

    const existing = await col.findOne(
      { _id: id },
      { projection: { _id: 1, updatedBy: 1, updatedAt: 1 } }
    );
    const verb = existing ? "update" : "create";

    console.log(`  ${id.padEnd(10)} ${dims} dims, ${keys} position keys  [${verb}]`);

    if (apply) {
      const doc: DemographicConfigOverride = {
        _id: id,
        countryId: "US",
        era,
        positions,
        turnout,
        composition,
        updatedAt: new Date(),
        updatedBy: "seed-position-overrides",
      };
      await col.updateOne({ _id: id }, { $set: doc }, { upsert: true });
      upserted++;
    } else {
      upserted++;
    }
  }

  // ── International ────────────────────────────────────────────────────────────
  console.log("\n── International ───────────────────────────────────────────────");
  for (const countryId of INTERNATIONAL_COUNTRIES) {
    for (const era of ERAS) {
      const model = getCountryLayer1Model(countryId, era);
      if (!model) {
        skipped++;
        continue;
      }

      const positions: DemographicConfigOverride["positions"] = {};
      for (const [dim, keys] of Object.entries(model.positions)) {
        positions[dim] = {};
        for (const [key, pos] of Object.entries(keys)) {
          positions[dim][key] = { economicLean: pos.economicLean, socialLean: pos.socialLean };
        }
      }

      const turnout = flattenTurnout(model.turnoutRates);

      const composition: DemographicConfigOverride["composition"] = {};
      for (const [archetypeId, entry] of Object.entries(model.composition)) {
        composition[archetypeId] = {
          weights: entry.weights.map((w) => ({ dim: w.dim, key: w.key, w: w.w })),
          civicMultiplier: entry.civicMultiplier ?? 1,
        };
      }

      const { keys: keyCount } = countPositionKeys(positions);
      const id = `${countryId}:${era}`;

      const existing = await col.findOne({ _id: id }, { projection: { _id: 1 } });
      const verb = existing ? "update" : "create";

      console.log(
        `  ${id.padEnd(10)} ${model.dims.length} dims, ${keyCount} position keys  [${verb}]`
      );

      if (apply) {
        const doc: DemographicConfigOverride = {
          _id: id,
          countryId,
          era,
          positions,
          turnout,
          composition,
          updatedAt: new Date(),
          updatedBy: "seed-position-overrides",
        };
        await col.updateOne({ _id: id }, { $set: doc }, { upsert: true });
        upserted++;
      } else {
        upserted++;
      }
    }
  }

  console.log(`\n── Summary ─────────────────────────────────────────────────────`);
  console.log(`  Would ${apply ? "upserted" : "upsert"}: ${upserted}`);
  console.log(`  Skipped (no model for era): ${skipped}`);
  if (!apply) {
    console.log(`\n  Re-run with --apply to write to DB.`);
  }

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
