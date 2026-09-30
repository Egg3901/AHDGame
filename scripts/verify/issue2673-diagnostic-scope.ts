/** Native diagnostic qualification in a generated disposable test database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient } from "mongodb";
import { STATE_IDS } from "../../src/lib/constants/states";

async function main() {
  const uri = process.env.AHD_TEST_MONGODB_URI;
  assert(uri, "AHD_TEST_MONGODB_URI is required");
  assert.equal(process.env.NODE_ENV, "test", "Run with NODE_ENV=test");
  const databaseName = `ahd_diagnostic_scope_${randomUUID().replaceAll("-", "")}`;
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = databaseName;
  process.env.MONGO_DB_NAME = databaseName;
  const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(databaseName);
  const cases: string[] = [];
  try {
    const { runConformanceChecks } = await import("../../src/lib/admin/seedDiagnostic/conformance");
    const { seedTurnoutScopeFilter } =
      await import("../../src/lib/admin/seedDiagnostic/regionalCoverage");
    const regions = Array.from({ length: 12 }, (_, index) => `test_uk_${index}`);
    await db
      .collection<{ _id: string; countryId: string }>("states")
      .insertMany(regions.map((_id) => ({ _id, countryId: "UK" })));
    const metrics = db.collection<{ _id: string; countryId: string }>("macroMetrics");
    await metrics.insertMany([...regions, "uk_national"].map((_id) => ({ _id, countryId: "UK" })));
    const turnout = db.collection<{ _id: string; countryId?: string | null }>(
      "stateDemographicTurnout"
    );
    await turnout.insertMany(STATE_IDS.map((_id) => ({ _id })));
    let report = await runConformanceChecks(db, { preset: "1991-default" });
    assert.deepEqual(
      report.checks.find((check) => check.id === "regions.UK.metrics"),
      {
        id: "regions.UK.metrics",
        scope: "UK",
        metric: "macroMetrics regional coverage",
        expected: 12,
        actual: 12,
        severity: "ok",
        note: "all region identities covered; national summaries excluded",
      }
    );
    assert.equal(report.checks.find((check) => check.id === "demographics.US.turnout")?.actual, 50);
    assert.equal(
      report.checks.find((check) => check.id === "demographics.US.turnout")?.severity,
      "ok"
    );
    cases.push(
      "12 UK regions plus national summary; 50 legacy US turnout rows recognized by full diagnostic"
    );

    await metrics.deleteOne({ _id: regions[0] });
    await metrics.insertOne({ _id: "test_orphan", countryId: "UK" });
    report = await runConformanceChecks(db, { preset: "1991-default" });
    const coverage = report.checks.find((check) => check.id === "regions.UK.metrics");
    assert.equal(coverage?.severity, "warn");
    assert.equal(coverage?.actual, 11);
    assert.match(coverage?.note ?? "", /missing: test_uk_0/);
    assert.match(coverage?.note ?? "", /orphan: test_orphan/);
    cases.push("equal totals cannot mask missing and orphan identities");

    await turnout.insertMany([{ _id: "DC", countryId: null }, { _id: "test_foreign_legacy" }]);
    assert.equal(await turnout.countDocuments(seedTurnoutScopeFilter("US")), 51);
    assert.equal(await turnout.countDocuments(seedTurnoutScopeFilter("UK")), 0);
    cases.push("null-country DC accepted; unknown untagged id excluded from both countries");

    await turnout.updateOne({ _id: "PA" }, { $set: { countryId: "UK" } });
    assert.equal(await turnout.countDocuments(seedTurnoutScopeFilter("US")), 50);
    assert.equal(await turnout.countDocuments(seedTurnoutScopeFilter("UK")), 1);
    cases.push("explicit foreign country tag overrides a US-looking key");
    console.log(JSON.stringify({ passed: cases.length, cases }, null, 2));
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
