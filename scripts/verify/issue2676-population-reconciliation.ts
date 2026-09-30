/** Qualify actual country seeders and population-derived cohort stocks in a disposable database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";

async function main() {
  assert.equal(process.env.NODE_ENV, "test", "Run with NODE_ENV=test");
  const uri = process.env.AHD_TEST_MONGODB_URI;
  assert(uri, "AHD_TEST_MONGODB_URI is required");
  const databaseName = `ahd_population_${randomUUID().replaceAll("-", "")}`;
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = databaseName;
  process.env.MONGO_DB_NAME = databaseName;
  const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(databaseName);
  try {
    const { seedCNRegions } = await import("../../src/lib/admin/seed/seedCN");
    const { seedNGRegions } = await import("../../src/lib/admin/seed/seedNG");
    const { seedFRRegions } = await import("../../src/lib/admin/seed/seedFR");
    const { seedESRegions } = await import("../../src/lib/admin/seed/seedES");
    const { seedSERegions } = await import("../../src/lib/admin/seed/seedSE");
    const { seedTRRegions } = await import("../../src/lib/admin/seed/seedTR");
    const { seedCohortVectors } = await import("../../src/lib/admin/seed/seedCohortVectors");
    const { runConformanceChecks } = await import("../../src/lib/admin/seedDiagnostic/conformance");
    const { POPULATION_TOTALS_1991 } =
      await import("../../src/lib/seeds/reference/populationTotals1991");
    const seeders = [
      seedCNRegions,
      seedNGRegions,
      seedFRRegions,
      seedESRegions,
      seedSERegions,
      seedTRRegions,
    ];
    const log = () => {};
    for (const seed of seeders) await seed(db, true, log, "1991-default");
    const initial = await db.collection("states").find().sort({ _id: 1 }).toArray();
    assert.equal(initial.length, 45);
    for (const seed of seeders) await seed(db, true, log, "1991-default");
    assert.deepEqual(await db.collection("states").find().sort({ _id: 1 }).toArray(), initial);
    const diagnostic = await runConformanceChecks(db, { preset: "1991-default" });
    const checks = Object.keys(POPULATION_TOTALS_1991).map((country) => {
      const check = diagnostic.checks.find((row) => row.id === `regions.${country}.populationSum`);
      assert(check, country);
      assert.equal(check.severity, "ok", country);
      assert.equal(
        check.actual,
        POPULATION_TOTALS_1991[country as keyof typeof POPULATION_TOTALS_1991].population
      );
      assert.equal(check.actual, check.expected);
      return check;
    });
    const cohorts = await seedCohortVectors(db, "1991-default", log);
    // #2728 now supplies explicit 1991 age-only proxies for the 16 FR/ES regions.
    assert.equal(cohorts.covered, 45);
    assert.deepEqual(cohorts.skipped, []);
    const stocks = await db
      .collection<{ _id: string; ages: { male: number[]; female: number[] } }>("regionDemographics")
      .find()
      .toArray();
    assert.equal(stocks.length, 45);
    let expectedTarget = 0;
    let roundingTolerance = 0;
    for (const stock of stocks) {
      const state = initial.find((entry) => String(entry._id) === stock._id);
      assert(state);
      const people = [...stock.ages.male, ...stock.ages.female].reduce(
        (sum, value) => sum + value,
        0
      );
      const tolerance = (stock.ages.male.length + stock.ages.female.length) / 2;
      assert(Math.abs(people - Number(state.population)) <= tolerance, stock._id);
      expectedTarget += Number(state.population);
      roundingTolerance += tolerance;
    }
    assert.equal(cohorts.totalTargetPop, expectedTarget);
    assert(Math.abs(cohorts.totalPeople - expectedTarget) <= roundingTolerance);
    const repeated = await seedCohortVectors(db, "1991-default", log);
    assert.equal(repeated.covered, 45);
    const repeatedStocks = await db
      .collection<{ _id: string; ages: { male: number[]; female: number[] } }>("regionDemographics")
      .find()
      .toArray();
    for (const stock of stocks) {
      assert.deepEqual(repeatedStocks.find((row) => row._id === stock._id)?.ages, stock.ages);
    }
    await db.collection("gameState").updateOne(
      { _id: "current" } as never,
      {
        $set: {
          preset: "1991-default",
          startingYear: 1991,
          currentYear: 1991,
          currentTurn: 1,
          livingConflictsEnabled: false,
        },
      },
      { upsert: true }
    );
    const { runDemographicFlows } = await import("../../src/lib/demographics/phase");
    for (let turn = 1; turn <= 10; turn++) {
      const phase = await runDemographicFlows(db, turn);
      assert.equal(phase.regionsProcessed, 45);
      const currentStates = await db.collection("states").find().toArray();
      const currentStocks = await db
        .collection<{ _id: string; ages: { male: number[]; female: number[] } }>(
          "regionDemographics"
        )
        .find()
        .toArray();
      assert.equal(currentStocks.length, 45);
      for (const stock of currentStocks) {
        const cells = [...stock.ages.male, ...stock.ages.female];
        assert.equal(cells.length, 202);
        assert(
          cells.every((value) => Number.isFinite(value) && value >= 0),
          stock._id
        );
        const people = cells.reduce((sum, value) => sum + value, 0);
        const state = currentStates.find((row) => String(row._id) === stock._id);
        assert(state && people > 0);
        assert(Math.abs(people - Number(state.population)) <= 0.500001, stock._id);
      }
    }
    console.log(
      JSON.stringify(
        {
          passed: 5,
          cases: [
            "actual six-country seeders write45 reconciled regions and repeat deterministically",
            "full conformance reports exact national population equality for all six countries",
            "actual cohort seeder consumes corrected populations for all45 regions, including16 FR/ES age-only proxies",
            "repeated cohort seeding preserves all45 age/sex vectors",
            "ten actual demographic phase calls process all45 regions with finite nonnegative stocks and matching state totals",
          ],
          populationChecks: checks,
          cohorts,
        },
        null,
        2
      )
    );
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
      const { closeDb } = await import("../utils/db");
      await closeDb();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
