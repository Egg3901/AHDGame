/**
 * #3369 bounded qualification: the real 1991 bootstrap and the real
 * demographic phase in a disposable isolated mongod, for every populated 1991
 * region, on a fresh database and on a reference rebuild over an evolved world that holds
 * stale and retired stocks. Writes the public report under scripts/sim/reports.
 *
 *   AHD_SIM_REPORT=1 AHD_TEST_REAL_MONGO=1 npx vitest run scripts/sim/cohortCoverage1991.mongo.test.ts
 *
 * Skipped without both flags. seedCohortVectors1991.mongo.test.ts carries the
 * fast 87-region gate in the opt-in real-Mongo suite.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import type { Db } from "mongodb";
import {
  REAL_MONGO_ENABLED,
  startIsolatedMongod,
  stopIsolatedMongod,
  type IsolatedMongod,
} from "@/lib/test-utils/realMongoFixture";
import {
  evaluateScenario,
  readProvenance,
  renderMarkdown,
  summarizeScenario,
  type Ages,
  type CoverageReport,
  type WorldSnapshot,
} from "./cohortCoverage1991";

let fixture: IsolatedMongod | null = null;
let db: Db;
vi.mock("@/lib/mongodb", () => ({
  getDb: vi.fn(async () => db),
  getMongoClient: vi.fn(async () => fixture!.client),
}));

const TURNS = 3;
const REPORT = "scripts/sim/reports/1991-cohort-coverage-3369";
const HARNESS_FILES = [
  "scripts/sim/cohortCoverage1991.ts",
  "scripts/sim/cohortCoverage1991.mongo.test.ts",
];
const SOURCE_FILES = [
  ...HARNESS_FILES,
  "src/lib/seeds/reference/cohortAgeSources1991.ts",
  "src/lib/seeds/reference/cohortAgeProfiles1991.ts",
  "src/lib/seeds/rules/cohortAgeShares1991.ts",
  "src/lib/admin/seed/seedCohortVectors.ts",
  "src/lib/admin/bootstrapGameWorld.ts",
  "src/lib/demographics/seedSynthesis.ts",
  "src/lib/demographics/cohortFlows.ts",
  "src/lib/demographics/phase.ts",
];
/** Stocks a prior world could leave behind: the observed stale CEN total, an
 * inflated union republic, and region ids no 1991 roster contains. */
const STALE = [
  { _id: "CEN", countryId: "RU", people: 39_862_013 },
  { _id: "SU_UKR", countryId: "RU", people: 60_000_000 },
  { _id: "RU_RETIRED", countryId: "RU", people: 1_000_000 },
  { _id: "PL_RETIRED", countryId: "PL", people: 250_000 },
];

