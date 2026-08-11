import type { AnyBulkWriteOperation, Db } from "mongodb";
import type { CountryId } from "@/lib/constants/countries";
import type { StateMetrics } from "@/lib/db/types";
import type { RegionDemographics } from "@/lib/db/types/regionDemographics";
import { NATIONAL_SCOPE_IDS } from "@/lib/constants/nationalScope";
import { getRegionCensusData } from "@/lib/seeds/regionCensusData";
import { synthesizeAgeSexVector } from "@/lib/demographics/seedSynthesis";
import { sexRatioFromVector, dependencyRatio } from "@/lib/demographics/cohortVector";

/**
 * Stand up the per-region single-year age×sex cohort vector (`regionDemographics.ages`) —
 * the SSOT population stock the demographic turn phase evolves — for a freshly seeded/reset
 * world, and stamp the seed-time derived population metrics (`sexRatio`, `dependencyRatio`,
 * `realizedMigrationRate`) onto `stateMetrics.population` so the Live Population panel is
 * populated at turn 0 instead of waiting for the first turn.
 *
 * Era-aware: synthesizes from each region's preset-appropriate census age-shares
 * (`getRegionCensusData`) + its seeded `population.medianAge` / `birthRate`. Uses the same
 * SSOT synthesis (`synthesizeAgeSexVector`) and derived-view helpers as the turn engine, so
 * the seeded stock is byte-identical to what the unit-tested engine produces.
 *
 * This is the shared core called both by `bootstrapGameWorld` (every reset) and the
 * standalone `2026-06-10-seed-cohort-vectors` migration (live worlds). `apply: false`
 * computes coverage stats without writing (the migration's dry-run).
 */

const DEFAULT_MEDIAN_AGE = 38;
const DEFAULT_BIRTH_RATE = 50; // neutral 0-100 index

// Mirror the metric bounds the turn phase clamps these to (phase.ts METRIC_BOUNDS).
const SEX_RATIO_BOUNDS: readonly [number, number] = [0, 100];
const DEPENDENCY_BOUNDS: readonly [number, number] = [0, 3];
const REALIZED_MIGRATION_BOUNDS: readonly [number, number] = [-10, 10];

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export interface CohortSeedStats {
  covered: number;
  skipped: string[];
  totalPeople: number;
  totalTargetPop: number;
}

interface StateDoc {
  _id: string;
  countryId: CountryId;
  population?: number;
}
interface MetricValue {
  value?: number;
}
interface MetricsDoc {
  _id: string;
  population?: { medianAge?: MetricValue; birthRate?: MetricValue; migrationRate?: MetricValue };
}

export async function seedCohortVectors(
  db: Db,
  preset: string,
  log: (msg: string) => void,
  opts: { apply?: boolean } = {}
): Promise<CohortSeedStats> {
  const apply = opts.apply !== false;

  const [states, metricsDocs] = await Promise.all([
    db
      .collection<StateDoc>("states")
      .find({}, { projection: { _id: 1, countryId: 1, population: 1 } })
      .toArray(),
    db
      .collection<MetricsDoc>("macroMetrics")
      .find(
        {},
        {
          projection: {
            _id: 1,
            "population.medianAge": 1,
            "population.birthRate": 1,
            "population.migrationRate": 1,
          },
        }
      )
      .toArray(),
  ]);

  const metricsById = new Map(metricsDocs.map((m) => [String(m._id), m]));
  const realStates = states.filter((s) => !NATIONAL_SCOPE_IDS.has(String(s._id)));

  const stats: CohortSeedStats = { covered: 0, skipped: [], totalPeople: 0, totalTargetPop: 0 };
  const now = new Date();
  const demoOps: AnyBulkWriteOperation<RegionDemographics>[] = [];
  const metricOps: AnyBulkWriteOperation<StateMetrics>[] = [];

  for (const state of realStates) {
    const id = String(state._id);
    const population = state.population ?? 0;
    const census = getRegionCensusData(state.countryId, id, preset);
    if (!census || !(population > 0)) {
      stats.skipped.push(`${id} (${state.countryId}): ${!census ? "no census" : "no population"}`);
      continue;
    }

    const age = (census as { age: Record<string, number> }).age;
    const metrics = metricsById.get(id);
    const medianAge = metrics?.population?.medianAge?.value ?? DEFAULT_MEDIAN_AGE;
    const birthRate = metrics?.population?.birthRate?.value ?? DEFAULT_BIRTH_RATE;
    const migrationRate = metrics?.population?.migrationRate?.value ?? 0;

    const vector = synthesizeAgeSexVector({
      adultShares: {
        young: age.young ?? 0,
        mid: age.mid ?? 0,
        mature: age.mature ?? 0,
        senior: age.senior ?? 0,
      },
      medianAge,
      birthRate,
      population,
    });

    // People are whole; round each cell. Deterministic → idempotent on a fresh world.
    const ages = {
      male: vector.male.map((c) => Math.round(c)),
      female: vector.female.map((c) => Math.round(c)),
    };
    const summed = ages.male.reduce((a, b) => a + b, 0) + ages.female.reduce((a, b) => a + b, 0);

    stats.covered++;
    stats.totalPeople += summed;
    stats.totalTargetPop += population;

    if (apply) {
      demoOps.push({
        updateOne: {
          filter: { _id: id },
          update: { $set: { countryId: state.countryId, ages, lastUpdated: now } },
          upsert: true,
        },
      });
      // Stamp the derived population metrics from the freshly built (rounded) vector so the
      // panel shows them at turn 0. realizedMigrationRate has no flow yet → seed the
      // configured migrationRate as the turn-0 readout.
      // Dotted paths, deliberately: this must touch only these three metric
      // leaves and leave the rest of the `population` subtree alone.
      metricOps.push({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: {
              "population.sexRatio.value": clamp(sexRatioFromVector(ages), ...SEX_RATIO_BOUNDS),
              "population.dependencyRatio.value": clamp(
                dependencyRatio(ages),
                ...DEPENDENCY_BOUNDS
              ),
              "population.realizedMigrationRate.value": clamp(
                migrationRate,
                ...REALIZED_MIGRATION_BOUNDS
              ),
            },
          },
        },
      });
    }
  }

  if (demoOps.length > 0) {
    await db
      .collection<RegionDemographics>("regionDemographics")
      .bulkWrite(demoOps, { ordered: true });
  }
  if (metricOps.length > 0) {
    await db.collection<StateMetrics>("macroMetrics").bulkWrite(metricOps, { ordered: true });
  }

  log(`Seeded ${stats.covered} region cohort vectors (${preset}; ${stats.skipped.length} skipped)`);
  return stats;
}
