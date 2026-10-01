/** Targeted native Mongo qualification. Requires NODE_ENV=test and an explicit test URI. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { MongoClient, MongoServerError, ObjectId } from "mongodb";

async function main() {
  const uri = process.env.AHD_TEST_MONGODB_URI;
  assert(uri, "AHD_TEST_MONGODB_URI is required");
  assert.equal(process.env.NODE_ENV, "test", "Run with NODE_ENV=test");
  const databaseName = `ahd_reset_cleanup_qualification_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
  // Any ambient database helper must resolve this same disposable database.
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = databaseName;
  process.env.MONGO_DB_NAME = databaseName;
  const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(databaseName);
  const { resetGameWorld } = await import("../../src/lib/admin/resetGameWorld");
  const { resetAndBootstrapGameWorld } =
    await import("../../src/lib/admin/resetAndBootstrapGameWorld");
  const repairedCollections = [
    "conflicts",
    "peaceOffers",
    "politicalMetricsHistory",
    "politicalMetricsRegionHistory",
    "politicalCabinetContribution",
    "nationalManpower",
    "regionalBudgets",
    "unions",
    "unionEndorsements",
    "unionLeaderVotes",
    "unionOrganizers",
    "bargainingCampaigns",
    "collectiveAgreements",
    "landeslisten",
  ];
  const cases: Array<Record<string, unknown>> = [];
  try {
    await db
      .collection<{ _id: string; currentTurn: number; currentYear: number; preset: string }>(
        "gameState"
      )
      .insertOne({ _id: "current", currentTurn: 390, currentYear: 1991, preset: "1991-default" });
    const warId = new ObjectId();
    await db
      .collection("conflicts")
      .insertOne({ _id: warId, status: "active", startTurn: 390, hostCountryId: "DE" });
    await db.collection("peaceOffers").insertOne({ conflictId: warId, status: "pending" });
    for (const name of repairedCollections.slice(2)) {
      await db.collection(name).insertOne({ previousWorld: true, turn: 390 });
    }
    const referenceId = new ObjectId();
    await db.collection("states").insertOne({ _id: referenceId, marker: "reference control" });
    await db.collection("users").insertOne({ isAdmin: true, marker: "preserved account control" });
    for (const label of ["populated reset", "repeat reset"]) {
      await resetGameWorld(db, {
        deleteProfiles: true,
        preset: "1991-default",
        seedHistorical: false,
      });
      for (const name of repairedCollections)
        assert.equal(await db.collection(name).countDocuments(), 0, name);
      assert.equal(await db.collection("states").countDocuments({ _id: referenceId }), 1);
      assert.equal(
        await db.collection("users").countDocuments({ marker: "preserved account control" }),
        1
      );
      cases.push({
        label,
        clearedCollections: repairedCollections.length,
        referencesAndAccountsPreserved: true,
      });
    }
    await db.dropDatabase();
    await resetGameWorld(db, {
      deleteProfiles: true,
      preset: "1991-default",
      seedHistorical: false,
    });
    assert.equal(await db.collection("conflicts").countDocuments(), 0);
    cases.push({ label: "clean reset", staleConflicts: 0 });

    await db.collection("conflicts").insertOne({ status: "active", startTurn: 390 });
    const faultDb = new Proxy(db, {
      get(target, key) {
        if (key === "collection") {
          return (name: string) => {
            const collection = target.collection(name);
            if (name === "conflicts") {
              collection.drop = async () => {
                throw new MongoServerError({ message: "qualification drop denied", code: 13 });
              };
            }
            return collection;
          };
        }
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await assert.rejects(
      resetAndBootstrapGameWorld({ db: faultDb, preset: "1991-default", deleteProfiles: true }),
      /Required reset cleanup failed for: conflicts/
    );
    const failed = await db.collection("adminLogs").findOne({ "resetRun.status": "failed" });
    assert.equal(failed?.resetRun?.phaseReached, "teardown");
    assert.equal(await db.collection("conflicts").countDocuments(), 1);
    cases.push({
      label: "required cleanup failure",
      status: "failed",
      phase: "teardown",
      staleWorldNotClaimedAsReset: true,
    });
    console.log(JSON.stringify({ issue: 2671, cases, passed: cases.length }, null, 2));
  } finally {
    try {
      await db.dropDatabase();
    } finally {
      await client.close();
      if (global._mongoClientPromise) await (await global._mongoClientPromise).close();
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