describe.runIf(process.env.AHD_SIM_REPORT === "1" && REAL_MONGO_ENABLED)(
  "1991 cohort coverage qualification (#3369)",
  () => {
    beforeAll(async () => {
      fixture = await startIsolatedMongod("ahd-cohort-cov-1991-");
      db = fixture.db;
    }, 60_000);
    afterAll(async () => {
      await stopIsolatedMongod(fixture);
      fixture = null;
    });

    it("seeds and evolves every populated 1991 region without a jump", async () => {
      const { bootstrapGameWorld } = await import("@/lib/admin/bootstrapGameWorld");
      const { runDemographicFlows } = await import("@/lib/demographics/phase");
      const { NATIONAL_SCOPE_IDS } = await import("@/lib/constants/nationalScope");
      const { cohortAgeShares1991, cohortAgeSource1991 } =
        await import("@/lib/seeds/rules/cohortAgeShares1991");
      const { COHORT_AGE_SOURCES_1991, COHORT_AGE_SOURCE_URLS_1991 } =
        await import("@/lib/seeds/reference/cohortAgeSources1991");
      const { getRegionCensusData } = await import("@/lib/seeds/regionCensusData");
      const preset = "1991-default";

      const bootstrap = (fresh: boolean) =>
        bootstrapGameWorld({
          db,
          preset,
          resetReference: true,
          log: () => {},
          ...(fresh ? { fresh1991VehicleModelSeed: true, fresh1991MediaTaxonomySeed: true } : {}),
        });

      async function snapshot(): Promise<WorldSnapshot> {
        const [states, stocks] = await Promise.all([
          db
            .collection<{ _id: string; countryId: string; population?: number }>("states")
            .find({}, { projection: { countryId: 1, population: 1 } })
            .toArray(),
          db
            .collection<{ _id: string; ages: Ages }>("regionDemographics")
            .find({}, { projection: { ages: 1 } })
            .toArray(),
        ]);
        const stockById = new Map(stocks.map((s) => [String(s._id), s.ages]));
        const regions: WorldSnapshot["regions"] = new Map();
        for (const state of states) {
          const id = String(state._id);
          if (NATIONAL_SCOPE_IDS.has(id) || !((state.population ?? 0) > 0)) continue;
          regions.set(id, {
            countryId: state.countryId,
            statePopulation: state.population!,
            stock: stockById.get(id) ?? null,
          });
        }
        return {
          regions,
          orphanStocks: [...stockById.keys()].filter((id) => !regions.has(id)).sort(),
        };
      }

      async function runTurns(): Promise<WorldSnapshot[]> {
        const current = await db
          .collection<{ _id: string; currentTurn?: number }>("gameState")
          .findOne({ _id: "current" });
        const first = current?.currentTurn ?? 1;
        const out: WorldSnapshot[] = [];
        for (let turn = first; turn < first + TURNS; turn++) {
          const phase = await runDemographicFlows(db, turn);
          out.push(await snapshot());
          expect(phase.regionsProcessed, `turn ${turn}`).toBe(out.at(-1)!.regions.size);
          // The full turn host advances this clock. This bounded harness must
          // do the same, so the next scenario does not replay old frozen
          // demographic receipts against newly reseeded stocks.
          await db
            .collection<{ _id: string; currentTurn: number }>("gameState")
            .updateOne({ _id: "current" }, { $set: { currentTurn: turn + 1 } });
        }
        return out;
      }

      const sourceOf = (countryId: string, id: string) => {
        if (countryId !== "FR" && countryId !== "ES") {
          const key = cohortAgeSource1991(countryId, id);
          if (key) return { source: key, affected: true };
        }
        if (cohortAgeShares1991(countryId, id, preset))
          return { source: `${countryId} 1991 profile`, affected: false };
        return { source: "census bundle", affected: false };
      };
      const expectedAdult = (countryId: string, id: string) =>
        cohortAgeShares1991(countryId, id, preset) ??
        (
          getRegionCensusData(countryId as never, id, preset) as {
            age?: { young: number; mid: number; mature: number; senior: number };
          } | null
        )?.age ??
        null;
      // Fresh: an empty database, as a new world.
      const startedAt = Date.now();
      await bootstrap(true);
      const freshSeed = await snapshot();
      const fresh = evaluateScenario({
        seed: freshSeed,
        turns: await runTurns(),
        sourceOf,
        expectedAdult,
      });

      // Reference rebuild: the evolved fresh world plus prior-world stocks,
      // then the same bootstrap without clearing anything first. This exercises
      // the reseeding path, not resetGameWorld or its world-epoch lifecycle.
      const flat = (total: number) => ({
        male: Array.from({ length: 101 }, () => total / 202),
        female: Array.from({ length: 101 }, () => total / 202),
      });
      for (const stale of STALE) {
        await db
          .collection<{ _id: string }>("regionDemographics")
          .updateOne(
            { _id: stale._id },
            { $set: { countryId: stale.countryId, ages: flat(stale.people) } },
            { upsert: true }
          );
      }
      const staleIds = STALE.map((s) => s._id);
      expect(
        await db.collection<{ _id: string }>("regionDemographics").countDocuments({
          _id: { $in: staleIds },
        })
      ).toBe(STALE.length);
      await bootstrap(false);
      const staleSeed = await snapshot();
      const staleReset = evaluateScenario({
        seed: staleSeed,
        turns: await runTurns(),
        sourceOf,
        expectedAdult,
      });
      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);

      const sameSeed =
        freshSeed.regions.size === staleSeed.regions.size &&
        [...freshSeed.regions].every(([id, region]) => {
          const other = staleSeed.regions.get(id);
          return (
            other?.statePopulation === region.statePopulation &&
            JSON.stringify(other.stock) === JSON.stringify(region.stock)
          );
        });

      const affected = fresh.rows.filter((row) => row.affected);
      const usedSources = [...new Set(affected.map((row) => row.source))].sort();
      const report: CoverageReport & Record<string, unknown> = {
        issue: 3369,
        preset,
        provenance: readProvenance(HARNESS_FILES, SOURCE_FILES),
        fixture:
          "disposable isolated mongod from the shared real-Mongo test fixture; " +
          "bootstrapGameWorld(1991-default, resetReference) then runDemographicFlows per turn; " +
          `no live, sandbox or worker database; wall clock ${elapsedSeconds}s on the run host`,
        scope:
          `Every populated 1991 region the real bootstrap seeds (${fresh.rows.length}), of which ` +
          `${affected.length} take a #3369 dated age source. Two scenarios, ${TURNS} demographic ` +
          "turns each: fresh database, and a reset over the evolved world after injecting stale " +
          "and retired stocks. Seeded inputs (populations, median age, birth rate, healthcare, " +
          "economy metrics) are the bootstrap's own; only the demographic phase advances.",
        limits: (await import("./cohortCoverage1991")).LIMITS,
        notCovered: [
          `Not a world simulation: ${TURNS} demographic turns per scenario, not a 48-turn or multi-year run, and no other turn phase runs between them.`,
          "No economy, budget, labour market, election, seat apportionment or party outcome is measured or assured.",
          "No historical calibration of regional age structure: #3369 sources are national or successor-state shapes applied to aggregate regions as explicit proxies; WDI rows are UN WPP model estimates.",
          "No live or saved world is read or repaired; the live repair stays a separate reviewed proposal.",
          "Reset is exercised as bootstrapGameWorld over an existing database, not through the admin reset route or the 1991 clear path.",
        ],
        sources: usedSources.map((key) => {
          const row = COHORT_AGE_SOURCES_1991[key]!;
          return {
            key,
            family: row.family,
            geo: row.geo,
            referenceDate: row.referenceDate,
            revision: row.revision,
            retrievedAt: row.retrievedAt,
            url: COHORT_AGE_SOURCE_URLS_1991[row.family].replace("{geo}", row.geo),
            regions: affected.filter((r) => r.source === key).map((r) => r.id),
          };
        }),
        injectedStaleStocks: STALE,
        scenarios: [
          summarizeScenario(
            "fresh",
            "Empty isolated database, bootstrap, then demographic turns.",
            TURNS,
            fresh
          ),
          summarizeScenario(
            "reference rebuild",
            `Evolved fresh world plus injected stocks (${staleIds.join(", ")}), bootstrap references again, then three new demographic turns with a continuing turn clock. This does not exercise full world teardown.`,
            TURNS,
            staleReset
          ),
        ],
        freshMatchesStaleReset: sameSeed,
      };

      writeFileSync(`${REPORT}.json`, JSON.stringify(report, null, 2) + "\n");
      writeFileSync(
        `${REPORT}.md`,
        renderMarkdown(report) +
          "\n## Dated #3369 sources used\n\n| Source | Family | Geo | Reference date | Revision | Regions |\n|---|---|---|---|---|---:|\n" +
          (report.sources as Array<Record<string, unknown>>)
            .map(
              (s) =>
                `| ${s.key} | ${s.family} | ${s.geo} | ${s.referenceDate} | ${s.revision} | ${(s.regions as string[]).length} |`
            )
            .join("\n") +
          "\n"
      );

      expect(affected).toHaveLength(87);
      expect(staleReset.rows.filter((row) => row.affected)).toHaveLength(87);
      expect(fresh.failures).toEqual([]);
      expect(staleReset.failures).toEqual([]);
      expect(sameSeed).toBe(true);
    }, 3_600_000);
  }
);
