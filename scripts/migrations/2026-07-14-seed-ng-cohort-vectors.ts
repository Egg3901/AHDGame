/**
 * Seed the `regionDemographics` age×sex cohort vector for Nigeria's regions on an
 * EXISTING live world that was seeded before NG had a "1991-default" census bundle.
 *
 * Context (#0962 gap audit): NG has 0 regionDemographics docs, so the demographic turn
 * phase skips NG entirely and its demographic-derived metrics (dependencyRatio, sexRatio,
 * realizedMigrationRate, populationGrowth) never compute. Root cause: the NG CENSUS_BUNDLES
 * entry lacked "1991-default" (now added, aliased to the 1979 census), so seedCohortVectors
 * found no census for NG in this 1991 world and skipped it.
 *
 * This backfills ONLY NG regions that currently lack a cohort vector — it does NOT touch any
 * other country's (already-evolved) vectors. Uses the same SSOT synthesis the turn engine and
 * fresh resets use, so the seeded stock is byte-identical to a fresh NG seed.
 *
 * Guarded:
 *   - DRY RUN by default; `--apply` to write. `--live` targets MONGODB_URI_LIVE.
 *   - `--preset=<id>` overrides (else read from gameState, else "1991-default").
 *   - Idempotent: skips NG regions that already have a regionDemographics doc.
 *
 * Usage:
 *   npx tsx scripts/migrations/2026-07-14-seed-ng-cohort-vectors.ts --live           # dry-run
 *   npx tsx scripts/migrations/2026-07-14-seed-ng-cohort-vectors.ts --live --apply   # write
 */
import { MongoClient } from "mongodb";
import * as dotenv from "dotenv";
import * as path from "path";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { synthesizeAgeSexVector } from "@/lib/demographics/seedSynthesis";
import { sexRatioFromVector, dependencyRatio } from "@/lib/demographics/cohortVector";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import type { StateMetrics } from "@/lib/db/types";

// Region collections are keyed by string _id (region code), not ObjectId.
interface StateDoc {
  _id: string;
  countryId: string;
  population?: number;
}
interface MetricsDoc {
  _id: string;
  population?: {
    medianAge?: { value?: number };
    birthRate?: { value?: number };
    migrationRate?: { value?: number };
  };
}

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const useLive = argv.includes("--live");
const presetArg = argv.find((a) => a.startsWith("--preset="))?.split("=")[1];

const uri = useLive ? process.env.MONGODB_URI_LIVE : process.env.MONGODB_URI;
if (!uri) {
  console.error(`MISSING env: ${useLive ? "MONGODB_URI_LIVE" : "MONGODB_URI"} not set`);
  process.exit(1);
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

async function main() {
  const client = new MongoClient(uri!, { directConnection: true });
  await client.connect();
  console.log(apply ? "=== APPLY MODE ===" : "=== DRY RUN ===");
  try {
    const db = client.db("a-house-divided");
    const gameState = db.collection<{ _id: string; preset?: string; activePreset?: string }>(
      "gameState"
    );
    const gs =
      (await gameState.findOne({ _id: "current" })) ?? (await gameState.findOne({ _id: "main" }));
    const preset = presetArg ?? gs?.preset ?? gs?.activePreset ?? "1991-default";
    console.log(`preset: ${preset}`);

    const ngStates = await db
      .collection<StateDoc>("states")
      .find({ countryId: "NG" }, { projection: { _id: 1, countryId: 1, population: 1 } })
      .toArray();
    const existing = new Set(
      (
        await db
          .collection<RegionDemographics>("regionDemographics")
          .find({ _id: { $in: ngStates.map((s) => s._id) } }, { projection: { _id: 1 } })
          .toArray()
      ).map((d) => String(d._id))
    );

    const now = new Date();
    let covered = 0;
    for (const state of ngStates) {
      const id = String(state._id);
      if (existing.has(id)) {
        console.log(`  ${id}: already has regionDemographics — skip`);
        continue;
      }
      const population = state.population ?? 0;
      const census = getRegionCensusData("NG", id, preset) as {
        age: Record<string, number>;
      } | null;
      if (!census || !(population > 0)) {
        console.log(`  ${id}: SKIP (${!census ? "no census for " + preset : "no population"})`);
        continue;
      }
      const metrics = await db.collection<MetricsDoc>("stateMetrics").findOne(
        { _id: id },
        {
          projection: {
            "population.medianAge": 1,
            "population.birthRate": 1,
            "population.migrationRate": 1,
          },
        }
      );
      const medianAge = metrics?.population?.medianAge?.value ?? 38;
      const birthRate = metrics?.population?.birthRate?.value ?? 50;
      const migrationRate = metrics?.population?.migrationRate?.value ?? 0;

      const vector = synthesizeAgeSexVector({
        adultShares: {
          young: census.age.young ?? 0,
          mid: census.age.mid ?? 0,
          mature: census.age.mature ?? 0,
          senior: census.age.senior ?? 0,
        },
        medianAge,
        birthRate,
        population,
      });
      const ages = {
        male: vector.male.map((c) => Math.round(c)),
        female: vector.female.map((c) => Math.round(c)),
      };
      const summed = ages.male.reduce((a, b) => a + b, 0) + ages.female.reduce((a, b) => a + b, 0);
      const sr = clamp(sexRatioFromVector(ages), 0, 100);
      const dr = clamp(dependencyRatio(ages), 0, 3);
      console.log(
        `  ${id}: build cohort — pop target ${fmt(population)}, synthesized ${fmt(summed)}; sexRatio=${sr.toFixed(1)} dependencyRatio=${dr.toFixed(2)}`
      );
      covered++;

      if (apply) {
        await db
          .collection<RegionDemographics>("regionDemographics")
          .updateOne(
            { _id: id },
            { $set: { countryId: "NG", ages, lastUpdated: now } },
            { upsert: true }
          );
        await db.collection<StateMetrics>("stateMetrics").updateOne(
          { _id: id },
          {
            $set: {
              "population.sexRatio.value": sr,
              "population.dependencyRatio.value": dr,
              "population.realizedMigrationRate.value": clamp(migrationRate, -10, 10),
            },
          }
        );
      }
    }
    console.log(
      `\n${apply ? "APPLIED" : "WOULD SEED"}: ${covered} NG region cohort vectors (${ngStates.length} NG regions, ${existing.size} already present).`
    );
  } finally {
    await client.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
